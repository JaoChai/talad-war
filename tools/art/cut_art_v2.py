"""Cut the owner-approved A1 'Lantern Night' redesign sheets into Talad War game files.

usage: python -I cut_art_v2.py SRC_DIR OUT_DIR
SRC_DIR holds: cast_<char>.png (2x8 grey #bdbdbd key), idle_<char>.png (1x4 grey key),
props_stalls.png / props_crates_pads.png / props_fx.png (magenta key), arena.png (1920x1080).
Characters -> <char>.webp, a 5x4 grid of 256 px cells (20 frames), feet on a shared baseline,
one scale per character (from the run frames), every character the same body height.
Frame order: idle0-3, run0-5, carry0-3, windup, slap, hurt, ko.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).parent))
from gridcut import grid_frames  # noqa: E402

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
CELL, COLS, ROWS = 256, 5, 4
BASE = 252          # feet baseline (px from cell top)
BODY_H = 228        # target height of the median run frame
CHARS = ["fruit_mangosteen", "fruit_rambutan", "fruit_durian", "fruit_longan",
         "dessert_khanomkrok", "dessert_thongyod", "dessert_lookchup", "dessert_khanomchan"]
ANIMS = {"idle": [0, 4], "run": [4, 6], "carry": [10, 4], "windup": [14, 1],
         "slap": [15, 1], "hurt": [16, 1], "ko": [17, 1]}
FRAME_NAMES = ([f"idle{i}" for i in range(4)] + [f"run{i}" for i in range(6)]
               + [f"carry{i}" for i in range(4)] + ["windup", "slap", "hurt", "ko"])
PROPS = {
    "props_stalls.png": ["stall_fruit_ok", "stall_fruit_damaged", "stall_fruit_destroyed",
                         "stall_dessert_ok", "stall_dessert_damaged", "stall_dessert_destroyed"],
    "props_crates_pads.png": ["crate", "crate_air", "crate_stack2", "pad_fruit", "pad_dessert",
                              "pad_tile_glow", None],
    "props_fx.png": ["bomb", "shot_fruit", "shot_dessert", "explosion", None],
}


def components(path, n, magenta, dil):
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    key = np.array([255, 0, 255] if magenta else [189, 189, 189])
    near = np.sqrt(((a - key) ** 2).sum(-1)) < (90 if magenta else 34)
    lab, _ = ndi.label(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    if magenta:
        bg |= (np.minimum(a[..., 0], a[..., 2]) - a[..., 1]) > 70
    fg = ndi.binary_opening(~bg, iterations=1)
    lab, _ = ndi.label(ndi.binary_dilation(fg, iterations=dil))
    sl = ndi.find_objects(lab)
    area = lambda s: (s[0].stop - s[0].start) * (s[1].stop - s[1].start)
    objs = sorted([(s, i + 1) for i, s in enumerate(sl)], key=lambda t: -area(t[0]))[:n]
    if len(objs) < n:
        raise SystemExit(f"{path}: found {len(objs)} objects, need {n}")
    rows = max(1, round(a.shape[0] / max(o[0][0].stop - o[0][0].start for o in objs) / 1.6))
    ys = sorted(o[0][0].start + (o[0][0].stop - o[0][0].start) / 2 for o in objs)
    gaps = sorted(range(1, len(ys)), key=lambda i: -(ys[i] - ys[i - 1]))[: rows - 1]
    cuts = sorted(ys[i - 1] + (ys[i] - ys[i - 1]) / 2 for i in gaps)
    rowof = lambda s: sum((s[0].start + s[0].stop) / 2 > c for c in cuts)
    objs.sort(key=lambda t: (rowof(t[0]), t[0][1].start))
    rgba = np.dstack([a, fg * 255]).astype(np.uint8)
    res = []
    for s, i in objs:
        c = rgba[s].copy()
        c[..., 3] = ((lab[s] == i) & fg[s]) * 255
        im = Image.fromarray(c)
        res.append(im.crop(im.getbbox()))
    return res


def place(cell_im, scale):
    w, h = cell_im.size
    im = cell_im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    if im.width > CELL - 4 or im.height > BASE - 2:
        k = min((CELL - 4) / im.width, (BASE - 2) / im.height)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.paste(im, ((CELL - im.width) // 2, BASE - im.height), im)
    return cell


manifest = {"cell": CELL, "characters": {}, "props": {}, "arena": {"file": "arena_market.webp", "width": 1920, "height": 1080}}
for ch in CHARS:
    cast = grid_frames(SRC / f"cast_{ch}.png", 2, 8)
    idle = grid_frames(SRC / f"idle_{ch}.png", 1, 4)
    run = cast[2:8]
    scale = BODY_H / float(np.median([f.height for f in run]))
    # Idle frames are normalised on their own (the generated frame 4 is oversized): same body
    # height as the run, plus a gentle breathing squash/stretch.
    frames = [place(f, BODY_H / f.height * (1.0, 0.97, 1.0, 1.02)[k]) for k, f in enumerate(idle)]
    frames += [place(f, scale) for f in run + cast[8:16]]
    sheet = Image.new("RGBA", (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))
    for k, fr in enumerate(frames):
        sheet.paste(fr, ((k % COLS) * CELL, (k // COLS) * CELL))
    sheet.save(OUT / f"{ch}.webp", "WEBP", quality=82, method=6)
    manifest["characters"][ch] = {"file": f"{ch}.webp", "frameWidth": CELL, "frameHeight": CELL,
                                  "frames": FRAME_NAMES, "anims": ANIMS,
                                  "anchor": [0.5, BASE / CELL]}
for sheet_name, names in PROPS.items():
    for name, im in zip(names, components(SRC / sheet_name, len(names), True, 6)):
        if name is None:  # drawn but not used by the game (lantern is painted in the arena; slash stays code-drawn)
            continue
        if max(im.size) > 720:
            k = 720 / max(im.size)
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        im.save(OUT / f"prop_{name}.webp", "WEBP", quality=82, method=6)
        manifest["props"][name] = {"file": f"prop_{name}.webp", "width": im.width, "height": im.height}
Image.open(SRC / "arena.png").convert("RGB").resize((1920, 1080), Image.LANCZOS).save(
    OUT / "arena_market.webp", "WEBP", quality=80, method=6)
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(sum(p.stat().st_size for p in OUT.iterdir()) // 1024, "KiB")
