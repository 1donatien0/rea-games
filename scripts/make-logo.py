"""Writes the rea-game brand SVGs: a pixel dino with a faint twin (the original and its rebuild) and the wordmark.
Needs fontTools (pip install fonttools) and Inter ExtraBold. Usage: python3 scripts/make-logo.py"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
ORANGE, CREAM, INK = "#E2560F", "#F6EBDD", "#1F1209"

DINO = [
    "..............XXXXXXX.",
    ".............XXXXXXXXX",
    ".............XX.XXXXXX",
    ".............XXXXXXXXX",
    ".............XXXXXXXXX",
    ".............XXXXXX...",
    ".............XXXXXXXX.",
    "X............XXXX.....",
    "X...........XXXXX.....",
    "XX.........XXXXXXXXX..",
    "XXX.......XXXXXXXXXXXX",
    "XXXXX....XXXXXXXXXXXX.",
    ".XXXXXXXXXXXXXXXXXXX..",
    "..XXXXXXXXXXXXXXXXX...",
    "...XXXXXXXXXXXXXXX....",
    "....XXXXXXXXXXXXX.....",
    ".....XXXX....XXXX.....",
    ".....XXX.....XXX......",
    ".....XXXX....XXXX.....",
]

def pixels(cell, fill, dx=0, dy=0, opacity=None):
    rects = []
    for y, row in enumerate(DINO):
        x = 0
        while x < len(row):
            if row[x] == "X":
                x0 = x
                while x < len(row) and row[x] == "X":
                    x += 1
                rects.append(f'<rect x="{dx + x0 * cell:g}" y="{dy + y * cell:g}" width="{(x - x0) * cell:g}" height="{cell:g}"/>')
            else:
                x += 1
    op = f' opacity="{opacity}"' if opacity else ""
    return f'<g fill="{fill}"{op} shape-rendering="crispEdges">' + "".join(rects) + "</g>"

def text_path(s, size, spacing, x, y, dot_x_out=None):
    f = TTFont(FONT); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm
    k = size / upm; cx = x; out = []
    for ch in s:
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs)
        g.draw(TransformPen(pen, (k, 0, 0, -k, cx, y)))
        out.append((ch, pen.getCommands()))
        cx += g.width * k + spacing
    return out, cx

def wordmark(text_color, dot_color, x=136, y=84):
    glyphs, end = text_path("rea-game", 64, -2.4, x, y)
    dot, end2 = text_path(".", 64, 0, end, y)
    body = "".join(f'<path d="{d}"/>' for _, d in glyphs)
    return f'<g fill="{text_color}">{body}</g><g fill="{dot_color}"><path d="{dot[0][1]}"/></g>', end2

def logo(text_color):
    mark = pixels(4.2, ORANGE, 14, 22, None)
    ghost = pixels(4.2, ORANGE, 14 + 8, 22 + 8, 0.3)
    wm, end = wordmark(text_color, ORANGE)
    w = round(end + 18)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 128" fill="none" role="img" aria-label="rea-game">'
            f'{ghost}{mark}{wm}</svg>\n')

def tile():
    cell = 15.5; w = 22 * cell; h = len(DINO) * cell
    ox = (512 - w) / 2 - 14; oy = (512 - h) / 2 - 12
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="rea-game: a pixel dino and its twin">'
            f'<rect width="512" height="512" rx="112" fill="{ORANGE}"/>'
            + pixels(cell, "#7A2A05", ox + 26, oy + 26, 0.55) + pixels(cell, CREAM, ox, oy) + '</svg>\n')

open("docs/brand/logo-dark.svg", "w").write(logo(CREAM))   # for dark backgrounds
open("docs/brand/logo-light.svg", "w").write(logo(INK))    # for light backgrounds
open("docs/assets/logo.svg", "w").write(tile())
print("wrote docs/brand/logo-dark.svg, docs/brand/logo-light.svg, docs/assets/logo.svg")
