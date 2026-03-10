// Settings module
async function initSettings() {
    const settings = await window.settingsAPI.getAll();

    // Download dir
    document.getElementById('download-dir-display').textContent =
        settings.downloadDir.replace(/^\/Users\/[^/]+/, '~');

    // Default format (radio buttons)
    const format = settings.defaultFormat || 'mp3';
    const radio = document.querySelector(`input[name="default-format"][value="${format}"]`);
    if (radio) radio.checked = true;

    // Auto-import
    document.getElementById('auto-import-toggle').checked = settings.autoImport || false;
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

// Default format (radio buttons)
document.querySelectorAll('input[name="default-format"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        window.settingsAPI.set('defaultFormat', e.target.value);
    });
});

// Auto-import toggle
document.getElementById('auto-import-toggle').addEventListener('change', (e) => {
    window.settingsAPI.set('autoImport', e.target.checked);
});

// Open download folder
document.getElementById('open-download-dir-btn').addEventListener('click', () => {
    window.appAPI.openDownloadDir();
});
