// Home page module — renders sections from main process
function renderSkeletonHome() {
    const container = document.getElementById('home-sections');
    container.innerHTML = '';

    // Match real section order: songs, albums, artists, albums
    const layout = [
        { type: 'songs', count: 6 },
        { type: 'albums', count: 6 },
        { type: 'artists', count: 6 },
        { type: 'albums', count: 6 }
    ];

    layout.forEach(({ type, count }) => {
        const section = document.createElement('div');
        section.className = 'home-section';

        // Match real h4 title element
        const title = document.createElement('h4');
        title.innerHTML = '<span class="skeleton" style="display:inline-block;width:100px;height:13px"></span>';
        section.appendChild(title);

        const row = document.createElement('div');
        row.className = 'home-row';

        for (let i = 0; i < count; i++) {
            // Use same classes as real cards so sizing/spacing matches exactly
            const card = document.createElement('div');
            card.className = 'home-card' +
                (type === 'songs' ? ' home-card-song' : '') +
                (type === 'artists' ? ' home-card-artist' : '');

            const thumbWrap = document.createElement('div');
            thumbWrap.className = 'home-card-thumb-wrap';
            const thumb = document.createElement('div');
            thumb.className = 'skeleton home-card-thumb';
            thumbWrap.appendChild(thumb);
            card.appendChild(thumbWrap);

            const info = document.createElement('div');
            info.className = 'home-card-info';
            const nameLine = document.createElement('div');
            nameLine.className = 'skeleton skeleton-text skeleton-text-long';
            info.appendChild(nameLine);
            if (type !== 'artists') {
                const subLine = document.createElement('div');
                subLine.className = 'skeleton skeleton-text skeleton-text-short';
                info.appendChild(subLine);
            }
            card.appendChild(info);

            row.appendChild(card);
        }
        section.appendChild(row);
        container.appendChild(section);
    });
}

async function loadHomeContent() {
    const loading = document.getElementById('home-loading');
    const container = document.getElementById('home-sections');

    loading.style.display = 'none';
    renderSkeletonHome();

    try {
        AppState.homeSections = await window.musicAPI.getHomeContent();
        container.innerHTML = '';
        container.classList.add('home-sections-fade-in');
        renderHomeContent();
        container.addEventListener('animationend', () => container.classList.remove('home-sections-fade-in'), { once: true });
    } catch (err) {
        container.innerHTML = '<div class="empty-state">Could not load home content</div>';
    }
}

function renderHomeContent() {
    const container = document.getElementById('home-sections');
    container.innerHTML = '';

    AppState.homeSections.forEach(section => {
        if (!section.items || section.items.length === 0) return;

        const sectionEl = document.createElement('div');
        sectionEl.className = 'home-section';

        const header = document.createElement('h4');
        header.textContent = section.title;
        sectionEl.appendChild(header);

        const row = document.createElement('div');
        row.className = 'home-row';

        if (section.type === 'artists') {
            section.items.forEach(item => row.appendChild(renderArtistCard(item)));
        } else if (section.type === 'albums') {
            section.items.forEach(item => row.appendChild(renderAlbumCard(item)));
        } else if (section.type === 'songs') {
            section.items.forEach(item => row.appendChild(renderSongCard(item)));
        } else {
            // Fallback: mixed items (legacy home sections from open mode)
            section.items.forEach(item => {
                if (item.type === 'SONG') {
                    row.appendChild(renderSongCard(item));
                } else if (item.artistId && !item.albumId && !item.videoId) {
                    row.appendChild(renderArtistCard(item));
                } else {
                    row.appendChild(renderAlbumCard(item));
                }
            });
        }

        sectionEl.appendChild(row);
        container.appendChild(sectionEl);
    });
}

function renderSongCard(item) {
    const card = document.createElement('div');
    card.className = 'home-card home-card-song';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'home-card-thumb-wrap';

    const thumb = document.createElement('img');
    thumb.className = 'home-card-thumb';
    thumb.src = item.thumbnailSmall || item.thumbnail || '';
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.onerror = function() { this.style.background = 'var(--bg-tertiary)'; };
    thumbWrap.appendChild(thumb);

    const playOverlay = document.createElement('div');
    playOverlay.className = 'home-card-play';
    playOverlay.innerHTML = '<svg viewBox="0 0 24 24" fill="white"><polygon points="6,3 20,12 6,21"/></svg>';
    thumbWrap.appendChild(playOverlay);

    const info = document.createElement('div');
    info.className = 'home-card-info';

    const name = document.createElement('div');
    name.className = 'home-card-name';
    name.textContent = item.name || item.title || '';

    const artist = document.createElement('div');
    artist.className = 'home-card-artist';
    artist.textContent = item.artist || '';

    info.appendChild(name);
    info.appendChild(artist);
    card.appendChild(thumbWrap);
    card.appendChild(info);

    card.addEventListener('click', () => {
        startPreview({
            videoId: item.videoId,
            title: item.name || item.title || '',
            artist: item.artist || '',
            duration: item.duration || 0,
            thumbnail: item.thumbnail || ''
        });
    });

    return card;
}

function renderAlbumCard(item) {
    const card = document.createElement('div');
    card.className = 'home-card';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'home-card-thumb-wrap';

    const thumb = document.createElement('img');
    thumb.className = 'home-card-thumb';
    thumb.src = item.thumbnailSmall || item.thumbnail || '';
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.onerror = function() { this.style.background = 'var(--bg-tertiary)'; };
    thumbWrap.appendChild(thumb);

    const info = document.createElement('div');
    info.className = 'home-card-info';

    const name = document.createElement('div');
    name.className = 'home-card-name';
    name.textContent = item.name || '';

    const artist = document.createElement('div');
    artist.className = 'home-card-artist';
    artist.textContent = item.artist || '';
    if (item.year) artist.textContent += ' \u00b7 ' + item.year;

    info.appendChild(name);
    info.appendChild(artist);
    card.appendChild(thumbWrap);
    card.appendChild(info);

    card.addEventListener('click', () => {
        if (item.albumId) {
            showAlbumView(item.albumId, item.name, item.thumbnail, item.artist, item.year);
        } else if (item.playlistId) {
            showPlaylistDetailView(item);
            onHomePlaylistClick(item);
        }
    });

    return card;
}

function renderArtistCard(item) {
    const card = document.createElement('div');
    card.className = 'home-card home-card-artist';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'home-card-thumb-wrap';

    const thumb = document.createElement('img');
    thumb.className = 'home-card-thumb';
    thumb.src = item.thumbnailSmall || item.thumbnail || '';
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.onerror = function() { this.style.background = 'var(--bg-tertiary)'; };
    thumbWrap.appendChild(thumb);

    const info = document.createElement('div');
    info.className = 'home-card-info';

    const name = document.createElement('div');
    name.className = 'home-card-name';
    name.textContent = item.name || '';

    info.appendChild(name);
    card.appendChild(thumbWrap);
    card.appendChild(info);

    card.addEventListener('click', () => {
        if (item.artistId) {
            showArtistView(item.artistId, item.name, item.thumbnail);
        }
    });

    return card;
}

// Handle playlist/album clicks from home (non-song, non-artist items)
async function onHomePlaylistClick(item) {
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
