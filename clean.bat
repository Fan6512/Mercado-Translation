@echo off
chcp 65001 >nul
REM 清理构建产物与 Chrome 运行时缓存
REM 这些文件都被 .gitignore 忽略，不会入库；此脚本仅用于释放本地磁盘空间
set "HERE=%~dp0"
echo 正在清理构建产物与运行时缓存...
rmdir /s /q "%HERE%.chrome-profile" 2>nul
del /q "%HERE%build-log.txt" 2>nul
del /q "%HERE%Translator.msi" 2>nul
del /q "%HERE%pake-translator.exe" 2>nul
rmdir /s /q "%HERE%dist" 2>nul
echo.
echo 完成。已清理（如原本存在）：
echo   .chrome-profile/   build-log.txt   Translator.msi   pake-translator.exe   dist/
echo.
pause
