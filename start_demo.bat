@echo off
REM 一键启动：本地精修服务 + 静态站点 + 打开浏览器
cd /d %~dp0

echo [1/3] 启动精修服务（首次加载模型约 5 秒）...
start "Cleanfit Refiner" /min .venv\Scripts\python.exe -m uvicorn tryon_server.server:app --host 127.0.0.1 --port 8787

echo [2/3] 启动静态站点...
start "Cleanfit Demo" /min .venv\Scripts\python.exe -m http.server 8851 --bind 127.0.0.1 --directory demo

echo [3/3] 打开页面...
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:8851/

echo.
echo   页面已打开：http://127.0.0.1:8851/
echo   精修服务：  http://127.0.0.1:8787/health
echo   关闭这两个最小化的窗口即可停止服务。
