"""分割层测试：用合成深度图验证「背景剔除 / 噪点清理 / 反投影」。

不依赖 pytest 的 fixture，只用 assert 和 try/except，
这样没有装 pytest 也能直接跑（见文件末尾的 ``__main__``）。
"""

from __future__ import annotations

import numpy as np

from cleanfit.capture import Frame, Intrinsics
from cleanfit.segment import BodyCloud, SegmentConfig, foreground_mask, segment_body

H, W = 120, 160
FX = FY = 500.0
CX, CY = 80.0, 60.0

# "人"的矩形：y0, x0, y1, x1 —— 90 高 40 宽，居中
PERSON = (20, 60, 110, 100)
PERSON_AREA = (PERSON[2] - PERSON[0]) * (PERSON[3] - PERSON[1])
SPECKLES = ((5, 5), (8, 150), (115, 12))


def make_intrinsics() -> Intrinsics:
    return Intrinsics(fx=FX, fy=FY, cx=CX, cy=CY, width=W, height=H)


def make_frame(person_depth: int = 1200, wall_depth: int = 2500) -> Frame:
    """远处墙面 + 近处人形矩形 + 三个孤立噪点。"""
    depth = np.full((H, W), wall_depth, dtype=np.uint16)
    y0, x0, y1, x1 = PERSON
    depth[y0:y1, x0:x1] = person_depth
    for y, x in SPECKLES:
        depth[y, x] = person_depth
    color = np.zeros((H, W, 3), dtype=np.uint8)
    color[..., 1] = 128
    return Frame(depth_mm=depth, color_bgr=color, intrinsics=make_intrinsics())


def test_background_is_excluded() -> None:
    mask = foreground_mask(make_frame().depth_mm)
    assert not mask[0, 0], "左上角是墙面，不该被判为前景"
    assert not mask[H - 1, W - 1], "右下角是墙面，不该被判为前景"
    assert mask[50, 80], "人体中心应当在前景里"


def test_speckles_are_removed() -> None:
    mask = foreground_mask(make_frame().depth_mm)
    for y, x in SPECKLES:
        assert not mask[y, x], f"孤立噪点 ({y},{x}) 应当被开运算去掉"


def test_area_is_close_to_expected() -> None:
    mask = foreground_mask(make_frame().depth_mm)
    area = int(mask.sum())
    # 形态学开闭运算会在四角轻微削圆，允许 ±10%
    assert PERSON_AREA * 0.9 <= area <= PERSON_AREA * 1.1, f"前景面积 {area} 偏离 {PERSON_AREA} 太多"


def test_points_are_back_projected() -> None:
    cloud = segment_body(make_frame())
    assert isinstance(cloud, BodyCloud)
    assert cloud.count > 0
    # 所有点都来自 1200mm 的人体平面
    assert np.allclose(cloud.points[:, 2], 1200.0, atol=1e-3)
    # 人形居中于光轴，平均 x 应当接近 0
    assert abs(float(cloud.points[:, 0].mean())) < 5.0


def test_colors_follow_points() -> None:
    cloud = segment_body(make_frame())
    assert cloud.colors.shape == (cloud.count, 3)


def test_empty_scene_raises() -> None:
    depth = np.zeros((H, W), dtype=np.uint16)
    color = np.zeros((H, W, 3), dtype=np.uint8)
    frame = Frame(depth_mm=depth, color_bgr=color, intrinsics=make_intrinsics())
    try:
        segment_body(frame)
    except ValueError:
        return
    raise AssertionError("全零深度图应当抛 ValueError")


def test_depth_range_too_narrow_raises() -> None:
    config = SegmentConfig(min_depth_mm=100, max_depth_mm=200)
    try:
        segment_body(make_frame(), config)
    except ValueError:
        return
    raise AssertionError("深度范围覆盖不到人体时应当抛 ValueError")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("PASS", name)
    print("全部通过")
