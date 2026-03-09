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

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const PLUGIN_ID = 'com.daviddayan.resolve.youtubemusic';

let mainWindow = null;
let resolveAvailable = false;
let resolveObj = null;

// --- Dual-mode: try loading WorkflowIntegration ---
let WorkflowIntegration = null;
try {
    WorkflowIntegration = require('./WorkflowIntegration.node');
} catch (e) {
    // Running standalone — Resolve features disabled
}

// --- Resolve helpers (Studio mode only) ---
async function initResolveInterface() {
    if (!WorkflowIntegration) return null;
    const isSuccess = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!isSuccess) return null;
    return await WorkflowIntegration.GetResolve();
}

async function getResolve() {
    if (!resolveObj && WorkflowIntegration) {
        resolveObj = await initResolveInterface();
    }
    return resolveObj;
}

// --- Lib modules ---
const YTMusicSearch = require('./lib/ytmusic-search');
const AudioDownloader = require('./lib/audio-downloader');
const ResolveBridge = require('./lib/resolve-bridge');
const PlaylistStore = require('./lib/playlist-store');
const SettingsStore = require('./lib/settings-store');

const ytmusic = new YTMusicSearch();
const settings = new SettingsStore();
const playlists = new PlaylistStore();
const downloader = new AudioDownloader(settings);
let resolveBridge = null;

// --- Audio preview server ---
const http = require('http');
const ytdl = require('@distube/ytdl-core');

let previewServer = null;
let currentPreviewStream = null;

function startPreviewServer() {
    previewServer = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const videoId = url.searchParams.get('id');
        if (!videoId) {
            res.writeHead(400);
            res.end('Missing id');
            return;
        }

        try {
            // Destroy previous stream if any
            if (currentPreviewStream) {
                currentPreviewStream.destroy();
                currentPreviewStream = null;
            }

            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const info = await ytdl.getInfo(videoUrl);
            const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });

            res.writeHead(200, {
                'Content-Type': format.mimeType || 'audio/webm',
                'Access-Control-Allow-Origin': '*',
                'Transfer-Encoding': 'chunked'
            });

            currentPreviewStream = ytdl(videoUrl, { format });
            currentPreviewStream.pipe(res);
            currentPreviewStream.on('error', () => res.end());
            res.on('close', () => {
                if (currentPreviewStream) {
                    currentPreviewStream.destroy();
                    currentPreviewStream = null;
                }
            });
        } catch (err) {
            res.writeHead(500);
            res.end('Stream error: ' + err.message);
        }
    });

    previewServer.listen(0, '127.0.0.1', () => {
        const port = previewServer.address().port;
        console.log(`Preview server on port ${port}`);
    });
}

function getPreviewPort() {
    return previewServer ? previewServer.address().port : 0;
}

// --- IPC Handlers ---
function registerIpcHandlers() {
    // App
    ipcMain.handle('app:isResolveAvailable', () => resolveAvailable);
    ipcMain.handle('app:getPreviewPort', () => getPreviewPort());
    ipcMain.handle('app:showInFinder', (event, filePath) => {
        shell.showItemInFolder(filePath);
    });
    ipcMain.handle('app:openDownloadDir', () => {
        const dir = settings.get('downloadDir');
        shell.openPath(dir);
    });

    // Music search
    ipcMain.handle('music:search', async (event, query) => {
        return await ytmusic.search(query);
    });

    // Download
    ipcMain.handle('download:start', async (event, videoId, title, format) => {
        return await downloader.download(videoId, title, format, (progress) => {
            mainWindow.webContents.send('download:progress', { videoId, progress });
        });
    });
    ipcMain.handle('download:cancel', (event, videoId) => {
        downloader.cancel(videoId);
    });
    ipcMain.handle('download:getPath', (event, videoId, title, format) => {
        return downloader.getOutputPath(videoId, title, format);
    });

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
            sandbox: true,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('close', () => {
        if (currentPreviewStream) {
            currentPreviewStream.destroy();
        }
        if (previewServer) {
            previewServer.close();
        }
        app.quit();
    });
}

// --- App lifecycle ---
app.whenReady().then(async () => {
    // Try to connect to Resolve
    if (WorkflowIntegration) {
        try {
            resolveObj = await initResolveInterface();
            if (resolveObj) {
                resolveAvailable = true;
                resolveBridge = new ResolveBridge(resolveObj, WorkflowIntegration);
            }
        } catch (e) {
            resolveAvailable = false;
        }
    }

    startPreviewServer();
    registerIpcHandlers();
    createWindow();
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
