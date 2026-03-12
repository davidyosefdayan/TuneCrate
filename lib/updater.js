const { net } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function getRepo() {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    const url = pkg.repository?.url || '';
    // Extract owner/repo from git URL
    const match = url.match(/github\.com[/:](.+?\/.+?)(?:\.git)?$/);
    return match ? match[1] : 'daviddayan/TuneCrate';
}

const REPO = getRepo();
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

function getCurrentVersion() {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
}

function getPluginDir() {
    const platform = os.platform();
    if (platform === 'darwin') {
        return '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/TuneCrate';
    }
    if (platform === 'win32') {
        return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData',
            'Blackmagic Design', 'DaVinci Resolve', 'Support',
            'Workflow Integration Plugins', 'TuneCrate');
    }
    return null;
}

function getPlatformAssetName() {
    const platform = os.platform();
    const arch = os.arch();
    if (platform === 'darwin') {
        return arch === 'arm64' ? 'TuneCrate-macos-arm64.zip' : 'TuneCrate-macos-x64.zip';
    }
    if (platform === 'win32') {
        return 'TuneCrate-windows-x64.zip';
    }
    return null;
}

function compareVersions(a, b) {
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

async function fetchLatestRelease() {
    return new Promise((resolve, reject) => {
        const request = net.request(API_URL);
        request.setHeader('Accept', 'application/vnd.github.v3+json');
        request.setHeader('User-Agent', 'TuneCrate-Updater');

        let body = '';
        request.on('response', (response) => {
            response.on('data', (chunk) => { body += chunk.toString(); });
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    reject(new Error(`GitHub API returned ${response.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('Failed to parse release data'));
                }
            });
        });
        request.on('error', reject);
        request.end();
    });
}

async function checkForUpdates() {
    const currentVersion = getCurrentVersion();
    const release = await fetchLatestRelease();
    const latestVersion = release.tag_name.replace(/^v/, '');

    if (compareVersions(latestVersion, currentVersion) <= 0) {
        return { updateAvailable: false, currentVersion, latestVersion };
    }

    const assetName = getPlatformAssetName();
    const asset = release.assets.find(a => a.name === assetName);

    return {
        updateAvailable: true,
        currentVersion,
        latestVersion,
        downloadUrl: asset ? asset.browser_download_url : null,
        releaseNotes: release.body || '',
        releaseName: release.name || `v${latestVersion}`
    };
}

async function downloadUpdate(downloadUrl, onProgress) {
    const tmpDir = path.join(os.tmpdir(), 'tunecrate-update');
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const zipPath = path.join(tmpDir, 'update.zip');

    return new Promise((resolve, reject) => {
        const request = net.request(downloadUrl);
        request.setHeader('User-Agent', 'TuneCrate-Updater');

        request.on('response', (response) => {
            // Follow redirects (GitHub uses them for asset downloads)
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                const redirectUrl = Array.isArray(response.headers.location)
                    ? response.headers.location[0]
                    : response.headers.location;
                downloadUpdate(redirectUrl, onProgress).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Download failed with status ${response.statusCode}`));
                return;
            }

            const contentLength = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;
            const fileStream = fs.createWriteStream(zipPath);

            response.on('data', (chunk) => {
                fileStream.write(chunk);
                downloaded += chunk.length;
                if (contentLength > 0 && onProgress) {
                    onProgress(Math.round((downloaded / contentLength) * 100));
                }
            });

            response.on('end', () => {
                fileStream.end(() => {
                    resolve({ zipPath, tmpDir });
                });
            });

            response.on('error', (err) => {
                fileStream.end();
                reject(err);
            });
        });

        request.on('error', reject);
        request.end();
    });
}

async function applyUpdate(zipPath) {
    const pluginDir = getPluginDir();
    if (!pluginDir) {
        throw new Error('Unsupported platform for auto-update');
    }

    const tmpExtract = path.join(path.dirname(zipPath), 'extracted');
    if (fs.existsSync(tmpExtract)) {
        fs.rmSync(tmpExtract, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpExtract, { recursive: true });

    const platform = os.platform();
    if (platform === 'darwin' || platform === 'linux') {
        execSync(`unzip -o "${zipPath}" -d "${tmpExtract}"`, { stdio: 'ignore' });
    } else if (platform === 'win32') {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpExtract}' -Force"`, { stdio: 'ignore' });
    }

    // Find the plugin content (may be inside a TuneCrate subfolder)
    let sourceDir = tmpExtract;
    const nested = path.join(tmpExtract, 'TuneCrate');
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
        sourceDir = nested;
    }

    // Preserve user's bin/ directory (contains downloaded yt-dlp/ffmpeg)
    const existingBin = path.join(pluginDir, 'bin');
    const tmpBin = path.join(path.dirname(zipPath), 'bin-backup');
    if (fs.existsSync(existingBin)) {
        fs.cpSync(existingBin, tmpBin, { recursive: true });
    }

    // Remove old plugin files (except user data which is in ~/Library/Application Support/TuneCrate)
    if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
    }

    // Copy new files
    fs.cpSync(sourceDir, pluginDir, { recursive: true });

    // Restore bin/ if it existed
    if (fs.existsSync(tmpBin)) {
        const newBin = path.join(pluginDir, 'bin');
        if (!fs.existsSync(newBin)) {
            fs.mkdirSync(newBin, { recursive: true });
        }
        fs.cpSync(tmpBin, newBin, { recursive: true });
        fs.rmSync(tmpBin, { recursive: true, force: true });
    }

    // Clean up
    fs.rmSync(path.dirname(zipPath), { recursive: true, force: true });

    return pluginDir;
}

module.exports = {
    checkForUpdates,
    downloadUpdate,
    applyUpdate,
    getCurrentVersion,
    getPluginDir,
    REPO
};
