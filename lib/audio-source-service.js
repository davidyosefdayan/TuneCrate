const crypto = require('crypto');
const fs = require('fs');

const URL_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const INTERACTIVE_TIMEOUT_MS = 15000;
const PREFETCH_TIMEOUT_MS = 9000;
const PREFETCH_CONCURRENCY = 1;
const PREFETCH_LIMIT = 2;
const PREFETCH_DELAY_MS = 2500;
const PREFETCH_COOLDOWN_AFTER_DOWNLOAD_MS = 12000;
const PREVIEW_SESSION_TTL_MS = 20 * 60 * 1000;
const LOOKUP_VARIANTS = {
    prefetch: [
        {
            label: 'music',
            args: ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=default,web_music']
        }
    ],
    interactive: [
        {
            label: 'music',
            args: ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=default,web_music']
        },
        {
            label: 'web',
            args: ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=default,web']
        },
        {
            label: 'default',
            args: []
        }
    ]
};

class AudioSourceService {
    constructor({ execFile, fetchImpl, resolveYtdlpPath, settings, baseDir, onPrefetchReady = null }) {
        this.execFile = execFile;
        this.fetchImpl = fetchImpl;
        this.resolveYtdlpPath = resolveYtdlpPath;
        this.settings = settings;
        this.baseDir = baseDir;
        this.onPrefetchReady = onPrefetchReady;

        this.audioUrlCache = new Map();
        this.pendingAudioUrlRequests = new Map();
        this.prefetchQueue = [];
        this.activePrefetches = 0;
        this.activeInteractiveRequests = 0;
        this.activeDownloadRequests = 0;
        this.previewSessionsByVideo = new Map();
        this.previewSessionsByToken = new Map();
        this.prefetchResumeTimer = null;
        this.prefetchBlockedUntil = 0;
    }

    fileExists(filePath) {
        return Boolean(filePath) && fs.existsSync(filePath);
    }

    getRequestMode(options = {}) {
        return options.mode || 'interactive';
    }

    toLocalAudioUrl(filePath) {
        return 'local-audio://' + encodeURIComponent(filePath);
    }

    getCachedAudioUrl(videoId) {
        const cached = this.audioUrlCache.get(videoId);
        if (cached && cached.expires > Date.now()) {
            return cached;
        }
        return null;
    }

    isPreviewCached(videoId) {
        return Boolean(this.getCachedAudioUrl(videoId) || this.getReusablePreviewSession(videoId));
    }

    invalidate(videoId) {
        this.audioUrlCache.delete(videoId);
        this.destroyPreviewSession(videoId);
    }

    beginDownload(videoId) {
        this.activeDownloadRequests++;
        this.clearPrefetchResumeTimer();
        console.log(`[DOWNLOAD] Prefetch paused while downloading ${videoId}. active_downloads=${this.activeDownloadRequests}`);
    }

    endDownload(videoId) {
        this.activeDownloadRequests = Math.max(0, this.activeDownloadRequests - 1);
        this.prefetchBlockedUntil = Date.now() + PREFETCH_COOLDOWN_AFTER_DOWNLOAD_MS;
        console.log(`[DOWNLOAD] Download finished for ${videoId}. active_downloads=${this.activeDownloadRequests}`);
        this.resumePrefetch();
    }

    serializeDownload(track) {
        const localPath = this.fileExists(track.localPath) ? track.localPath : null;
        return {
            ...track,
            localPath,
            isAvailableLocally: Boolean(localPath)
        };
    }

    serializePlaylist(playlist) {
        return {
            ...playlist,
            tracks: playlist.tracks.map(track => this.serializeDownload(track))
        };
    }

    async getAudioUrl(videoId, options = {}) {
        const mode = this.getRequestMode(options);
        const cached = this.getCachedAudioUrl(videoId);
        if (cached) {
            console.log(`[PREVIEW] Cache hit for ${videoId}`);
            return cached.url;
        }

        const pending = this.pendingAudioUrlRequests.get(videoId);
        if (pending && !(mode === 'interactive' && pending.mode === 'prefetch')) {
            console.log(`[PREVIEW] Reusing in-flight lookup for ${videoId}`);
            return pending.promise;
        }

        if (pending && mode === 'interactive' && pending.mode === 'prefetch') {
            console.log(`[PREVIEW] Upgrading ${videoId} lookup from prefetch to interactive`);
        }

        if (mode === 'interactive') {
            this.activeInteractiveRequests++;
            this.clearPrefetchResumeTimer();
        }

        let requestEntry = null;
        const request = this.fetchAudioUrl(videoId, options)
            .finally(() => {
                const current = this.pendingAudioUrlRequests.get(videoId);
                if (current === requestEntry) {
                    this.pendingAudioUrlRequests.delete(videoId);
                }
                if (mode === 'interactive') {
                    this.activeInteractiveRequests = Math.max(0, this.activeInteractiveRequests - 1);
                    this.resumePrefetch();
                }
            });

        requestEntry = { promise: request, mode };
        this.pendingAudioUrlRequests.set(videoId, requestEntry);
        return request;
    }

    async fetchAudioUrl(videoId, options = {}) {
        const ytdlp = this.resolveBinary();
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const mode = this.getRequestMode(options);
        const variants = LOOKUP_VARIANTS[mode] || LOOKUP_VARIANTS.interactive;

        let lastError = null;
        for (const variant of variants) {
            const cached = this.getCachedAudioUrl(videoId);
            if (cached) {
                console.log(`[PREVIEW] Cache hit for ${videoId}`);
                return cached.url;
            }

            try {
                const resolvedUrl = await this.execGetUrl(ytdlp, videoUrl, variant, mode);
                this.cacheAudioUrl(videoId, resolvedUrl);
                return resolvedUrl;
            } catch (error) {
                lastError = error;
                console.warn(`[PREVIEW] ${variant.label} lookup failed for ${videoId}: ${error.message}`);
            }
        }

        throw lastError || new Error('Could not get audio URL');
    }

    execGetUrl(ytdlp, videoUrl, variant, mode) {
        const args = [
            '-f', 'wa/w/ba/b',
            '--get-url',
            '--no-playlist',
            '--no-warnings',
            ...variant.args,
            videoUrl
        ];

        const startTime = Date.now();
        console.log(`[PREVIEW] Getting URL for ${videoUrl} via ${variant.label}...`);

        return new Promise((resolve, reject) => {
            this.execFile(
                ytdlp,
                args,
                {
                    timeout: this.getLookupTimeout(mode),
                    maxBuffer: 1024 * 1024
                },
                (err, stdout, stderr) => {
                    const elapsed = Date.now() - startTime;
                    if (err) {
                        const stderrSummary = (stderr || '').trim().split('\n').slice(-1)[0];
                        console.log(`[PREVIEW] Failed after ${elapsed}ms${stderrSummary ? `: ${stderrSummary}` : ''}`);
                        reject(new Error(stderrSummary || 'Could not get audio URL'));
                        return;
                    }

                    const resolvedUrl = stdout.trim().split('\n')[0];
                    if (!resolvedUrl || !resolvedUrl.startsWith('http')) {
                        reject(new Error('No URL returned'));
                        return;
                    }

                    console.log(`[PREVIEW] Got URL in ${elapsed}ms`);
                    resolve(resolvedUrl);
                }
            );
        });
    }

    cacheAudioUrl(videoId, url) {
        this.audioUrlCache.set(videoId, {
            url,
            expires: Date.now() + URL_CACHE_TTL_MS
        });
    }

    getLookupTimeout(mode) {
        return mode === 'prefetch' ? PREFETCH_TIMEOUT_MS : INTERACTIVE_TIMEOUT_MS;
    }

    resolveBinary() {
        try {
            return this.resolveYtdlpPath(this.settings, this.baseDir);
        } catch {
            throw new Error('yt-dlp is unavailable');
        }
    }

    async resolveTrackSource(videoId, localPath) {
        if (this.fileExists(localPath)) {
            return {
                url: this.toLocalAudioUrl(localPath),
                source: 'local',
                missingLocalFile: false
            };
        }

        const session = await this.getOrCreatePreviewSession(videoId);
        return {
            url: session.protocolUrl,
            source: 'stream',
            missingLocalFile: Boolean(localPath)
        };
    }

    async getOrCreatePreviewSession(videoId) {
        const existing = this.getReusablePreviewSession(videoId);
        if (existing) {
            existing.lastAccessedAt = Date.now();
            return existing;
        }

        const remoteUrl = await this.getAudioUrl(videoId, { mode: 'interactive' });
        const session = this.createPreviewSession(videoId, remoteUrl);
        this.destroyPreviewSession(videoId);
        this.previewSessionsByVideo.set(videoId, session);
        this.previewSessionsByToken.set(session.token, session);
        return session;
    }

    createPreviewSession(videoId, remoteUrl) {
        const token = crypto.randomUUID();
        return {
            token,
            videoId,
            remoteUrl,
            protocolUrl: `preview-audio://${token}`,
            createdAt: Date.now(),
            lastAccessedAt: Date.now()
        };
    }

    getReusablePreviewSession(videoId) {
        const session = this.previewSessionsByVideo.get(videoId);
        if (!session) return null;

        const expired = (Date.now() - session.lastAccessedAt) > PREVIEW_SESSION_TTL_MS;
        if (expired) {
            this.destroyPreviewSession(videoId);
            return null;
        }

        return session;
    }

    destroyPreviewSession(videoId) {
        const session = this.previewSessionsByVideo.get(videoId);
        if (!session) return;
        this.previewSessionsByVideo.delete(videoId);
        this.previewSessionsByToken.delete(session.token);
    }

    async handlePreviewRequest(request) {
        const token = this.parsePreviewToken(request.url);
        const session = token ? this.previewSessionsByToken.get(token) : null;
        if (!session) {
            return new Response('Preview not found', { status: 404 });
        }

        session.lastAccessedAt = Date.now();
        const headers = {};
        const range = request.headers.get('range');
        if (range) {
            headers.range = range;
        }
        const accept = request.headers.get('accept');
        if (accept) {
            headers.accept = accept;
        }

        try {
            const response = await this.fetchImpl(session.remoteUrl, {
                method: request.method,
                headers
            });
            if (response.status === 403 || response.status === 410) {
                this.invalidate(session.videoId);
            }
            return response;
        } catch (error) {
            console.warn(`[PREVIEW] Relay request failed for ${session.videoId}: ${error.message}`);
            this.invalidate(session.videoId);
            return new Response('Preview relay failed', { status: 502 });
        }
    }

    parsePreviewToken(requestUrl) {
        const prefix = 'preview-audio://';
        if (!requestUrl.startsWith(prefix)) {
            return null;
        }
        return requestUrl.slice(prefix.length).replace(/\/+$/, '');
    }

    getDownloadSource(videoId) {
        const session = this.getReusablePreviewSession(videoId);
        if (session) {
            session.lastAccessedAt = Date.now();
            return { kind: 'media-url', url: session.remoteUrl, label: 'preview session URL' };
        }

        const cached = this.getCachedAudioUrl(videoId);
        if (cached) {
            return { kind: 'media-url', url: cached.url, label: 'cached media URL' };
        }

        return { kind: 'watch-url' };
    }

    resolveDownloadSource(videoId) {
        const source = this.getDownloadSource(videoId);
        if (source.kind === 'media-url') {
            console.log(`[DOWNLOAD] Reusing ${source.label} for ${videoId}`);
            return source;
        }

        console.log(`[DOWNLOAD] No reusable media URL for ${videoId}; downloader will resolve from watch page`);
        return source;
    }

    prefetchUrls(videoIds) {
        this.clearPrefetchResumeTimer();
        this.prefetchQueue = [];
        for (const id of videoIds.slice(0, PREFETCH_LIMIT)) {
            if (this.isPreviewCached(id) || this.pendingAudioUrlRequests.has(id)) continue;
            this.prefetchQueue.push(id);
        }

        console.log(`[PREFETCH] Queued ${this.prefetchQueue.length} tracks (${PREFETCH_CONCURRENCY} concurrent, first ${PREFETCH_LIMIT} only)`);
        this.schedulePrefetchResume();
    }

    resumePrefetch() {
        if (this.activeInteractiveRequests > 0 || this.activeDownloadRequests > 0) {
            return;
        }

        const waitMs = this.prefetchBlockedUntil - Date.now();
        if (waitMs > 0) {
            this.schedulePrefetchResume(waitMs);
            return;
        }

        while (this.activePrefetches < PREFETCH_CONCURRENCY && this.prefetchQueue.length > 0) {
            this.prefetchNext();
        }
    }

    prefetchNext() {
        if (this.activeInteractiveRequests > 0 || this.activeDownloadRequests > 0 || this.prefetchQueue.length === 0) return;

        const videoId = this.prefetchQueue.shift();
        if (this.isPreviewCached(videoId)) {
            this.prefetchNext();
            return;
        }

        this.activePrefetches++;
        this.getAudioUrl(videoId, { mode: 'prefetch' })
            .then(() => {
                if (this.onPrefetchReady) {
                    this.onPrefetchReady(videoId);
                }
            })
            .catch(() => {})
            .finally(() => {
                this.activePrefetches--;
                this.resumePrefetch();
            });
    }

    schedulePrefetchResume(delayMs = PREFETCH_DELAY_MS) {
        if (this.prefetchResumeTimer || this.prefetchQueue.length === 0) {
            return;
        }

        console.log(`[PREFETCH] Waiting ${Math.max(0, Math.round(delayMs))}ms before background fetch`);
        this.prefetchResumeTimer = setTimeout(() => {
            this.prefetchResumeTimer = null;
            this.resumePrefetch();
        }, Math.max(0, delayMs));
    }

    clearPrefetchResumeTimer() {
        if (!this.prefetchResumeTimer) {
            return;
        }

        clearTimeout(this.prefetchResumeTimer);
        this.prefetchResumeTimer = null;
    }
}

module.exports = AudioSourceService;
