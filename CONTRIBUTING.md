# 参与贡献

感谢你愿意一起打磨 Cleanfit。这个项目走「小而准」的路线，**精度优先于功能数量** ——
提 PR 前请先确认改动是让核心测量更稳、更准，而不是加更多场景。

## 环境搭建

```bash
git clone https://github.com/Aholic-12/Cleanfit.git
cd Cleanfit

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -e ".[dev]"          # 安装项目 + 开发依赖
```

奥比中光 Astra SDK 不在 PyPI 上，需从官网下载安装。**不装 SDK 也能开发算法层** ——
只要不进 `capture` 层，其余模块可以用离线数据跑。

## 分支与提交

分支命名：

```
feature/xxx     新功能
fix/xxx         修 bug
docs/xxx        文档
refactor/xxx    重构
```

提交信息用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat(landmark): 用切片宽度曲线定位肩峰
fix(calibrate): 修正俯仰角补偿的符号错误
docs: 补充硬件选型说明
```

一个提交只做一件事，不要混入无关的格式化改动。

## 代码风格

- 行宽 100，`ruff` 统一格式与检查
- 全部模块加 `from __future__ import annotations`，兼容 Python 3.8
- 类型标注尽量写全，尤其是跨层的数据结构
- 中文注释，术语保留英文原词

提交前跑一遍：

```bash
ruff check .
pytest
```

## PR 检查项

- [ ] `ruff check .` 通过
- [ ] `pytest` 通过
- [ ] 新增算法有对应测试，或说明为什么暂时没法测
- [ ] 涉及精度改动的，附上改动前后的误差对比数据
- [ ] 更新了相关文档（README / 模块 docstring）

## 报告问题

用 [Issue 模板](https://github.com/Aholic-12/Cleanfit/issues/new/choose) 提交，
bug 报告请务必写清**运行环境**（系统 / Python 版本 / Open3D 版本 / 相机型号）和**复现步骤**。
测量类问题最好附上原始深度图，否则很难定位。
