const { spawn } = require('child_process');
const { once } = require('events');
const path = require('path');
const fs = require('fs');
const { resolveYtdlpPath } = require('./ytdlp-resolver');

// Progress is split into three phases per video:
// Phase 1: resolve the source (skipped for cached media URLs)
// Phase 2: fetch the media bytes
// Phase 3: local audio conversion

class AudioDownloader {
    constructor(settings, options = {}) {
        this.settings = settings;
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.activeDownloads = new Map();
        this.queue = [];
        this.processing = false;
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

    async download(videoId, title, format, onProgress, cachedUrl = null) {
        return new Promise((resolve, reject) => {
            this.queue.push({ videoId, title, format, onProgress, resolve, reject, cachedUrl });
            console.log(`[DOWNLOAD] Queued ${videoId}. queue_length=${this.queue.length} source=${cachedUrl ? 'media-url' : 'watch-url'}`);
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        const job = this.queue.shift();
        const { videoId, title, format, onProgress, resolve, reject, cachedUrl } = job;
        const startedAt = Date.now();
        console.log(`[DOWNLOAD] Starting job for ${videoId}. remaining_queue=${this.queue.length}`);

        const outputPath = this.getOutputPath(videoId, title, format);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        console.log(`[DOWNLOAD] Output path for ${videoId}: ${outputPath}`);

        if (cachedUrl) {
            this.downloadFromMediaUrl({
                videoId,
                format,
                outputPath,
                mediaUrl: cachedUrl,
                onProgress,
                startedAt
            }).then((finalPath) => {
                this.processing = false;
                this.scheduleNextJob();
                console.log(`[DOWNLOAD] Process closed for ${videoId} with code=0 after ${Date.now() - startedAt}ms`);
                resolve(finalPath);
            }).catch((error) => {
                this.processing = false;
                this.scheduleNextJob();
                console.error(`[DOWNLOAD] Process error for ${videoId} after ${Date.now() - startedAt}ms: ${error.message}`);
                reject(error);
            });
            return;
        }

        const source = `https://www.youtube.com/watch?v=${videoId}`;
        let ytdlp;
        try {
            ytdlp = resolveYtdlpPath(this.settings, path.join(__dirname, '..'));
            console.log(`[DOWNLOAD] Using yt-dlp binary for ${videoId}: ${ytdlp}`);
        } catch (error) {
            this.processing = false;
            console.error(`[DOWNLOAD] yt-dlp unavailable for ${videoId}: ${error.message}`);
            reject(new Error('yt-dlp is unavailable'));
            this.processQueue();
            return;
        }

        const args = [
            source,
            '-x',
            '--audio-format', format === 'wav' ? 'wav' : 'mp3',
            '--audio-quality', '0',
            '-o', outputPath,
            '--no-playlist',
            '--no-warnings',
            '--progress',
            '--newline',
            '--ffmpeg-location', this.getFfmpegPath(),
        ];

        if (!cachedUrl) {
            args.push('--js-runtimes', 'node');
            args.push('--extractor-args', 'youtube:player_client=default,web_music');
        }
        console.log(`[DOWNLOAD] Launching yt-dlp for ${videoId} with source=${cachedUrl ? 'media-url' : 'watch-url'}`);

        // Per-video randomized fetch cap (70-80%)
        const fetchCap = 70 + Math.random() * 10;
        const DOWNLOAD_END = 90; // download phase ends here, then conversion

        // Fetch phase: random 0.5-1.5% every 800-1400ms ≈ avg 1% per 1100ms ≈ ~17s to ~75%
        let fetchProgress = cachedUrl ? fetchCap : 1;
        let fetchTimeout = null;
        onProgress(fetchProgress);

        const scheduleFetchTick = () => {
            const delay = 800 + Math.random() * 600; // 800-1400ms
            fetchTimeout = setTimeout(() => {
                if (fetchProgress < fetchCap - 1) {
                    const increment = 0.5 + Math.random() * 1; // 0.5-1.5%
                    fetchProgress = Math.min(fetchProgress + increment, fetchCap - 1);
                    onProgress(fetchProgress);
                    scheduleFetchTick();
                }
            }, delay);
        };

        if (!cachedUrl) {
            scheduleFetchTick();
        }

        const proc = spawn(ytdlp, args);
        this.activeDownloads.set(videoId, {
            cancel: () => proc.kill('SIGTERM')
        });
        console.log(`[DOWNLOAD] Spawned yt-dlp for ${videoId}. pid=${proc.pid ?? 'unknown'}`);

        let lastRawProgress = 0;
        let seenDownloadProgress = false;
        let lastLogLine = '';

        const handleOutput = (data) => {
            const line = data.toString();
            const trimmed = line.trim();
            const match = line.match(/(\d+\.?\d*)%/);
            if (match) {
                const rawPct = parseFloat(match[1]);
                if (rawPct > lastRawProgress) {
                    lastRawProgress = rawPct;

                    // First real download progress — end fetch phase
                    if (!seenDownloadProgress) {
                        seenDownloadProgress = true;
                        if (fetchTimeout) clearTimeout(fetchTimeout);
                        console.log(`[DOWNLOAD] First byte progress for ${videoId} after ${Date.now() - startedAt}ms`);
                    }

                    if (rawPct >= 100) {
                        // yt-dlp download done, now ffmpeg converts — show 90%
                        console.log(`[DOWNLOAD] yt-dlp reported 100% for ${videoId}; waiting for conversion/exit`);
                        onProgress(DOWNLOAD_END);
                    } else {
                        // Map raw 0-100% into fetchCap → DOWNLOAD_END
                        const overall = fetchCap + (rawPct / 100) * (DOWNLOAD_END - fetchCap);
                        onProgress(Math.min(overall, DOWNLOAD_END - 1));
                    }
                }
            } else if (trimmed && trimmed !== lastLogLine) {
                lastLogLine = trimmed;
                if (/Destination:|ERROR|warning|Deleting original file|Extracting URL|Downloading webpage|Merging formats|Post-process/i.test(trimmed)) {
                    console.log(`[DOWNLOAD] ${videoId}: ${trimmed}`);
                }
            }
        };

        proc.stdout.on('data', handleOutput);
        proc.stderr.on('data', handleOutput);

        proc.on('close', (code) => {
            if (fetchTimeout) clearTimeout(fetchTimeout);
            this.activeDownloads.delete(videoId);
            this.processing = false;

            this.scheduleNextJob();
            console.log(`[DOWNLOAD] Process closed for ${videoId} with code=${code} after ${Date.now() - startedAt}ms`);

            if (code === 0) {
                onProgress(100);
                resolve(outputPath);
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });

        proc.on('error', (err) => {
            if (fetchTimeout) clearTimeout(fetchTimeout);
            this.activeDownloads.delete(videoId);
            this.processing = false;
            this.scheduleNextJob();
            console.error(`[DOWNLOAD] Process error for ${videoId} after ${Date.now() - startedAt}ms: ${err.message}`);
            reject(err);
        });
    }

    async downloadFromMediaUrl({ videoId, format, outputPath, mediaUrl, onProgress, startedAt }) {
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('Direct media downloads are unavailable');
        }

        const abortController = new AbortController();
        this.activeDownloads.set(videoId, {
            cancel: () => abortController.abort()
        });

        const tempPath = this.getTempDownloadPath(outputPath, mediaUrl);
        const fetchCap = 90;
        const writeStream = fs.createWriteStream(tempPath);
        let ffmpegProc = null;
        let lastLogLine = '';

        try {
            console.log(`[DOWNLOAD] Using direct media fetch for ${videoId}`);
            const response = await this.fetchImpl(mediaUrl, {
                signal: abortController.signal,
                headers: {
                    accept: '*/*'
                }
            });

            if (!response.ok || !response.body) {
                throw new Error(`Media fetch failed with status ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || 'unknown';
            const totalBytes = Number(response.headers.get('content-length')) || 0;
            console.log(`[DOWNLOAD] Fetch response for ${videoId}: status=${response.status} length=${totalBytes || 'unknown'} type=${contentType}`);

            const reader = response.body.getReader();
            let downloadedBytes = 0;
            let seenDownloadProgress = false;

            onProgress(5);

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
                    const overall = 5 + rawPct * (fetchCap - 5);
                    onProgress(Math.min(overall, fetchCap - 1));
                }
            }

            writeStream.end();
            await once(writeStream, 'finish');
            console.log(`[DOWNLOAD] Media fetch completed for ${videoId} after ${Date.now() - startedAt}ms`);
            onProgress(fetchCap);
            console.log(`[DOWNLOAD] Starting ffmpeg conversion for ${videoId}`);

            await new Promise((resolve, reject) => {
                const ffmpeg = this.getFfmpegPath();
                const args = this.getFfmpegArgs(tempPath, outputPath, format);
                ffmpegProc = spawn(ffmpeg, args);
                this.activeDownloads.set(videoId, {
                    cancel: () => ffmpegProc.kill('SIGTERM')
                });

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

    getTempDownloadPath(outputPath, mediaUrl) {
        const extension = this.getMediaExtension(mediaUrl);
        return `${outputPath}.download.${extension}`;
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
        this.queue = this.queue.filter(j => j.videoId !== videoId);
        if (removed !== this.queue.length) {
            console.log(`[DOWNLOAD] Removed queued download for ${videoId}`);
        }
    }
}

module.exports = AudioDownloader;
