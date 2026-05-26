@echo off
chcp 65001 >nul
REM 跨境电商翻译工具 - 一键启动器
REM 自动打开独立 Chrome 实例（关闭跨域检查）并加载本工具

set "APP_PATH=%~dp0index.html"
set "USER_DATA=%~dp0.chrome-profile"

REM 尝试常见 Chrome 安装路径
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

echo 正在启动跨境电商翻译工具...
echo Chrome 路径: %CHROME%
echo 应用路径:   %APP_PATH%
echo.
echo 提示: 这个 Chrome 实例已关闭跨域限制，仅用于本工具，不要拿它访问其他网站。

start "" "%CHROME%" ^
    --disable-web-security ^
    --disable-features=IsolateOrigins,site-per-process ^
    --user-data-dir="%USER_DATA%" ^
    --new-window ^
    "file:///%APP_PATH:\=/%"

exit /b 0
