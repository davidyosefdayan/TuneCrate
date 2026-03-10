const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VALIDATION_TIMEOUT_MS = 1500;

let cachedPath = null;
let cachedKey = null;

function getCandidateKey(customPath, baseDir) {
    return JSON.stringify([customPath || '', path.join(baseDir, 'bin', 'yt-dlp')]);
}

function isExecutable(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function validateCandidate(candidate, { allowUnvalidatedAbsolutePath = false } = {}) {
    try {
        const version = execFileSync(candidate, ['--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: VALIDATION_TIMEOUT_MS
        }).trim();
        console.log(`[yt-dlp] Validated: ${candidate} (v${version})`);
        return Boolean(version);
    } catch (error) {
        console.warn(`[yt-dlp] Validation failed for ${candidate}: ${error.message}`);

        // Only allow an explicit custom path to bypass validation, and never on timeout.
        if (
            allowUnvalidatedAbsolutePath &&
            path.isAbsolute(candidate) &&
            isExecutable(candidate) &&
            error.code !== 'ETIMEDOUT' &&
            !/timed out/i.test(error.message)
        ) {
            console.log(`[yt-dlp] Trusting executable at: ${candidate}`);
            return true;
        }
        return false;
    }
}

function resolveYtdlpPath(settings, baseDir) {
    const customPath = settings?.get?.('ytdlpPath') || '';
    const candidateKey = getCandidateKey(customPath, baseDir);
    if (cachedPath && cachedKey === candidateKey) {
        return cachedPath;
    }

    const bundledPath = path.join(baseDir, 'bin', 'yt-dlp');
    console.log(`[yt-dlp] Resolving... bundled=${bundledPath}, custom=${customPath || '(none)'}`);

    const candidates = [
        { path: customPath, allowUnvalidatedAbsolutePath: true },
        { path: 'yt-dlp', allowUnvalidatedAbsolutePath: false },
        { path: bundledPath, allowUnvalidatedAbsolutePath: false }
    ].filter(candidate => Boolean(candidate.path));

    for (const candidate of candidates) {
        if (candidate.path !== 'yt-dlp' && !fs.existsSync(candidate.path)) {
            console.log(`[yt-dlp] Skipping (not found): ${candidate.path}`);
            continue;
        }
        if (validateCandidate(candidate.path, candidate)) {
            cachedPath = candidate.path;
            cachedKey = candidateKey;
            return candidate.path;
        }
    }

    throw new Error('No working yt-dlp binary found');
}

module.exports = { resolveYtdlpPath };
