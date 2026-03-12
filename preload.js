const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('musicAPI', {
    search: (query) => ipcRenderer.invoke('music:search', query),
    getHomeSections: () => ipcRenderer.invoke('music:getHomeSections'),
    getHomeContent: () => ipcRenderer.invoke('home:getSections'),
    getPlaylistTracks: (playlistId) => ipcRenderer.invoke('music:getPlaylistTracks', playlistId),
    getArtist: (artistId) => ipcRenderer.invoke('music:getArtist', artistId),
    getArtistSongs: (artistId) => ipcRenderer.invoke('music:getArtistSongs', artistId),
    getAlbum: (albumId) => ipcRenderer.invoke('music:getAlbum', albumId),
});

contextBridge.exposeInMainWorld('downloadAPI', {
    start: (videoId, title, format) => ipcRenderer.invoke('download:start', videoId, title, format),
    cancel: (videoId) => ipcRenderer.invoke('download:cancel', videoId),
    onProgress: (callback) => ipcRenderer.on('download:progress', (event, data) => callback(data)),
    getHistory: () => ipcRenderer.invoke('download:getHistory'),
    saveToHistory: (track) => ipcRenderer.invoke('download:saveToHistory', track),
});

contextBridge.exposeInMainWorld('resolveAPI', {
    importToMediaPool: (filePath) => ipcRenderer.invoke('resolve:importToMediaPool', filePath),
    addToTimeline: (filePath) => ipcRenderer.invoke('resolve:addToTimeline', filePath),
    isConnected: () => ipcRenderer.invoke('resolve:isConnected'),
    getProjectName: () => ipcRenderer.invoke('resolve:getProjectName'),
});

contextBridge.exposeInMainWorld('playlistAPI', {
    getAll: () => ipcRenderer.invoke('playlist:getAll'),
    create: (name) => ipcRenderer.invoke('playlist:create', name),
    rename: (id, name) => ipcRenderer.invoke('playlist:rename', id, name),
    remove: (id) => ipcRenderer.invoke('playlist:delete', id),
    addTrack: (playlistId, track) => ipcRenderer.invoke('playlist:addTrack', playlistId, track),
    removeTrack: (playlistId, videoId) => ipcRenderer.invoke('playlist:removeTrack', playlistId, videoId),
    setLocalPath: (playlistId, videoId, localPath) => ipcRenderer.invoke('playlist:setLocalPath', playlistId, videoId, localPath),
    setTrackLocalPath: (videoId, localPath) => ipcRenderer.invoke('playlist:setTrackLocalPath', videoId, localPath),
});

contextBridge.exposeInMainWorld('settingsAPI', {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    selectDownloadDir: () => ipcRenderer.invoke('settings:selectDownloadDir'),
    syncDownloadDir: () => ipcRenderer.invoke('settings:syncDownloadDir'),
});

contextBridge.exposeInMainWorld('updaterAPI', {
    check: () => ipcRenderer.invoke('updater:check'),
    download: (downloadUrl) => ipcRenderer.invoke('updater:download', downloadUrl),
    apply: (zipPath) => ipcRenderer.invoke('updater:apply', zipPath),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    onProgress: (callback) => ipcRenderer.on('updater:progress', (event, progress) => callback(progress)),
});

contextBridge.exposeInMainWorld('appAPI', {
    isResolveAvailable: () => ipcRenderer.invoke('app:isResolveAvailable'),
    getProfile: () => ipcRenderer.invoke('app:getProfile'),
    getPreviewUrl: (videoId) => ipcRenderer.invoke('app:getPreviewUrl', videoId),
    resolveTrackSource: (videoId, localPath) => ipcRenderer.invoke('app:resolveTrackSource', videoId, localPath),
    isFileAvailable: (filePath) => ipcRenderer.invoke('app:isFileAvailable', filePath),
    isPreviewCached: (videoId) => ipcRenderer.invoke('app:isPreviewCached', videoId),
    onPrefetchReady: (callback) => ipcRenderer.on('prefetch:ready', (event, videoId) => callback(videoId)),
    invalidatePreviewCache: (videoId) => ipcRenderer.invoke('app:invalidatePreviewCache', videoId),
    showInFinder: (filePath) => ipcRenderer.invoke('app:showInFinder', filePath),
    openDownloadDir: () => ipcRenderer.invoke('app:openDownloadDir'),
});
