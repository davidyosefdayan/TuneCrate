const path = require('path');

// DaVinci Resolve launches plugins with a minimal PATH that excludes
// Homebrew, Python framework, and other user-installed directories.
// We build an enriched PATH so yt-dlp, ffmpeg, and node are reachable.
const EXTRA_PATHS = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/Library/Frameworks/Python.framework/Versions/Current/bin',
    '/Library/Frameworks/Python.framework/Versions/3.12/bin',
    '/Library/Frameworks/Python.framework/Versions/3.11/bin',
    '/Library/Frameworks/Python.framework/Versions/3.10/bin',
    '/Library/Frameworks/Python.framework/Versions/3.9/bin'
];

function getChildEnv(baseDir) {
    const currentPath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
    const parts = currentPath.split(':');
    const binDir = baseDir ? path.join(baseDir, 'bin') : null;
    const extra = [];

    if (binDir && !parts.includes(binDir)) {
        extra.push(binDir);
    }

    for (const p of EXTRA_PATHS) {
        if (!parts.includes(p)) {
            extra.push(p);
        }
    }

    return {
        ...process.env,
        PATH: [...extra, ...parts].join(':')
    };
}

module.exports = { getChildEnv };
