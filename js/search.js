// Search module
let searchResults = [];
let currentSort = 'relevance';
let isSearchActive = false;

document.getElementById('search-btn').addEventListener('click', performSearch);
document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
});

// Clear search / back to home
document.getElementById('search-clear-btn').addEventListener('click', clearSearch);

// Sort select
document.getElementById('search-sort').addEventListener('change', (e) => {
    currentSort = e.target.value;
    if (searchResults.length > 0) {
        renderSearchResults(sortResults(searchResults));
    }
});

function showSearchView() {
    isSearchActive = true;
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('playlist-detail').classList.add('hidden');
    document.getElementById('search-results').classList.remove('hidden');
    document.getElementById('search-filters').classList.remove('hidden');
    document.getElementById('search-clear-btn').classList.remove('hidden');
    document.querySelector('.search-bar').classList.remove('hidden');
}

function showHomeView() {
    isSearchActive = false;
    document.getElementById('home-view').classList.remove('hidden');
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('search-filters').classList.add('hidden');
    document.getElementById('search-clear-btn').classList.add('hidden');
    document.getElementById('playlist-detail').classList.add('hidden');
    document.querySelector('.search-bar').classList.remove('hidden');
    document.getElementById('search-input').value = '';
    searchResults = [];
}

function showPlaylistDetailView(item) {
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('search-filters').classList.add('hidden');
    document.querySelector('.search-bar').classList.add('hidden');
    document.getElementById('search-clear-btn').classList.add('hidden');

    const detail = document.getElementById('playlist-detail');
    detail.classList.remove('hidden');

    document.getElementById('playlist-detail-thumb').src = item.thumbnail || item.thumbnailSmall || '';
    document.getElementById('playlist-detail-title').textContent = item.name;
    document.getElementById('playlist-detail-artist').textContent = item.artist || '';
    document.getElementById('playlist-detail-count').textContent = '\u00A0';

    document.getElementById('playlist-detail-tracks').innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <span>Loading tracks...</span>
        </div>
    `;
}

function renderPlaylistDetailTracks(tracks) {
    const container = document.getElementById('playlist-detail-tracks');
    const countEl = document.getElementById('playlist-detail-count');
    countEl.textContent = tracks.length + ' track' + (tracks.length !== 1 ? 's' : '');

    if (!tracks || tracks.length === 0) {
        container.innerHTML = '<div class="empty-state">No tracks found</div>';
        return;
    }

    container.innerHTML = '';
    tracks.forEach(track => {
        container.appendChild(createResultElement(track));
    });
}

function clearSearch() {
    showHomeView();
}

// Back button from playlist detail
document.getElementById('playlist-detail-back').addEventListener('click', showHomeView);

function sortResults(results) {
    const sorted = [...results];
    switch (currentSort) {
        case 'duration-asc':
            sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
            break;
        case 'duration-desc':
            sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
            break;
        // 'relevance' — keep original API order
    }
    return sorted;
}

async function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    showSearchView();
    addRecentSearch(query);

    const container = document.getElementById('search-results');
    container.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <span>Searching YouTube Music...</span>
        </div>
    `;

    try {
        searchResults = await window.musicAPI.search(query);
        renderSearchResults(sortResults(searchResults));
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

    container.innerHTML = '';
    results.forEach(track => {
        container.appendChild(createResultElement(track));
    });
}

function createResultElement(track) {
    const isPlaying = AppState.currentTrack?.videoId === track.videoId;
    const isLoading = isPlaying && isLoadingPreview;
    const isDownloaded = !!AppState.downloadedPaths[track.videoId];
    const isDownloading = AppState.downloading.has(track.videoId);
    const progress = AppState.downloadProgress[track.videoId] || 0;

    const el = document.createElement('div');
    el.className = `result-item ${isPlaying ? 'playing' : ''}`;
    el.dataset.videoId = track.videoId;

    let playBtnContent;
    if (isLoading) {
        playBtnContent = loadingSmallIcon();
    } else if (isPlaying) {
        playBtnContent = pauseSmallIcon();
    } else {
        playBtnContent = playSmallIcon();
    }

    el.innerHTML = `
        <img class="result-thumb" src="${track.thumbnail}" alt="" loading="lazy"
             onerror="this.style.background='var(--bg-tertiary)'">
        <div class="result-info">
            <div class="result-title">${escapeHtml(track.title)}</div>
            <div class="result-meta">${escapeHtml(track.artist)}${track.album ? ' \u00b7 ' + escapeHtml(track.album) : ''}</div>
        </div>
        <span class="result-duration">${formatDuration(track.duration)}</span>
        <div class="result-actions">
            <button class="action-btn play-btn ${isLoading ? 'loading' : ''}" title="Preview">
                ${playBtnContent}
            </button>
            <button class="action-btn download-btn ${isDownloaded ? 'done' : ''} ${isDownloading ? 'active' : ''}"
                    title="${isDownloaded ? 'Downloaded' : isDownloading ? 'Downloading...' : 'Download'}"
                    data-video-id="${track.videoId}">
                ${isDownloaded ? checkIcon() : isDownloading ? spinnerIcon(progress) : downloadIcon()}
            </button>
            <button class="action-btn playlist-btn" title="Add to playlist">
                ${plusIcon()}
            </button>
            ${AppState.resolveAvailable ? `
                <button class="action-btn import-btn" title="Import to Resolve Media Pool">
                    ${importIcon()}
                </button>
            ` : ''}
        </div>
    `;

    // Download progress bar overlay
    if (isDownloading) {
        const progressBar = document.createElement('div');
        progressBar.className = 'result-progress';
        progressBar.style.width = `${progress}%`;
        el.appendChild(progressBar);
        el.classList.add('downloading');
    }

    // Event listeners
    el.querySelector('.result-info').addEventListener('click', () => playTrack(track.videoId));
    el.querySelector('.result-thumb').addEventListener('click', () => playTrack(track.videoId));
    el.querySelector('.play-btn').addEventListener('click', (e) => { e.stopPropagation(); playTrack(track.videoId); });
    el.querySelector('.download-btn').addEventListener('click', (e) => { e.stopPropagation(); downloadTrack(track.videoId); });
    el.querySelector('.playlist-btn').addEventListener('click', (e) => { e.stopPropagation(); showAddToPlaylist(track.videoId); });

    const importBtn = el.querySelector('.import-btn');
    if (importBtn) importBtn.addEventListener('click', (e) => { e.stopPropagation(); importTrack(track.videoId); });

    return el;
}

function playTrack(videoId) {
    const track = findTrack(videoId);
    if (track) startPreview(track);
}

async function downloadTrack(videoId, { silent = false } = {}) {
    if (AppState.downloading.has(videoId) || AppState.downloadedPaths[videoId]) return;

    const track = findTrack(videoId);
    if (!track) return;

    const format = await window.settingsAPI.get('defaultFormat') || 'mp3';

    AppState.downloading.add(videoId);
    AppState.downloadProgress[videoId] = 0;
    updateDownloadButton(videoId, 0);
    if (!silent) showToast(`Downloading: ${track.title}`);

    try {
        const filePath = await window.downloadAPI.start(videoId, track.title, format);
        AppState.downloadedPaths[videoId] = filePath;
        AppState.downloading.delete(videoId);

        // Save to download history
        await window.downloadAPI.saveToHistory({
            videoId: track.videoId,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnail: track.thumbnail,
            localPath: filePath
        });
        AppState.downloadHistory = await window.downloadAPI.getHistory();
        loadDownloads();

        if (!silent) showToast(`Downloaded: ${track.title}`, 'success');

        // Auto-import if setting enabled
        if (!silent && AppState.resolveAvailable) {
            const autoImport = await window.settingsAPI.get('autoImport');
            if (autoImport) {
                await window.resolveAPI.addToTimeline(filePath);
                showToast('Added to Timeline', 'success');
            }
        }

        refreshResultItem(videoId);
    } catch (err) {
        AppState.downloading.delete(videoId);
        delete AppState.downloadProgress[videoId];
        showToast(`Download failed: ${err.message}`, 'error');
        refreshResultItem(videoId);
    }
}

function updateDownloadButton(videoId, progress) {
    const el = document.querySelector(`.result-item[data-video-id="${videoId}"]`);
    if (!el) return;

    // Update progress bar — show immediately (thin bar at ~5% during fetch phase)
    let progressBar = el.querySelector('.result-progress');
    if (!progressBar && progress < 100) {
        progressBar = document.createElement('div');
        progressBar.className = 'result-progress';
        el.appendChild(progressBar);
        el.classList.add('downloading');
    }
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }

    // Update button — use same spinner as play button loading
    const btn = el.querySelector('.download-btn');
    if (btn) {
        if (progress >= 100) {
            btn.innerHTML = checkIcon();
            btn.classList.add('done');
            btn.classList.remove('active');
            btn.title = 'Downloaded';
            if (progressBar) progressBar.remove();
            el.classList.remove('downloading');
        } else {
            btn.innerHTML = spinnerIcon();
            btn.classList.add('active');
            btn.title = progress > 0 ? `Downloading ${Math.round(progress)}%` : 'Fetching...';
        }
    }
}

function refreshResultItem(videoId) {
    const oldEl = document.querySelector(`.result-item[data-video-id="${videoId}"]`);
    if (!oldEl) return;
    const track = findTrack(videoId);
    if (!track) return;
    const newEl = createResultElement(track);
    oldEl.replaceWith(newEl);
}

async function importTrack(videoId) {
    let filePath = AppState.downloadedPaths[videoId];

    // Auto-download if not yet downloaded
    if (!filePath) {
        try {
            await downloadTrack(videoId, { silent: true });
            filePath = AppState.downloadedPaths[videoId];
        } catch (err) {
            showToast('Download failed', 'error');
            return;
        }
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

function findTrack(videoId) {
    return searchResults.find(t => t.videoId === videoId)
        || AppState.downloadHistory.find(t => t.videoId === videoId)
        || (AppState.currentTrack?.videoId === videoId ? AppState.currentTrack : null);
}

function showAddToPlaylist(videoId) {
    const track = findTrack(videoId);
    if (!track) return;
    openPlaylistModal(track);
}

// SVG Icons
function playSmallIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>';
}
function pauseSmallIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
}
function downloadIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
}
function checkIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
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
function loadingSmallIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" class="spin-anim"><circle cx="12" cy="12" r="9" stroke="var(--bg-elevated)" stroke-width="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/></svg>';
}
function spinnerIcon() {
    return loadingSmallIcon();
}
