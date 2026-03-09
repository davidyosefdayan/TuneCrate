const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'YouTube Music Resolve');
const DOWNLOADS_FILE = path.join(DATA_DIR, 'downloads.json');

class DownloadStore {
    constructor() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(DOWNLOADS_FILE)) {
                return JSON.parse(fs.readFileSync(DOWNLOADS_FILE, 'utf-8'));
            }
        } catch (e) { /* ignore */ }
        return { downloads: [] };
    }

    _save() {
        fs.writeFileSync(DOWNLOADS_FILE, JSON.stringify(this.data, null, 2));
    }

    getAll() {
        return this.data.downloads;
    }

    add(track) {
        // Avoid duplicates — update if exists
        const idx = this.data.downloads.findIndex(d => d.videoId === track.videoId);
        const entry = {
            videoId: track.videoId,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnail: track.thumbnail,
            localPath: track.localPath,
            downloadedAt: new Date().toISOString()
        };
        if (idx >= 0) {
            this.data.downloads[idx] = entry;
        } else {
            this.data.downloads.unshift(entry); // newest first
        }
        this._save();
        return entry;
    }

    remove(videoId) {
        this.data.downloads = this.data.downloads.filter(d => d.videoId !== videoId);
        this._save();
    }
}

module.exports = DownloadStore;
