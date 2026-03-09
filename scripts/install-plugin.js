const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'YouTube Music';
const SOURCE_DIR = path.join(__dirname, '..');
const TARGET_DIR = path.join(
    '/Library/Application Support/Blackmagic Design/DaVinci Resolve',
    'Workflow Integration Plugins',
    PLUGIN_NAME
);

try {
    // Create parent dir if needed
    const parentDir = path.dirname(TARGET_DIR);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    // Remove existing symlink/dir
    if (fs.existsSync(TARGET_DIR)) {
        const stat = fs.lstatSync(TARGET_DIR);
        if (stat.isSymbolicLink()) {
            fs.unlinkSync(TARGET_DIR);
        } else {
            console.error(`Target exists and is not a symlink: ${TARGET_DIR}`);
            console.error('Remove it manually first.');
            process.exit(1);
        }
    }

    // Create symlink
    fs.symlinkSync(SOURCE_DIR, TARGET_DIR, 'dir');
    console.log(`Plugin installed! Symlinked to:\n  ${TARGET_DIR}\n`);
    console.log('Open DaVinci Resolve Studio > Workspace > Workflow Integrations > YouTube Music');
} catch (err) {
    if (err.code === 'EACCES') {
        console.error('Permission denied. Try running with sudo:');
        console.error('  sudo node scripts/install-plugin.js');
    } else {
        console.error('Install failed:', err.message);
    }
    process.exit(1);
}
