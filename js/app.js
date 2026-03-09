// Global state
const AppState = {
    resolveAvailable: false,
    currentTrack: null,
    downloadProgress: {},   // videoId -> percent
    downloadedPaths: {},    // videoId -> filePath
    downloading: new Set(), // videoIds currently downloading
    downloadHistory: [],    // loaded from main process
    homeSections: []        // loaded from YouTube Music API
};

// Tab navigation
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// Toast notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Format duration from seconds
function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// HTML escape
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// Custom modal helpers (replace prompt/confirm)
function showInputModal(title, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('input-modal');
        const input = document.getElementById('input-modal-input');
        const okBtn = document.getElementById('input-modal-ok');
        const cancelBtn = document.getElementById('input-modal-cancel');

        document.getElementById('input-modal-title').textContent = title;
        input.value = defaultValue;
        modal.classList.remove('hidden');
        input.focus();
        input.select();

        function cleanup() {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKey);
        }
        function onOk() { cleanup(); resolve(input.value); }
        function onCancel() { cleanup(); resolve(null); }
        function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
    });
}

function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');

        document.getElementById('confirm-modal-title').textContent = title;
        document.getElementById('confirm-modal-message').textContent = message;
        modal.classList.remove('hidden');

        function cleanup() {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        }
        function onOk() { cleanup(); resolve(true); }
        function onCancel() { cleanup(); resolve(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// ============================================
// Home sections
// ============================================
async function loadHomeSections() {
    const loading = document.getElementById('home-loading');
    const container = document.getElementById('home-sections');

    try {
        AppState.homeSections = await window.musicAPI.getHomeSections();
        loading.style.display = 'none';
        renderHomeSections();
    } catch (err) {
        loading.innerHTML = '<div class="empty-state">Could not load home content</div>';
    }
}

function renderHomeSections() {
    const container = document.getElementById('home-sections');
    container.innerHTML = '';

    AppState.homeSections.forEach(section => {
        if (!section.items || section.items.length === 0) return;
        if (/live\s+performance/i.test(section.title)) return;

        const sectionEl = document.createElement('div');
        sectionEl.className = 'home-section';

        const header = document.createElement('h4');
        header.textContent = section.title;
        sectionEl.appendChild(header);

        const row = document.createElement('div');
        row.className = 'home-row';

        section.items.forEach(item => {
            const isSong = item.type === 'SONG';
            const card = document.createElement('div');
            card.className = isSong ? 'home-card home-card-song' : 'home-card';

            const thumbWrap = document.createElement('div');
            thumbWrap.className = 'home-card-thumb-wrap';

            const thumb = document.createElement('img');
            thumb.className = 'home-card-thumb';
            thumb.src = item.thumbnailSmall || item.thumbnail;
            thumb.alt = '';
            thumb.loading = 'lazy';
            thumb.onerror = function() { this.style.background = 'var(--bg-tertiary)'; };

            thumbWrap.appendChild(thumb);

            if (isSong) {
                const playOverlay = document.createElement('div');
                playOverlay.className = 'home-card-play';
                playOverlay.innerHTML = '<svg viewBox="0 0 24 24" fill="white"><polygon points="6,3 20,12 6,21"/></svg>';
                thumbWrap.appendChild(playOverlay);
            }

            const info = document.createElement('div');
            info.className = 'home-card-info';

            const name = document.createElement('div');
            name.className = 'home-card-name';
            name.textContent = item.name;

            const artist = document.createElement('div');
            artist.className = 'home-card-artist';
            artist.textContent = item.artist;

            info.appendChild(name);
            info.appendChild(artist);
            card.appendChild(thumbWrap);
            card.appendChild(info);

            card.addEventListener('click', () => onHomeItemClick(item));

            row.appendChild(card);
        });

        sectionEl.appendChild(row);
        container.appendChild(sectionEl);
    });
}

async function onHomeItemClick(item) {
    if (item.type === 'SONG' && item.videoId) {
        startPreview({
            videoId: item.videoId,
            title: item.name,
            artist: item.artist,
            duration: item.duration || 0,
            thumbnail: item.thumbnail
        });
        return;
    }

    // Show playlist detail view
    showPlaylistDetailView(item);

    // PL... playlists can be loaded directly. Others (RDCLAK, OLAK) fall back to search.
    let tracks;
    if (item.playlistId && item.playlistId.startsWith('PL')) {
        try {
            tracks = await window.musicAPI.getPlaylistTracks(item.playlistId);
        } catch (err) {
            // fall through to search
        }
    }

    if (!tracks || tracks.length === 0) {
        try {
            const query = item.name + (item.artist ? ' ' + item.artist : '');
            tracks = await window.musicAPI.search(query);
        } catch (err) {
            document.getElementById('playlist-detail-tracks').innerHTML =
                '<div class="empty-state">Could not load content</div>';
            return;
        }
    }

    searchResults = tracks;
    renderPlaylistDetailTracks(tracks);
}

// ============================================
// Initialize (called from index.html after all scripts loaded)
// ============================================
async function initApp() {
    AppState.resolveAvailable = await window.appAPI.isResolveAvailable();

    // Show/hide Resolve-only elements
    if (AppState.resolveAvailable) {
        document.querySelectorAll('.resolve-only').forEach(el => el.style.display = '');
        document.getElementById('resolve-status').textContent = 'Connected to Resolve';
        document.getElementById('resolve-status').className = 'status-badge connected';
    }

    // Listen for prefetch completions
    window.appAPI.onPrefetchReady((videoId) => {
        const btn = document.querySelector(`.result-item[data-video-id="${videoId}"] .play-btn`);
        if (btn) btn.classList.add('ready');
    });

    // Listen for download progress
    window.downloadAPI.onProgress(({ videoId, progress }) => {
        AppState.downloadProgress[videoId] = progress;
        updateDownloadButton(videoId, progress);
        if (progress >= 100) {
            AppState.downloading.delete(videoId);
        }
        if (typeof updatePlayerActions === 'function') {
            updatePlayerActions();
        }
    });

    // Load download history
    AppState.downloadHistory = await window.downloadAPI.getHistory();
    AppState.downloadHistory.forEach(d => {
        if (d.localPath) AppState.downloadedPaths[d.videoId] = d.localPath;
    });

    // Init sub-modules
    initSettings();
    loadPlaylists();
    loadDownloads();

    // Load home content
    loadHomeSections();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
            e.preventDefault();
            togglePlayPause();
        }
    });
}
