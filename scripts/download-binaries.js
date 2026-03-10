const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BIN_DIR = path.join(__dirname, '..', 'bin');

if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
}

const platform = os.platform();
const arch = os.arch();

function isWorkingBinary(binaryPath) {
    try {
        execFileSync(binaryPath, ['--version'], {
            stdio: 'ignore',
            timeout: 1500
        });
        return true;
    } catch (error) {
        return false;
    }
}

function findSystemBinary(binaryName) {
    try {
        const resolved = execSync(`which ${binaryName} 2>/dev/null`, { encoding: 'utf-8' }).trim();
        return resolved || null;
    } catch {
        return null;
    }
}

// yt-dlp
const ytdlpPath = path.join(BIN_DIR, 'yt-dlp');
const systemYtdlp = findSystemBinary('yt-dlp');
if (fs.existsSync(ytdlpPath) && !isWorkingBinary(ytdlpPath)) {
    console.log('Bundled yt-dlp is not responding, re-downloading...');
    fs.unlinkSync(ytdlpPath);
}

if (!fs.existsSync(ytdlpPath) && systemYtdlp && isWorkingBinary(systemYtdlp)) {
    fs.symlinkSync(systemYtdlp, ytdlpPath);
    console.log(`Linked to system yt-dlp: ${systemYtdlp}`);
} else if (!fs.existsSync(ytdlpPath)) {
    console.log('Downloading yt-dlp...');
    let ytdlpUrl;
    if (platform === 'darwin') {
        ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
    } else if (platform === 'linux') {
        ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    } else {
        ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    }
    try {
        execSync(`curl -L "${ytdlpUrl}" -o "${ytdlpPath}"`, { stdio: 'inherit' });
        fs.chmodSync(ytdlpPath, 0o755);
        console.log('yt-dlp downloaded successfully.');
    } catch (e) {
        console.error('Failed to download yt-dlp:', e.message);
        console.error('You can install it manually: brew install yt-dlp');
    }
} else {
    console.log('yt-dlp already exists, skipping.');
}

// ffmpeg
const ffmpegPath = path.join(BIN_DIR, 'ffmpeg');
if (!fs.existsSync(ffmpegPath)) {
    console.log('Downloading ffmpeg...');
    try {
        // Try to find system ffmpeg first
        const systemFfmpeg = execSync('which ffmpeg 2>/dev/null', { encoding: 'utf-8' }).trim();
        if (systemFfmpeg) {
            fs.symlinkSync(systemFfmpeg, ffmpegPath);
            console.log(`Linked to system ffmpeg: ${systemFfmpeg}`);
        }
    } catch (e) {
        // Download ffmpeg binary
        let ffmpegUrl;
        if (platform === 'darwin') {
            ffmpegUrl = arch === 'arm64'
                ? 'https://www.osxexperts.net/ffmpeg71arm.zip'
                : 'https://www.osxexperts.net/ffmpeg71intel.zip';
            try {
                const tmpZip = path.join(BIN_DIR, 'ffmpeg.zip');
                execSync(`curl -L "${ffmpegUrl}" -o "${tmpZip}"`, { stdio: 'inherit' });
                execSync(`unzip -o "${tmpZip}" -d "${BIN_DIR}"`, { stdio: 'inherit' });
                fs.unlinkSync(tmpZip);
                fs.chmodSync(ffmpegPath, 0o755);
                console.log('ffmpeg downloaded successfully.');
            } catch (e2) {
                console.error('Failed to download ffmpeg:', e2.message);
                console.error('Install manually: brew install ffmpeg');
            }
        } else {
            console.error('Please install ffmpeg manually for your platform.');
        }
    }
} else {
    console.log('ffmpeg already exists, skipping.');
}
