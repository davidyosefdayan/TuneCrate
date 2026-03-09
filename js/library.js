// Library/Playlist module
let playlists = [];

async function loadPlaylists() {
    playlists = await window.playlistAPI.getAll();
    renderPlaylists();
}

function renderPlaylists() {
    const container = document.getElementById('playlists-container');
    if (!playlists || playlists.length === 0) {
        container.innerHTML = '<div class="empty-state">No playlists yet</div>';
        return;
    }

    container.innerHTML = playlists.map(pl => `
        <div class="playlist-card" data-playlist-id="${pl.id}">
            <div class="playlist-header" onclick="togglePlaylist('${pl.id}')">
                <div>
                    <span class="playlist-name">${escapeHtml(pl.name)}</span>
                    <span class="playlist-count">${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="playlist-actions">
                    <button class="action-btn" onclick="event.stopPropagation(); renamePlaylist('${pl.id}')" title="Rename">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="action-btn" onclick="event.stopPropagation(); deletePlaylist('${pl.id}')" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
            <div class="playlist-tracks" id="tracks-${pl.id}">
                ${pl.tracks.map(t => `
                    <div class="playlist-track">
                        <img class="result-thumb" src="${t.thumbnail}" alt="" style="width:32px;height:32px" loading="lazy">
                        <div class="result-info" style="flex:1;min-width:0" onclick="playTrackFromLibrary(${JSON.stringify(t).replace(/"/g, '&quot;')})">
                            <div class="result-title" style="font-size:12px">${escapeHtml(t.title)}</div>
                            <div class="result-meta">${escapeHtml(t.artist)}</div>
                        </div>
                        <span class="result-duration">${formatDuration(t.duration)}</span>
                        <div class="result-actions">
                            ${t.localPath ? `
                                <button class="action-btn" onclick="window.appAPI.showInFinder('${t.localPath.replace(/'/g, "\\'")}')" title="Show in Finder">
                                    ${folderIcon()}
                                </button>
                            ` : ''}
                            <button class="action-btn" onclick="removeFromPlaylist('${pl.id}', '${t.videoId}')" title="Remove">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>
                    </div>
                `).join('')}
                ${pl.tracks.length > 0 ? `
                    <div class="playlist-batch-actions">
                        <button class="btn-small" onclick="batchDownload('${pl.id}')">Download All</button>
                        ${AppState.resolveAvailable ? `<button class="btn-small" onclick="batchImport('${pl.id}')">Import All to Resolve</button>` : ''}
                    </div>
                ` : '<div class="empty-state" style="padding:20px">No tracks in this playlist</div>'}
            </div>
        </div>
    `).join('');
}

function togglePlaylist(id) {
    const tracks = document.getElementById('tracks-' + id);
    if (tracks) tracks.classList.toggle('expanded');
}

document.getElementById('create-playlist-btn').addEventListener('click', async () => {
    const name = prompt('Playlist name:');
    if (!name) return;
    await window.playlistAPI.create(name);
    await loadPlaylists();
    showToast('Playlist created', 'success');
});

async function renamePlaylist(id) {
    const pl = playlists.find(p => p.id === id);
    if (!pl) return;
    const name = prompt('Rename playlist:', pl.name);
    if (!name || name === pl.name) return;
    await window.playlistAPI.rename(id, name);
    await loadPlaylists();
}

async function deletePlaylist(id) {
    if (!confirm('Delete this playlist?')) return;
    await window.playlistAPI.remove(id);
    await loadPlaylists();
    showToast('Playlist deleted');
}

async function removeFromPlaylist(playlistId, videoId) {
    await window.playlistAPI.removeTrack(playlistId, videoId);
    await loadPlaylists();
}

function playTrackFromLibrary(track) {
    startPreview(track);
}

// Playlist modal
function openPlaylistModal(track) {
    const modal = document.getElementById('playlist-modal');
    const list = document.getElementById('playlist-modal-list');

    if (playlists.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:10px">Create a playlist first</div>';
    } else {
        list.innerHTML = playlists.map(pl => `
            <div class="modal-playlist-item" onclick="addToPlaylist('${pl.id}', '${track.videoId}')">
                ${escapeHtml(pl.name)} (${pl.tracks.length})
            </div>
        `).join('');
    }

    modal.classList.remove('hidden');
    modal._track = track;
}

document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('playlist-modal').classList.add('hidden');
});

async function addToPlaylist(playlistId, videoId) {
    const modal = document.getElementById('playlist-modal');
    const track = modal._track || findTrack(videoId);
    if (!track) return;

    await window.playlistAPI.addTrack(playlistId, {
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        thumbnail: track.thumbnail,
        localPath: AppState.downloadedPaths[track.videoId] || null
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
        } catch (err) {
            showToast(`Failed: ${track.title}`, 'error');
        }
    }

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
            await window.resolveAPI.importToMediaPool(filePath);
            imported++;
        } catch (e) { /* skip */ }
    }

    showToast(`Imported ${imported} track${imported !== 1 ? 's' : ''} to Resolve`, 'success');
}
