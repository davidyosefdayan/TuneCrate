const { spawn } = require('child_process');
const { once } = require('events');
const path = require('path');
const fs = require('fs');
const { resolveYtdlpPath } = require('./ytdlp-resolver');
const { getChildEnv } = require('./child-env');

const WATCH_DOWNLOAD_PROGRESS_START_MIN = 70;
const WATCH_DOWNLOAD_PROGRESS_START_MAX = 80;
const DIRECT_DOWNLOAD_PROGRESS_START = 5;
const DOWNLOAD_END = 90;

class AudioDownloader {
    constructor(settings, options = {}) {
        this.settings = settings;
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.activeDownloads = new Map();
        this.queue = [];
        this.processing = false;
    }

    download(videoId, title, format, onProgress, source = { kind: 'watch-url' }) {
        return new Promise((resolve, reject) => {
            this.queue.push({ videoId, title, format, onProgress, resolve, reject, source });
            console.log(`[DOWNLOAD] Queued ${videoId}. queue_length=${this.queue.length} source=${source.kind}`);
            this.processQueue();
        });
    }

    processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        const job = this.queue.shift();
        const startedAt = Date.now();
        const outputPath = this.prepareOutputPath(job.videoId, job.title, job.format);

        console.log(`[DOWNLOAD] Starting job for ${job.videoId}. remaining_queue=${this.queue.length}`);
        console.log(`[DOWNLOAD] Output path for ${job.videoId}: ${outputPath}`);

        this.runJob(job, outputPath, startedAt)
            .then((finalPath) => this.finishJob(job, startedAt, finalPath))
            .catch((error) => this.failJob(job, startedAt, error));
    }

    async runJob(job, outputPath, startedAt) {
        if (job.source.kind === 'media-url') {
            return this.downloadFromMediaUrl({
                videoId: job.videoId,
                format: job.format,
                outputPath,
                mediaUrl: job.source.url,
                onProgress: job.onProgress,
                startedAt
            });
        }

        return this.downloadFromWatchUrl({
            videoId: job.videoId,
            format: job.format,
            outputPath,
            onProgress: job.onProgress,
            startedAt
        });
    }

    finishJob(job, startedAt, outputPath) {
        this.processing = false;
        this.scheduleNextJob();
        console.log(`[DOWNLOAD] Process closed for ${job.videoId} with code=0 after ${Date.now() - startedAt}ms`);
        job.resolve(outputPath);
    }

    failJob(job, startedAt, error) {
        this.processing = false;
        this.scheduleNextJob();
        console.error(`[DOWNLOAD] Process error for ${job.videoId} after ${Date.now() - startedAt}ms: ${error.message}`);
        job.reject(error);
    }

    scheduleNextJob() {
        setTimeout(() => this.processQueue(), 50);
    }

    getFfmpegPath() {
        const bundled = path.join(__dirname, '..', 'bin', 'ffmpeg');
        if (fs.existsSync(bundled)) return bundled;
        return 'ffmpeg';
    }

    getOutputPath(videoId, title, format) {
        const dir = this.settings.get('downloadDir');
        const safeName = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 80);
        return path.join(dir, `${safeName}_${videoId}.${format}`);
    }

    prepareOutputPath(videoId, title, format) {
        const outputPath = this.getOutputPath(videoId, title, format);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return outputPath;
    }

    resolveYtdlpBinary(videoId) {
        try {
            const ytdlp = resolveYtdlpPath(this.settings, path.join(__dirname, '..'));
            console.log(`[DOWNLOAD] Using yt-dlp binary for ${videoId}: ${ytdlp}`);
            return ytdlp;
        } catch (error) {
            console.error(`[DOWNLOAD] yt-dlp unavailable for ${videoId}: ${error.message}`);
            throw new Error('yt-dlp is unavailable');
        }
    }

    buildWatchDownloadArgs(videoId, format, outputPath) {
        return [
            `https://www.youtube.com/watch?v=${videoId}`,
            '-x',
            '--audio-format', format === 'wav' ? 'wav' : 'mp3',
            '--audio-quality', '0',
            '-o', outputPath,
            '--no-playlist',
            '--no-warnings',
            '--progress',
            '--newline',
            '--js-runtimes', 'node',
            '--extractor-args', 'youtube:player_client=default,web_music',
            '--ffmpeg-location', this.getFfmpegPath()
        ];
    }

    createWatchProgressTracker(videoId, onProgress, startedAt) {
        const fetchCap = WATCH_DOWNLOAD_PROGRESS_START_MIN + Math.random() * (WATCH_DOWNLOAD_PROGRESS_START_MAX - WATCH_DOWNLOAD_PROGRESS_START_MIN);
        let fetchProgress = 1;
        let fetchTimeout = null;
        let lastRawProgress = 0;
        let seenDownloadProgress = false;
        let lastLogLine = '';

        const scheduleFetchTick = () => {
            const delay = 800 + Math.random() * 600;
            fetchTimeout = setTimeout(() => {
                if (fetchProgress < fetchCap - 1) {
                    const increment = 0.5 + Math.random();
                    fetchProgress = Math.min(fetchProgress + increment, fetchCap - 1);
                    onProgress(fetchProgress);
                    scheduleFetchTick();
                }
            }, delay);
        };

        const handleOutput = (data) => {
            const line = data.toString();
            const trimmed = line.trim();
            const match = line.match(/(\d+\.?\d*)%/);

            if (match) {
                const rawPct = parseFloat(match[1]);
                if (rawPct <= lastRawProgress) {
                    return;
                }

                lastRawProgress = rawPct;
                if (!seenDownloadProgress) {
                    seenDownloadProgress = true;
                    this.clearTimer(fetchTimeout);
                    console.log(`[DOWNLOAD] First byte progress for ${videoId} after ${Date.now() - startedAt}ms`);
                }

                if (rawPct >= 100) {
                    console.log(`[DOWNLOAD] yt-dlp reported 100% for ${videoId}; waiting for conversion/exit`);
                    onProgress(DOWNLOAD_END);
                    return;
                }

                const overall = fetchCap + (rawPct / 100) * (DOWNLOAD_END - fetchCap);
                onProgress(Math.min(overall, DOWNLOAD_END - 1));
                return;
            }

            if (!trimmed || trimmed === lastLogLine) {
                return;
            }

            lastLogLine = trimmed;
            if (/Destination:|ERROR|warning|Deleting original file|Extracting URL|Downloading webpage|Merging formats|Post-process/i.test(trimmed)) {
                console.log(`[DOWNLOAD] ${videoId}: ${trimmed}`);
            }
        };

        return {
            start() {
                onProgress(fetchProgress);
                scheduleFetchTick();
            },
            handleOutput,
            dispose: () => this.clearTimer(fetchTimeout)
        };
    }

    async downloadFromWatchUrl({ videoId, format, outputPath, onProgress, startedAt }) {
        const ytdlp = this.resolveYtdlpBinary(videoId);
        const args = this.buildWatchDownloadArgs(videoId, format, outputPath);
        console.log(`[DOWNLOAD] Launching yt-dlp for ${videoId} with source=watch-url`);

        const progress = this.createWatchProgressTracker(videoId, onProgress, startedAt);
        progress.start();

        return new Promise((resolve, reject) => {
            const baseDir = path.join(__dirname, '..');
            const proc = spawn(ytdlp, args, { env: getChildEnv(baseDir) });
            this.activeDownloads.set(videoId, { cancel: () => proc.kill('SIGTERM') });
            console.log(`[DOWNLOAD] Spawned yt-dlp for ${videoId}. pid=${proc.pid ?? 'unknown'}`);

            proc.stdout.on('data', progress.handleOutput);
            proc.stderr.on('data', progress.handleOutput);

            proc.on('close', (code) => {
                progress.dispose();
                this.activeDownloads.delete(videoId);

                if (code === 0) {
                    onProgress(100);
                    resolve(outputPath);
                    return;
                }

                reject(new Error(`yt-dlp exited with code ${code}`));
            });

            proc.on('error', (error) => {
                progress.dispose();
                this.activeDownloads.delete(videoId);
                reject(error);
            });
        });
    }

    async downloadFromMediaUrl({ videoId, format, outputPath, mediaUrl, onProgress, startedAt }) {
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('Direct media downloads are unavailable');
        }

        const abortController = new AbortController();
        this.activeDownloads.set(videoId, { cancel: () => abortController.abort() });

        const tempPath = this.getTempDownloadPath(outputPath, mediaUrl);
        const writeStream = fs.createWriteStream(tempPath);
        let ffmpegProc = null;
        let lastLogLine = '';

        try {
            console.log(`[DOWNLOAD] Using direct media fetch for ${videoId}`);
            const response = await this.fetchImpl(mediaUrl, {
                signal: abortController.signal,
                headers: { accept: '*/*' }
            });

            if (!response.ok || !response.body) {
                throw new Error(`Media fetch failed with status ${response.status}`);
            }

            const totalBytes = Number(response.headers.get('content-length')) || 0;
            const contentType = response.headers.get('content-type') || 'unknown';
            console.log(`[DOWNLOAD] Fetch response for ${videoId}: status=${response.status} length=${totalBytes || 'unknown'} type=${contentType}`);

            const reader = response.body.getReader();
            let downloadedBytes = 0;
            let seenDownloadProgress = false;

            onProgress(DIRECT_DOWNLOAD_PROGRESS_START);

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                if (!seenDownloadProgress) {
                    seenDownloadProgress = true;
                    console.log(`[DOWNLOAD] First byte progress for ${videoId} after ${Date.now() - startedAt}ms`);
                }

                downloadedBytes += value.byteLength;
                if (!writeStream.write(Buffer.from(value))) {
                    await once(writeStream, 'drain');
                }

                if (totalBytes > 0) {
                    const rawPct = downloadedBytes / totalBytes;
                    const overall = DIRECT_DOWNLOAD_PROGRESS_START + rawPct * (DOWNLOAD_END - DIRECT_DOWNLOAD_PROGRESS_START);
                    onProgress(Math.min(overall, DOWNLOAD_END - 1));
                }
            }

            writeStream.end();
            await once(writeStream, 'finish');
            console.log(`[DOWNLOAD] Media fetch completed for ${videoId} after ${Date.now() - startedAt}ms`);
            onProgress(DOWNLOAD_END);
            console.log(`[DOWNLOAD] Starting ffmpeg conversion for ${videoId}`);

            await new Promise((resolve, reject) => {
                const ffmpeg = this.getFfmpegPath();
                ffmpegProc = spawn(ffmpeg, this.getFfmpegArgs(tempPath, outputPath, format), { env: getChildEnv(path.join(__dirname, '..')) });
                this.activeDownloads.set(videoId, { cancel: () => ffmpegProc.kill('SIGTERM') });

                ffmpegProc.stderr.on('data', (data) => {
                    const trimmed = data.toString().trim();
                    if (!trimmed || trimmed === lastLogLine) {
                        return;
                    }

                    lastLogLine = trimmed;
                    if (/error|size=|time=|speed=/i.test(trimmed)) {
                        console.log(`[DOWNLOAD] ${videoId}: ${trimmed}`);
                    }
                });

                ffmpegProc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                        return;
                    }

                    reject(new Error(`ffmpeg exited with code ${code}`));
                });

                ffmpegProc.on('error', reject);
            });

            console.log(`[DOWNLOAD] ffmpeg conversion completed for ${videoId} after ${Date.now() - startedAt}ms`);
            onProgress(100);
            return outputPath;
        } finally {
            this.activeDownloads.delete(videoId);
            writeStream.destroy();
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            if (ffmpegProc && !ffmpegProc.killed) {
                ffmpegProc.removeAllListeners();
            }
        }
    }

    clearTimer(timer) {
        if (timer) {
            clearTimeout(timer);
        }
    }

    getTempDownloadPath(outputPath, mediaUrl) {
        return `${outputPath}.download.${this.getMediaExtension(mediaUrl)}`;
    }

    getMediaExtension(mediaUrl) {
        try {
            const parsed = new URL(mediaUrl);
            const mime = parsed.searchParams.get('mime') || '';
            if (/audio\/mp4/i.test(mime)) return 'm4a';
            if (/audio\/webm/i.test(mime)) return 'webm';

            const pathname = parsed.pathname || '';
            const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
            if (match) {
                return match[1].toLowerCase();
            }
        } catch {
            // Fall back to a generic temp extension.
        }

        return 'media';
    }

    getFfmpegArgs(inputPath, outputPath, format) {
        if (format === 'wav') {
            return ['-y', '-i', inputPath, '-vn', '-acodec', 'pcm_s16le', outputPath];
        }

        return ['-y', '-i', inputPath, '-vn', '-codec:a', 'libmp3lame', '-q:a', '0', outputPath];
    }

    cancel(videoId) {
        const active = this.activeDownloads.get(videoId);
        if (active) {
            console.log(`[DOWNLOAD] Cancelling active download for ${videoId}`);
            active.cancel();
            this.activeDownloads.delete(videoId);
        }

        const removed = this.queue.length;
        this.queue = this.queue.filter((job) => job.videoId !== videoId);
        if (removed !== this.queue.length) {
            console.log(`[DOWNLOAD] Removed queued download for ${videoId}`);
        }
    }
}

module.exports = AudioDownloader;
