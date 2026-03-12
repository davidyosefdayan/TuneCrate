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
const { app, BrowserWindow, Menu, ipcMain, shell, net, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { execFile } = require('child_process');

const PLUGIN_ID = 'com.daviddayan.resolve.tunecrate';

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
const Profile = require('./lib/profile');
const updater = require('./lib/updater');

console.log('[BOOT] Modules loaded');
const profile = new Profile(__dirname);
console.log(`[BOOT] Profile mode: ${profile.getMode()}`);
const ytmusic = new YTMusicSearch();
const settings = new SettingsStore();
const playlists = new PlaylistStore();
const downloads = new DownloadStore();
const fetchImpl = (url, options = {}) => net.fetch(url, options);
const downloader = new AudioDownloader(settings, { fetchImpl });
let resolveBridge = null;
console.log('[BOOT] Instances created');

const audioSources = new AudioSourceService({
    execFile,
    fetchImpl,
    resolveYtdlpPath,
    settings,
    baseDir: __dirname,
    onPrefetchReady: (videoId) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('prefetch:ready', videoId);
        }
    }
});

function getAudioContentType(filePath) {
    switch (path.extname(filePath).toLowerCase()) {
        case '.mp3':
            return 'audio/mpeg';
        case '.wav':
            return 'audio/wav';
        case '.m4a':
        case '.mp4':
            return 'audio/mp4';
        case '.webm':
            return 'audio/webm';
        case '.ogg':
            return 'audio/ogg';
        default:
            return 'application/octet-stream';
    }
}

function parseRangeHeader(rangeHeader, fileSize) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
        return null;
    }

    const [startText, endText] = rangeHeader.replace('bytes=', '').split('-', 2);
    let start = startText ? Number.parseInt(startText, 10) : NaN;
    let end = endText ? Number.parseInt(endText, 10) : NaN;

    if (Number.isNaN(start)) {
        const suffixLength = end;
        if (Number.isNaN(suffixLength)) {
            return null;
        }
        start = Math.max(fileSize - suffixLength, 0);
        end = fileSize - 1;
    } else if (Number.isNaN(end) || end >= fileSize) {
        end = fileSize - 1;
    }

    if (start < 0 || start >= fileSize || end < start) {
        return { invalid: true };
    }

    return { start, end };
}

async function handleLocalAudioRequest(request) {
    const filePath = decodeURIComponent(request.url.replace('local-audio://', ''));

    try {
        const stats = await fs.promises.stat(filePath);
        const fileSize = stats.size;
        const contentType = getAudioContentType(filePath);
        const range = parseRangeHeader(request.headers.get('range'), fileSize);

        if (range?.invalid) {
            return new Response(null, {
                status: 416,
                headers: {
                    'Accept-Ranges': 'bytes',
                    'Content-Range': `bytes */${fileSize}`
                }
            });
        }

        const headers = {
            'Accept-Ranges': 'bytes',
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
        };

        if (!range) {
            headers['Content-Length'] = String(fileSize);
            const stream = fs.createReadStream(filePath);
            return new Response(Readable.toWeb(stream), { status: 200, headers });
        }

        const chunkSize = range.end - range.start + 1;
        headers['Content-Length'] = String(chunkSize);
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${fileSize}`;

        const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
        return new Response(Readable.toWeb(stream), { status: 206, headers });
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return new Response('File not found', { status: 404 });
        }

        console.warn(`[LOCAL-AUDIO] Failed to serve ${filePath}: ${error.message}`);
        return new Response('Local audio failed', { status: 500 });
    }
}

async function startDownload(videoId, title, format, onProgress) {
    audioSources.beginDownload(videoId);
    const downloadSource = audioSources.resolveDownloadSource(videoId);
    console.log(`[DOWNLOAD] Start requested for ${videoId} (${format}) using ${downloadSource.kind === 'media-url' ? downloadSource.label : 'watch-page yt-dlp resolution'}`);

    try {
        const outputPath = await downloader.download(videoId, title, format, onProgress, downloadSource);
        console.log(`[DOWNLOAD] Completed for ${videoId}: ${outputPath}`);
        return outputPath;
    } catch (error) {
        if (downloadSource.kind !== 'media-url') {
            console.warn(`[DOWNLOAD] Failed for ${videoId} without reusable URL: ${error.message}`);
            throw error;
        }

        console.warn(`[DOWNLOAD] Reused media URL failed for ${videoId}, retrying with a watch-page lookup`);
        audioSources.invalidate(videoId);
        const outputPath = await downloader.download(videoId, title, format, onProgress, { kind: 'watch-url' });
        console.log(`[DOWNLOAD] Completed for ${videoId} after watch-page retry: ${outputPath}`);
        return outputPath;
    } finally {
        audioSources.endDownload(videoId);
    }
}

// --- Home sections builder ---
async function buildHomeSections() {
    let artistIds = [];

    if (profile.getMode() === 'curated') {
        const picks = profile.getRandomArtists(12);
        artistIds = picks.map(a => a.artistId);
    } else {
        // Open mode: get home sections from YT Music, extract unique artist IDs
        try {
            const sections = await ytmusic.getHomeSections();
            const seen = new Set();
            for (const section of sections) {
                for (const item of (section.items || [])) {
                    if (item.artist && item.videoId) {
                        // Search for the artist to get their ID
                        const id = item.artistId || item.id;
                        if (id && !seen.has(id)) {
                            seen.add(id);
                            artistIds.push(id);
                        }
                    }
                }
            }
            // Take 8-10 unique artist IDs
            artistIds = artistIds.slice(0, 10);
        } catch (err) {
            console.warn('[HOME] Failed to get home sections:', err.message);
            return [];
        }
    }

    if (artistIds.length === 0) return [];

    // Fetch artist details in parallel
    const results = await Promise.allSettled(
        artistIds.map(id => ytmusic.getArtist(id))
    );

    const artists = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

    return assembleHomeSections(artists);
}

function assembleHomeSections(artistResults) {
    const allSongs = [];
    const allAlbums = [];
    const allArtists = [];

    for (const artist of artistResults) {
        // Collect songs
        if (artist.topSongs) {
            for (const song of artist.topSongs) {
                allSongs.push({
                    videoId: song.videoId,
                    name: song.title,
                    artist: song.artist,
                    artistId: song.artistId,
                    duration: song.duration,
                    thumbnail: song.thumbnail,
                    thumbnailSmall: song.thumbnail
                });
            }
        }

        // Collect albums + singles
        const albums = [...(artist.topAlbums || []), ...(artist.topSingles || [])];
        for (const album of albums) {
            allAlbums.push({
                albumId: album.albumId,
                playlistId: album.playlistId,
                name: album.name,
                artist: artist.name,
                artistId: artist.artistId,
                year: album.year,
                thumbnail: album.thumbnail,
                thumbnailSmall: album.thumbnail
            });
        }

        // Collect artist cards
        allArtists.push({
            artistId: artist.artistId,
            name: artist.name,
            thumbnail: artist.thumbnail,
            thumbnailSmall: artist.thumbnail
        });
    }

    // Shuffle helpers
    const shuffle = arr => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };

    const sections = [];

    // Quick Picks — ~20 random songs
    if (allSongs.length > 0) {
        sections.push({
            id: 'quick-picks',
            title: 'Quick Picks',
            type: 'songs',
            items: shuffle(allSongs).slice(0, 20)
        });
    }

    // Featured Albums — ~12 random albums
    if (allAlbums.length > 0) {
        sections.push({
            id: 'featured-albums',
            title: 'Featured Albums',
            type: 'albums',
            items: shuffle(allAlbums).slice(0, 12)
        });
    }

    // Artists — all fetched, shuffled
    if (allArtists.length > 0) {
        sections.push({
            id: 'artists',
            title: 'Artists',
            type: 'artists',
            items: shuffle(allArtists)
        });
    }

    // New Releases — albums sorted by year desc
    const withYear = allAlbums.filter(a => a.year);
    if (withYear.length > 0) {
        sections.push({
            id: 'new-releases',
            title: 'New Releases',
            type: 'albums',
            items: [...withYear].sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, 12)
        });
    }

    return sections;
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

    // Profile
    ipcMain.handle('app:getProfile', () => profile.getProfile());

    // Home sections (profile-aware)
    ipcMain.handle('home:getSections', async () => {
        return await buildHomeSections();
    });

    // Music search
    ipcMain.handle('music:search', async (event, query) => {
        let results = await ytmusic.search(query);
        if (profile.getMode() === 'curated') {
            results = results.filter(r => profile.isArtistAllowed(r.artistId));
        }
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

    // Artist
    ipcMain.handle('music:getArtist', async (event, artistId) => {
        return await ytmusic.getArtist(artistId);
    });

    ipcMain.handle('music:getArtistSongs', async (event, artistId) => {
        const results = await ytmusic.getArtistSongs(artistId);
        const allIds = results.map(r => r.videoId).filter(Boolean);
        audioSources.prefetchUrls(allIds);
        return results;
    });

    // Album
    ipcMain.handle('music:getAlbum', async (event, albumId) => {
        const album = await ytmusic.getAlbum(albumId);
        const allIds = album.songs.map(s => s.videoId).filter(Boolean);
        audioSources.prefetchUrls(allIds);
        return album;
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

    // Project sync — compute project-synced download directory
    ipcMain.handle('settings:syncDownloadDir', async () => {
        let projectName = null;
        if (resolveAvailable && resolveBridge) {
            try {
                const project = await resolveBridge.getProject();
                if (project) projectName = await project.GetName();
            } catch { /* ignore */ }
        }

        const { DATA_DIR } = require('./lib/shared-paths');
        const folder = projectName || 'Default Project';
        const syncDir = path.join(DATA_DIR, 'Projects', folder, 'TuneCrate');
        if (!fs.existsSync(syncDir)) {
            fs.mkdirSync(syncDir, { recursive: true });
        }
        settings.set('downloadDir', syncDir);
        return syncDir;
    });

    // Project sync — get current Resolve project name for download dir
    ipcMain.handle('resolve:getProjectName', async () => {
        if (!resolveAvailable || !resolveBridge) return null;
        try {
            const project = await resolveBridge.getProject();
            if (!project) return null;
            return await project.GetName();
        } catch {
            return null;
        }
    });

    // Updates
    ipcMain.handle('updater:check', async () => {
        try {
            return await updater.checkForUpdates();
        } catch (err) {
            return { updateAvailable: false, error: err.message };
        }
    });
    ipcMain.handle('updater:download', async (event, downloadUrl) => {
        try {
            const result = await updater.downloadUpdate(downloadUrl, (progress) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('updater:progress', progress);
                }
            });
            return { success: true, zipPath: result.zipPath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    ipcMain.handle('updater:apply', async (event, zipPath) => {
        try {
            await updater.applyUpdate(zipPath);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    ipcMain.handle('updater:getVersion', () => updater.getCurrentVersion());

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
        icon: path.join(__dirname, 'assets', 'favicon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');

    // Custom menu without zoom roles
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        }
    ]));

    mainWindow.on('close', () => {
        app.quit();
    });
}

// --- Prevent singleton lock conflict when Resolve plugin is also running ---
const isInsideResolve = __dirname.includes('Workflow Integration Plugins');
if (!isInsideResolve) {
    app.setPath('userData', path.join(app.getPath('appData'), 'TuneCrate Standalone'));
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
    // Set dock icon and name on macOS
    if (process.platform === 'darwin' && app.dock) {
        const { nativeImage } = require('electron');
        const dockIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'favicon.png'));
        if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    }

    // Register protocol handler for local audio files
    protocol.handle('local-audio', (request) => handleLocalAudioRequest(request));
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
