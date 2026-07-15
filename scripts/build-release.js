#!/usr/bin/env node
/**
 * Build native, double-click installers for the TuneCrate plugin.
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
    'profiles',
    'data',
    'css',
    'js',
    'lib',
    'node_modules',
    'scripts/download-binaries.js',
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

function buildMacInstaller(platform, pluginStageDir) {
    if (os.platform() !== 'darwin') {
        throw new Error(`Building ${platform} requires macOS.`);
    }

    const workDir = path.join(DIST, `.installer-${platform}`);
    const baseRoot = path.join(workDir, 'base-root');
    const curatedRoot = path.join(workDir, 'curated-root');
    const scriptsDir = path.join(workDir, 'scripts');
    const resourcesDir = path.join(workDir, 'resources');
    const relativePluginPath = 'Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/TuneCrate';
    const baseInstallPath = path.join(baseRoot, relativePluginPath);
    const curatedInstallPath = path.join(curatedRoot, relativePluginPath);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(baseInstallPath), { recursive: true });
    fs.mkdirSync(curatedInstallPath, { recursive: true });
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.renameSync(pluginStageDir, baseInstallPath);

    // Open is the base/default payload. The optional curated component overlays
    // only app-profile.json when its checkbox is selected in Installer.
    fs.copyFileSync(path.join(ROOT, 'profiles', 'open.json'), path.join(baseInstallPath, 'app-profile.json'));
    fs.copyFileSync(path.join(ROOT, 'profiles', 'curated.json'), path.join(curatedInstallPath, 'app-profile.json'));

    const postinstallPath = path.join(scriptsDir, 'postinstall');
    fs.writeFileSync(postinstallPath, `#!/bin/sh\nPLUGIN=\"/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/TuneCrate\"\nfind \"$PLUGIN/bin\" -maxdepth 1 -type f -exec chmod 755 {} \\; 2>/dev/null || true\nexit 0\n`);
    fs.chmodSync(postinstallPath, 0o755);

    fs.writeFileSync(path.join(resourcesDir, 'welcome.html'), '<html><body><h1>Install TuneCrate</h1><p>This installs TuneCrate directly into DaVinci Resolve Studio.</p><p>On the next screen, keep <b>Curated Catalog</b> selected for the approved artist library, or deselect it for the full open catalog.</p></body></html>');
    fs.writeFileSync(path.join(resourcesDir, 'conclusion.html'), '<html><body><h1>TuneCrate is installed</h1><p>Restart DaVinci Resolve, then choose <b>Workspace &gt; Workflow Integrations &gt; TuneCrate</b>.</p></body></html>');

    const basePkg = path.join(workDir, 'TuneCrate-base.pkg');
    const curatedPkg = path.join(workDir, 'TuneCrate-curated.pkg');
    execSync(`pkgbuild --root "${baseRoot}" --identifier com.daviddayan.resolve.tunecrate.base --version "${VERSION}" --scripts "${scriptsDir}" --install-location / "${basePkg}"`, { stdio: 'inherit' });
    execSync(`pkgbuild --root "${curatedRoot}" --identifier com.daviddayan.resolve.tunecrate.curated --version "${VERSION}" --install-location / "${curatedPkg}"`, { stdio: 'inherit' });

    const distributionPath = path.join(workDir, 'Distribution.xml');
    fs.writeFileSync(distributionPath, `<?xml version="1.0" encoding="utf-8"?>\n<installer-gui-script minSpecVersion="2">\n  <title>TuneCrate for DaVinci Resolve</title>\n  <organization>com.daviddayan</organization>\n  <domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>\n  <options customize="always" require-scripts="false" rootVolumeOnly="true"/>\n  <welcome file="welcome.html" mime-type="text/html"/>\n  <conclusion file="conclusion.html" mime-type="text/html"/>\n  <choices-outline>\n    <line choice="base"/>\n    <line choice="curated"/>\n  </choices-outline>\n  <choice id="base" title="TuneCrate" visible="false" enabled="false" start_selected="true"><pkg-ref id="com.daviddayan.resolve.tunecrate.base"/></choice>\n  <choice id="curated" title="Curated Catalog (recommended)" description="Keep selected for the approved artist library. Deselect for the full open catalog." start_selected="true"><pkg-ref id="com.daviddayan.resolve.tunecrate.curated"/></choice>\n  <pkg-ref id="com.daviddayan.resolve.tunecrate.base" version="${VERSION}" onConclusion="none">TuneCrate-base.pkg</pkg-ref>\n  <pkg-ref id="com.daviddayan.resolve.tunecrate.curated" version="${VERSION}" onConclusion="none">TuneCrate-curated.pkg</pkg-ref>\n</installer-gui-script>\n`);

    const unsignedPath = path.join(workDir, 'TuneCrate-unsigned.pkg');
    const outputPath = path.join(DIST, `TuneCrate-${platform}.pkg`);
    execSync(`productbuild --distribution "${distributionPath}" --resources "${resourcesDir}" --package-path "${workDir}" "${unsignedPath}"`, { stdio: 'inherit' });
    fs.rmSync(outputPath, { force: true });

    const signingIdentity = process.env.INSTALLER_SIGNING_IDENTITY;
    if (signingIdentity) {
        console.log(`  Signing installer package with ${signingIdentity}...`);
        execSync(`productsign --sign "${signingIdentity}" "${unsignedPath}" "${outputPath}"`, { stdio: 'inherit' });
    } else {
        fs.renameSync(unsignedPath, outputPath);
        console.warn('  Warning: INSTALLER_SIGNING_IDENTITY is not set; this development package is unsigned.');
    }

    const notaryProfile = process.env.APPLE_NOTARY_PROFILE;
    if (notaryProfile) {
        if (!signingIdentity) {
            throw new Error('APPLE_NOTARY_PROFILE requires INSTALLER_SIGNING_IDENTITY.');
        }
        console.log('  Submitting installer to Apple for notarization...');
        execSync(`xcrun notarytool submit "${outputPath}" --keychain-profile "${notaryProfile}" --wait`, { stdio: 'inherit' });
        execSync(`xcrun stapler staple "${outputPath}"`, { stdio: 'inherit' });
    }
    fs.rmSync(workDir, { recursive: true, force: true });
    return outputPath;
}

function findInnoCompiler() {
    const candidates = [
        process.env.ISCC_PATH,
        'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
        'C:\\Program Files\\Inno Setup 6\\ISCC.exe'
    ].filter(Boolean);
    return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function buildWindowsInstaller(platform, pluginStageDir) {
    if (os.platform() !== 'win32') {
        throw new Error(`Building ${platform} requires Windows and Inno Setup 6.`);
    }
    const compiler = findInnoCompiler();
    if (!compiler) {
        throw new Error('Inno Setup 6 was not found. Install it with: choco install innosetup');
    }
    const scriptPath = path.join(ROOT, 'scripts', 'windows-installer.iss');
    execSync(`"${compiler}" /DSourceDir="${pluginStageDir}" /DOutputDir="${DIST}" /DAppVersion="${VERSION}" "${scriptPath}"`, { stdio: 'inherit' });
    return path.join(DIST, `TuneCrate-${platform}.exe`);
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

    const parentDir = path.join(DIST, `TuneCrate-${platform}`);
    console.log('  Creating native installer...');
    const installerPath = platform.startsWith('macos')
        ? buildMacInstaller(platform, stageDir)
        : buildWindowsInstaller(platform, stageDir);

    // Clean up staging directory
    fs.rmSync(parentDir, { recursive: true, force: true });

    const stats = fs.statSync(installerPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`  Created: ${installerPath} (${sizeMB} MB)`);
    return installerPath;
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
