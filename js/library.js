// Library module — flat list of playlists (Downloads + user playlists)
let playlists = [];
let libraryDetailOpen = null; // 'downloads' or playlist id

// Accent colors for playlist letter icons
const PLAYLIST_COLORS = [
    '#4a9eff', '#ff6b6b', '#51cf66', '#fcc419', '#cc5de8',
    '#ff922b', '#20c997', '#e64980', '#845ef7', '#f06595',
    '#339af0', '#e03131', '#2f9e44', '#f08c00', '#9c36b5'
];

function getPlaylistColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return PLAYLIST_COLORS[Math.abs(hash) % PLAYLIST_COLORS.length];
}

function getPlaylistInitials(name) {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

// --- Render library list ---
function renderLibraryList() {
    const container = document.getElementById('library-list');
    container.innerHTML = '';

    // Downloads row (always first)
    const dlCount = AppState.downloadHistory.length;
    const dlRow = document.createElement('div');
    dlRow.className = 'library-row';
    dlRow.innerHTML = `
        <div class="library-row-icon library-row-icon-downloads">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
        </div>
        <div class="library-row-info">
            <div class="library-row-name">Downloads</div>
            <div class="library-row-count">${dlCount} track${dlCount !== 1 ? 's' : ''}</div>
        </div>
    `;
    dlRow.addEventListener('click', () => openLibraryDetail('downloads'));
    container.appendChild(dlRow);

    // User playlists
    playlists.forEach(pl => {
        const row = document.createElement('div');
        row.className = 'library-row';

        const color = getPlaylistColor(pl.name);
        const initials = getPlaylistInitials(pl.name);
        const trackCount = pl.tracks.length;

        row.innerHTML = `
            <div class="library-row-icon" style="background:${color}">
                <span class="library-row-initials">${escapeHtml(initials)}</span>
            </div>
            <div class="library-row-info">
                <div class="library-row-name">${escapeHtml(pl.name)}</div>
                <div class="library-row-count">${trackCount} track${trackCount !== 1 ? 's' : ''}</div>
            </div>
            <div class="library-row-actions">
                <button class="action-btn rename-btn" title="Rename">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="action-btn delete-btn" title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `;

        row.addEventListener('click', (e) => {
            if (e.target.closest('.library-row-actions')) return;
            openLibraryDetail(pl.id);
        });

        row.querySelector('.rename-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            renamePlaylist(pl.id);
        });

        row.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deletePlaylist(pl.id);
        });

        container.appendChild(row);
    });

    // Empty state if no playlists
    if (playlists.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'library-empty-hint';
        empty.textContent = 'Create a playlist to get started';
        container.appendChild(empty);
    }
}

// --- Open detail view ---
function openLibraryDetail(id) {
    libraryDetailOpen = id;

    document.getElementById('library-list-view').classList.add('hidden');
    const detail = document.getElementById('library-detail');
    detail.classList.remove('hidden');

    const iconEl = document.getElementById('library-detail-icon');
    const titleEl = document.getElementById('library-detail-title');
    const countEl = document.getElementById('library-detail-count');
    const actionsEl = document.getElementById('library-detail-actions');
    const tracksEl = document.getElementById('library-detail-tracks');

    actionsEl.innerHTML = '';

    if (id === 'downloads') {
        iconEl.className = 'library-detail-icon library-row-icon-downloads';
        iconEl.style.background = '';
        iconEl.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>`;
        titleEl.textContent = 'Downloads';
        const tracks = AppState.downloadHistory;
        countEl.textContent = `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;
        renderLibraryDetailTracks(tracks, 'downloads');
    } else {
        const pl = playlists.find(p => p.id === id);
        if (!pl) return;

        const color = getPlaylistColor(pl.name);
        const initials = getPlaylistInitials(pl.name);
        iconEl.className = 'library-detail-icon';
        iconEl.style.background = color;
        iconEl.innerHTML = `<span class="library-row-initials">${escapeHtml(initials)}</span>`;
        titleEl.textContent = pl.name;
        countEl.textContent = `${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}`;

        if (AppState.resolveAvailable) {
            const impBtn = document.createElement('button');
            impBtn.className = 'btn-small';
            impBtn.textContent = 'Import All';
            impBtn.addEventListener('click', () => batchImport(pl.id));
            actionsEl.appendChild(impBtn);
        }

        renderLibraryDetailTracks(pl.tracks, pl.id);
    }
}

function renderLibraryDetailTracks(tracks, parentId) {
    const container = document.getElementById('library-detail-tracks');

    if (!tracks || tracks.length === 0) {
        container.innerHTML = '<div class="empty-state">No tracks yet</div>';
        return;
    }

    container.innerHTML = '';
    tracks.forEach(track => {
        const el = createLibraryTrackItem(track, parentId);
        container.appendChild(el);
    });
}

function createLibraryTrackItem(track, parentId) {
    const isCurrentTrack = AppState.currentTrack?.videoId === track.videoId;
    const isActivelyPlaying = isCurrentTrack && typeof isPlaying !== 'undefined' && isPlaying;
    const isLoading = isCurrentTrack && typeof isLoadingPreview !== 'undefined' && isLoadingPreview;
    const isDownloaded = hasLocalDownload(track.videoId);

    const el = document.createElement('div');
    el.className = `result-item ${isActivelyPlaying ? 'playing' : ''}`;
    el.dataset.videoId = track.videoId;

    let playBtnContent;
    if (isLoading) playBtnContent = loadingSmallIcon();
    else if (isActivelyPlaying) playBtnContent = pauseSmallIcon();
    else playBtnContent = playSmallIcon();

    const isPlaylist = parentId !== 'downloads';

    el.innerHTML = `
        <img class="result-thumb" src="${track.thumbnail}" alt="" loading="lazy"
             onerror="this.style.background='var(--bg-tertiary)'">
        <div class="result-info">
            <div class="result-title">${escapeHtml(track.title)}</div>
            <div class="result-meta">${escapeHtml(track.artist)}</div>
        </div>
        <span class="result-duration">${formatDuration(track.duration)}</span>
        <div class="result-actions">
            <button class="action-btn play-btn ${isLoading ? 'loading' : ''} ${isActivelyPlaying ? 'active' : ''}" title="Play">
                ${playBtnContent}
            </button>
            <button class="action-btn download-btn ${isDownloaded ? 'done' : ''}" title="${isDownloaded ? 'Show in Finder' : 'Download'}">
                ${isDownloaded ? folderIcon() : downloadIcon()}
            </button>
            ${isPlaylist ? `<button class="action-btn remove-btn" title="Remove">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>` : ''}
        </div>
    `;

    el.querySelector('.play-btn').addEventListener('click', (e) => { e.stopPropagation(); startPreview(track); });
    el.querySelector('.result-info').addEventListener('click', () => startPreview(track));

    el.querySelector('.download-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (hasLocalDownload(track.videoId)) {
            await revealTrackInFinder(track);
        } else {
            await downloadTrack(track.videoId);
        }
    });

    const removeBtn = el.querySelector('.remove-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await removeFromPlaylist(parentId, track.videoId);
        });
    }

    return el;
}

function closeLibraryDetail() {
    libraryDetailOpen = null;
    document.getElementById('library-detail').classList.add('hidden');
    document.getElementById('library-list-view').classList.remove('hidden');
}

document.getElementById('library-detail-back').addEventListener('click', closeLibraryDetail);

// --- Load functions (called from initApp) ---
function loadDownloads() {
    // Re-render list if visible, and refresh detail if downloads detail is open
    renderLibraryList();
    if (libraryDetailOpen === 'downloads') {
        openLibraryDetail('downloads');
    }
}

async function loadPlaylists() {
    playlists = await window.playlistAPI.getAll();
    renderLibraryList();
    // Refresh detail view if a playlist detail is open
    if (libraryDetailOpen && libraryDetailOpen !== 'downloads') {
        const pl = playlists.find(p => p.id === libraryDetailOpen);
        if (pl) openLibraryDetail(pl.id);
        else closeLibraryDetail();
    }
}

function renderPlaylists() {
    renderLibraryList();
    if (libraryDetailOpen && libraryDetailOpen !== 'downloads') {
        const pl = playlists.find(p => p.id === libraryDetailOpen);
        if (pl) openLibraryDetail(pl.id);
    }
}

// --- Create playlist ---
document.getElementById('create-playlist-btn').addEventListener('click', async () => {
    const name = await showInputModal('Playlist name');
    if (!name) return;
    await window.playlistAPI.create(name);
    await loadPlaylists();
    showToast('Playlist created', 'success');
});

async function renamePlaylist(id) {
    const pl = playlists.find(p => p.id === id);
    if (!pl) return;
    const name = await showInputModal('Rename playlist', pl.name);
    if (!name || name === pl.name) return;
    await window.playlistAPI.rename(id, name);
    await loadPlaylists();
}

async function deletePlaylist(id) {
    const confirmed = await showConfirmModal('Delete Playlist', 'Are you sure you want to delete this playlist?');
    if (!confirmed) return;
    await window.playlistAPI.remove(id);
    if (libraryDetailOpen === id) closeLibraryDetail();
    await loadPlaylists();
    showToast('Playlist deleted');
}

async function removeFromPlaylist(playlistId, videoId) {
    await window.playlistAPI.removeTrack(playlistId, videoId);
    await loadPlaylists();
}

// --- Playlist modal (add track to playlist) ---
function openPlaylistModal(track) {
    const modal = document.getElementById('playlist-modal');
    const list = document.getElementById('playlist-modal-list');

    if (playlists.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:10px">Create a playlist first</div>';
    } else {
        list.innerHTML = '';
        playlists.forEach(pl => {
            const item = document.createElement('div');
            item.className = 'modal-playlist-item';
            item.textContent = `${pl.name} (${pl.tracks.length})`;
            item.addEventListener('click', () => addToPlaylist(pl.id, track));
            list.appendChild(item);
        });
    }

    modal.classList.remove('hidden');
    modal._track = track;
}

document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('playlist-modal').classList.add('hidden');
});

async function addToPlaylist(playlistId, track) {
    const modal = document.getElementById('playlist-modal');
    if (!track) return;

    await window.playlistAPI.addTrack(playlistId, {
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        thumbnail: track.thumbnail,
        localPath: getLocalTrackPath(track)
    });

    modal.classList.add('hidden');
    await loadPlaylists();
    showToast('Added to playlist', 'success');
}

async function batchDownload(playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;

    const format = await window.settingsAPI.get('defaultFormat') || 'mp3';
    showToast(`Downloading ${pl.tracks.length} tracks...`);

    for (const track of pl.tracks) {
        if (hasLocalDownload(track.videoId)) continue;
        try {
            const filePath = await window.downloadAPI.start(track.videoId, track.title, format);
            await syncDownloadedTrack(track, filePath);
        } catch (err) {
            showToast(`Failed: ${track.title}`, 'error');
        }
    }

    renderPlaylists();
    showToast('Batch download complete', 'success');
}

async function batchImport(playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;

    let imported = 0;
    for (const track of pl.tracks) {
        const filePath = await verifyLocalTrackPath(track);
        if (!filePath) continue;
        try {
            await window.resolveAPI.addToTimeline(filePath);
            imported++;
        } catch (e) { /* skip */ }
    }

    showToast(`Added ${imported} track${imported !== 1 ? 's' : ''} to Timeline`, 'success');
}
