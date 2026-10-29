"""冒烟测试：保证包能导入、公开契约没被破坏。

算法层尚未实现，这里只测「不该坏的东西」——
数据结构定义、枚举成员、版本号。真正的精度测试等阶段 1 数据就位后再补。
"""

from __future__ import annotations

import cleanfit
from cleanfit.calibrate import Ratios
from cleanfit.classify import BodyShape, FitAdvice


def test_version_exists() -> None:
    assert isinstance(cleanfit.__version__, str)
    assert cleanfit.__version__


def test_body_shape_members() -> None:
    assert {s.value for s in BodyShape} == {"倒三角", "H 型", "梨型", "苹果型"}


def test_ratios_serialisation() -> None:
    r = Ratios(
        height_mm=1750.0,
        head_to_body=7.42,
        shoulder_to_height=0.2531,
        waist_to_hip=0.8123,
    )
    assert r.as_dict() == {
        "height_mm": 1750.0,
        "head_to_body": 7.42,
        "shoulder_to_height": 0.253,
        "waist_to_hip": 0.812,
    }


def test_fit_advice_defaults_are_independent() -> None:
    a = FitAdvice(shape=BodyShape.H_SHAPE, reason="肩胯接近")
    b = FitAdvice(shape=BodyShape.PEAR, reason="胯宽大于肩宽")
    a.tops.append("合身衬衫")
    assert b.tops == []
