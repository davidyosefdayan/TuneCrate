#!/usr/bin/env node
/**
 * Build platform-specific ZIP releases of the TuneCrate plugin.
 *
 * Usage:
 *   node scripts/build-release.js                  # build for current platform
 *   node scripts/build-release.js --platform macos-arm64
 *   node scripts/build-release.js --platform macos-x64
 *   node scripts/build-release.js --platform windows-x64
 *   node scripts/build-release.js --all             # build all platforms
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;

// Files to include in the release (mirrors install-plugin.js)
const INCLUDE = [
    'manifest.xml',
    'package.json',
    'package-lock.json',
    'main.js',
    'preload.js',
    'index.html',
    'WorkflowIntegration.node',
    'app-profile.json',
    'data',
    'css',
    'js',
    'lib',
    'node_modules',
    'scripts/download-binaries.js',
    'scripts/install.sh',
    'scripts/install.bat',
];

// Platform-specific binary URLs
const BINARIES = {
    'macos-arm64': {
        'yt-dlp': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
        'ffmpeg': null  // downloaded separately via zip
    },
    'macos-x64': {
        'yt-dlp': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
        'ffmpeg': null
    },
    'windows-x64': {
        'yt-dlp': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
        'ffmpeg': null
    }
};

function detectCurrentPlatform() {
    const platform = os.platform();
    const arch = os.arch();
    if (platform === 'darwin') {
        return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
    }
    if (platform === 'win32') {
        return 'windows-x64';
    }
    throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

function copyItem(src, dest) {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
    } else {
        const destDir = path.dirname(dest);
        if (!destDir || destDir === '.') return;
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

function buildForPlatform(platform) {
    console.log(`\nBuilding TuneCrate v${VERSION} for ${platform}...`);

    const stageDir = path.join(DIST, `TuneCrate-${platform}`, 'TuneCrate');
    if (fs.existsSync(stageDir)) {
        fs.rmSync(stageDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stageDir, { recursive: true });

    // Copy plugin files
    for (const item of INCLUDE) {
        const src = path.join(ROOT, item);
        const dest = path.join(stageDir, item);
        console.log(`  Copying ${item}...`);
        copyItem(src, dest);
    }

    // Create bin/ directory with a README
    const binDir = path.join(stageDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'README.txt'),
        'Binary dependencies (yt-dlp, ffmpeg) will be downloaded on first run.\n' +
        'You can also install them manually:\n' +
        '  macOS: brew install yt-dlp ffmpeg\n' +
        '  Windows: winget install yt-dlp.yt-dlp / choco install ffmpeg\n');

    // Copy install scripts to parent dir (alongside TuneCrate/ folder) for easy access
    const parentStage = path.dirname(stageDir);
    if (platform.startsWith('macos')) {
        fs.copyFileSync(path.join(ROOT, 'scripts', 'install.sh'), path.join(parentStage, 'install.sh'));
        fs.chmodSync(path.join(parentStage, 'install.sh'), 0o755);
    } else if (platform === 'windows-x64') {
        fs.copyFileSync(path.join(ROOT, 'scripts', 'install.bat'), path.join(parentStage, 'install.bat'));
    }

    // Download platform binaries if available
    const binaries = BINARIES[platform];
    if (binaries && binaries['yt-dlp']) {
        const ytdlpDest = platform === 'windows-x64'
            ? path.join(binDir, 'yt-dlp.exe')
            : path.join(binDir, 'yt-dlp');
        console.log('  Downloading yt-dlp...');
        try {
            execSync(`curl -L "${binaries['yt-dlp']}" -o "${ytdlpDest}"`, { stdio: 'inherit' });
            if (platform !== 'windows-x64') {
                fs.chmodSync(ytdlpDest, 0o755);
            }
        } catch (e) {
            console.warn(`  Warning: Failed to download yt-dlp: ${e.message}`);
            console.warn('  Users will need to install yt-dlp manually.');
        }
    }

    // Create the ZIP
    const zipName = `TuneCrate-${platform}.zip`;
    const zipPath = path.join(DIST, zipName);
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }

    const parentDir = path.join(DIST, `TuneCrate-${platform}`);
    console.log(`  Creating ${zipName}...`);
    if (os.platform() === 'win32') {
        execSync(`powershell -Command "Compress-Archive -Path '${parentDir}\\*' -DestinationPath '${zipPath}'"`, { stdio: 'inherit' });
    } else {
        execSync(`cd "${parentDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
    }

    // Clean up staging directory
    fs.rmSync(parentDir, { recursive: true, force: true });

    const stats = fs.statSync(zipPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`  Created: ${zipPath} (${sizeMB} MB)`);
    return zipPath;
}

// Parse CLI args
const args = process.argv.slice(2);
let platforms = [];

if (args.includes('--all')) {
    platforms = Object.keys(BINARIES);
} else if (args.includes('--platform')) {
    const idx = args.indexOf('--platform');
    const p = args[idx + 1];
    if (!BINARIES[p]) {
        console.error(`Unknown platform: ${p}`);
        console.error(`Valid platforms: ${Object.keys(BINARIES).join(', ')}`);
        process.exit(1);
    }
    platforms = [p];
} else {
    platforms = [detectCurrentPlatform()];
}

// Ensure dist/ exists
if (!fs.existsSync(DIST)) {
    fs.mkdirSync(DIST, { recursive: true });
}

// Ensure node_modules is installed
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.log('Installing dependencies...');
    execSync('npm install --omit=dev', { cwd: ROOT, stdio: 'inherit' });
}

const results = [];
for (const p of platforms) {
    results.push(buildForPlatform(p));
}

console.log('\nBuild complete!');
console.log('Artifacts:');
for (const r of results) {
    console.log(`  ${r}`);
}
