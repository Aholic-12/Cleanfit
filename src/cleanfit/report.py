"""结构化报告导出。

把比例数据、身形分类、版型建议整理成图文报告，可保存、可分享、可对比。
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

from .calibrate import Ratios
from .classify import FitAdvice


def export_report(
    ratios: Ratios,
    advice: FitAdvice,
    out_path: Union[str, Path],
) -> Path:
    """导出图文报告（PDF / PNG）。

    TODO(阶段 3)：先出 PNG（OpenCV 排版），再补 PDF。
    """
    raise NotImplementedError("报告导出尚未实现，见 README 开发路线图 · 阶段 3")
