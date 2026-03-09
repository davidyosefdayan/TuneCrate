// Audio player module
let audio = new Audio();
let isPlaying = false;
let isLoadingPreview = false;

const playerBar = document.getElementById('player-bar');
const playerThumb = document.getElementById('player-thumb');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const loadingIcon = document.getElementById('loading-icon');
const seekBar = document.getElementById('player-seek-bar');
const playerTime = document.getElementById('player-time');
const playerDuration = document.getElementById('player-duration');

document.getElementById('player-play-btn').addEventListener('click', togglePlayPause);

seekBar.addEventListener('input', () => {
    if (audio.duration && isFinite(audio.duration)) {
        audio.currentTime = (seekBar.value / 100) * audio.duration;
    }
});

audio.addEventListener('timeupdate', () => {
    if (audio.duration && isFinite(audio.duration)) {
        seekBar.value = (audio.currentTime / audio.duration) * 100;
        playerTime.textContent = formatDuration(audio.currentTime);
    }
});

audio.addEventListener('loadedmetadata', () => {
    if (audio.duration && isFinite(audio.duration)) {
        playerDuration.textContent = formatDuration(audio.duration);
    }
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

audio.addEventListener('waiting', () => {
    isLoadingPreview = true;
    updatePlayerIcons();
});

audio.addEventListener('error', (e) => {
    isPlaying = false;
    isLoadingPreview = false;
    updatePlayerIcons();
    showToast('Preview unavailable — try again', 'error');
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
    playerArtist.textContent = track.artist;
    seekBar.value = 0;
    playerTime.textContent = '0:00';
    playerDuration.textContent = formatDuration(track.duration);

    isLoadingPreview = true;
    isPlaying = false;
    updatePlayerIcons();

    // Highlight playing item
    document.querySelectorAll('.result-item').forEach(el => {
        el.classList.toggle('playing', el.dataset.videoId === track.videoId);
    });

    // Update play buttons in results
    document.querySelectorAll('.result-item .play-btn').forEach(btn => {
        const item = btn.closest('.result-item');
        btn.innerHTML = item.dataset.videoId === track.videoId ? pauseSmallIcon() : playSmallIcon();
    });

    // Get stream URL via yt-dlp and proxy
    try {
        const { url, error } = await window.appAPI.getPreviewUrl(track.videoId);
        if (error || !url) throw new Error(error || 'No URL');

        audio.src = url;
        await audio.play();
    } catch (e) {
        isLoadingPreview = false;
        updatePlayerIcons();
        showToast('Could not load preview', 'error');
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
}
