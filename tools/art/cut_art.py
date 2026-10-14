"""Cut approved Talad War concept sheets into game atlases (WebP + JSON manifest).

usage: python -I cut_art.py SRC_DIR OUT_DIR
Characters: grey #bdbdbd key, 4 poses per sheet -> 4 x 256px cells, shared scale per character, feet on baseline.
Props: magenta key, objects found by dilated connected components, each trimmed into its own WebP.
Arena: resized to 1920x1080 WebP.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
CELL = 256
POSES = ["idle", "run", "carry", "hurt"]
CHARS = ["fruit_mangosteen", "fruit_rambutan", "fruit_durian", "fruit_longan",
         "dessert_khanomkrok", "dessert_thongyod", "dessert_lookchup", "dessert_khanomchan"]
PROPS = [  # row-major order expected on props.png
    "crate", "crate_air", "crate_stack2",
    "stall_fruit_ok", "stall_fruit_damaged", "stall_fruit_destroyed",
    "stall_dessert_ok", "stall_dessert_damaged", "stall_dessert_destroyed",
    "pad_fruit", "pad_dessert", "pad_tile_glow",
    "shot_fruit", "shot_dessert", "bomb", "explosion",
]


def key_alpha(rgb, key, tol=28, pocket_tol=None):
    """Alpha from background connected to the border, plus large neutral enclosed pockets."""
    d = np.sqrt(((rgb.astype(np.float32) - np.array(key, np.float32)) ** 2).sum(-1))
    near = d <= tol
    lab, _ = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    chroma = rgb.max(-1).astype(np.int16) - rgb.min(-1).astype(np.int16)
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        if sl is None or i in border:
            continue
        m = lab[sl] == i
        neutral = chroma[sl][m].mean() <= 4 and d[sl][m].mean() <= 10
        keyish = pocket_tol is not None and d[sl][m].mean() <= pocket_tol
        if (neutral and m.sum() >= 150) or (keyish and m.sum() >= 40):
            bg[sl] |= m
    a = np.where(bg, 0, 255).astype(np.uint8)
    a[ndi.binary_opening(a > 0, iterations=1) == 0] = 0  # drop 1px specks
    return a


def despill(rgba, key):
    """Pull key-coloured fringe on semi-edge pixels toward neighbours: desaturate pixels next to transparency."""
    a = rgba[..., 3] > 0
    rim = a & ~ndi.binary_erosion(a, iterations=1)
    rgb = rgba[..., :3].astype(np.int16)
    k = np.array(key, np.int16)
    close = np.abs(rgb - k).sum(-1) < 90
    rgba[rim & close, 3] = 0
    return rgba


def magenta_clean(rgba):
    """Drop key-tinted pixels: magenta shadows and violet/pink glow halos (g far below r and b)."""
    rgb = rgba[..., :3].astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    tint = (np.minimum(r, b) - g > 70) & (np.abs(r - b) < 110)
    rgba[tint, 3] = 0
    keep = ndi.binary_opening(rgba[..., 3] > 0, iterations=1)
    rgba[~keep, 3] = 0
    return rgba


def tidy_alpha(img, max_hole=120, min_speck=30):
    """After resizing: binarise alpha, fill small enclosed holes, drop tiny floating specks."""
    a = np.array(img)
    solid = a[..., 3] >= 128
    hl, hn = ndi.label(ndi.binary_fill_holes(solid) & ~solid)
    if hn:
        sizes = ndi.sum(np.ones_like(solid), hl, range(1, hn + 1))
        small = np.isin(hl, [i + 1 for i, s in enumerate(sizes) if s <= max_hole])
        a[small, :3] = ndi.grey_dilation(a[..., :3], size=(3, 3, 1))[small]
        solid |= small
    sl, sn = ndi.label(solid)
    if sn:
        sizes = ndi.sum(solid, sl, range(1, sn + 1))
        solid &= ~np.isin(sl, [i + 1 for i, s in enumerate(sizes) if s < min_speck])
    a[..., 3] = np.where(solid, 255, 0)
    return Image.fromarray(a, "RGBA")


def objects(alpha, dilate, min_area):
    lab, _ = ndi.label(ndi.binary_dilation(alpha > 0, iterations=dilate))
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        m = (lab[sl] == i) & (alpha[sl] > 0)
        if m.sum() >= min_area:
            out.append((sl, i))
    return lab, out


def crop_obj(rgba, lab, sl, i):
    piece = rgba[sl].copy()
    piece[..., 3] = np.where(lab[sl] == i, piece[..., 3], 0)
    ys, xs = np.nonzero(piece[..., 3])
    return piece[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


manifest = {"cell": CELL, "characters": {}, "props": {}, "arena": None}
report = []

for name in CHARS:
    im = np.array(Image.open(SRC / f"{name}.png").convert("RGB"))
    rgba = np.dstack([im, key_alpha(im, (0xBD, 0xBD, 0xBD))])
    rgba = despill(rgba, (0xBD, 0xBD, 0xBD))
    lab, objs = objects(rgba[..., 3], dilate=6, min_area=4000)
    objs.sort(key=lambda o: o[0][1].start)
    if len(objs) != 4:
        sys.exit(f"{name}: found {len(objs)} poses, expected 4")
    pieces = [crop_obj(rgba, lab, sl, i) for sl, i in objs]
    scale = (CELL - 8) / max(max(p.shape[0], p.shape[1]) for p in pieces)  # one scale per character
    sheet = Image.new("RGBA", (CELL * 4, CELL), (0, 0, 0, 0))
    for k, p in enumerate(pieces):
        img = Image.fromarray(p, "RGBA")
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
        x = k * CELL + (CELL - img.width) // 2
        y = CELL - 4 - img.height  # feet on a shared baseline
        sheet.alpha_composite(img, (x, y))
    sheet = tidy_alpha(sheet)
    f = OUT / f"{name}.webp"
    sheet.save(f, "WEBP", quality=82, method=6)
    manifest["characters"][name] = {"file": f.name, "frameWidth": CELL, "frameHeight": CELL,
                                    "frames": POSES, "anchor": [0.5, (CELL - 4) / CELL]}
    report.append((f.name, f.stat().st_size))

im = np.array(Image.open(SRC / "props.png").convert("RGB"))
rgba = despill(np.dstack([im, key_alpha(im, (255, 0, 255), tol=60, pocket_tol=60)]), (255, 0, 255))
lab, objs = objects(rgba[..., 3], dilate=int(__import__("os").environ.get("PD", "4")), min_area=1500)
if len(objs) != len(PROPS):
    sys.exit(f"props: found {len(objs)} objects, expected {len(PROPS)}: "
             + str([(o[0][0].start, o[0][1].start) for o in objs]))
cy = [(o[0][0].start + o[0][0].stop) / 2 for o in objs]
rows, order = [], sorted(range(len(objs)), key=lambda j: cy[j])
for j in order:  # cluster into rows by centre y
    if rows and abs(cy[j] - np.mean([cy[r] for r in rows[-1]])) < 90:
        rows[-1].append(j)
    else:
        rows.append([j])
flat = [j for r in rows for j in sorted(r, key=lambda j: objs[j][0][1].start)]
for name, j in zip(PROPS, flat):
    p = crop_obj(rgba, lab, *objs[j])
    if not name.startswith("stall_dessert"):  # dessert stalls have intentional magenta stools
        p = magenta_clean(p)
        if name == "pad_tile_glow":  # yellow glow: any blue-leaning pixel is key bleed
            q = p[..., :3].astype(np.int16)
            p[(q[..., 2] > q[..., 1]) & (q[..., 0] - q[..., 1] > 40), 3] = 0
        ys, xs = np.nonzero(p[..., 3])
        p = p[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    img = Image.fromarray(p, "RGBA")
    limit = 512 if name.startswith(("stall", "pad")) else 256
    img.thumbnail((limit, limit), Image.LANCZOS)
    f = OUT / f"prop_{name}.webp"
    img.save(f, "WEBP", quality=85, method=6)
    manifest["props"][name] = {"file": f.name, "width": img.width, "height": img.height}
    report.append((f.name, f.stat().st_size))

arena = Image.open(SRC / "arena_floor.png").convert("RGB").resize((1920, 1080), Image.LANCZOS)
f = OUT / "arena_market.webp"
arena.save(f, "WEBP", quality=80, method=6)
manifest["arena"] = {"file": f.name, "width": 1920, "height": 1080}
report.append((f.name, f.stat().st_size))

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
total = sum(s for _, s in report)
for n, s in report:
    print(f"{s:>8} {n}")
print(f"TOTAL {total} bytes ({total / 1048576:.2f} MiB)")
