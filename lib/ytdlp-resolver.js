const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VALIDATION_TIMEOUT_MS = 1500;

let cachedPath = null;
let cachedKey = null;

function getCandidateKey(customPath, baseDir) {
    return JSON.stringify([customPath || '', path.join(baseDir, 'bin', 'yt-dlp')]);
}

function validateCandidate(candidate) {
    try {
        const version = execFileSync(candidate, ['--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: VALIDATION_TIMEOUT_MS
        }).trim();
        return Boolean(version);
    } catch (error) {
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
    const candidates = [
        customPath,
        bundledPath,
        'yt-dlp'
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (candidate !== 'yt-dlp' && !fs.existsSync(candidate)) {
            continue;
        }
        if (validateCandidate(candidate)) {
            cachedPath = candidate;
            cachedKey = candidateKey;
            return candidate;
        }
    }

    throw new Error('No working yt-dlp binary found');
}

module.exports = { resolveYtdlpPath };
