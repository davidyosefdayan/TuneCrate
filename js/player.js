// Audio player module
let audio = new Audio();
let isPlaying = false;
let isLoadingPreview = false;

const playerBar = document.getElementById('player-bar');
const playerThumb = document.getElementById('player-thumb');
const playerTitle = document.getElementById('player-title');
const playerSubtitle = document.getElementById('player-subtitle');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const loadingIcon = document.getElementById('loading-icon');
const seekBar = document.getElementById('player-seek-bar');
const playerTime = document.getElementById('player-time');
const playerDuration = document.getElementById('player-duration');

document.getElementById('player-play-btn').addEventListener('click', togglePlayPause);

document.getElementById('player-download-btn').addEventListener('click', () => {
    if (AppState.currentTrack) downloadTrack(AppState.currentTrack.videoId);
});

document.getElementById('player-playlist-btn').addEventListener('click', () => {
    if (AppState.currentTrack) showAddToPlaylist(AppState.currentTrack.videoId);
});

document.getElementById('player-import-btn').addEventListener('click', async () => {
    if (!AppState.currentTrack) return;
    importTrack(AppState.currentTrack.videoId);
});

function updateSeekBarFill() {
    const pct = seekBar.value;
    seekBar.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-elevated) ${pct}%)`;
}

seekBar.addEventListener('input', () => {
    if (audio.duration && isFinite(audio.duration)) {
        audio.currentTime = (seekBar.value / 100) * audio.duration;
    }
    updateSeekBarFill();
});

audio.addEventListener('timeupdate', () => {
    if (audio.duration && isFinite(audio.duration)) {
        seekBar.value = (audio.currentTime / audio.duration) * 100;
        playerTime.textContent = formatDuration(audio.currentTime);
        updateSeekBarFill();
    }
});

audio.addEventListener('loadedmetadata', () => {
    if (audio.duration && isFinite(audio.duration)) {
        playerDuration.textContent = formatDuration(audio.duration);
    }
});

audio.addEventListener('canplay', () => {
    isLoadingPreview = false;
    updatePlayerIcons();
});

audio.addEventListener('playing', () => {
    isPlaying = true;
    isLoadingPreview = false;
    updatePlayerIcons();
});

audio.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayerIcons();
});

audio.addEventListener('ended', () => {
    isPlaying = false;
    updatePlayerIcons();
});

audio.addEventListener('error', (e) => {
    console.error('Audio error:', audio.error);
    isPlaying = false;
    isLoadingPreview = false;
    updatePlayerIcons();
    showToast('Preview failed — try again', 'error');
});

async function startPreview(track) {
    // If same track, just toggle
    if (AppState.currentTrack?.videoId === track.videoId) {
        togglePlayPause();
        return;
    }

    AppState.currentTrack = track;

    // Show player bar with loading state
    playerBar.classList.remove('hidden');
    playerThumb.src = track.thumbnail;
    playerTitle.textContent = track.title;
    playerSubtitle.textContent = track.album ? `${track.artist} · ${track.album}` : track.artist;
    seekBar.value = 0;
    playerTime.textContent = '0:00';
    playerDuration.textContent = formatDuration(track.duration);

    isLoadingPreview = true;
    isPlaying = false;
    updatePlayerIcons();
    updatePlayerActions();

    // Highlight playing item
    document.querySelectorAll('.result-item').forEach(el => {
        el.classList.toggle('playing', el.dataset.videoId === track.videoId);
    });

    // Update play buttons in results — show loading spinner for current track
    updateListPlayButtons();

    // Play from local file if already downloaded, otherwise stream
    try {
        const localPath = AppState.downloadedPaths[track.videoId] || track.localPath;
        let playUrl;

        if (localPath) {
            playUrl = 'file://' + localPath;
        } else {
            const cached = await window.appAPI.isPreviewCached(track.videoId);
            if (!cached) {
                showToast('Loading preview... this may take a moment');
            }
            const { url, error } = await window.appAPI.getPreviewUrl(track.videoId);
            if (error || !url) throw new Error(error || 'No URL');
            playUrl = url;
        }

        // Check if user switched to a different track while we were loading
        if (AppState.currentTrack?.videoId !== track.videoId) return;

        audio.pause();
        audio.src = playUrl;
        audio.load();
        await audio.play();
        isPlaying = true;
        isLoadingPreview = false;
        updatePlayerIcons();
    } catch (e) {
        console.error('Preview error:', e);
        isLoadingPreview = false;
        isPlaying = false;
        updatePlayerIcons();
        showToast('Could not load preview — try again', 'error');
    }
}

function togglePlayPause() {
    if (!AppState.currentTrack) return;
    if (isLoadingPreview) return;

    if (isPlaying) {
        audio.pause();
    } else {
        audio.play();
    }
}

function updatePlayerIcons() {
    playIcon.style.display = (isPlaying || isLoadingPreview) ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
    loadingIcon.style.display = isLoadingPreview ? 'block' : 'none';

    // Sync list view play buttons
    updateListPlayButtons();

    // Sync player bar action buttons
    updatePlayerActions();
}

function updateListPlayButtons() {
    document.querySelectorAll('.result-item .play-btn').forEach(btn => {
        const item = btn.closest('.result-item');
        const isCurrent = item.dataset.videoId === AppState.currentTrack?.videoId;
        if (isCurrent && isLoadingPreview) {
            btn.innerHTML = loadingSmallIcon();
            btn.classList.add('loading');
        } else if (isCurrent && isPlaying) {
            btn.innerHTML = pauseSmallIcon();
            btn.classList.remove('loading');
        } else {
            btn.innerHTML = playSmallIcon();
            btn.classList.remove('loading');
        }
    });
}

function updatePlayerActions() {
    if (!AppState.currentTrack) return;
    const videoId = AppState.currentTrack.videoId;
    const isDownloaded = !!AppState.downloadedPaths[videoId];
    const isDownloading = AppState.downloading.has(videoId);
    const progress = AppState.downloadProgress[videoId] || 0;

    const dlBtn = document.getElementById('player-download-btn');
    if (dlBtn) {
        if (isDownloaded) {
            dlBtn.innerHTML = checkIcon();
            dlBtn.classList.add('done');
            dlBtn.classList.remove('active');
            dlBtn.title = 'Downloaded';
        } else if (isDownloading) {
            dlBtn.innerHTML = spinnerIcon();
            dlBtn.classList.add('active');
            dlBtn.classList.remove('done');
            dlBtn.title = progress > 0 ? `Downloading ${Math.round(progress)}%` : 'Fetching...';
        } else {
            dlBtn.innerHTML = downloadIcon();
            dlBtn.classList.remove('done', 'active');
            dlBtn.title = 'Download';
        }
    }
}
