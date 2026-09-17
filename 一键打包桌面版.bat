@echo off
setlocal
REM ---- 切到 UTF-8 代码页 ----
REM 本脚本与 pake 的输出都是 UTF-8；不切的话中文路径写进 build-log.txt 全是乱码，排障困难
chcp 65001 >nul
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

REM ---- Warn if path contains non-ASCII characters ----
echo "%HERE%" | findstr /R "[^ -~]" >nul
if not errorlevel 1 (
    echo [WARNING] Current path contains non-ASCII characters. Move to pure ASCII path for portable build. >> "%LOG%"
    echo [WARNING] Current path contains non-ASCII characters. Move to pure ASCII path for portable build.
)

set "INDEX=%HERE%index.html"

REM ---- 可选代理：同目录 proxy.txt 首行会被传给 Pake 的 --proxy-url ----
REM 留空则回退系统代理（Clash 开系统代理/TUN 即可）。地址不能含空格。
set "PROXY_URL="
if exist "%HERE%proxy.txt" (
    for /f "usebackq tokens=* delims=" %%L in ("%HERE%proxy.txt") do (
        if not defined PROXY_URL if not "%%L"=="" set "PROXY_URL=%%L"
    )
)
set "PAKE_PROXY="
if defined PROXY_URL set PAKE_PROXY=--proxy-url %PROXY_URL%

echo Entry : %INDEX% >> "%LOG%"
echo Icon  : %HERE%icon.ico >> "%LOG%"
if defined PROXY_URL (echo Proxy : %PROXY_URL% >> "%LOG%") else (echo Proxy : (system default) >> "%LOG%")
echo. >> "%LOG%"
echo Running pake-cli... this can take 5-15 minutes on first run. >> "%LOG%"
echo Running pake-cli... this can take 5-15 minutes on first run.
if defined PROXY_URL echo Proxy  : %PROXY_URL%
echo.

REM Pass the local file path directly (not file:// URL) so --use-local-file properly embeds resources
REM --identifier 必须钉死：pake 默认用 md5(入口路径::名称) 生成 com.pake.aXXXXXX，
REM   换目录 / 改名就变 ID，MSI 会被 Windows 当成另一个产品、无法覆盖升级。
REM   注意：改这个值会让「已安装旧 ID 版本」的机器出现重复安装（需先卸载旧版）。
call cmd /c ""%VCVARS%" && npx -y pake-cli "%INDEX%" --name "Translator" --identifier "com.pake.translator" --icon "%HERE%icon.ico" --width 1400 --height 900 --use-local-file %PAKE_PROXY%" >> "%LOG%" 2>&1

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
REM ---- 扫描 Pake 产物。真实输出路径带 target 三元组（pake 固定传 --target x86_64-pc-windows-msvc）：
REM      <pake-cli>\src-tauri\target\x86_64-pc-windows-msvc\release\
REM      老版本没有三元组，所以两个候选都探测一遍 ----
echo Files in Pake build output folders (auto-scan):
for /f "delims=" %%d in ('dir /b /s /ad "%LOCALAPPDATA%\npm-cache\_npx\*pake-cli" 2^>nul') do (
    for %%r in ("%%d\src-tauri\target\release" "%%d\src-tauri\target\x86_64-pc-windows-msvc\release") do (
        if exist "%%~fr\bundle\nsis\" (
            echo NSIS installer location:
            echo   %%~fr\bundle\nsis\
            dir /b "%%~fr\bundle\nsis\"
        )
        if exist "%%~fr\bundle\msi\" (
            echo MSI installer location:
            echo   %%~fr\bundle\msi\
            dir /b "%%~fr\bundle\msi\"
        )
    )
)
echo.

REM ---- 复制构建产物到 dist/（已被 .gitignore 忽略，不入库）----
REM 注意：pake 打包完成会把 .msi 直接搬到当前目录（%HERE%Translator.msi），
REM       所以先复制根目录的 msi，再从构建目录兜底找 nsis 安装包与绿色 exe
if not exist "%HERE%dist" mkdir "%HERE%dist"
set "INSTALLER_COPIED=0"
for %%m in ("%HERE%Translator*.msi") do (
    if exist "%%~fm" (
        copy /y "%%~fm" "%HERE%dist\" >nul
        set "INSTALLER_COPIED=1"
    )
)
for /f "delims=" %%d in ('dir /b /s /ad "%LOCALAPPDATA%\npm-cache\_npx\*pake-cli" 2^>nul') do (
    for %%r in ("%%d\src-tauri\target\release" "%%d\src-tauri\target\x86_64-pc-windows-msvc\release") do (
        if exist "%%~fr\bundle\nsis\*.exe" (
            copy /y "%%~fr\bundle\nsis\*.exe" "%HERE%dist\" >nul
            set "INSTALLER_COPIED=1"
        )
        if exist "%%~fr\bundle\msi\*.msi" (
            copy /y "%%~fr\bundle\msi\*.msi" "%HERE%dist\" >nul
            set "INSTALLER_COPIED=1"
        )
        if exist "%%~fr\pake-translator.exe" (
            copy /y "%%~fr\pake-translator.exe" "%HERE%dist\" >nul
        )
    )
)
if "%INSTALLER_COPIED%"=="1" (
    echo.
    echo Installer copied to: %HERE%dist\
    dir /b "%HERE%dist\"
)


:END
echo.
echo ============================================================
echo Log saved to: %LOG%
echo If build failed, open build-log.txt and look for error messages.
echo ============================================================
pause
endlocal
