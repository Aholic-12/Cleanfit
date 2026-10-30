#!/usr/bin/env python3
"""Cleanfit · Pose Mirror 本地预览服务。

浏览器的摄像头 API 只在安全上下文下可用：https 或 http://localhost。
直接双击 index.html（file://）拿不到摄像头，也会被 CORS 拦住 wasm。
所以用这个脚本起一个本地静态服务。

    python serve.py          # 默认 http://127.0.0.1:8848
    python serve.py 9000     # 指定端口
"""
import http.server
import mimetypes
import os
import sys
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

# MediaPipe 的运行时文件需要正确的 MIME，否则 instantiateStreaming 会失败
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".data")
mimetypes.add_type("application/octet-stream", ".binarypb")
mimetypes.add_type("application/octet-stream", ".tflite")
mimetypes.add_type("text/javascript", ".js")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # 静音，避免刷屏
        pass


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8848
    url = f"http://127.0.0.1:{port}/"
    print("Cleanfit · Pose Mirror")
    print(f"  目录 : {ROOT}")
    print(f"  地址 : {url}")
    print(f"  演示 : {url}?demo=1   （无摄像头也能看效果）")
    print("  Ctrl+C 停止")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
