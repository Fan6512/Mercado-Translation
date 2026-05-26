@echo off
setlocal
REM ============================================================
REM Build desktop app with Pake (no Chrome required)
REM This version logs everything to build-log.txt
REM ============================================================

set "HERE=%~dp0"
cd /d "%HERE%"
set "LOG=%HERE%build-log.txt"

echo Building... see build-log.txt for full output
echo Started at %DATE% %TIME% > "%LOG%"

where node >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. >> "%LOG%"
    echo [ERROR] Node.js not found.
    goto END
)

where cargo >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] Rust/cargo not found in PATH. Open a NEW cmd window after installing Rust. >> "%LOG%"
    echo [ERROR] Rust/cargo not found in PATH. Open a NEW cmd window after installing Rust.
    goto END
)

REM ---- Load MSVC environment (link.exe / cl.exe) ----
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" set "VSWHERE=%ProgramFiles%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
    echo [ERROR] vswhere.exe not found. VS Build Tools not installed correctly. >> "%LOG%"
    echo [ERROR] vswhere.exe not found.
    goto END
)
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_PATH=%%i"
if "%VS_PATH%"=="" (
    echo [ERROR] MSVC v143 not found via vswhere. Re-run VS Installer and tick MSVC v143 + Windows SDK. >> "%LOG%"
    echo [ERROR] MSVC v143 not found via vswhere.
    goto END
)
echo Found VS at: %VS_PATH% >> "%LOG%"
set "VCVARS=%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%HERE%icon.ico" (
    echo [ERROR] icon.ico missing in this folder. >> "%LOG%"
    echo [ERROR] icon.ico missing in this folder.
    goto END
)

set "INDEX=%HERE%index.html"
set "FILE_URL=file:///%INDEX:\=/%"

echo Entry : %FILE_URL% >> "%LOG%"
echo Icon  : %HERE%icon.ico >> "%LOG%"
echo. >> "%LOG%"
echo Running pake-cli... this can take 5-15 minutes on first run. >> "%LOG%"
echo Running pake-cli... this can take 5-15 minutes on first run.
echo.

call cmd /c ""%VCVARS%" && npx -y pake-cli "%FILE_URL%" --name "Translator" --icon "%HERE%icon.ico" --width 1400 --height 900 --use-local-file" >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo Exit code: %ERRORLEVEL% >> "%LOG%"
echo Finished at %DATE% %TIME% >> "%LOG%"

echo.
echo ============================================================
echo Build process finished. Searching for output files...
echo ============================================================
echo.
echo Files matching Translator* in this folder:
dir /b "%HERE%Translator*" 2>nul
echo.
echo Files matching Translator* in your user folder:
dir /b "%USERPROFILE%\Translator*" 2>nul
echo.
echo Files in Pake build output folders (auto-scan):
for /f "delims=" %%d in ('dir /b /s /ad "%LOCALAPPDATA%\npm-cache\_npx\*pake-cli" 2^>nul') do (
    if exist "%%d\src-tauri\target\release\bundle\nsis\" (
        echo NSIS installer location:
        echo   %%d\src-tauri\target\release\bundle\nsis\
        dir /b "%%d\src-tauri\target\release\bundle\nsis\"
    )
    if exist "%%d\src-tauri\target\release\bundle\msi\" (
        echo MSI installer location:
        echo   %%d\src-tauri\target\release\bundle\msi\
        dir /b "%%d\src-tauri\target\release\bundle\msi\"
    )
)
echo.

:END
echo.
echo ============================================================
echo Log saved to: %LOG%
echo If build failed, open build-log.txt and look for error messages.
echo ============================================================
pause
endlocal
