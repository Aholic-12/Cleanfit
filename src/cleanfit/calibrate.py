"""③ 透视与距离校正。

结合相机内参与深度信息，把像素尺度换算成真实毫米尺度，
并修正不同拍摄距离、微小俯仰造成的比例畸变。
目标是 1.2m ± 0.1m 内测量结果保持稳定。
"""

from __future__ import annotations

from dataclasses import dataclass

from .capture import Intrinsics
from .landmark import Landmarks


@dataclass(frozen=True)
class Ratios:
    """三大核心比例，均为无量纲量。"""

    height_mm: float
    head_to_body: float  # 头身比 = 身高 / 头高
    shoulder_to_height: float  # 肩宽 / 身高
    waist_to_hip: float  # 腰臀比（参考项，误差上限 7%）

    def as_dict(self) -> dict:
        return {
            "height_mm": round(self.height_mm, 1),
            "head_to_body": round(self.head_to_body, 3),
            "shoulder_to_height": round(self.shoulder_to_height, 3),
            "waist_to_hip": round(self.waist_to_hip, 3),
        }


def compute_ratios(landmarks: Landmarks, intrinsics: Intrinsics) -> Ratios:
    """把特征点换算成真实比例。

    TODO(阶段 2)：反投影 + 俯仰角补偿。深度相机已给几何真值，
    这里主要处理相机俯仰与镜头畸变带来的残余偏差。
    """
    raise NotImplementedError("比例计算尚未实现，见 README 开发路线图 · 阶段 2")
