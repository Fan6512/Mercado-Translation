@echo off
chcp 65001 >nul
set "APP_PATH=%~dp0index.html"
set "USER_DATA=%~dp0.chrome-profile"

set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if "%CHROME%"=="" (
    echo [ERROR] Chrome not found. Please install: https://www.google.cn/chrome/
    pause
    exit /b 1
)

start "" "%CHROME%" --disable-web-security --disable-features=IsolateOrigins,site-per-process --user-data-dir="%USER_DATA%" --new-window "file:///%APP_PATH:\=/%"

exit /b 0
