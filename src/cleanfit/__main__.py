"""命令行入口：``python -m cleanfit``。"""

from __future__ import annotations

import argparse
from typing import List, Optional

from . import __version__


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="cleanfit",
        description="基于深度视觉的人体身形测量与版型适配",
    )
    parser.add_argument(
        "-V",
        "--version",
        action="version",
        version=f"cleanfit {__version__}",
    )
    parser.parse_args(argv)

    print("Cleanfit 尚在开发中，测量流程见 README 开发路线图。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
