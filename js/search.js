// Search module
let searchResults = [];

document.getElementById('search-btn').addEventListener('click', performSearch);

async function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    const container = document.getElementById('search-results');
    container.innerHTML = '<div class="spinner"></div>';

    try {
        searchResults = await window.musicAPI.search(query);
        renderSearchResults(searchResults);
    } catch (err) {
        container.innerHTML = `<div class="empty-state">Search failed: ${err.message}</div>`;
        showToast('Search failed', 'error');
    }
}

function renderSearchResults(results) {
    const container = document.getElementById('search-results');
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="empty-state">No results found</div>';
        return;
    }

    container.innerHTML = results.map(track => createResultItem(track)).join('');
}

function createResultItem(track) {
    const isPlaying = AppState.currentTrack?.videoId === track.videoId;
    const isDownloaded = AppState.downloadedPaths[track.videoId];
    const progress = AppState.downloadProgress[track.videoId];
    const isDownloading = progress !== undefined && progress < 100;

    return `
        <div class="result-item ${isPlaying ? 'playing' : ''}" data-video-id="${track.videoId}">
            <img class="result-thumb" src="${track.thumbnail}" alt="" loading="lazy"
                 onerror="this.style.background='var(--bg-tertiary)'">
            <div class="result-info" onclick="playTrack('${track.videoId}')">
                <div class="result-title">${escapeHtml(track.title)}</div>
                <div class="result-meta">${escapeHtml(track.artist)}${track.album ? ' \u2022 ' + escapeHtml(track.album) : ''}</div>
            </div>
            <span class="result-duration">${formatDuration(track.duration)}</span>
            <div class="result-actions">
                <select class="format-select" data-video-id="${track.videoId}" title="Format">
                    <option value="mp3">MP3</option>
                    <option value="wav">WAV</option>
                </select>
                ${isDownloading ? createProgressRing(progress) : `
                    <button class="action-btn ${isDownloaded ? 'downloaded' : ''}"
                            onclick="downloadTrack('${track.videoId}')"
                            title="${isDownloaded ? 'Downloaded' : 'Download'}">
                        ${isDownloaded ? checkIcon() : downloadIcon()}
                    </button>
                `}
                <button class="action-btn" onclick="showAddToPlaylist('${track.videoId}')" title="Add to playlist">
                    ${plusIcon()}
                </button>
                ${AppState.resolveAvailable ? `
                    <button class="action-btn" onclick="importTrack('${track.videoId}')" title="Import to Resolve">
                        ${importIcon()}
                    </button>
                ` : ''}
                ${isDownloaded ? `
                    <button class="action-btn" onclick="showInFinder('${track.videoId}')" title="Show in Finder">
                        ${folderIcon()}
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

function playTrack(videoId) {
    const track = findTrack(videoId);
    if (track) startPreview(track);
}

async function downloadTrack(videoId) {
    const track = findTrack(videoId);
    if (!track) return;

    const formatEl = document.querySelector(`.format-select[data-video-id="${videoId}"]`);
    const format = formatEl ? formatEl.value : 'mp3';

    AppState.downloadProgress[videoId] = 0;
    updateDownloadUI(videoId, 0);

    try {
        const filePath = await window.downloadAPI.start(videoId, track.title, format);
        AppState.downloadedPaths[videoId] = filePath;
        showToast(`Downloaded: ${track.title}`, 'success');

        // Auto-import if setting enabled and Resolve available
        if (AppState.resolveAvailable) {
            const autoImport = await window.settingsAPI.get('autoImport');
            if (autoImport) {
                await window.resolveAPI.importToMediaPool(filePath);
                showToast('Imported to Media Pool', 'success');
            }
        }

        renderSearchResults(searchResults);
    } catch (err) {
        delete AppState.downloadProgress[videoId];
        showToast(`Download failed: ${err.message}`, 'error');
        renderSearchResults(searchResults);
    }
}

async function importTrack(videoId) {
    const filePath = AppState.downloadedPaths[videoId];
    if (!filePath) {
        showToast('Download the track first', 'error');
        return;
    }
    try {
        await window.resolveAPI.importToMediaPool(filePath);
        showToast('Imported to Media Pool', 'success');
    } catch (err) {
        showToast('Import failed', 'error');
    }
}

function showInFinder(videoId) {
    const filePath = AppState.downloadedPaths[videoId];
    if (filePath) window.appAPI.showInFinder(filePath);
}

function updateDownloadUI(videoId, progress) {
    const item = document.querySelector(`.result-item[data-video-id="${videoId}"]`);
    if (!item) return;
    // Re-render on completion
    if (progress >= 100) {
        renderSearchResults(searchResults);
    }
}

function findTrack(videoId) {
    return searchResults.find(t => t.videoId === videoId);
}

function showAddToPlaylist(videoId) {
    const track = findTrack(videoId);
    if (!track) return;
    openPlaylistModal(track);
}

// HTML helpers
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function downloadIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
}

function checkIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
}

function plusIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
}

function importIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>';
}

function folderIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
}

function createProgressRing(progress) {
    const r = 10;
    const c = 2 * Math.PI * r;
    const offset = c - (progress / 100) * c;
    return `
        <div class="download-progress">
            <svg width="28" height="28" viewBox="0 0 28 28" class="progress-ring">
                <circle cx="14" cy="14" r="${r}" fill="none" stroke-width="2" class="progress-ring-bg"/>
                <circle cx="14" cy="14" r="${r}" fill="none" stroke-width="2" class="progress-ring-fill"
                        stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
            </svg>
        </div>
    `;
}
