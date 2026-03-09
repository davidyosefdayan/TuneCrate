// Polyfill Web APIs missing in Electron's Node.js
const { Blob } = require('buffer');
if (typeof globalThis.File === 'undefined') {
    globalThis.File = class File extends Blob {
        constructor(chunks, name, opts) { super(chunks, opts); this.name = name; this.lastModified = opts?.lastModified || Date.now(); }
    };
}
if (typeof globalThis.FormData === 'undefined') {
    globalThis.FormData = class FormData { constructor() { this._data = []; } append(k, v) { this._data.push([k, v]); } };
}

console.log('[BOOT] Starting...');
const { app, BrowserWindow, ipcMain, shell, net, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const PLUGIN_ID = 'com.daviddayan.resolve.youtubemusic';

let mainWindow = null;
let resolveAvailable = false;
let resolveObj = null;

// --- Dual-mode: try loading WorkflowIntegration ---
let WorkflowIntegration = null;
try {
    WorkflowIntegration = require('./WorkflowIntegration.node');
    console.log('[BOOT] WorkflowIntegration loaded');
} catch (e) {
    console.log('[BOOT] WorkflowIntegration not available:', e.message);
}

// --- Resolve helpers (Studio mode only) ---
async function initResolveInterface() {
    if (!WorkflowIntegration) return null;
    const isSuccess = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!isSuccess) return null;
    return await WorkflowIntegration.GetResolve();
}

// --- Lib modules ---
const YTMusicSearch = require('./lib/ytmusic-search');
const AudioDownloader = require('./lib/audio-downloader');
const ResolveBridge = require('./lib/resolve-bridge');
const PlaylistStore = require('./lib/playlist-store');
const DownloadStore = require('./lib/download-store');
const SettingsStore = require('./lib/settings-store');
const { resolveYtdlpPath } = require('./lib/ytdlp-resolver');

console.log('[BOOT] Modules loaded');
const ytmusic = new YTMusicSearch();
const settings = new SettingsStore();
const playlists = new PlaylistStore();
const downloads = new DownloadStore();
const downloader = new AudioDownloader(settings);
let resolveBridge = null;
console.log('[BOOT] Instances created');

// --- Audio preview: get direct URL via yt-dlp ---
let audioUrlCache = new Map(); // videoId -> { url, expires }
const pendingAudioUrlRequests = new Map();
const PREFETCH_CONCURRENCY = 2; // keep background work light so explicit play/download stays responsive
const PREFETCH_LIMIT = 6;
let prefetchQueue = [];
let activePrefetches = 0;

function getAudioUrl(videoId) {
    const cached = audioUrlCache.get(videoId);
    if (cached && cached.expires > Date.now()) {
        console.log(`[PREVIEW] Cache hit for ${videoId}`);
        return Promise.resolve(cached.url);
    }

    const pending = pendingAudioUrlRequests.get(videoId);
    if (pending) {
        console.log(`[PREVIEW] Reusing in-flight lookup for ${videoId}`);
        return pending;
    }

    const request = new Promise((resolve, reject) => {
        let ytdlp;
        try {
            ytdlp = resolveYtdlpPath(settings, __dirname);
        } catch (error) {
            return reject(new Error('yt-dlp is unavailable'));
        }

        const cached = audioUrlCache.get(videoId);
        if (cached && cached.expires > Date.now()) {
            console.log(`[PREVIEW] Cache hit for ${videoId}`);
            return resolve(cached.url);
        }
        const args = [
            '-f', 'wa/w/ba/b',  // worst audio first — small and fast to stream for preview
            '--get-url',
            '--no-playlist',
            '--no-warnings',
            '--js-runtimes', 'node',
            '--extractor-args', 'youtube:player_client=default,web_music',
            `https://www.youtube.com/watch?v=${videoId}`
        ];

        console.log(`[PREVIEW] Getting URL for ${videoId}...`);
        const startTime = Date.now();

        execFile(ytdlp, args, { timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            const elapsed = Date.now() - startTime;
            if (err) {
                const stderrSummary = (stderr || '').trim().split('\n').slice(-1)[0];
                console.log(`[PREVIEW] Failed after ${elapsed}ms${stderrSummary ? `: ${stderrSummary}` : ''}`);
                return reject(new Error('Could not get audio URL'));
            }
            const url = stdout.trim().split('\n')[0]; // take first URL only
            if (!url || !url.startsWith('http')) return reject(new Error('No URL returned'));

            console.log(`[PREVIEW] Got URL in ${elapsed}ms`);
            // Cache for 4 hours (YouTube URLs expire after ~6h)
            audioUrlCache.set(videoId, { url, expires: Date.now() + 4 * 60 * 60 * 1000 });
            resolve(url);
        });
    }).finally(() => {
        pendingAudioUrlRequests.delete(videoId);
    });

    pendingAudioUrlRequests.set(videoId, request);
    return request;
}

// Pre-fetch URLs for search results — limited concurrency
function prefetchUrls(videoIds) {
    // Clear old queue (new search replaces old)
    prefetchQueue = [];
    for (const id of videoIds.slice(0, PREFETCH_LIMIT)) {
        const cached = audioUrlCache.get(id);
        if ((cached && cached.expires > Date.now()) || pendingAudioUrlRequests.has(id)) continue;
        prefetchQueue.push(id);
    }
    console.log(`[PREFETCH] Queued ${prefetchQueue.length} tracks (${PREFETCH_CONCURRENCY} concurrent, first ${PREFETCH_LIMIT} only)`);
    // Kick off workers up to concurrency limit
    for (let i = activePrefetches; i < PREFETCH_CONCURRENCY; i++) {
        prefetchNext();
    }
}

function prefetchNext() {
    if (prefetchQueue.length === 0) return;
    const videoId = prefetchQueue.shift();

    // Skip if cached while waiting in queue
    const cached = audioUrlCache.get(videoId);
    if (cached && cached.expires > Date.now()) {
        prefetchNext();
        return;
    }

    activePrefetches++;
    getAudioUrl(videoId)
        .then(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('prefetch:ready', videoId);
            }
        })
        .catch(() => {})
        .finally(() => {
            activePrefetches--;
            prefetchNext(); // pick up next from queue
        });
}

// --- IPC Handlers ---
function registerIpcHandlers() {
    // App
    ipcMain.handle('app:isResolveAvailable', () => resolveAvailable);
    ipcMain.handle('app:getPreviewUrl', async (event, videoId) => {
        try {
            const url = await getAudioUrl(videoId);
            return { url, error: null };
        } catch (err) {
            return { url: null, error: err.message };
        }
    });
    ipcMain.handle('app:showInFinder', (event, filePath) => {
        shell.showItemInFolder(filePath);
    });
    ipcMain.handle('app:openDownloadDir', () => {
        const dir = settings.get('downloadDir');
        shell.openPath(dir);
    });

    // Music search
    ipcMain.handle('music:search', async (event, query) => {
        const results = await ytmusic.search(query);
        const allIds = results.map(r => r.videoId);
        prefetchUrls(allIds);
        return results;
    });

    // Get playlist tracks (tries direct fetch, caller handles errors)
    ipcMain.handle('music:getPlaylistTracks', async (event, playlistId) => {
        const results = await ytmusic.getPlaylistTracks(playlistId);
        const allIds = results.map(r => r.videoId).filter(Boolean);
        prefetchUrls(allIds);
        return results;
    });

    // Home sections
    ipcMain.handle('music:getHomeSections', async () => {
        return await ytmusic.getHomeSections();
    });


    // Check if a preview URL is cached (for UI status)
    ipcMain.handle('app:isPreviewCached', (event, videoId) => {
        const cached = audioUrlCache.get(videoId);
        return !!(cached && cached.expires > Date.now());
    });

    // Invalidate cached preview URL (for retry on failure)
    ipcMain.handle('app:invalidatePreviewCache', (event, videoId) => {
        audioUrlCache.delete(videoId);
    });

    // Download — pass cached audio URL if available to skip re-fetching
    ipcMain.handle('download:start', async (event, videoId, title, format) => {
        const cached = audioUrlCache.get(videoId);
        const cachedUrl = (cached && cached.expires > Date.now()) ? cached.url : null;
        return await downloader.download(videoId, title, format, (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download:progress', { videoId, progress });
            }
        }, cachedUrl);
    });
    ipcMain.handle('download:cancel', (event, videoId) => {
        downloader.cancel(videoId);
    });
    ipcMain.handle('download:getHistory', () => downloads.getAll());
    ipcMain.handle('download:saveToHistory', (event, track) => downloads.add(track));

    // Playlists
    ipcMain.handle('playlist:getAll', () => playlists.getAll());
    ipcMain.handle('playlist:create', (event, name) => playlists.create(name));
    ipcMain.handle('playlist:rename', (event, id, name) => playlists.rename(id, name));
    ipcMain.handle('playlist:delete', (event, id) => playlists.remove(id));
    ipcMain.handle('playlist:addTrack', (event, playlistId, track) => playlists.addTrack(playlistId, track));
    ipcMain.handle('playlist:removeTrack', (event, playlistId, videoId) => playlists.removeTrack(playlistId, videoId));
    ipcMain.handle('playlist:setLocalPath', (event, playlistId, videoId, localPath) => playlists.setLocalPath(playlistId, videoId, localPath));

    // Settings
    ipcMain.handle('settings:get', (event, key) => settings.get(key));
    ipcMain.handle('settings:set', (event, key, value) => settings.set(key, value));
    ipcMain.handle('settings:getAll', () => settings.getAll());
    ipcMain.handle('settings:selectDownloadDir', async () => {
        const result = await require('electron').dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Download Directory'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            settings.set('downloadDir', result.filePaths[0]);
            return result.filePaths[0];
        }
        return null;
    });

    // Resolve (Studio mode only)
    ipcMain.handle('resolve:importToMediaPool', async (event, filePath) => {
        if (!resolveAvailable || !resolveBridge) return false;
        return await resolveBridge.importToMediaPool(filePath);
    });
    ipcMain.handle('resolve:addToTimeline', async (event, filePath) => {
        if (!resolveAvailable || !resolveBridge) return false;
        return await resolveBridge.addToTimeline(filePath);
    });
    ipcMain.handle('resolve:isConnected', () => resolveAvailable);
}

// --- Window ---
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 480,
        height: 750,
        minWidth: 400,
        minHeight: 600,
        useContentSize: true,
        backgroundColor: '#0d0d0d',
        titleBarStyle: 'hiddenInset',
        alwaysOnTop: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('close', () => {
        app.quit();
    });
}

// --- Prevent singleton lock conflict when Resolve plugin is also running ---
const isInsideResolve = __dirname.includes('Workflow Integration Plugins');
if (!isInsideResolve) {
    app.setPath('userData', path.join(app.getPath('appData'), 'YouTube Music Resolve Standalone'));
}

// --- Custom protocol for local audio playback ---
protocol.registerSchemesAsPrivileged([{
    scheme: 'local-audio',
    privileges: { stream: true, bypassCSP: true }
}]);

// --- App lifecycle ---
console.log('[BOOT] Waiting for app ready...');
app.whenReady().then(async () => {
    // Register protocol handler for local audio files
    protocol.handle('local-audio', (request) => {
        const filePath = decodeURIComponent(request.url.replace('local-audio://', ''));
        return net.fetch('file://' + filePath);
    });
    console.log('[BOOT] App ready');
    // Only try to connect to Resolve if we're running from the plugins directory
    if (WorkflowIntegration && isInsideResolve) {
        try {
            console.log('[BOOT] Connecting to Resolve...');
            resolveObj = await initResolveInterface();
            if (resolveObj) {
                resolveAvailable = true;
                resolveBridge = new ResolveBridge(resolveObj, WorkflowIntegration);
                console.log('[BOOT] Connected to Resolve');
            }
        } catch (e) {
            console.log('[BOOT] Resolve connection failed:', e.message);
            resolveAvailable = false;
        }
    } else {
        console.log('[BOOT] Standalone mode — skipping Resolve connection');
    }

    console.log('[BOOT] Registering IPC...');
    registerIpcHandlers();
    console.log('[BOOT] Creating window...');
    createWindow();
    console.log('[BOOT] Window created');
});

app.on('window-all-closed', () => {
    if (WorkflowIntegration && resolveAvailable) {
        WorkflowIntegration.CleanUp();
    }
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
