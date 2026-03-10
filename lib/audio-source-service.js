const fs = require('fs');

const URL_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const INTERACTIVE_TIMEOUT_MS = 12000;
const PREFETCH_TIMEOUT_MS = 7000;
const PREFETCH_CONCURRENCY = 1;
const PREFETCH_LIMIT = 4;

class AudioSourceService {
    constructor({ execFile, resolveYtdlpPath, settings, baseDir, onPrefetchReady = null }) {
        this.execFile = execFile;
        this.resolveYtdlpPath = resolveYtdlpPath;
        this.settings = settings;
        this.baseDir = baseDir;
        this.onPrefetchReady = onPrefetchReady;

        this.audioUrlCache = new Map();
        this.pendingAudioUrlRequests = new Map();
        this.prefetchQueue = [];
        this.activePrefetches = 0;
        this.activeInteractiveRequests = 0;
    }

    fileExists(filePath) {
        return Boolean(filePath) && fs.existsSync(filePath);
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
        return Boolean(this.getCachedAudioUrl(videoId));
    }

    invalidate(videoId) {
        this.audioUrlCache.delete(videoId);
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
        const mode = options.mode || 'interactive';
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
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const mode = options.mode || 'interactive';
        const variants = mode === 'prefetch'
            ? [
                {
                    label: 'music',
                    args: ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=default,web_music']
                }
            ]
            : [
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
        ];

        let lastError = null;
        for (const variant of variants) {
            const cached = this.getCachedAudioUrl(videoId);
            if (cached) {
                console.log(`[PREVIEW] Cache hit for ${videoId}`);
                return cached.url;
            }

            try {
                const resolvedUrl = await this.execGetUrl(ytdlp, url, variant, mode);
                this.audioUrlCache.set(videoId, {
                    url: resolvedUrl,
                    expires: Date.now() + URL_CACHE_TTL_MS
                });
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
                    timeout: mode === 'prefetch' ? PREFETCH_TIMEOUT_MS : INTERACTIVE_TIMEOUT_MS,
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

    resolveBinary() {
        try {
            return this.resolveYtdlpPath(this.settings, this.baseDir);
        } catch (error) {
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

        const url = await this.getAudioUrl(videoId, { mode: 'interactive' });
        return {
            url,
            source: 'stream',
            missingLocalFile: Boolean(localPath)
        };
    }

    getDownloadUrl(videoId) {
        return this.getCachedAudioUrl(videoId)?.url || null;
    }

    prefetchUrls(videoIds) {
        this.prefetchQueue = [];
        for (const id of videoIds.slice(0, PREFETCH_LIMIT)) {
            if (this.isPreviewCached(id) || this.pendingAudioUrlRequests.has(id)) continue;
            this.prefetchQueue.push(id);
        }

        console.log(`[PREFETCH] Queued ${this.prefetchQueue.length} tracks (${PREFETCH_CONCURRENCY} concurrent, first ${PREFETCH_LIMIT} only)`);
        this.resumePrefetch();
    }

    resumePrefetch() {
        if (this.activeInteractiveRequests > 0) {
            return;
        }

        while (this.activePrefetches < PREFETCH_CONCURRENCY && this.prefetchQueue.length > 0) {
            this.prefetchNext();
        }
    }

    prefetchNext() {
        if (this.activeInteractiveRequests > 0 || this.prefetchQueue.length === 0) return;

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
}

module.exports = AudioSourceService;
