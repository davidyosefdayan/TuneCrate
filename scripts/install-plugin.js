const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'TuneCrate';
const SOURCE_DIR = path.join(__dirname, '..');
const TARGET_DIR = path.join(
    '/Library/Application Support/Blackmagic Design/DaVinci Resolve',
    'Workflow Integration Plugins',
    PLUGIN_NAME
);

// Files/dirs to copy (exclude dev-only stuff)
const INCLUDE = [
    'manifest.xml',
    'package.json',
    'package-lock.json',
    'main.js',
    'preload.js',
    'index.html',
    'WorkflowIntegration.node',
    'app-profile.json',
    'data',
    'css',
    'js',
    'lib',
    'node_modules',
    'bin',
    'scripts'
];

try {
    // Remove existing install
    if (fs.existsSync(TARGET_DIR)) {
        console.log('Removing previous install...');
        fs.rmSync(TARGET_DIR, { recursive: true, force: true });
    }

    // Create target dir
    fs.mkdirSync(TARGET_DIR, { recursive: true });

    // Copy each item
    for (const item of INCLUDE) {
        const src = path.join(SOURCE_DIR, item);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(TARGET_DIR, item);
        console.log(`  Copying ${item}...`);
        fs.cpSync(src, dest, { recursive: true });
    }

    console.log(`\nPlugin installed to:\n  ${TARGET_DIR}\n`);
    console.log('Restart DaVinci Resolve, then open:');
    console.log('  Workspace > Workflow Integrations > TuneCrate');
} catch (err) {
    if (err.code === 'EACCES') {
        console.error('Permission denied. Try running with sudo:');
        console.error('  sudo npm run install-plugin');
    } else {
        console.error('Install failed:', err.message);
    }
    process.exit(1);
}
