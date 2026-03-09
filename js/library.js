// Library/Playlist module
let playlists = [];

// --- Downloads section ---
function loadDownloads() {
    const container = document.getElementById('downloads-container');
    const countEl = document.getElementById('downloads-count');
    const downloads = AppState.downloadHistory;

    if (!downloads || downloads.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <svg class="empty-state-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Downloaded tracks will appear here
        </div>`;
        countEl.textContent = '';
        return;
    }

    countEl.textContent = `${downloads.length} track${downloads.length !== 1 ? 's' : ''}`;
    container.innerHTML = '';
    downloads.forEach(track => {
        container.appendChild(createDownloadItem(track));
    });
}

function createDownloadItem(track) {
    const isPlaying = AppState.currentTrack?.videoId === track.videoId;

    const el = document.createElement('div');
    el.className = `result-item ${isPlaying ? 'playing' : ''}`;
    el.dataset.videoId = track.videoId;

    el.innerHTML = `
        <img class="result-thumb" src="${track.thumbnail}" alt="" loading="lazy"
             onerror="this.style.background='var(--bg-tertiary)'">
        <div class="result-info">
            <div class="result-title">${escapeHtml(track.title)}</div>
            <div class="result-meta">${escapeHtml(track.artist)}</div>
        </div>
        <span class="result-duration">${formatDuration(track.duration)}</span>
        <div class="result-actions">
            <button class="action-btn play-btn" title="Play">
                ${isPlaying && typeof isLoadingPreview !== 'undefined' && isLoadingPreview ? loadingSmallIcon() : isPlaying && typeof isPlaying !== 'undefined' ? pauseSmallIcon() : playSmallIcon()}
            </button>
            <button class="action-btn" title="Show in Finder">
                ${folderIcon()}
            </button>
            <button class="action-btn playlist-btn" title="Add to playlist">
                ${plusIcon()}
            </button>
            ${AppState.resolveAvailable ? `
                <button class="action-btn import-btn" title="Import to Resolve">
                    ${importIcon()}
                </button>
            ` : ''}
        </div>
    `;

    el.querySelector('.play-btn').addEventListener('click', (e) => { e.stopPropagation(); startPreview(track); });
    el.querySelector('.result-info').addEventListener('click', () => startPreview(track));

    const folderBtn = el.querySelectorAll('.action-btn')[1];
    folderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (track.localPath) window.appAPI.showInFinder(track.localPath);
    });

    const playlistBtn = el.querySelector('.playlist-btn');
    playlistBtn.addEventListener('click', (e) => { e.stopPropagation(); openPlaylistModal(track); });

    const importBtn = el.querySelector('.import-btn');
    if (importBtn) {
        importBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (track.localPath) {
                try {
                    await window.resolveAPI.addToTimeline(track.localPath);
                    showToast('Added to Timeline', 'success');
                } catch (err) {
                    showToast('Import failed', 'error');
                }
            }
        });
    }

    return el;
}

// --- Playlists section ---
async function loadPlaylists() {
    playlists = await window.playlistAPI.getAll();
    renderPlaylists();
}

function renderPlaylists() {
    const container = document.getElementById('playlists-container');
    if (!playlists || playlists.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding:20px">
            <svg class="empty-state-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            No playlists yet
        </div>`;
        return;
    }

    container.innerHTML = '';
    playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.dataset.playlistId = pl.id;

        const header = document.createElement('div');
        header.className = 'playlist-header';
        header.innerHTML = `
            <div>
                <span class="playlist-name">${escapeHtml(pl.name)}</span>
                <span class="playlist-count">${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="playlist-actions">
                <button class="action-btn rename-btn" title="Rename">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="action-btn delete-btn" title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `;

        header.addEventListener('click', (e) => {
            if (e.target.closest('.action-btn')) return;
            const tracks = card.querySelector('.playlist-tracks');
            if (tracks) tracks.classList.toggle('expanded');
        });

        header.querySelector('.rename-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            renamePlaylist(pl.id);
        });

        header.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deletePlaylist(pl.id);
        });

        const tracksDiv = document.createElement('div');
        tracksDiv.className = 'playlist-tracks';
        tracksDiv.id = 'tracks-' + pl.id;

        if (pl.tracks.length > 0) {
            pl.tracks.forEach(t => {
                const trackEl = document.createElement('div');
                trackEl.className = 'playlist-track';
                trackEl.innerHTML = `
                    <img class="result-thumb" src="${t.thumbnail}" alt="" style="width:32px;height:32px" loading="lazy">
                    <div class="result-info" style="flex:1;min-width:0">
                        <div class="result-title" style="font-size:12px">${escapeHtml(t.title)}</div>
                        <div class="result-meta">${escapeHtml(t.artist)}</div>
                    </div>
                    <span class="result-duration">${formatDuration(t.duration)}</span>
                    <div class="result-actions">
                        ${t.localPath ? `<button class="action-btn folder-btn" title="Show in Finder">${folderIcon()}</button>` : ''}
                        <button class="action-btn remove-btn" title="Remove">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                `;

                trackEl.querySelector('.result-info').addEventListener('click', () => startPreview(t));

                const folderBtn = trackEl.querySelector('.folder-btn');
                if (folderBtn) {
                    folderBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.appAPI.showInFinder(t.localPath);
                    });
                }

                trackEl.querySelector('.remove-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeFromPlaylist(pl.id, t.videoId);
                });

                tracksDiv.appendChild(trackEl);
            });

            const batchDiv = document.createElement('div');
            batchDiv.className = 'playlist-batch-actions';
            const dlAllBtn = document.createElement('button');
            dlAllBtn.className = 'btn-small';
            dlAllBtn.textContent = 'Download All';
            dlAllBtn.addEventListener('click', () => batchDownload(pl.id));
            batchDiv.appendChild(dlAllBtn);

            if (AppState.resolveAvailable) {
                const impAllBtn = document.createElement('button');
                impAllBtn.className = 'btn-small';
                impAllBtn.textContent = 'Import All to Resolve';
                impAllBtn.addEventListener('click', () => batchImport(pl.id));
                batchDiv.appendChild(impAllBtn);
            }
            tracksDiv.appendChild(batchDiv);
        } else {
            tracksDiv.innerHTML = '<div class="empty-state" style="padding:20px">No tracks in this playlist</div>';
        }

        card.appendChild(header);
        card.appendChild(tracksDiv);
        container.appendChild(card);
    });
}

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
    await loadPlaylists();
    showToast('Playlist deleted');
}

async function removeFromPlaylist(playlistId, videoId) {
    await window.playlistAPI.removeTrack(playlistId, videoId);
    await loadPlaylists();
}

// Playlist modal
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
        localPath: AppState.downloadedPaths[track.videoId] || track.localPath || null
    });

    modal.classList.add('hidden');
    await loadPlaylists();
    showToast(`Added to playlist`, 'success');
}

async function batchDownload(playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;

    const format = await window.settingsAPI.get('defaultFormat') || 'mp3';
    showToast(`Downloading ${pl.tracks.length} tracks...`);

    for (const track of pl.tracks) {
        if (track.localPath) continue; // Skip already downloaded
        try {
            const filePath = await window.downloadAPI.start(track.videoId, track.title, format);
            await window.playlistAPI.setLocalPath(playlistId, track.videoId, filePath);
            AppState.downloadedPaths[track.videoId] = filePath;

            // Save to download history
            await window.downloadAPI.saveToHistory({
                videoId: track.videoId,
                title: track.title,
                artist: track.artist,
                duration: track.duration,
                thumbnail: track.thumbnail,
                localPath: filePath
            });
        } catch (err) {
            showToast(`Failed: ${track.title}`, 'error');
        }
    }

    AppState.downloadHistory = await window.downloadAPI.getHistory();
    loadDownloads();
    await loadPlaylists();
    showToast('Batch download complete', 'success');
}

async function batchImport(playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;

    let imported = 0;
    for (const track of pl.tracks) {
        const filePath = track.localPath || AppState.downloadedPaths[track.videoId];
        if (!filePath) continue;
        try {
            await window.resolveAPI.addToTimeline(filePath);
            imported++;
        } catch (e) { /* skip */ }
    }

    showToast(`Added ${imported} track${imported !== 1 ? 's' : ''} to Timeline`, 'success');
}
