"""Contact sheets + pixel measurements for cut atlases. usage: python -I contact.py OUT_DIR"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

OUT = Path(sys.argv[1])
m = json.loads((OUT / "manifest.json").read_text())
BG = (46, 127, 224)  # saturated blue shows halos / holes

# characters: 8 rows x 4 cells
cell = m["cell"]
sheet = Image.new("RGB", (cell * 4, cell * 8), BG)
for r, (name, c) in enumerate(m["characters"].items()):
    im = Image.open(OUT / c["file"]).convert("RGBA")
    sheet.paste(im, (0, r * cell), im)
    a = np.array(im)[..., 3]
    for k, pose in enumerate(c["frames"]):
        f = a[:, k * cell:(k + 1) * cell] > 0
        lab, n = ndi.label(f)
        sizes = ndi.sum(f, lab, range(1, n + 1)) if n else []
        holes = int((ndi.binary_fill_holes(f) & ~f).sum())
        edge = int(f[0].sum() + f[:, 0].sum() + f[:, -1].sum())
        print(f"{name:20} {pose:6} opaque={int(f.sum()):6} comps={n} big={sum(1 for s in sizes if s > 30)} holes={holes} edgepx={edge}")
sheet.save(OUT.parent / "contact_chars.png")

# props grid with labels
names = list(m["props"])
W, H = 300, 300
grid = Image.new("RGB", (W * 4, (H + 24) * ((len(names) + 3) // 4)), BG)
d = ImageDraw.Draw(grid)
for i, n in enumerate(names):
    im = Image.open(OUT / m["props"][n]["file"]).convert("RGBA")
    im.thumbnail((W - 10, H - 10))
    x, y = (i % 4) * W, (i // 4) * (H + 24)
    grid.paste(im, (x + 5, y + 5), im)
    d.text((x + 6, y + H + 4), n, fill=(255, 255, 255))
    a = np.array(Image.open(OUT / m["props"][n]["file"]).convert("RGBA"))[..., 3] > 0
    lab, k = ndi.label(a)
    sizes = sorted(ndi.sum(a, lab, range(1, k + 1)), reverse=True) if k else []
    print(f"prop {n:24} size={a.shape[1]}x{a.shape[0]} comps>30={sum(1 for s in sizes if s > 30)} largest={int(sizes[0]) if sizes else 0}")
grid.save(OUT.parent / "contact_props.png")
