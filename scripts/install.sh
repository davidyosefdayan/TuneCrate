#!/bin/bash
#
# TuneCrate Installer for macOS
# Installs TuneCrate as a DaVinci Resolve Workflow Integration Plugin
#
# Usage:
#   ./install.sh          # Install from extracted ZIP
#   curl -sL <url> | bash # One-line install from GitHub
#

set -e

PLUGIN_NAME="TuneCrate"
PLUGIN_DIR="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/${PLUGIN_NAME}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║   TuneCrate Plugin Installer     ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# Check if DaVinci Resolve is installed
RESOLVE_APP="/Applications/DaVinci Resolve/DaVinci Resolve.app"
if [ ! -d "$RESOLVE_APP" ]; then
    echo -e "${YELLOW}Warning: DaVinci Resolve not found at ${RESOLVE_APP}${NC}"
    echo "TuneCrate requires DaVinci Resolve Studio to run as a plugin."
    echo ""
fi

# Determine source directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if we're inside the extracted TuneCrate folder
if [ -f "${SCRIPT_DIR}/manifest.xml" ]; then
    SOURCE_DIR="$SCRIPT_DIR"
elif [ -f "${SCRIPT_DIR}/TuneCrate/manifest.xml" ]; then
    SOURCE_DIR="${SCRIPT_DIR}/TuneCrate"
elif [ -f "${SCRIPT_DIR}/../manifest.xml" ]; then
    SOURCE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
else
    echo -e "${RED}Error: Could not find TuneCrate plugin files.${NC}"
    echo "Make sure you're running this script from the extracted ZIP directory."
    exit 1
fi

echo "Source:  ${SOURCE_DIR}"
echo "Target:  ${PLUGIN_DIR}"
echo ""

# Check if we need sudo
PARENT_DIR="$(dirname "$PLUGIN_DIR")"
if [ ! -w "$PARENT_DIR" ] 2>/dev/null; then
    echo "Elevated permissions required to install to the plugins directory."
    echo ""
    SUDO="sudo"
else
    SUDO=""
fi

# Remove previous install
if [ -d "$PLUGIN_DIR" ]; then
    echo "Removing previous installation..."
    $SUDO rm -rf "$PLUGIN_DIR"
fi

# Create plugin directory
$SUDO mkdir -p "$PLUGIN_DIR"

# Copy files
echo "Installing plugin files..."
$SUDO cp -R "${SOURCE_DIR}/"* "$PLUGIN_DIR/"

# Ensure binaries are executable
if [ -f "${PLUGIN_DIR}/bin/yt-dlp" ]; then
    $SUDO chmod +x "${PLUGIN_DIR}/bin/yt-dlp"
fi
if [ -f "${PLUGIN_DIR}/bin/ffmpeg" ]; then
    $SUDO chmod +x "${PLUGIN_DIR}/bin/ffmpeg"
fi

echo ""
echo -e "${GREEN}TuneCrate installed successfully!${NC}"
echo ""
echo "Next steps:"
echo "  1. Restart DaVinci Resolve (if running)"
echo "  2. Go to: Workspace > Workflow Integrations > TuneCrate"
echo ""
echo "Note: TuneCrate requires DaVinci Resolve Studio (not the free version)."
echo "      Workflow Integrations are a Studio-only feature."
echo ""
