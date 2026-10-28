# -*- coding: utf-8 -*-
"""把 README.md 转成一个 GitHub 风格的本地预览页（离线可用，无外部依赖）。"""
import html
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "README.md")
DST = os.path.join(BASE, "preview.html")

BLOCK_START = ("<", "|", "#", "```", ">")


def inline(s: str) -> str:
    codes = []

    def stash(m):
        codes.append(m.group(1))
        return f"\x00{len(codes)-1}\x00"

    s = re.sub(r"`([^`]+)`", stash, s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\*\w])\*([^\*]+)\*(?!\*)", r"<em>\1</em>", s)
    s = re.sub(r"~~(.+?)~~", r"<del>\1</del>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)

    def unstash(m):
        return "<code>" + html.escape(codes[int(m.group(1))]) + "</code>"

    return re.sub(r"\x00(\d+)\x00", unstash, s)


def split_row(line: str):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def render_table(rows):
    header = split_row(rows[0])
    aligns = []
    body_rows = rows[1:]
    if len(rows) > 1 and re.fullmatch(r"[\s\|:\-]+", rows[1]):
        for c in split_row(rows[1]):
            c = c.strip()
            if c.startswith(":") and c.endswith(":"):
                aligns.append("center")
            elif c.endswith(":"):
                aligns.append("right")
            else:
                aligns.append("left")
        body_rows = rows[2:]

    has_header = any(c for c in header)
    out = ["<table>"]
    if has_header:
        out.append("<thead><tr>")
        for idx, c in enumerate(header):
            al = aligns[idx] if idx < len(aligns) else "left"
            out.append(f'<th align="{al}">{inline(c)}</th>')
        out.append("</tr></thead>")
    out.append("<tbody>")
    for r in body_rows:
        cells = split_row(r)
        out.append("<tr>")
        for idx, c in enumerate(cells):
            al = aligns[idx] if idx < len(aligns) else "left"
            out.append(f'<td align="{al}">{inline(c)}</td>')
        out.append("</tr>")
    out.append("</tbody></table>")
    return "\n".join(out)


def convert(md: str) -> str:
    lines = md.split("\n")
    out = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]

        if line.startswith("```"):
            lang = line[3:].strip()
            i += 1
            buf = []
            while i < n and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            code = html.escape("\n".join(buf))
            if lang == "mermaid":
                out.append(
                    '<div class="mmd-hint">▼ GitHub 会把这个代码块渲染成交互式图表（Mermaid），'
                    "此处预览仅显示源码</div>"
                    f'<pre class="mmd"><code>{code}</code></pre>'
                )
            else:
                out.append(f'<pre><code class="language-{lang}">{code}</code></pre>')
            continue

        if not line.strip():
            i += 1
            continue

        if line.lstrip().startswith("|"):
            rows = []
            while i < n and lines[i].lstrip().startswith("|"):
                rows.append(lines[i])
                i += 1
            out.append(render_table(rows))
            continue

        if line.lstrip().startswith("<"):
            buf = []
            while i < n and lines[i].strip() != "":
                buf.append(lines[i])
                i += 1
            out.append("\n".join(buf))
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue

        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", line.strip()):
            out.append("<hr/>")
            i += 1
            continue

        if line.lstrip().startswith(">"):
            buf = []
            while i < n and lines[i].lstrip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            out.append("<blockquote>" + "<br/>".join(inline(b) for b in buf) + "</blockquote>")
            continue

        if re.match(r"^\s*([-*+]|\d+\.)\s+", line):
            ordered = bool(re.match(r"^\s*\d+\.", line))
            buf = []
            while i < n and re.match(r"^\s*([-*+]|\d+\.)\s+", lines[i]):
                buf.append(re.sub(r"^\s*([-*+]|\d+\.)\s+", "", lines[i]))
                i += 1
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>" + "".join(f"<li>{inline(b)}</li>" for b in buf) + f"</{tag}>")
            continue

        buf = []
        while (
            i < n
            and lines[i].strip()
            and not lines[i].lstrip().startswith(BLOCK_START)
            and not re.fullmatch(r"(-{3,}|\*{3,})", lines[i].strip())
        ):
            buf.append(lines[i].strip())
            i += 1
        out.append("<p>" + inline(" ".join(buf)) + "</p>")

    return "\n".join(out)


CSS = """
:root{
  color-scheme:dark;
  --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --border:#30363d; --border-muted:#21262d;
  --code-bg:rgba(110,118,129,.4); --pre-bg:#161b22; --row-bg:#161b22; --link:#4493f8;
  --kbd-bg:#161b22; --kbd-shadow:#3d444d;
}
[data-theme="light"]{
  color-scheme:light;
  --bg:#ffffff; --fg:#1f2328; --muted:#59636e; --border:#d1d9e0; --border-muted:#eff2f5;
  --code-bg:rgba(175,184,193,.2); --pre-bg:#f6f8fa; --row-bg:#f6f8fa; --link:#0969da;
  --kbd-bg:#f6f8fa; --kbd-shadow:#d1d9e0;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--fg);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans",Helvetica,Arial,sans-serif;
  font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:980px; margin:0 auto; padding:32px 24px 80px}
.markdown-body > *:first-child{margin-top:0 !important}
h1,h2,h3,h4{font-weight:600; line-height:1.25; margin:28px 0 16px}
h1{font-size:2em; border-bottom:1px solid var(--border); padding-bottom:.3em}
h2{font-size:1.5em; border-bottom:1px solid var(--border); padding-bottom:.3em}
h3{font-size:1.15em}
h4{font-size:1em}
p{margin:0 0 16px}
a{color:var(--link); text-decoration:none}
a:hover{text-decoration:underline}
img{max-width:100%; height:auto; border-style:none}
hr{height:1px; border:0; background:var(--border); margin:28px 0}
code{
  font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  font-size:85%; background:var(--code-bg); padding:.2em .4em; border-radius:6px;
}
pre{background:var(--pre-bg); padding:16px; border-radius:6px; overflow:auto; margin:0 0 16px; line-height:1.45}
pre code{background:none; padding:0; font-size:85%; white-space:pre}
pre.mmd{border:1px dashed var(--border)}
.mmd-hint{font-size:12px; color:var(--muted); margin-bottom:6px}
blockquote{
  margin:0 0 16px; padding:0 1em; color:var(--muted);
  border-left:.25em solid var(--border);
}
blockquote p{margin:0}
table{border-collapse:collapse; border-spacing:0; margin:0 0 16px; display:block; width:max-content; max-width:100%; overflow:auto}
table[width="100%"]{display:table; width:100%}
.pic-only{display:block}
[data-theme="dark"] .pic-light{display:none}
[data-theme="light"] .pic-dark{display:none}
table th,table td{border:1px solid var(--border); padding:6px 13px}
table th{font-weight:600; background:var(--pre-bg)}
table tr:nth-child(2n){background:var(--row-bg)}
ul,ol{margin:0 0 16px; padding-left:2em}
li+li{margin-top:.25em}
details{margin:0 0 16px}
summary{cursor:pointer; font-weight:600}
details[open] summary{margin-bottom:8px}
kbd{
  display:inline-block; padding:3px 6px; font-size:11px; line-height:11px; font-weight:600;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color:var(--fg); background:var(--kbd-bg); border:1px solid var(--border);
  border-radius:6px; box-shadow:inset 0 -1px 0 var(--kbd-shadow);
}
/* 让 align / valign 这类 GitHub 会保留的属性在本地也生效 */
div[align="center"],p[align="center"],h1[align="center"],h2[align="center"],h3[align="center"]{text-align:center}
div[align="center"] > table{margin-left:auto; margin-right:auto}
table[align="center"]{margin-left:auto; margin-right:auto}
th[align="center"],td[align="center"]{text-align:center}
th[align="right"],td[align="right"]{text-align:right}
th[align="left"],td[align="left"]{text-align:left}
td[valign="top"],th[valign="top"]{vertical-align:top}
sub{font-size:.75em; color:var(--muted)}
/* 悬浮主题切换 */
#toggle{
  position:fixed; right:22px; bottom:22px; z-index:9; cursor:pointer;
  padding:9px 15px; border-radius:999px; border:1px solid var(--border);
  background:var(--pre-bg); color:var(--fg); font-size:13px; font-weight:600;
  box-shadow:0 4px 16px rgba(0,0,0,.28);
}
"""

JS = """
const btn=document.getElementById('toggle');
btn.addEventListener('click',()=>{
  const cur=document.documentElement.getAttribute('data-theme');
  const next=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  btn.textContent = next==='dark' ? '☀ 切换浅色' : '🌙 切换深色';
});
"""


PIC_RE = re.compile(r"<picture>(.*?)</picture>", re.S)


def fix_picture(text: str) -> str:
    """把 <picture> 换成随预览主题切换的两个 <img>，行为与 GitHub 一致。"""

    def repl(m):
        inner = m.group(1)
        dark = re.search(r'media="\(prefers-color-scheme:\s*dark\)"\s*srcset="([^"]+)"', inner)
        light = re.search(r'media="\(prefers-color-scheme:\s*light\)"\s*srcset="([^"]+)"', inner)
        img = re.search(r"<img[^>]*>", inner)
        wattr = ""
        if img:
            w = re.search(r'width="([^"]+)"', img.group(0))
            if w:
                wattr = f' width="{w.group(1)}"'
        d = dark.group(1) if dark else (light.group(1) if light else "")
        l = light.group(1) if light else d
        return (
            f'<span class="pic-only pic-dark"><img src="{d}"{wattr}></span>'
            f'<span class="pic-only pic-light"><img src="{l}"{wattr}></span>'
        )

    return PIC_RE.sub(repl, text)


def main():
    with open(SRC, encoding="utf-8") as f:
        md = f.read()
    body = fix_picture(convert(md))
    page = f"""<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cleanfit · README 预览</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<article class="markdown-body">
{body}
</article>
</div>
<button id="toggle">☀ 切换浅色</button>
<script>{JS}</script>
</body>
</html>
"""
    with open(DST, "w", encoding="utf-8") as f:
        f.write(page)
    print("preview ->", DST, len(page), "bytes")


if __name__ == "__main__":
    main()
