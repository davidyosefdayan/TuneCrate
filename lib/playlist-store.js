const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'YouTube Music Resolve');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');

class PlaylistStore {
    constructor() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(PLAYLISTS_FILE)) {
                return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf-8'));
            }
        } catch (e) { /* ignore */ }
        return { playlists: [] };
    }

    _save() {
        fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(this.data, null, 2));
    }

    getAll() {
        return this.data.playlists;
    }

    create(name) {
        const playlist = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name,
            created: new Date().toISOString(),
            tracks: []
        };
        this.data.playlists.push(playlist);
        this._save();
        return playlist;
    }

    rename(id, name) {
        const pl = this.data.playlists.find(p => p.id === id);
        if (pl) {
            pl.name = name;
            this._save();
        }
        return pl;
    }

    remove(id) {
        this.data.playlists = this.data.playlists.filter(p => p.id !== id);
        this._save();
    }

    addTrack(playlistId, track) {
        const pl = this.data.playlists.find(p => p.id === playlistId);
        if (!pl) return null;
        // Avoid duplicates
        if (pl.tracks.some(t => t.videoId === track.videoId)) return pl;
        pl.tracks.push({
            videoId: track.videoId,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnail: track.thumbnail,
            localPath: track.localPath || null
        });
        this._save();
        return pl;
    }

    removeTrack(playlistId, videoId) {
        const pl = this.data.playlists.find(p => p.id === playlistId);
        if (!pl) return null;
        pl.tracks = pl.tracks.filter(t => t.videoId !== videoId);
        this._save();
        return pl;
    }

    setLocalPath(playlistId, videoId, localPath) {
        const pl = this.data.playlists.find(p => p.id === playlistId);
        if (!pl) return null;
        const track = pl.tracks.find(t => t.videoId === videoId);
        if (track) {
            track.localPath = localPath;
            this._save();
        }
        return pl;
    }
}

module.exports = PlaylistStore;
