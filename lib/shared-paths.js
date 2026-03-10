const os = require('os');
const path = require('path');

const DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'YouTube Music Resolve');
const MANAGED_BIN_DIR = path.join(DATA_DIR, 'bin');
const MANAGED_YTDLP_PATH = path.join(MANAGED_BIN_DIR, 'yt-dlp');

module.exports = {
    DATA_DIR,
    MANAGED_BIN_DIR,
    MANAGED_YTDLP_PATH
};
