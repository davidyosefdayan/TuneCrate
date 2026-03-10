const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MANAGED_BIN_DIR, MANAGED_YTDLP_PATH } = require('./shared-paths');

const VALIDATION_TIMEOUT_MS = 1500;

function ensureManagedBinDir() {
    if (!fs.existsSync(MANAGED_BIN_DIR)) {
        fs.mkdirSync(MANAGED_BIN_DIR, { recursive: true });
    }
}

function isExecutable(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function isWorkingBinary(binaryPath) {
    try {
        const version = execFileSync(binaryPath, ['--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: VALIDATION_TIMEOUT_MS
        }).trim();
        return Boolean(version);
    } catch {
        return false;
    }
}

function getKnownSystemCandidates() {
    if (os.platform() !== 'darwin') {
        return [];
    }

    return [
        '/opt/homebrew/bin/yt-dlp',
        '/usr/local/bin/yt-dlp',
        '/Library/Frameworks/Python.framework/Versions/Current/bin/yt-dlp',
        '/Library/Frameworks/Python.framework/Versions/3.12/bin/yt-dlp',
        '/Library/Frameworks/Python.framework/Versions/3.11/bin/yt-dlp',
        '/Library/Frameworks/Python.framework/Versions/3.10/bin/yt-dlp',
        '/Library/Frameworks/Python.framework/Versions/3.9/bin/yt-dlp'
    ];
}

function getBundledCandidate(baseDir) {
    return path.join(baseDir, 'bin', 'yt-dlp');
}

function dedupePaths(paths) {
    const seen = new Set();
    return paths.filter(filePath => {
        if (!filePath || seen.has(filePath)) {
            return false;
        }
        seen.add(filePath);
        return true;
    });
}

function replaceManagedBinary(targetPath) {
    ensureManagedBinDir();
    try {
        if (fs.existsSync(MANAGED_YTDLP_PATH) || fs.lstatSync(MANAGED_YTDLP_PATH)) {
            fs.rmSync(MANAGED_YTDLP_PATH, { force: true });
        }
    } catch {
        // ignore
    }

    fs.symlinkSync(targetPath, MANAGED_YTDLP_PATH);
    return MANAGED_YTDLP_PATH;
}

function ensureManagedYtdlp(baseDir) {
    ensureManagedBinDir();

    if (fs.existsSync(MANAGED_YTDLP_PATH) && isWorkingBinary(MANAGED_YTDLP_PATH)) {
        return MANAGED_YTDLP_PATH;
    }

    if (fs.existsSync(MANAGED_YTDLP_PATH)) {
        fs.rmSync(MANAGED_YTDLP_PATH, { force: true });
    }

    const candidates = dedupePaths([
        ...getKnownSystemCandidates(),
        'yt-dlp',
        getBundledCandidate(baseDir)
    ]);

    for (const candidate of candidates) {
        if (candidate !== 'yt-dlp' && !fs.existsSync(candidate)) {
            continue;
        }

        if (!isExecutable(candidate) && candidate !== 'yt-dlp') {
            continue;
        }

        if (!isWorkingBinary(candidate)) {
            continue;
        }

        if (candidate === 'yt-dlp') {
            return candidate;
        }

        return replaceManagedBinary(candidate);
    }

    throw new Error('No working yt-dlp binary found');
}

module.exports = {
    ensureManagedYtdlp,
    isWorkingBinary,
    MANAGED_YTDLP_PATH
};
