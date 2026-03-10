const fs = require('fs');
const path = require('path');
const os = require('os');
const { DATA_DIR } = require('./shared-paths');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Music', 'YouTube Music Resolve');

const DEFAULTS = {
    downloadDir: DEFAULT_DOWNLOAD_DIR,
    userDownloadDir: DEFAULT_DOWNLOAD_DIR,
    defaultFormat: 'mp3',
    autoImport: false,
    syncToProject: false
};

class SettingsStore {
    constructor() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        this.data = this._load();

        // Ensure download dir exists
        const dlDir = this.data.downloadDir;
        if (!fs.existsSync(dlDir)) {
            fs.mkdirSync(dlDir, { recursive: true });
        }
    }

    _load() {
        try {
            if (fs.existsSync(SETTINGS_FILE)) {
                const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
                const { ytdlpPath, ...rest } = saved;
                return { ...DEFAULTS, ...rest };
            }
        } catch (e) { /* ignore */ }
        return { ...DEFAULTS };
    }

    _save() {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.data, null, 2));
    }

    get(key) {
        return this.data[key] ?? DEFAULTS[key];
    }

    set(key, value) {
        this.data[key] = value;
        this._save();
    }

    getAll() {
        return { ...this.data };
    }
}

module.exports = SettingsStore;
