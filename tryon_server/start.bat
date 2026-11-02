@echo off
cd /d %~dp0..
.venv\Scripts\python.exe -m uvicorn tryon_server.server:app --host 127.0.0.1 --port 8787
