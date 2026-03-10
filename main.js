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
const AudioSourceService = require('./lib/audio-source-service');
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
const downloader = new AudioDownloader(settings, {
    fetchImpl: (url, options = {}) => net.fetch(url, options)
});
let resolveBridge = null;
console.log('[BOOT] Instances created');

const audioSources = new AudioSourceService({
    execFile,
    fetchImpl: (url, options = {}) => net.fetch(url, options),
    resolveYtdlpPath,
    settings,
    baseDir: __dirname,
    onPrefetchReady: (videoId) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('prefetch:ready', videoId);
        }
    }
});

async function startDownload(videoId, title, format, onProgress) {
    audioSources.beginDownload(videoId);
    const cachedUrl = audioSources.resolveDownloadUrl(videoId);
    console.log(`[DOWNLOAD] Start requested for ${videoId} (${format}) using ${cachedUrl ? 'reused media URL' : 'watch-page yt-dlp resolution'}`);

    try {
        const outputPath = await downloader.download(videoId, title, format, onProgress, cachedUrl);
        console.log(`[DOWNLOAD] Completed for ${videoId}: ${outputPath}`);
        return outputPath;
    } catch (error) {
        if (!cachedUrl) {
            console.warn(`[DOWNLOAD] Failed for ${videoId} without reusable URL: ${error.message}`);
            throw error;
        }

        console.warn(`[DOWNLOAD] Cached URL failed for ${videoId}, retrying with a fresh lookup`);
        audioSources.invalidate(videoId);
        const outputPath = await downloader.download(videoId, title, format, onProgress, null);
        console.log(`[DOWNLOAD] Completed for ${videoId} after fresh retry: ${outputPath}`);
        return outputPath;
    } finally {
        audioSources.endDownload(videoId);
    }
}

// --- IPC Handlers ---
function registerIpcHandlers() {
    // App
    ipcMain.handle('app:isResolveAvailable', () => resolveAvailable);
    ipcMain.handle('app:getPreviewUrl', async (event, videoId) => {
        try {
            const session = await audioSources.getOrCreatePreviewSession(videoId);
            const url = session.protocolUrl;
            return { url, error: null };
        } catch (err) {
            return { url: null, error: err.message };
        }
    });
    ipcMain.handle('app:resolveTrackSource', async (event, videoId, localPath) => {
        try {
            return await audioSources.resolveTrackSource(videoId, localPath);
        } catch (err) {
            return { url: null, error: err.message, source: null, missingLocalFile: Boolean(localPath) };
        }
    });
    ipcMain.handle('app:isFileAvailable', (event, filePath) => audioSources.fileExists(filePath));
    ipcMain.handle('app:showInFinder', (event, filePath) => {
        if (!audioSources.fileExists(filePath)) {
            return false;
        }
        shell.showItemInFolder(filePath);
        return true;
    });
    ipcMain.handle('app:openDownloadDir', () => {
        const dir = settings.get('downloadDir');
        shell.openPath(dir);
    });

    // Music search
    ipcMain.handle('music:search', async (event, query) => {
        const results = await ytmusic.search(query);
        const allIds = results.map(r => r.videoId);
        audioSources.prefetchUrls(allIds);
        return results;
    });

    // Get playlist tracks (tries direct fetch, caller handles errors)
    ipcMain.handle('music:getPlaylistTracks', async (event, playlistId) => {
        const results = await ytmusic.getPlaylistTracks(playlistId);
        const allIds = results.map(r => r.videoId).filter(Boolean);
        audioSources.prefetchUrls(allIds);
        return results;
    });

    // Home sections
    ipcMain.handle('music:getHomeSections', async () => {
        return await ytmusic.getHomeSections();
    });


    // Check if a preview URL is cached (for UI status)
    ipcMain.handle('app:isPreviewCached', (event, videoId) => {
        return audioSources.isPreviewCached(videoId);
    });

    // Invalidate cached preview URL (for retry on failure)
    ipcMain.handle('app:invalidatePreviewCache', (event, videoId) => {
        audioSources.invalidate(videoId);
    });

    // Download — pass cached audio URL if available to skip re-fetching
    ipcMain.handle('download:start', async (event, videoId, title, format) => {
        return await startDownload(videoId, title, format, (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download:progress', { videoId, progress });
            }
        });
    });
    ipcMain.handle('download:cancel', (event, videoId) => {
        downloader.cancel(videoId);
    });
    ipcMain.handle('download:getHistory', () => downloads.getAll().map(track => audioSources.serializeDownload(track)));
    ipcMain.handle('download:saveToHistory', (event, track) => downloads.add(track));

    // Playlists
    ipcMain.handle('playlist:getAll', () => playlists.getAll().map(playlist => audioSources.serializePlaylist(playlist)));
    ipcMain.handle('playlist:create', (event, name) => playlists.create(name));
    ipcMain.handle('playlist:rename', (event, id, name) => playlists.rename(id, name));
    ipcMain.handle('playlist:delete', (event, id) => playlists.remove(id));
    ipcMain.handle('playlist:addTrack', (event, playlistId, track) => playlists.addTrack(playlistId, track));
    ipcMain.handle('playlist:removeTrack', (event, playlistId, videoId) => playlists.removeTrack(playlistId, videoId));
    ipcMain.handle('playlist:setLocalPath', (event, playlistId, videoId, localPath) => playlists.setLocalPath(playlistId, videoId, localPath));
    ipcMain.handle('playlist:setTrackLocalPath', (event, videoId, localPath) => playlists.setTrackLocalPath(videoId, localPath));

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
}, {
    scheme: 'preview-audio',
    privileges: { stream: true, bypassCSP: true, supportFetchAPI: true }
}]);

// --- App lifecycle ---
console.log('[BOOT] Waiting for app ready...');
app.whenReady().then(async () => {
    // Register protocol handler for local audio files
    protocol.handle('local-audio', (request) => {
        const filePath = decodeURIComponent(request.url.replace('local-audio://', ''));
        return net.fetch('file://' + filePath);
    });
    protocol.handle('preview-audio', (request) => audioSources.handlePreviewRequest(request));
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
