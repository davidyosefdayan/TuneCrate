const { ensureManagedYtdlp } = require('./ytdlp-manager');

let cachedPath = null;
let cachedBaseDir = null;

function resolveYtdlpPath(_settings, baseDir) {
    if (cachedPath && cachedBaseDir === baseDir) {
        return cachedPath;
    }

    const resolvedPath = ensureManagedYtdlp(baseDir);
    console.log(`[yt-dlp] Using managed binary: ${resolvedPath}`);
    cachedPath = resolvedPath;
    cachedBaseDir = baseDir;
    return resolvedPath;
}

module.exports = { resolveYtdlpPath };
