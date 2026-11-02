#!/usr/bin/env bash
# 启动本地试衣精修服务（Windows / Git Bash）
cd "$(dirname "$0")/.." || exit 1
exec .venv/Scripts/python.exe -m uvicorn tryon_server.server:app --host 127.0.0.1 --port 8787
