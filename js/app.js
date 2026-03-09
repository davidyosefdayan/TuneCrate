// Global state
const AppState = {
    resolveAvailable: false,
    previewPort: 0,
    currentTrack: null,
    downloadProgress: {},   // videoId -> percent
    downloadedPaths: {},    // videoId -> filePath
    downloading: new Set()  // videoIds currently downloading
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

// Initialize
async function initApp() {
    AppState.resolveAvailable = await window.appAPI.isResolveAvailable();
    AppState.previewPort = await window.appAPI.getPreviewPort();

    // Show/hide Resolve-only elements
    if (AppState.resolveAvailable) {
        document.querySelectorAll('.resolve-only').forEach(el => el.style.display = '');
        document.getElementById('resolve-status').textContent = 'Connected to Resolve';
        document.getElementById('resolve-status').className = 'status-badge connected';
    }

    // Listen for download progress
    window.downloadAPI.onProgress(({ videoId, progress }) => {
        AppState.downloadProgress[videoId] = progress;
        updateDownloadButton(videoId, progress);
        if (progress >= 100) {
            AppState.downloading.delete(videoId);
        }
    });

    // Init sub-modules
    initSettings();
    loadPlaylists();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement.id === 'search-input') {
            performSearch();
        }
        if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            togglePlayPause();
        }
    });
}

initApp();
