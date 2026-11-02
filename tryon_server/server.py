"""
Cleanfit 本地 GPU 试衣精修服务

思路：浏览器里的网格变形已经解决了「位置对不对」，但它本质是把一张商品图贴上去，
布料的褶皱、明暗、和身体的关系都是假的。这里用 SD1.5-inpainting 对**已经贴好的
躯干区域**做一次局部重绘：模型看得见人物、姿势、光线和衣服的颜色花纹，能把这块
区域重新画成「穿在身上的衣服」。

浏览器端拿到重绘结果后做一次逆变换，把它烘焙成新的衣服贴图，实时追踪继续由
canvas 管线负责 —— 所以是「AI 精修一次 + 本地实时跟人」，不是每帧都过 GPU。

启动：
    .venv/Scripts/python.exe -m uvicorn tryon_server.server:app --port 8787
"""

import io
import os
import threading
import time

import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image

MODEL_DIR = os.environ.get("SD_DIR", r"D:/Cleanfit/.models/sd15-inpaint")
MAX_SIDE = int(os.environ.get("MAX_SIDE", "768"))

app = FastAPI(title="Cleanfit Try-On Refiner")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    # 不暴露的话浏览器读不到 X-Elapsed，界面上就显示不出耗时
    expose_headers=["X-Elapsed", "X-Size"],
)

_pipe = None
_lock = threading.Lock()


def get_pipe():
    """懒加载：第一次请求时才把 4GB 权重读进显存，避免服务启动就卡住。"""
    global _pipe
    if _pipe is not None:
        return _pipe
    with _lock:
        if _pipe is None:
            from diffusers import StableDiffusionInpaintPipeline

            if not os.path.isdir(MODEL_DIR):
                raise FileNotFoundError(f"权重目录不存在：{MODEL_DIR}")

            # 用本地 diffusers 目录直接加载：from_single_file 会去 HuggingFace
            # 拉 original config，而这台机器上 HF 是被挡住的（406）。
            pipe = StableDiffusionInpaintPipeline.from_pretrained(
                MODEL_DIR,
                torch_dtype=torch.float16,
                variant="fp16",
                safety_checker=None,
                feature_extractor=None,
                requires_safety_checker=False,
            )
            pipe.to("cuda")
            pipe.set_progress_bar_config(disable=True)
            # 12G 显存跑 768 够用，但开两个 slice 更稳
            try:
                pipe.enable_vae_slicing()
                pipe.enable_attention_slicing()
            except Exception:
                pass
            _pipe = pipe
    return _pipe


def _fit_size(w, h, max_side):
    """等比缩放到 max_side 以内，并保证是 8 的倍数（UNet 下采样要求）。"""
    scale = min(1.0, max_side / max(w, h))
    nw = max(64, int(round(w * scale / 8)) * 8)
    nh = max(64, int(round(h * scale / 8)) * 8)
    return nw, nh


DEFAULT_PROMPT = (
    "a person wearing a t-shirt, realistic fabric, natural folds and wrinkles, "
    "soft studio lighting, photorealistic, high detail, 8k"
)
DEFAULT_NEG = (
    "cartoon, illustration, painting, 3d render, blurry, low quality, deformed, "
    "extra limbs, watermark, text, sticker, flat cutout"
)


@app.get("/health")
def health():
    info = {"ok": True, "loaded": _pipe is not None, "model": MODEL_DIR}
    try:
        info["cuda"] = torch.cuda.is_available()
        info["device"] = torch.cuda.get_device_name(0) if info["cuda"] else "cpu"
    except Exception as e:  # pragma: no cover
        info["cuda"] = False
        info["error"] = str(e)
    return info


@app.post("/warmup")
def warmup():
    t0 = time.time()
    get_pipe()
    return {"ok": True, "seconds": round(time.time() - t0, 2)}


@app.post("/refine")
async def refine(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    strength: float = Form(0.45),
    steps: int = Form(22),
    seed: int = Form(-1),
    prompt: str = Form(""),
    negative: str = Form(""),
):
    t0 = time.time()
    pipe = get_pipe()

    img = Image.open(io.BytesIO(await image.read())).convert("RGB")
    msk = Image.open(io.BytesIO(await mask.read())).convert("L")

    nw, nh = _fit_size(img.width, img.height, MAX_SIDE)
    img = img.resize((nw, nh), Image.LANCZOS)
    msk = msk.resize((nw, nh), Image.LANCZOS)

    gen = None
    if seed is not None and seed >= 0:
        gen = torch.Generator(device="cuda").manual_seed(int(seed))

    out = pipe(
        prompt=prompt.strip() or DEFAULT_PROMPT,
        negative_prompt=negative.strip() or DEFAULT_NEG,
        image=img,
        mask_image=msk,
        strength=float(max(0.05, min(0.95, strength))),
        num_inference_steps=int(max(4, min(50, steps))),
        guidance_scale=7.0,
        generator=gen,
    ).images[0]

    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={
            "X-Elapsed": f"{time.time() - t0:.2f}",
            "X-Size": f"{nw}x{nh}",
        },
    )


@app.exception_handler(Exception)
async def on_error(request, exc):  # pragma: no cover
    return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, status_code=500)
