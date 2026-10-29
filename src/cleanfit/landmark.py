"""② 骨性特征点定位。

只认骨性标志 —— 头顶、左右肩峰、腰最细处、左右臀峰、脚底，
不认脂肪轮廓与衣物褶皱。这是「限定场景深耕精度」的技术前提。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .segment import BodyCloud


@dataclass(frozen=True)
class Landmarks:
    """关键点坐标，相机坐标系，单位毫米。左右以被摄者自身为准。"""

    head_top: np.ndarray
    shoulder_left: np.ndarray
    shoulder_right: np.ndarray
    waist: np.ndarray
    hip_left: np.ndarray
    hip_right: np.ndarray
    foot: np.ndarray

    def shoulder_width(self) -> float:
        """左右肩峰直线距离。"""
        return float(np.linalg.norm(self.shoulder_right - self.shoulder_left))

    def hip_width(self) -> float:
        """左右臀峰直线距离。"""
        return float(np.linalg.norm(self.hip_right - self.hip_left))

    def height(self) -> float:
        """头顶到脚底的垂直距离。"""
        return float(abs(self.head_top[1] - self.foot[1]))


def locate_landmarks(cloud: BodyCloud) -> Landmarks:
    """在人体点云上自动定位七个骨性锚点。

    TODO(阶段 1)：先做横向切片宽度曲线（肩 / 腰 / 臀的极值点），
    再用局部曲率约束剔除衣物造成的伪极值。
    """
    raise NotImplementedError("特征点定位尚未实现，见 README 开发路线图 · 阶段 1")
