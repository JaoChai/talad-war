"""List enclosed transparent holes and small opaque specks per character frame. usage: python -I holes.py OUT_DIR"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

OUT = Path(sys.argv[1])
m = json.loads((OUT / "manifest.json").read_text())
cell = m["cell"]
for name, c in m["characters"].items():
    rgba = np.array(Image.open(OUT / c["file"]).convert("RGBA"))
    for k, pose in enumerate(c["frames"]):
        f = rgba[:, k * cell:(k + 1) * cell, 3] > 0
        hl, hn = ndi.label(ndi.binary_fill_holes(f) & ~f)
        hs = sorted((int(s) for s in ndi.sum(np.ones_like(f), hl, range(1, hn + 1))), reverse=True) if hn else []
        sl, sn = ndi.label(f)
        ss = sorted((int(s) for s in ndi.sum(f, sl, range(1, sn + 1))), reverse=True) if sn else []
        print(f"{name:20} {pose:6} holes={hs[:8]} n={hn} specks<30={sum(1 for s in ss if s < 30)} pieces={ss[:4]}")
