const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { resolveYtdlpPath } = require('./ytdlp-resolver');

// Progress is split into two phases:
// Phase 1 (0-20%): Fetching/extracting URL from YouTube (skipped if cached URL provided)
// Phase 2 (20-100%): Actual file download + conversion
const FETCH_PHASE = 20;

class AudioDownloader {
    constructor(settings) {
        this.settings = settings;
        this.activeDownloads = new Map();
        this.queue = [];
        this.processing = false;
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

        // Start fetch phase — animate progress from 0 toward FETCH_PHASE
        let fetchProgress = cachedUrl ? FETCH_PHASE : 2; // skip fetch phase if cached
        let fetchInterval = null;
        onProgress(fetchProgress);

        if (!cachedUrl) {
            // Gradually increment during fetch phase to show activity
            fetchInterval = setInterval(() => {
                if (fetchProgress < FETCH_PHASE - 2) {
                    fetchProgress += 1;
                    onProgress(fetchProgress);
                }
            }, 800);
        }

        const proc = spawn(ytdlp, args);
        this.activeDownloads.set(videoId, proc);

        let lastRawProgress = 0;
        let seenDownloadProgress = false;

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
                        if (fetchInterval) clearInterval(fetchInterval);
                    }

                    // Map raw 0-100% to FETCH_PHASE-100% of overall progress
                    const overall = FETCH_PHASE + (rawPct / 100) * (100 - FETCH_PHASE);
                    onProgress(Math.min(overall, 99));
                }
            }
        };

        proc.stdout.on('data', handleOutput);
        proc.stderr.on('data', handleOutput);

        proc.on('close', (code) => {
            if (fetchInterval) clearInterval(fetchInterval);
            this.activeDownloads.delete(videoId);
            this.processing = false;

            setTimeout(() => this.processQueue(), 3000);

            if (code === 0) {
                onProgress(100);
                resolve(outputPath);
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });

        proc.on('error', (err) => {
            if (fetchInterval) clearInterval(fetchInterval);
            this.activeDownloads.delete(videoId);
            this.processing = false;
            setTimeout(() => this.processQueue(), 3000);
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
