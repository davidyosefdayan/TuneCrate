const os = require('os');
const path = require('path');

const platform = os.platform();

let DATA_DIR;
if (platform === 'win32') {
    DATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'TuneCrate');
} else {
    DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'TuneCrate');
}

const MANAGED_BIN_DIR = path.join(DATA_DIR, 'bin');
const MANAGED_YTDLP_PATH = path.join(MANAGED_BIN_DIR, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

let PLUGIN_DIR;
if (platform === 'darwin') {
    PLUGIN_DIR = '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/TuneCrate';
} else if (platform === 'win32') {
    PLUGIN_DIR = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData',
        'Blackmagic Design', 'DaVinci Resolve', 'Support',
        'Workflow Integration Plugins', 'TuneCrate');
}

module.exports = {
    DATA_DIR,
    MANAGED_BIN_DIR,
    MANAGED_YTDLP_PATH,
    PLUGIN_DIR
};
