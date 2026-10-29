"""① 人体点云分割与去噪。

从深度帧里把人体从衣物边缘、头发、地面、背景中分离出来，只保留躯干与四肢。
这一层是整个系统的最大误差来源：边缘残留会直接把测量结果带偏。

实现说明：本版只依赖 numpy，不引入 OpenCV —— 目的是让阶段 1 能在
合成数据上先跑通、先测准，等真实场景数据进来再换 `cv2.connectedComponents`
和形态学加速（接口不变）。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .capture import Frame


@dataclass(frozen=True)
class BodyCloud:
    """分割后的人体点云，相机坐标系，单位毫米。

    坐标约定：x 向右、y 向下、z 向前（即相机光轴方向），与图像坐标系一致。
    """

    points: np.ndarray  # (N, 3) float32
    colors: np.ndarray  # (N, 3) uint8，BGR；无彩色时为空数组

    @property
    def count(self) -> int:
        return int(self.points.shape[0])


@dataclass(frozen=True)
class SegmentConfig:
    """分割参数。默认值对应 README 限定的拍摄条件（1.2m ± 0.1m）。"""

    min_depth_mm: int = 600
    max_depth_mm: int = 2000
    open_radius: int = 2  # 开运算：先腐蚀后膨胀，去掉孤立噪点
    close_radius: int = 2  # 闭运算：先膨胀后腐蚀，补衣物边缘的小洞
    min_area_ratio: float = 0.01  # 连通域至少要占画面的这个比例
    keep_largest: bool = True  # 只保留最大连通域（画面里只有一个人）


DEFAULT_CONFIG = SegmentConfig()


# --------------------------------------------------------------------- 形态学
def _shift(mask: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """把掩码整体平移 (dy, dx)，空出来的地方补 False（不回绕）。"""
    h, w = mask.shape
    out = np.zeros_like(mask)
    src_y0, src_y1 = max(0, -dy), min(h, h - dy)
    src_x0, src_x1 = max(0, -dx), min(w, w - dx)
    if src_y0 >= src_y1 or src_x0 >= src_x1:
        return out
    dst_y0, dst_y1 = src_y0 + dy, src_y1 + dy
    dst_x0, dst_x1 = src_x0 + dx, src_x1 + dx
    out[dst_y0:dst_y1, dst_x0:dst_x1] = mask[src_y0:src_y1, src_x0:src_x1]
    return out


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """方形核膨胀。"""
    if radius <= 0:
        return mask.copy()
    out = mask.copy()
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            out |= _shift(mask, dy, dx)
    return out


def _erode(mask: np.ndarray, radius: int) -> np.ndarray:
    """方形核腐蚀。"""
    if radius <= 0:
        return mask.copy()
    out = mask.copy()
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            out &= _shift(mask, dy, dx)
    return out


# --------------------------------------------------------------------- 连通域
def _label_components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """四邻域连通域标记，返回 (标签图, 连通域数量)。

    用显式栈做深度优先遍历，避免递归爆栈。
    TODO: 真实分辨率下换成 cv2.connectedComponents 提速。
    """
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    total = 0
    ys, xs = np.nonzero(mask)
    for start_y, start_x in zip(ys.tolist(), xs.tolist()):
        if labels[start_y, start_x]:
            continue
        total += 1
        labels[start_y, start_x] = total
        stack = [(start_y, start_x)]
        while stack:
            y, x = stack.pop()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = total
                    stack.append((ny, nx))
    return labels, total


def _largest_component(mask: np.ndarray) -> np.ndarray:
    """只保留面积最大的连通域。"""
    labels, total = _label_components(mask)
    if total <= 1:
        return mask
    areas = np.bincount(labels.ravel())
    areas[0] = 0  # 背景不算
    return labels == int(areas.argmax())


# --------------------------------------------------------------------- 主流程
def foreground_mask(depth_mm: np.ndarray, config: SegmentConfig = DEFAULT_CONFIG) -> np.ndarray:
    """按深度范围 + 形态学 + 连通域，得到人体前景掩码。"""
    if depth_mm.ndim != 2:
        raise ValueError("深度图必须是二维数组")

    valid = (depth_mm > 0) & (depth_mm >= config.min_depth_mm) & (depth_mm <= config.max_depth_mm)
    if not valid.any():
        raise ValueError(
            f"深度图中没有落在 [{config.min_depth_mm}, {config.max_depth_mm}] mm 内的有效像素，"
            "请检查拍摄距离或放宽 SegmentConfig 的深度范围"
        )

    mask = _erode(valid, config.open_radius)  # 开运算：腐蚀
    mask = _dilate(mask, config.open_radius)  # 开运算：膨胀
    mask = _dilate(mask, config.close_radius)  # 闭运算：膨胀
    mask = _erode(mask, config.close_radius)  # 闭运算：腐蚀

    if config.keep_largest:
        mask = _largest_component(mask)

    min_area = int(mask.size * config.min_area_ratio)
    if mask.sum() < min_area:
        raise ValueError(f"前景面积 {int(mask.sum())} 像素，小于下限 {min_area} 像素，可能是空场景")

    return mask


def segment_body(frame: Frame, config: SegmentConfig = DEFAULT_CONFIG) -> BodyCloud:
    """去掉地面、背景与衣物边缘噪声，只留人体轮廓，并反投影成三维点云。"""
    depth = frame.depth_mm
    mask = foreground_mask(depth, config)

    vs, us = np.nonzero(mask)
    z = depth[vs, us].astype(np.float32)

    intr = frame.intrinsics
    x = (us.astype(np.float32) - intr.cx) * z / intr.fx
    y = (vs.astype(np.float32) - intr.cy) * z / intr.fy
    points = np.stack([x, y, z], axis=1).astype(np.float32)

    colors = np.empty((0, 3), dtype=np.uint8)
    if frame.color_bgr is not None and frame.color_bgr.shape[:2] == depth.shape:
        colors = frame.color_bgr[vs, us].astype(np.uint8)

    return BodyCloud(points=points, colors=colors)
