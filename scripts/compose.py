"""Puts the original's frames next to the rebuild's and writes a GIF: compose.py <frames dir> <out.gif> <left title> <right title> <unit>"""
import json, sys, subprocess, os, glob
from PIL import Image, ImageDraw, ImageFont

d, out, lt, rt, unit = sys.argv[1:6]
labels = json.load(open(os.path.join(d, "labels.json")))
def font(sz, bold=False):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
BG = (20, 22, 28)
os.makedirs(os.path.join(d, "out"), exist_ok=True)
for L in labels:
    i = L["i"]
    l = Image.open(os.path.join(d, f"l{i:04d}.png")).convert("RGB")
    r = Image.open(os.path.join(d, f"r{i:04d}.png")).convert("RGB")
    W, H = l.width + r.width + 30, l.height + 110
    im = Image.new("RGB", (W, H), BG); dr = ImageDraw.Draw(im)
    dr.text((20, 14), lt, font=font(22, True), fill=(232, 234, 240))
    dr.text((l.width + 30 + 10, 14), rt, font=font(22, True), fill=(255, 122, 69))
    im.paste(l, (0, 50)); im.paste(r, (l.width + 30, 50))
    msg = f"{unit} {i}   " + ("identical ✓" if L["same"] else "DIFFERENT")
    dr.text((20, H - 48), msg, font=font(24, True), fill=(120, 220, 140) if L["same"] else (255, 90, 90))
    if L.get("extra"):  # optional second caption line, e.g. what was compared
        dr.text((20, H - 18), L["extra"], font=font(14), fill=(139, 147, 167))
    dr.text((W - 330, H - 44), "rea-game", font=font(18), fill=(139, 147, 167))
    im.save(os.path.join(d, "out", f"f{i:04d}.png"))
frames = os.path.join(d, "out", "f%04d.png")
pal = os.path.join(d, "pal.png")
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
fps = os.environ.get("FPS", "8")
W = os.environ.get("WIDTH", "900")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", fps, "-i", frames, "-vf", f"scale={W}:trunc(ih*{W}/iw/2)*2:flags=lanczos,palettegen=max_colors=96", pal], check=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", fps, "-i", frames, "-i", pal, "-lavfi", f"scale={W}:trunc(ih*{W}/iw/2)*2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4", out], check=True)
print(os.path.getsize(out) // 1024, "KB")
