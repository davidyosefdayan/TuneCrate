// Search module
let searchResults = [];
let currentSort = 'relevance';
let isSearchActive = false;

// Skeleton helpers for detail view headers
function setDetailThumb(imgEl, src) {
    if (src) {
        imgEl.style.display = '';
        imgEl.src = src;
        // Remove skeleton sibling if exists
        const skel = imgEl.parentElement.querySelector('.skeleton-thumb-placeholder');
        if (skel) skel.remove();
    } else {
        imgEl.style.display = 'none';
        // Insert a skeleton div in its place if not already there
        if (!imgEl.parentElement.querySelector('.skeleton-thumb-placeholder')) {
            const ph = document.createElement('div');
            ph.className = 'skeleton skeleton-thumb-placeholder detail-view-thumb';
            if (imgEl.classList.contains('artist-thumb')) ph.classList.add('artist-thumb');
            imgEl.parentElement.insertBefore(ph, imgEl);
        }
    }
}

function setDetailText(el, text, skeletonWidth, skeletonHeight) {
    if (text) {
        el.textContent = text;
    } else if (skeletonWidth) {
        el.innerHTML = `<span class="skeleton" style="display:inline-block;width:${skeletonWidth}px;height:${skeletonHeight}px;border-radius:3px"></span>`;
    } else {
        el.textContent = '';
    }
}

function renderSkeletonTracks(count = 8) {
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `<div class="result-item" style="pointer-events:none">
            <div class="skeleton result-thumb"></div>
            <div class="result-info">
                <div class="skeleton" style="height:11px;width:${55 + Math.random() * 30}%;border-radius:3px"></div>
                <div class="skeleton" style="height:9px;width:${35 + Math.random() * 25}%;border-radius:3px;margin-top:4px"></div>
            </div>
            <div class="skeleton" style="height:9px;width:28px;border-radius:3px"></div>
        </div>`;
    }
    return html;
}

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

// Navigation stack for back button
let viewHistory = [];

function hideAllViews() {
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('search-filters').classList.add('hidden');
    document.getElementById('search-clear-btn').classList.add('hidden');
    document.getElementById('playlist-detail').classList.add('hidden');
    document.getElementById('artist-detail').classList.add('hidden');
    document.getElementById('album-detail').classList.add('hidden');
}

function showSearchView() {
    isSearchActive = true;
    hideAllViews();
    document.getElementById('search-results').classList.remove('hidden');
    document.getElementById('search-filters').classList.remove('hidden');
    document.getElementById('search-clear-btn').classList.remove('hidden');
    document.querySelector('.search-bar').classList.remove('hidden');
}

function showHomeView() {
    isSearchActive = false;
    viewHistory = [];
    hideAllViews();
    document.getElementById('home-view').classList.remove('hidden');
    document.querySelector('.search-bar').classList.remove('hidden');
    document.getElementById('search-input').value = '';
    searchResults = [];
}

function showPlaylistDetailView(item) {
    hideAllViews();
    document.querySelector('.search-bar').classList.add('hidden');

    const detail = document.getElementById('playlist-detail');
    detail.classList.remove('hidden');

    document.getElementById('playlist-detail-thumb').src = item.thumbnail || item.thumbnailSmall || '';
    document.getElementById('playlist-detail-title').textContent = item.name;
    document.getElementById('playlist-detail-artist').textContent = item.artist || '';
    document.getElementById('playlist-detail-count').textContent = '\u00A0';

    document.getElementById('playlist-detail-tracks').innerHTML = renderSkeletonTracks(10);
}

function navigateBack() {
    if (viewHistory.length > 0) {
        const prev = viewHistory.pop();
        prev();
    } else {
        showHomeView();
    }
}

async function showArtistView(artistId, artistName, artistThumb) {
    if (!artistId) return;

    // Push current view to history
    const currentView = captureCurrentView();
    if (currentView) viewHistory.push(currentView);

    hideAllViews();
    document.querySelector('.search-bar').classList.add('hidden');

    const detail = document.getElementById('artist-detail');
    detail.classList.remove('hidden');

    const artistThumbEl = document.getElementById('artist-detail-thumb');
    const artistNameEl = document.getElementById('artist-detail-name');

    setDetailThumb(artistThumbEl, artistThumb);
    setDetailText(artistNameEl, artistName, 120, 14);

    document.getElementById('artist-detail-content').innerHTML = renderSkeletonTracks(8);

    try {
        const artist = await window.musicAPI.getArtist(artistId);

        if (artist.name) setDetailText(artistNameEl, artist.name);
        if (artist.thumbnail) setDetailThumb(artistThumbEl, artist.thumbnail);

        lastArtistData = artist;
        renderArtistContent(artist);

    } catch (err) {
        document.getElementById('artist-detail-content').innerHTML =
            '<div class="empty-state">Could not load artist</div>';
    }
}

function renderArtistContent(artist) {
    const content = document.getElementById('artist-detail-content');
    content.innerHTML = '';

    // Top songs
    if (artist.topSongs && artist.topSongs.length > 0) {
        const songsSection = document.createElement('div');
        songsSection.className = 'detail-section';
        songsSection.innerHTML = '<div class="detail-section-title">Top Songs</div>';

        const songsList = document.createElement('div');
        songsList.className = 'detail-songs-list';
        artist.topSongs.forEach(track => {
            songsList.appendChild(createResultElement(track));
        });
        songsSection.appendChild(songsList);
        content.appendChild(songsSection);

        searchResults = artist.topSongs;
    }

    // Albums
    if (artist.topAlbums && artist.topAlbums.length > 0) {
        const albumsSection = document.createElement('div');
        albumsSection.className = 'detail-section';
        albumsSection.innerHTML = '<div class="detail-section-title">Albums</div>';

        const albumsRow = document.createElement('div');
        albumsRow.className = 'detail-albums-row';
        artist.topAlbums.forEach(album => {
            const card = createAlbumCard(album);
            albumsRow.appendChild(card);
        });
        albumsSection.appendChild(albumsRow);
        content.appendChild(albumsSection);
    }

    // Singles
    if (artist.topSingles && artist.topSingles.length > 0) {
        const singlesSection = document.createElement('div');
        singlesSection.className = 'detail-section';
        singlesSection.innerHTML = '<div class="detail-section-title">Singles</div>';

        const singlesRow = document.createElement('div');
        singlesRow.className = 'detail-albums-row';
        artist.topSingles.forEach(single => {
            const card = createAlbumCard(single);
            singlesRow.appendChild(card);
        });
        singlesSection.appendChild(singlesRow);
        content.appendChild(singlesSection);
    }

    // "Show all songs" button
    const allSection = document.createElement('div');
    allSection.className = 'detail-section';
    allSection.style.padding = '4px 12px 16px';
    const allBtn = document.createElement('button');
    allBtn.className = 'btn-small';
    allBtn.textContent = 'Show All Songs';
    allBtn.addEventListener('click', () => loadAllArtistSongs(artist.artistId));
    allSection.appendChild(allBtn);
    content.appendChild(allSection);
}

async function loadAllArtistSongs(artistId) {
    const content = document.getElementById('artist-detail-content');
    // Replace top songs with all songs
    content.innerHTML = renderSkeletonTracks(12);

    try {
        const songs = await window.musicAPI.getArtistSongs(artistId);
        searchResults = songs;

        content.innerHTML = '';
        const section = document.createElement('div');
        section.className = 'detail-section';
        section.innerHTML = `<div class="detail-section-title">All Songs (${songs.length})</div>`;

        const songsList = document.createElement('div');
        songsList.className = 'detail-songs-list';
        songs.forEach(track => {
            songsList.appendChild(createResultElement(track));
        });
        section.appendChild(songsList);
        content.appendChild(section);
    } catch (err) {
        content.innerHTML = '<div class="empty-state">Could not load songs</div>';
    }
}

async function showAlbumView(albumId, albumName, albumThumb, albumArtist, albumYear) {
    if (!albumId) return;

    const currentView = captureCurrentView();
    if (currentView) viewHistory.push(currentView);

    hideAllViews();
    document.querySelector('.search-bar').classList.add('hidden');

    const detail = document.getElementById('album-detail');
    detail.classList.remove('hidden');

    const thumbEl = document.getElementById('album-detail-thumb');
    const nameEl = document.getElementById('album-detail-name');
    const artistEl = document.getElementById('album-detail-artist');
    const yearEl = document.getElementById('album-detail-year');

    setDetailThumb(thumbEl, albumThumb);
    setDetailText(nameEl, albumName, 120, 14);
    setDetailText(artistEl, albumArtist, 80, 11);
    setDetailText(yearEl, albumYear ? String(albumYear) : null, 40, 10);

    document.getElementById('album-detail-tracks').innerHTML = renderSkeletonTracks(10);

    try {
        const album = await window.musicAPI.getAlbum(albumId);

        if (album.name) setDetailText(nameEl, album.name);
        if (album.artist) {
            setDetailText(artistEl, album.artist);
            artistEl.dataset.artistId = album.artistId || '';
        }
        if (album.year) setDetailText(yearEl, String(album.year));
        if (album.thumbnail) setDetailThumb(thumbEl, album.thumbnail);

        searchResults = album.songs;

        const container = document.getElementById('album-detail-tracks');
        container.innerHTML = '';
        if (!album.songs || album.songs.length === 0) {
            container.innerHTML = '<div class="empty-state">No tracks found</div>';
            return;
        }
        album.songs.forEach(track => {
            container.appendChild(createResultElement(track));
        });
    } catch (err) {
        document.getElementById('album-detail-tracks').innerHTML =
            '<div class="empty-state">Could not load album</div>';
    }
}

function createAlbumCard(album) {
    const card = document.createElement('div');
    card.className = 'detail-album-card';

    const img = document.createElement('img');
    img.src = album.thumbnail || '';
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = function() { this.style.background = 'var(--bg-tertiary)'; };

    const info = document.createElement('div');
    info.className = 'detail-album-card-info';

    const name = document.createElement('div');
    name.className = 'detail-album-card-name';
    name.textContent = album.name;

    const year = document.createElement('div');
    year.className = 'detail-album-card-year';
    year.textContent = album.year || '';

    info.appendChild(name);
    info.appendChild(year);
    card.appendChild(img);
    card.appendChild(info);

    card.addEventListener('click', () => showAlbumView(album.albumId, album.name, album.thumbnail, album.artist, album.year));

    return card;
}

// Store the last fetched artist data so we can restore without re-fetching
let lastArtistData = null;

function captureCurrentView() {
    if (!document.getElementById('artist-detail').classList.contains('hidden')) {
        // Save artist data to re-render with live event listeners on restore
        const savedArtist = lastArtistData;
        if (savedArtist) {
            return () => restoreArtistView(savedArtist);
        }
        // Fallback: just re-fetch
        const artistName = document.getElementById('artist-detail-name').textContent;
        const artistId = lastArtistData?.artistId;
        if (artistId) {
            return () => showArtistView(artistId, artistName);
        }
        return () => showHomeView();
    }
    if (!document.getElementById('album-detail').classList.contains('hidden')) {
        const name = document.getElementById('album-detail-name').textContent;
        const thumb = document.getElementById('album-detail-thumb').src;
        const artist = document.getElementById('album-detail-artist').textContent;
        const artistId = document.getElementById('album-detail-artist').dataset.artistId;
        const year = document.getElementById('album-detail-year').textContent;
        const savedTracks = [...searchResults];
        return () => {
            hideAllViews();
            document.querySelector('.search-bar').classList.add('hidden');
            document.getElementById('album-detail').classList.remove('hidden');
            document.getElementById('album-detail-name').textContent = name;
            document.getElementById('album-detail-thumb').src = thumb;
            document.getElementById('album-detail-artist').textContent = artist;
            document.getElementById('album-detail-artist').dataset.artistId = artistId;
            document.getElementById('album-detail-year').textContent = year;
            searchResults = savedTracks;
            const container = document.getElementById('album-detail-tracks');
            container.innerHTML = '';
            savedTracks.forEach(track => container.appendChild(createResultElement(track)));
        };
    }
    if (isSearchActive) {
        return () => showSearchView();
    }
    return () => showHomeView();
}

function restoreArtistView(artist) {
    hideAllViews();
    document.querySelector('.search-bar').classList.add('hidden');

    const detail = document.getElementById('artist-detail');
    detail.classList.remove('hidden');

    document.getElementById('artist-detail-name').textContent = artist.name;
    document.getElementById('artist-detail-thumb').src = artist.thumbnail || '';

    lastArtistData = artist;
    renderArtistContent(artist);
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

// Back buttons
document.getElementById('playlist-detail-back').addEventListener('click', showHomeView);
document.getElementById('artist-detail-back').addEventListener('click', navigateBack);
document.getElementById('album-detail-back').addEventListener('click', navigateBack);

// Album detail — clickable artist name
document.getElementById('album-detail-artist').addEventListener('click', () => {
    const artistId = document.getElementById('album-detail-artist').dataset.artistId;
    const artistName = document.getElementById('album-detail-artist').textContent;
    if (artistId) showArtistView(artistId, artistName);
});

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
    const isCurrentTrack = AppState.currentTrack?.videoId === track.videoId;
    const isActivelyPlaying = isCurrentTrack && typeof isPlaying !== 'undefined' && isPlaying;
    const isLoading = isCurrentTrack && isLoadingPreview;
    const showPause = isActivelyPlaying;
    const isDownloaded = hasLocalDownload(track.videoId);
    const isDownloading = AppState.downloading.has(track.videoId);
    const progress = AppState.downloadProgress[track.videoId] || 0;

    const el = document.createElement('div');
    el.className = `result-item ${isActivelyPlaying ? 'playing' : ''}`;
    el.dataset.videoId = track.videoId;

    let playBtnContent;
    if (isLoading) {
        playBtnContent = loadingSmallIcon();
    } else if (showPause) {
        playBtnContent = pauseSmallIcon();
    } else {
        playBtnContent = playSmallIcon();
    }

    el.innerHTML = `
        <img class="result-thumb" src="${track.thumbnail}" alt="" loading="lazy"
             onerror="this.style.background='var(--bg-tertiary)'">
        <div class="result-info">
            <div class="result-title">${escapeHtml(track.title)}</div>
            <div class="result-meta">${track.artistId ? `<span class="meta-link" data-artist-id="${escapeHtml(track.artistId)}">${escapeHtml(track.artist)}</span>` : escapeHtml(track.artist)}${track.album ? ' \u00b7 ' + (track.albumId ? `<span class="meta-link" data-album-id="${escapeHtml(track.albumId)}">${escapeHtml(track.album)}</span>` : escapeHtml(track.album)) : ''}</div>
        </div>
        <span class="result-duration">${formatDuration(track.duration)}</span>
        <div class="result-actions">
            <button class="action-btn play-btn ${isLoading ? 'loading' : ''} ${showPause ? 'active' : ''}" title="Preview">
                ${playBtnContent}
            </button>
            <button class="action-btn download-btn ${isDownloaded ? 'done' : ''} ${isDownloading ? 'active' : ''}"
                    title="${isDownloaded ? 'Show in Finder' : isDownloading ? 'Downloading...' : 'Download'}"
                    data-video-id="${track.videoId}">
                ${isDownloaded ? folderIcon() : isDownloading ? spinnerIcon() : downloadIcon()}
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

    // Meta link clicks (artist / album)
    const artistLink = el.querySelector('.meta-link[data-artist-id]');
    if (artistLink) {
        artistLink.addEventListener('click', (e) => {
            e.stopPropagation();
            showArtistView(artistLink.dataset.artistId, track.artist);
        });
    }
    const albumLink = el.querySelector('.meta-link[data-album-id]');
    if (albumLink) {
        albumLink.addEventListener('click', (e) => {
            e.stopPropagation();
            showAlbumView(albumLink.dataset.albumId, track.album);
        });
    }

    // Event listeners
    el.querySelector('.result-info').addEventListener('click', (e) => {
        // Don't play if clicking a meta link
        if (e.target.classList.contains('meta-link')) return;
        playTrack(track.videoId);
    });
    el.querySelector('.result-thumb').addEventListener('click', () => playTrack(track.videoId));
    el.querySelector('.play-btn').addEventListener('click', (e) => { e.stopPropagation(); playTrack(track.videoId); });
    el.querySelector('.download-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (hasLocalDownload(track.videoId)) {
            await revealTrackInFinder(track);
        } else {
            downloadTrack(track.videoId);
        }
    });
    el.querySelector('.playlist-btn').addEventListener('click', (e) => { e.stopPropagation(); showAddToPlaylist(track.videoId, e.currentTarget); });

    const importBtn = el.querySelector('.import-btn');
    if (importBtn) importBtn.addEventListener('click', (e) => { e.stopPropagation(); importTrack(track.videoId); });

    return el;
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
            btn.innerHTML = folderIcon();
            btn.classList.add('done');
            btn.classList.remove('active');
            btn.title = 'Show in Finder';
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
    return '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
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
    return '<div class="spinner-small"></div>';
}
function spinnerIcon() {
    return '<div class="spinner-small"></div>';
}
