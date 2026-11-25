"""Writes the rea-game brand SVGs: a pixel gamepad with a faint twin (the original and its rebuild) and the wordmark.
Needs fontTools (pip install fonttools) and Inter ExtraBold. Usage: python3 scripts/make-logo.py"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
ORANGE, CREAM, INK = "#E2560F", "#F6EBDD", "#1F1209"

ICON = [
    "...XXXXXX........XXXXXX...",
    "..XXXXXXXXXXXXXXXXXXXXXX..",
    ".XXXXXKKXXXXXXXXXXXXGGXXX.",
    "XXXXXXKKXXXXXXXXXXXXGGXXXX",
    "XXXXKKKKKKXXXXXXXXPPXXRRXX",
    "XXXXKKKKKKXXXXXXXXPPXXRRXX",
    "XXXXXXKKXXXXXXXXXXXXBBXXXX",
    "XXXXXXKKXXXSSXXXSSXXBBXXXX",
    "XXXXXXXXXXSSSSXSSSSXXXXXXX",
    "XXXXXXXXXXSSSSXSSSSXXXXXXX",
    "XXXXXXXXXXXSSXXXSSXXXXXXXX",
    "XXXXXXX............XXXXXXX",
    ".XXXXXX............XXXXXX.",
    "..XXXX..............XXXX..",
]

PALETTE = {
    "X": "#F6EBDD",
    "K": "#1F1209",
    "S": "#3A2A20",
    "G": "#2BB673",
    "R": "#E8434B",
    "B": "#3F7BF2",
    "P": "#E879B9",
}

def pixels(cell, fill, dx=0, dy=0, opacity=None, swap=None):
    """One group per color. fill=None paints each pixel from PALETTE (with swap overrides); a color paints them all (the twin)."""
    pal = {**PALETTE, **(swap or {})}
    groups = {}
    for y, row in enumerate(ICON):
        x = 0
        while x < len(row):
            ch = row[x]
            if ch == ".":
                x += 1
                continue
            color = fill or pal[ch]
            x0 = x
            while x < len(row) and row[x] != "." and (fill or pal[row[x]]) == color:
                x += 1
            groups.setdefault(color, []).append(
                f'<rect x="{dx + x0 * cell:g}" y="{dy + y * cell:g}" width="{(x - x0) * cell:g}" height="{cell:g}"/>')
    op = f' opacity="{opacity}"' if opacity else ""
    return "".join(f'<g fill="{c}"{op} shape-rendering="crispEdges">' + "".join(r) + "</g>" for c, r in groups.items())

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

ON_DARK = {}
ON_LIGHT = {"X": ORANGE}

def logo(text_color, swap):
    mark = pixels(3.7, None, 12, 36, None, swap)
    ghost = pixels(3.7, ORANGE, 12 + 5, 36 + 5, 0.35)
    wm, end = wordmark(text_color, ORANGE)
    w = round(end + 18)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 128" fill="none" role="img" aria-label="rea-game">'
            f'{ghost}{mark}{wm}</svg>\n')

def tile():
    cell = 16; w = len(ICON[0]) * cell; h = len(ICON) * cell
    ox = (512 - w) / 2 - 6; oy = (512 - h) / 2 - 6
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="rea-game: a pixel gamepad and its twin">'
            f'<rect width="512" height="512" rx="112" fill="{ORANGE}"/>'
            + pixels(cell, "#7A2A05", ox + 12, oy + 12, 0.55) + pixels(cell, None, ox, oy) + '</svg>\n')

open("docs/brand/logo-dark.svg", "w").write(logo(CREAM, ON_DARK))   # for dark backgrounds
open("docs/brand/logo-light.svg", "w").write(logo(INK, ON_LIGHT))    # for light backgrounds
open("docs/assets/logo.svg", "w").write(tile())
print("wrote docs/brand/logo-dark.svg, docs/brand/logo-light.svg, docs/assets/logo.svg")
