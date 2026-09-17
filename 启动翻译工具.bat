@echo off
chcp 65001 >nul
REM 跨境电商翻译工具 - 安全启动器
REM 默认保留 Chrome 同源/CORS 安全机制，不再全局关闭 Web Security。
REM 若同目录存在 proxy.txt，会自动把首行内容作为 Chrome 代理（--proxy-server）。
REM 如目标 API 不支持浏览器 CORS，请优先使用桌面版；确需旧行为时使用“启动翻译工具(兼容模式).bat”。

set "APP_PATH=%~dp0index.html"
set "USER_DATA=%~dp0.chrome-profile"
set "PROXY_FILE=%~dp0proxy.txt"

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

REM 读取 proxy.txt 第一行非空内容（如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080）
set "PROXY="
if exist "%PROXY_FILE%" (
    for /f "usebackq tokens=* delims=" %%L in ("%PROXY_FILE%") do (
        if not defined PROXY if not "%%L"=="" set "PROXY=%%L"
    )
)
set "PROXY_ARG="
if defined PROXY set "PROXY_ARG=--proxy-server=%PROXY%"

echo 正在以安全模式启动跨境电商翻译工具...
echo Chrome 路径: %CHROME%
echo 应用路径:   %APP_PATH%
if defined PROXY (
    echo 代理:        %PROXY%
) else (
    echo 代理:        未启用（如需代理，把地址写入 proxy.txt）
)
echo.
echo 提示: 当前启动器不会关闭 Chrome 的同源/CORS 安全机制。
echo       若 API 因 CORS 无法直接访问，请优先使用桌面版，或配置支持 CORS 的中转服务。
echo       仅在确认风险后才使用“启动翻译工具(兼容模式).bat”。

start "" "%CHROME%" %PROXY_ARG% --user-data-dir="%USER_DATA%" --new-window "file:///%APP_PATH:\=/%"

exit /b 0
