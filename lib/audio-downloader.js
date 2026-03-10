const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { resolveYtdlpPath } = require('./ytdlp-resolver');

// Progress is split into three phases per video:
// Phase 1 (0 → fetchCap):   Fetching/extracting URL from YouTube (~17s avg, skipped if cached)
// Phase 2 (fetchCap → 90%): Actual file download
// Phase 3 (90% → 100%):     ffmpeg conversion (yt-dlp hits 100% but process hasn't exited yet)
// fetchCap is randomized 70-80% per video so not every download stalls at the same spot

class AudioDownloader {
    constructor(settings) {
        this.settings = settings;
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
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        const job = this.queue.shift();
        const { videoId, title, format, onProgress, resolve, reject, cachedUrl } = job;

        const outputPath = this.getOutputPath(videoId, title, format);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const source = cachedUrl || `https://www.youtube.com/watch?v=${videoId}`;
        let ytdlp;
        try {
            ytdlp = resolveYtdlpPath(this.settings, path.join(__dirname, '..'));
        } catch (error) {
            this.processing = false;
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
        this.activeDownloads.set(videoId, proc);

        let lastRawProgress = 0;
        let seenDownloadProgress = false;
        let conversionStarted = false;

        const handleOutput = (data) => {
            const line = data.toString();
            const match = line.match(/(\d+\.?\d*)%/);
            if (match) {
                const rawPct = parseFloat(match[1]);
                if (rawPct > lastRawProgress) {
                    lastRawProgress = rawPct;

                    // First real download progress — end fetch phase
                    if (!seenDownloadProgress) {
                        seenDownloadProgress = true;
                        if (fetchTimeout) clearTimeout(fetchTimeout);
                    }

                    if (rawPct >= 100) {
                        // yt-dlp download done, now ffmpeg converts — show 90%
                        conversionStarted = true;
                        onProgress(DOWNLOAD_END);
                    } else {
                        // Map raw 0-100% into fetchCap → DOWNLOAD_END
                        const overall = fetchCap + (rawPct / 100) * (DOWNLOAD_END - fetchCap);
                        onProgress(Math.min(overall, DOWNLOAD_END - 1));
                    }
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
            reject(err);
        });
    }

    cancel(videoId) {
        const proc = this.activeDownloads.get(videoId);
        if (proc) {
            proc.kill('SIGTERM');
            this.activeDownloads.delete(videoId);
        }
        this.queue = this.queue.filter(j => j.videoId !== videoId);
    }
}

module.exports = AudioDownloader;
