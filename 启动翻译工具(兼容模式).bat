@echo off
chcp 65001 >nul
REM 跨境电商翻译工具 - 兼容模式启动器
REM 仅用于目标 API / Google Translate 因 CORS 无法访问时临时使用。
REM 警告：此模式会关闭 Chrome 的 Web Security，并降低站点隔离能力。
REM 请仅用这个独立 Chrome 窗口打开本工具，不要浏览其他网站，也不要安装未知扩展。

set "APP_PATH=%~dp0index.html"
set "USER_DATA=%~dp0.chrome-profile-compat"
set "PROXY_FILE=%~dp0proxy.txt"

set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if "%CHROME%"=="" (
    echo [错误] 未找到 Chrome 浏览器
    echo 请先安装 Chrome：https://www.google.cn/chrome/
    pause
    exit /b 1
)

set "PROXY="
if exist "%PROXY_FILE%" (
    for /f "usebackq tokens=* delims=" %%L in ("%PROXY_FILE%") do (
        if not defined PROXY if not "%%L"=="" set "PROXY=%%L"
    )
)
set "PROXY_ARG="
if defined PROXY set "PROXY_ARG=--proxy-server=%PROXY%"

echo [警告] 正在启动兼容模式：Chrome Web Security 将被关闭。
echo         这个窗口只能用于本工具，不要访问其他网站。
echo.
if defined PROXY echo 代理: %PROXY%

start "" "%CHROME%" --disable-web-security --disable-features=IsolateOrigins,site-per-process %PROXY_ARG% --user-data-dir="%USER_DATA%" --new-window "file:///%APP_PATH:\=/%"

exit /b 0
