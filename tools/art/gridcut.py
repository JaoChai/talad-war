"""Grid-cut a grey-key sprite sheet: split rows/cols at background valleys, keep the largest blob per cell."""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def _bands(profile, n):
    """Split a 1-D foreground profile into n bands at the n-1 widest empty valleys."""
    L = len(profile)
    empty = profile == 0
    runs, i = [], 0
    while i < L:
        if empty[i]:
            j = i
            while j < L and empty[j]:
                j += 1
            if i > 0 and j < L:
                runs.append((j - i, (i + j) // 2))
            i = j
        else:
            i += 1
    if len(runs) >= n - 1:
        cuts = sorted(c for _, c in sorted(runs, reverse=True)[: n - 1])
    else:  # frames touch: fall back to an even grid
        cuts = [round(L * k / n) for k in range(1, n)]
    edges = [0] + cuts + [L]
    return list(zip(edges[:-1], edges[1:]))


def grid_frames(path, rows, cols):
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    near = np.sqrt(((a - [189, 189, 189]) ** 2).sum(-1)) < 34
    lab, _ = ndi.label(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = ~np.isin(lab, list(edge))
    fg = ndi.binary_opening(fg, iterations=1)
    rgba = np.dstack([a, fg * 255]).astype(np.uint8)
    out = []
    for y0, y1 in _bands(fg.sum(1), rows):
        band = fg[y0:y1]
        for x0, x1 in _bands(band.sum(0), cols):
            m = fg[y0:y1, x0:x1]
            l, n = ndi.label(ndi.binary_dilation(m, iterations=3))
            if n == 0:
                raise SystemExit(f"{path}: empty cell")
            sizes = ndi.sum(m, l, range(1, n + 1))
            keep = (l == (int(np.argmax(sizes)) + 1)) & m
            c = rgba[y0:y1, x0:x1].copy()
            c[..., 3] = keep * 255
            im = Image.fromarray(c)
            out.append(im.crop(im.getbbox()))
    return out
