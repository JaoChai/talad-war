# Art pipeline — A1 Lantern Night

Owner-approved redesign (2026-10-16), replacing the original four-pose strips.
Game-ready files live in `apps/client/public/art/`; do not repaint them in a frontend card.

## Current cutter

- `python -I tools/art/cut_art_v2.py SRC_DIR OUT_DIR` (numpy, scipy, Pillow/WebP required).
- Sources (not committed): `/home/jaochai/Code/team-buddies-art-staging/redesign-2026-10-16/src/`.
  `cast_<character>.png` is a 2x8 grey-key sheet; `idle_<character>.png` is a 1x4 grey-key sheet.
  Props use magenta-key sheets `props_stalls.png`, `props_crates_pads.png`, `props_fx.png`;
  `arena.png` is the approved 1920x1080 open-floor market.
- `gridcut.py` splits character sheets at background valleys and retains the largest component per cell.
- Character output: 1280x1024 WebP, **5 columns x 4 rows of 256px cells**. The first 18 cells are
  `idle0-3`, `run0-5`, `carry0-3`, `windup`, `slap`, `hurt`, `ko`; cells 19–20 are empty.
  Feet baseline: 252px, anchor `[0.5, 252/256]`; all characters face right and share normalised body height.
  Carry poses have empty raised hands: the client supplies the carried crate.
- Manifest `anims` values are `[firstFrame, count]`. The client plays idle at 6fps, run at 12fps,
  carry at 10fps, and holds the four single-frame poses. Prop dimensions in the manifest are authoritative;
  preserve their aspect ratios at display size.
- Approved output: `/home/jaochai/Code/team-buddies-art-staging/redesign-2026-10-16/out/` (26 files).
  Copy `out_extra_bg_letterbox.webp` from its parent as `bg_letterbox.webp` (27th file).
- Approved target: `/home/jaochai/Code/team-buddies-art-staging/redesign-2026-10-16/mock_v1b.png`.

Budget: all of `public/art` <= 3 MB. New exact `du -sb apps/client/public/art`: **2497698 bytes** (27 files including letterbox; before: 767667 bytes).

## Retained tools

- `cut_art.py`: historical four-frame-strip cutter; do not use for A1.
- `compose_arena.py FLOOR OBSTACLES OUT`: paints obstacle props on sim `OBSTACLES` over the open
  40x24 floor. A1 uses the already-approved `src/arena.png`; do not recompose on a frontend card.
- `contact.py OUT`: QA contact sheets and pixel stats (historical strip layout).

The old buddy-scale 0.75 note and baked-in carried crates do not apply to A1.
