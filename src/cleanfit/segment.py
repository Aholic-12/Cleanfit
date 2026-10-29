"""① 人体点云分割与去噪。

从深度帧里把人体从衣物边缘、头发、地面、背景中分离出来，只保留躯干与四肢。
这一层是整个系统的最大误差来源：边缘残留会直接把测量结果带偏。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .capture import Frame


@dataclass(frozen=True)
class BodyCloud:
    """分割后的人体点云，相机坐标系，单位毫米。"""

    points: np.ndarray  # (N, 3) float32
    colors: np.ndarray  # (N, 3) uint8，无彩色时为空数组

    @property
    def count(self) -> int:
        return int(self.points.shape[0])


def segment_body(frame: Frame) -> BodyCloud:
    """去掉地面、背景与衣物边缘噪声，只留人体轮廓。

    TODO(阶段 1)：在 Human3.6M / SMPL 合成深度上验证「深度阈值 + 连通域 + 形态学」流程。
    """
    raise NotImplementedError("分割层尚未实现，见 README 开发路线图 · 阶段 1")
