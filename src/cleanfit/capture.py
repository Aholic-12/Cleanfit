"""深度相机采集层。

把奥比中光 Astra Mini Pro 的深度帧与彩色帧对齐到同一坐标系，输出相机内参。
这是唯一直接接触硬件的模块，上层只依赖 :class:`Frame`，不依赖 SDK ——
换相机时只需要改这一个文件。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass(frozen=True)
class Intrinsics:
    """相机内参，单位像素。"""

    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int

    def __post_init__(self) -> None:
        if self.fx <= 0 or self.fy <= 0:
            raise ValueError("焦距必须为正数")


@dataclass(frozen=True)
class Frame:
    """一帧对齐后的深度 + 彩色数据。"""

    depth_mm: np.ndarray  # (H, W) uint16，单位毫米
    color_bgr: np.ndarray  # (H, W, 3) uint8
    intrinsics: Intrinsics
    timestamp_ns: Optional[int] = None


def capture_frame(device_index: int = 0) -> Frame:
    """抓取一帧，并把深度图对齐到彩色图坐标系。

    TODO(阶段 2)：接入 Astra SDK，完成 depth-to-color 对齐与掉帧重试。
    """
    raise NotImplementedError("采集层尚未实现，见 README 开发路线图 · 阶段 2")
