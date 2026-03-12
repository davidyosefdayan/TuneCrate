@echo off
REM TuneCrate Installer for Windows
REM Installs TuneCrate as a DaVinci Resolve Workflow Integration Plugin

setlocal enabledelayedexpansion

set PLUGIN_NAME=TuneCrate
set PLUGIN_DIR=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\%PLUGIN_NAME%

echo.
echo   ======================================
echo     TuneCrate Plugin Installer
echo   ======================================
echo.

REM Determine source directory
set SCRIPT_DIR=%~dp0

if exist "%SCRIPT_DIR%manifest.xml" (
    set SOURCE_DIR=%SCRIPT_DIR%
) else if exist "%SCRIPT_DIR%TuneCrate\manifest.xml" (
    set SOURCE_DIR=%SCRIPT_DIR%TuneCrate\
) else if exist "%SCRIPT_DIR%..\manifest.xml" (
    set SOURCE_DIR=%SCRIPT_DIR%..\
) else (
    echo Error: Could not find TuneCrate plugin files.
    echo Make sure you're running this script from the extracted ZIP directory.
    pause
    exit /b 1
)

echo Source:  %SOURCE_DIR%
echo Target:  %PLUGIN_DIR%
echo.

REM Remove previous install
if exist "%PLUGIN_DIR%" (
    echo Removing previous installation...
    rmdir /s /q "%PLUGIN_DIR%"
)

REM Create plugin directory
mkdir "%PLUGIN_DIR%" 2>nul

REM Copy files
echo Installing plugin files...
xcopy "%SOURCE_DIR%*" "%PLUGIN_DIR%\" /e /i /q /y

echo.
echo TuneCrate installed successfully!
echo.
echo Next steps:
echo   1. Restart DaVinci Resolve (if running)
echo   2. Go to: Workspace ^> Workflow Integrations ^> TuneCrate
echo.
echo Note: TuneCrate requires DaVinci Resolve Studio (not the free version).
echo       Workflow Integrations are a Studio-only feature.
echo.
pause
