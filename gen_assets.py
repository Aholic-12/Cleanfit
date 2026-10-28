# -*- coding: utf-8 -*-
"""生成 Cleanfit README 所需的全部本地 SVG 素材（零外链）。"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
os.makedirs(OUT, exist_ok=True)

FONT = "'Segoe UI','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif"

PALETTE = {
    "ink": "#0E0E17",
    "ink2": "#1A1A2E",
    "violet": "#6C63FF",
    "amber": "#FFB400",
    "coral": "#FF6B6B",
    "mint": "#00C853",
    "teal": "#0FA3B1",
    "blue": "#3776AB",
}


def write(name, svg):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    print("written:", name, len(svg), "bytes")


# ---------------------------------------------------------------- header
def header(dark: bool) -> str:
    if dark:
        bg1, bg2 = "#0B0B12", "#191926"
        fg, sub, faint = "#FFFFFF", "#A9A9C4", "#2A2A3E"
        ruler = "#6C63FF"
    else:
        bg1, bg2 = "#FFFFFF", "#F6F4FF"
        fg, sub, faint = "#0E0E17", "#5A5A72", "#DCDAF0"
        ruler = "#6C63FF"

    W, H = 1200, 320

    # 底部量尺刻度
    ticks = []
    x = 0
    i = 0
    while x <= W:
        tall = (i % 5 == 0)
        y1 = H - (16 if tall else 8)
        ticks.append(
            f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{H}" stroke="{ruler}" '
            f'stroke-opacity="{0.45 if tall else 0.22}" stroke-width="1"/>'
        )
        x += 20
        i += 1
    ticks_svg = "\n    ".join(ticks)

    # 右侧人体测量示意（比例轴 + 特征线）
    cx = 940
    rows = [
        (78, 26, "HEAD"),
        (128, 132, "SHOULDER"),
        (196, 74, "WAIST"),
        (244, 108, "HIP"),
    ]
    marks = []
    for y, w, label in rows:
        marks.append(
            f'<line x1="{cx - w/2}" y1="{y}" x2="{cx + w/2}" y2="{y}" stroke="{ruler}" '
            f'stroke-opacity="0.55" stroke-width="2" stroke-linecap="round"/>'
        )
        marks.append(f'<circle cx="{cx - w/2}" cy="{y}" r="3.2" fill="{PALETTE["amber"]}"/>')
        marks.append(f'<circle cx="{cx + w/2}" cy="{y}" r="3.2" fill="{PALETTE["amber"]}"/>')
        marks.append(
            f'<text x="{cx + w/2 + 12}" y="{y}" dy="3.4" font-family="{FONT}" font-size="9" '
            f'font-weight="700" letter-spacing="1.6" fill="{ruler}" fill-opacity="0.75">{label}</text>'
        )
    marks_svg = "\n    ".join(marks)

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Cleanfit — 深度视觉人体身形测量与版型适配">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{bg1}"/>
      <stop offset="100%" stop-color="{bg2}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="{PALETTE['violet']}"/>
      <stop offset="55%" stop-color="{PALETTE['amber']}"/>
      <stop offset="100%" stop-color="{PALETTE['coral']}"/>
    </linearGradient>
  </defs>

  <rect width="{W}" height="{H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="{W}" height="4" fill="url(#accent)"/>
  <rect x="0" y="{H-2}" width="{W}" height="2" fill="{ruler}" fill-opacity="0.10"/>

  <!-- 顶部小标签 -->
  <text x="72" y="86" font-family="{FONT}" font-size="13" font-weight="700"
        letter-spacing="5" fill="{PALETTE['amber']}">DEEP VISION FITTING SYSTEM</text>

  <!-- 主标题 -->
  <text x="70" y="176" font-family="{FONT}" font-size="92" font-weight="800"
        letter-spacing="-1" fill="{fg}">Cleanfit<tspan fill="{PALETTE['violet']}">.</tspan></text>

  <!-- 中文副标题 -->
  <text x="74" y="222" font-family="{FONT}" font-size="25" font-weight="600"
        fill="{fg}" fill-opacity="0.88">深度视觉 · 人体身形测量与版型适配</text>

  <!-- 英文说明 -->
  <text x="74" y="258" font-family="{FONT}" font-size="14" font-weight="500"
        letter-spacing="2.6" fill="{sub}">MEASURE PRECISELY — DRESS WITH CONFIDENCE</text>

  <!-- 右侧测量示意 -->
  <g opacity="0.95">
    <line x1="{cx}" y1="58" x2="{cx}" y2="268" stroke="{ruler}" stroke-opacity="0.30"
          stroke-width="1.5" stroke-dasharray="5 6"/>
    {marks_svg}
  </g>

  <!-- 底部量尺 -->
  <g>
    {ticks_svg}
  </g>
</svg>
'''


write("header-dark.svg", header(True))
write("header-light.svg", header(False))


# ---------------------------------------------------------------- footer
def footer(dark: bool) -> str:
    bg = "#0B0B12" if dark else "#FFFFFF"
    fg = "#FFFFFF" if dark else "#0E0E17"
    sub = "#8E8EAA" if dark else "#6B6B84"
    W, H = 1200, 130
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Cleanfit footer">
  <defs>
    <linearGradient id="facc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="{PALETTE['violet']}"/>
      <stop offset="55%" stop-color="{PALETTE['amber']}"/>
      <stop offset="100%" stop-color="{PALETTE['coral']}"/>
    </linearGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="{bg}"/>
  <rect x="0" y="0" width="{W}" height="3" fill="url(#facc)"/>
  <text x="{W/2}" y="56" text-anchor="middle" font-family="{FONT}" font-size="15"
        font-weight="700" letter-spacing="1.5" fill="{fg}">Cleanfit · 精准测量，穿对版型</text>
  <text x="{W/2}" y="84" text-anchor="middle" font-family="{FONT}" font-size="12.5"
        letter-spacing="1" fill="{sub}">Built with precision and purpose · Made with ♥ by Aholic-12</text>
  <line x1="470" y1="104" x2="730" y2="104" stroke="{PALETTE['violet']}"
        stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="6 7"/>
</svg>
'''


write("footer-dark.svg", footer(True))
write("footer-light.svg", footer(False))


# ---------------------------------------------------------------- divider
def divider():
    W, H = 1200, 26
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="divider">
  <line x1="0" y1="13" x2="540" y2="13" stroke="{PALETTE['violet']}" stroke-opacity="0.30" stroke-width="1.5" stroke-dasharray="7 8"/>
  <line x1="660" y1="13" x2="1200" y2="13" stroke="{PALETTE['violet']}" stroke-opacity="0.30" stroke-width="1.5" stroke-dasharray="7 8"/>
  <circle cx="600" cy="13" r="4" fill="{PALETTE['amber']}"/>
  <circle cx="576" cy="13" r="2" fill="{PALETTE['violet']}" fill-opacity="0.6"/>
  <circle cx="624" cy="13" r="2" fill="{PALETTE['violet']}" fill-opacity="0.6"/>
</svg>
'''


write("divider.svg", divider())


# ---------------------------------------------------------------- badges
def text_width(s: str, size: float = 12.5) -> float:
    total = 0.0
    for ch in s:
        if ord(ch) > 0x2E80:          # CJK / 全角
            total += size * 1.02
        elif ch.isupper():
            total += size * 0.66
        elif ch.isdigit():
            total += size * 0.60
        elif ch in " .·:":
            total += size * 0.30
        elif ch in "ilj":
            total += size * 0.30
        elif ch in "mwMW":
            total += size * 0.86
        elif ch in "-+":
            total += size * 0.46
        else:
            total += size * 0.55
    return total


def badge(label: str, bg: str, fg: str = "#FFFFFF", size: float = 12.5) -> str:
    h = 28
    pad = 15
    w = round(text_width(label, size) + pad * 2)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{label}">
  <title>{label}</title>
  <rect width="{w}" height="{h}" rx="{h/2}" fill="{bg}"/>
  <text x="{w/2}" y="{h/2}" dy="4.2" text-anchor="middle" font-family="{FONT}"
        font-size="{size}" font-weight="600" fill="{fg}">{label}</text>
</svg>
'''


badges = [
    ("badge-status.svg", "In Development", PALETTE["amber"], PALETTE["ink2"]),
    ("badge-python.svg", "Python 3.8+", PALETTE["blue"], "#FFFFFF"),
    ("badge-license.svg", "License MIT", PALETTE["violet"], "#FFFFFF"),
    ("badge-prs.svg", "PRs Welcome", PALETTE["mint"], "#FFFFFF"),
    ("badge-open3d.svg", "Open3D 0.17+", PALETTE["ink2"], "#FFFFFF"),
    ("badge-astra.svg", "Astra SDK", PALETTE["teal"], "#FFFFFF"),
    ("badge-camera.svg", "深度相机 1.2m", PALETTE["coral"], "#FFFFFF"),
    ("badge-github.svg", "GitHub · Aholic-12", "#181717", "#FFFFFF"),
]

for name, label, bg, fg in badges:
    write(name, badge(label, bg, fg))

print("\nALL DONE ->", OUT)
