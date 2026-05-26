@echo off
REM ============================================================
REM Build desktop app with Pake (no Chrome required)
REM Requires: Node.js (install from https://nodejs.org if missing)
REM ============================================================

set "HERE=%~dp0"
cd /d "%HERE%"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    echo Please install Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "%HERE%icon.ico" (
    echo [INFO] icon.ico not found in this folder.
    echo Open "generate-icon.html" first, click "Download icon.ico",
    echo move the file to this folder, then re-run this script.
    pause
    exit /b 1
)

set "INDEX=%HERE%index.html"
set "FILE_URL=file:///%INDEX:\=/%"

echo ============================================================
echo Building with Pake...
echo Entry : %FILE_URL%
echo Icon  : %HERE%icon.ico
echo ============================================================
echo.
echo First run downloads Rust toolchain and dependencies.
echo This may take 5-15 minutes. Please be patient.
echo.

npx -y pake-cli "%FILE_URL%" --name "Translator" --icon "%HERE%icon.ico" --width 1400 --height 900 --use-local-file

if errorlevel 1 (
    echo.
    echo [FAILED] Build failed. Check error messages above.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Done. The .exe is in the current folder (name starts with "Translator").
echo You can rename it to Chinese after building.
echo ============================================================
pause
