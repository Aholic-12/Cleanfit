"""静态虚拟试穿。

上传单件衣服平面图 → 按测量出的身形比例做形变贴合 → 输出正面试穿图。
只做照片级静态效果，不涉及布料仿真与实时渲染 —— 这是有意的设计边界。
"""

from __future__ import annotations

import numpy as np

from .calibrate import Ratios


def render_tryon(garment_bgr: np.ndarray, ratios: Ratios) -> np.ndarray:
    """把平铺的衣服图变形贴合到身形比例上，返回 BGR 图。

    TODO(阶段 3)：先按肩宽 / 衣长做仿射对齐，再用薄板样条做局部形变。
    """
    raise NotImplementedError("虚拟试穿尚未实现，见 README 开发路线图 · 阶段 3")
