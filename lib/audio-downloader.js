const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class AudioDownloader {
    constructor(settings) {
        this.settings = settings;
        this.activeDownloads = new Map();
        this.queue = [];
        this.processing = false;
    }

    getYtdlpPath() {
        const custom = this.settings.get('ytdlpPath');
        if (custom && fs.existsSync(custom)) return custom;

        const bundled = path.join(__dirname, '..', 'bin', 'yt-dlp');
        if (fs.existsSync(bundled)) return bundled;

        return 'yt-dlp'; // fallback to PATH
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

    async download(videoId, title, format, onProgress) {
        return new Promise((resolve, reject) => {
            this.queue.push({ videoId, title, format, onProgress, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        const job = this.queue.shift();
        const { videoId, title, format, onProgress, resolve, reject } = job;

        const outputPath = this.getOutputPath(videoId, title, format);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const ytdlp = this.getYtdlpPath();

        const args = [
            url,
            '-x',
            '--audio-format', format === 'wav' ? 'wav' : 'mp3',
            '--audio-quality', '0',
            '-o', outputPath,
            '--no-playlist',
            '--progress',
            '--newline',
            '--ffmpeg-location', this.getFfmpegPath()
        ];

        const proc = spawn(ytdlp, args);
        this.activeDownloads.set(videoId, proc);

        let lastProgress = 0;

        proc.stdout.on('data', (data) => {
            const line = data.toString();
            const match = line.match(/(\d+\.?\d*)%/);
            if (match) {
                const pct = parseFloat(match[1]);
                if (pct > lastProgress) {
                    lastProgress = pct;
                    onProgress(pct);
                }
            }
        });

        proc.stderr.on('data', (data) => {
            const line = data.toString();
            const match = line.match(/(\d+\.?\d*)%/);
            if (match) {
                const pct = parseFloat(match[1]);
                if (pct > lastProgress) {
                    lastProgress = pct;
                    onProgress(pct);
                }
            }
        });

        proc.on('close', (code) => {
            this.activeDownloads.delete(videoId);
            this.processing = false;

            // Add delay before next download to avoid throttling
            setTimeout(() => this.processQueue(), 3000);

            if (code === 0) {
                onProgress(100);
                resolve(outputPath);
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });

        proc.on('error', (err) => {
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
        // Remove from queue
        this.queue = this.queue.filter(j => j.videoId !== videoId);
    }
}

module.exports = AudioDownloader;
