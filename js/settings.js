// Settings module
async function initSettings() {
    const settings = await window.settingsAPI.getAll();

    // Download dir
    updateDirDisplay(settings.downloadDir);

    // Default format (radio buttons)
    const format = settings.defaultFormat || 'mp3';
    const radio = document.querySelector(`input[name="default-format"][value="${format}"]`);
    if (radio) radio.checked = true;

    // Sync to project (only available when Resolve is connected)
    const syncToggle = document.getElementById('sync-to-project-toggle');
    if (AppState.resolveAvailable) {
        syncToggle.checked = settings.syncToProject || false;
        updateSyncState(syncToggle.checked);

        // If sync is on, refresh the dir on load (picks up current project)
        if (syncToggle.checked) {
            const syncDir = await window.settingsAPI.syncDownloadDir();
            if (syncDir) updateDirDisplay(syncDir);
        }
    } else {
        syncToggle.checked = false;
        syncToggle.disabled = true;
        syncToggle.closest('.setting-row').style.opacity = '0.4';
    }

    // Auto-import
    document.getElementById('auto-import-toggle').checked = settings.autoImport || false;
}

function updateDirDisplay(dir) {
    document.getElementById('download-dir-display').textContent =
        dir.replace(/^\/Users\/[^/]+/, '~');
}

function updateSyncState(synced) {
    const browseBtn = document.getElementById('change-dir-btn');
    browseBtn.disabled = synced;
    browseBtn.style.opacity = synced ? '0.4' : '';
    browseBtn.style.pointerEvents = synced ? 'none' : '';
}

// Change download dir
document.getElementById('change-dir-btn').addEventListener('click', async () => {
    const newDir = await window.settingsAPI.selectDownloadDir();
    if (newDir) {
        updateDirDisplay(newDir);
        showToast('Download directory updated', 'success');
    }
});

// Sync to project toggle
document.getElementById('sync-to-project-toggle').addEventListener('change', async (e) => {
    const synced = e.target.checked;
    await window.settingsAPI.set('syncToProject', synced);
    updateSyncState(synced);

    if (synced) {
        const syncDir = await window.settingsAPI.syncDownloadDir();
        if (syncDir) {
            updateDirDisplay(syncDir);
            showToast('Downloads synced to project', 'success');
        }
    } else {
        // Restore default dir
        const defaultDir = await window.settingsAPI.get('downloadDir');
        updateDirDisplay(defaultDir);
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
