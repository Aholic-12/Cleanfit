"""④ 身形分类与版型匹配。

比例 → 身形 → 版型，每一句建议都能追溯到具体数据，不做黑箱推荐。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List

from .calibrate import Ratios


class BodyShape(Enum):
    """四种标准身形。"""

    INVERTED_TRIANGLE = "倒三角"
    H_SHAPE = "H 型"
    PEAR = "梨型"
    APPLE = "苹果型"


@dataclass(frozen=True)
class FitAdvice:
    """一条可解释的版型建议。"""

    shape: BodyShape
    reason: str  # 为什么判成这个身形，要能对应到具体比例
    tops: List[str] = field(default_factory=list)
    bottoms: List[str] = field(default_factory=list)
    avoid: List[str] = field(default_factory=list)


def classify(ratios: Ratios) -> FitAdvice:
    """按比例判身形，并给出上衣 / 下装的版型建议。

    TODO(阶段 3)：用标注数据集拟合各身形的比例区间，避免硬编码阈值。
    """
    raise NotImplementedError("分类引擎尚未实现，见 README 开发路线图 · 阶段 3")
