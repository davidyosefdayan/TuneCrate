function findTrack(videoId) {
    const searchMatch = typeof searchResults !== 'undefined'
        ? searchResults.find(track => track.videoId === videoId)
        : null;

    return searchMatch
        || AppState.downloadHistory.find(track => track.videoId === videoId)
        || (AppState.currentTrack?.videoId === videoId ? AppState.currentTrack : null);
}

function playTrack(videoId) {
    const track = findTrack(videoId);
    if (track) {
        startPreview(track);
    }
}

async function downloadTrack(videoId, { silent = false } = {}) {
    if (AppState.downloading.has(videoId) || hasLocalDownload(videoId)) {
        console.log(`[DOWNLOAD] Ignoring duplicate request for ${videoId}. downloading=${AppState.downloading.has(videoId)} local=${hasLocalDownload(videoId)}`);
        return getLocalTrackPath(findTrack(videoId));
    }

    const track = findTrack(videoId);
    if (!track) return null;

    const format = await window.settingsAPI.get('defaultFormat') || 'mp3';

    AppState.downloading.add(videoId);
    AppState.downloadProgress[videoId] = 0;
    if (typeof updateDownloadButton === 'function') {
        updateDownloadButton(videoId, 0);
    }
    if (!silent) {
        showToast(`Downloading: ${track.title}`);
    }

    try {
        console.log(`[DOWNLOAD] Renderer starting download for ${videoId} (${track.title})`);
        const filePath = await window.downloadAPI.start(videoId, track.title, format);
        AppState.downloading.delete(videoId);
        delete AppState.downloadProgress[videoId];
        await syncDownloadedTrack(track, filePath);
        console.log(`[DOWNLOAD] Renderer finished download for ${videoId}: ${filePath}`);

        if (!silent) {
            showToast(`Downloaded: ${track.title}`, 'success');
        }

        if (!silent && AppState.resolveAvailable) {
            const autoImport = await window.settingsAPI.get('autoImport');
            if (autoImport) {
                await window.resolveAPI.addToTimeline(filePath);
                showToast('Added to Timeline', 'success');
            }
        }

        return filePath;
    } catch (err) {
        AppState.downloading.delete(videoId);
        delete AppState.downloadProgress[videoId];
        console.warn(`[DOWNLOAD] Renderer download failed for ${videoId}: ${err.message}`);
        showToast(`Download failed: ${err.message}`, 'error');
        refreshTrackUi(videoId);
        return null;
    }
}

async function importTrack(videoId) {
    const track = findTrack(videoId);
    if (!track) return;

    let filePath = await verifyLocalTrackPath(track);
    if (!filePath) {
        filePath = await downloadTrack(videoId, { silent: true });
        if (!filePath) {
            showToast('Download failed', 'error');
            return;
        }
    }

    try {
        const result = await window.resolveAPI.addToTimeline(filePath);
        if (result) {
            showToast('Added to Timeline', 'success');
        } else {
            showToast('Failed to add to Timeline', 'error');
        }
    } catch (err) {
        showToast('Import failed', 'error');
    }
}

function showAddToPlaylist(videoId) {
    const track = findTrack(videoId);
    if (track) {
        openPlaylistModal(track);
    }
}
