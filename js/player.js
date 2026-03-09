// Audio player module
let audio = new Audio();
let isPlaying = false;

const playerBar = document.getElementById('player-bar');
const playerThumb = document.getElementById('player-thumb');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const seekBar = document.getElementById('player-seek-bar');
const playerTime = document.getElementById('player-time');

document.getElementById('player-play-btn').addEventListener('click', togglePlayPause);

seekBar.addEventListener('input', () => {
    if (audio.duration) {
        audio.currentTime = (seekBar.value / 100) * audio.duration;
    }
});

audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
        seekBar.value = (audio.currentTime / audio.duration) * 100;
        playerTime.textContent = formatDuration(audio.currentTime);
    }
});

audio.addEventListener('ended', () => {
    isPlaying = false;
    updatePlayPauseIcon();
});

audio.addEventListener('error', () => {
    showToast('Preview unavailable', 'error');
    isPlaying = false;
    updatePlayPauseIcon();
});

async function startPreview(track) {
    // If same track, just toggle
    if (AppState.currentTrack?.videoId === track.videoId) {
        togglePlayPause();
        return;
    }

    AppState.currentTrack = track;

    // Show player bar
    playerBar.classList.remove('hidden');
    playerThumb.src = track.thumbnail;
    playerTitle.textContent = track.title;
    playerArtist.textContent = track.artist;
    seekBar.value = 0;
    playerTime.textContent = '0:00';

    // Highlight playing item
    document.querySelectorAll('.result-item').forEach(el => {
        el.classList.toggle('playing', el.dataset.videoId === track.videoId);
    });

    // Start streaming
    const port = AppState.previewPort;
    audio.src = `http://127.0.0.1:${port}/stream?id=${track.videoId}`;
    try {
        await audio.play();
        isPlaying = true;
    } catch (e) {
        isPlaying = false;
    }
    updatePlayPauseIcon();
}

function togglePlayPause() {
    if (!AppState.currentTrack) return;
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
    } else {
        audio.play();
        isPlaying = true;
    }
    updatePlayPauseIcon();
}

function updatePlayPauseIcon() {
    playIcon.style.display = isPlaying ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
}
