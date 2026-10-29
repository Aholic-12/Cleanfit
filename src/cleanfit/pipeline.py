"""把四层算法串成一条流水线。

采集 → 分割 → 定位 → 校正 → 分类，一次调用跑完。
"""

from __future__ import annotations

from dataclasses import dataclass

from .calibrate import Ratios, compute_ratios
from .capture import Frame
from .classify import FitAdvice, classify
from .landmark import locate_landmarks
from .segment import segment_body


@dataclass(frozen=True)
class Measurement:
    """一次完整测量的结果。"""

    ratios: Ratios
    advice: FitAdvice


def run(frame: Frame) -> Measurement:
    """跑完整条流水线。"""
    cloud = segment_body(frame)
    marks = locate_landmarks(cloud)
    ratios = compute_ratios(marks, frame.intrinsics)
    advice = classify(ratios)
    return Measurement(ratios=ratios, advice=advice)
