// Settings module
async function initSettings() {
    const settings = await window.settingsAPI.getAll();

    // Download dir
    document.getElementById('download-dir-display').textContent =
        settings.downloadDir.replace(/^\/Users\/[^/]+/, '~');

    // Default format
    document.getElementById('default-format').value = settings.defaultFormat || 'mp3';

    // Auto-import
    document.getElementById('auto-import-toggle').checked = settings.autoImport || false;

    // yt-dlp path
    document.getElementById('ytdlp-path').value = settings.ytdlpPath || '';
}

// Change download dir
document.getElementById('change-dir-btn').addEventListener('click', async () => {
    const newDir = await window.settingsAPI.selectDownloadDir();
    if (newDir) {
        document.getElementById('download-dir-display').textContent =
            newDir.replace(/^\/Users\/[^/]+/, '~');
        showToast('Download directory updated', 'success');
    }
});

// Default format
document.getElementById('default-format').addEventListener('change', (e) => {
    window.settingsAPI.set('defaultFormat', e.target.value);
});

// Auto-import toggle
document.getElementById('auto-import-toggle').addEventListener('change', (e) => {
    window.settingsAPI.set('autoImport', e.target.checked);
});

// yt-dlp path
document.getElementById('ytdlp-path').addEventListener('change', (e) => {
    window.settingsAPI.set('ytdlpPath', e.target.value);
});

// Open download folder
document.getElementById('open-download-dir-btn').addEventListener('click', () => {
    window.appAPI.openDownloadDir();
});
