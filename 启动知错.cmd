@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.13 或更新版本。
  pause
  exit /b 1
)
if not exist "node_modules" (
  call npm install
  if errorlevel 1 goto failed
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 goto failed
)
call npm start
pause
exit /b
:failed
echo 启动未完成，请查看上面的提示。
pause
