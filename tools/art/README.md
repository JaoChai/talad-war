# Art pipeline (Task 7)

Owner-approved concept sheets (2026-10-14) are cut into game files under `apps/client/public/art/`.

- `cut_art.py SRC OUT` — character pose sheets (grey `#bdbdbd` key) become one 1024x256 WebP strip per character
  (frames `idle, run, carry, hurt`, 256 px cells, one scale per character, feet on a shared baseline, anchor in
  `manifest.json`); the props sheet (magenta key) becomes one trimmed WebP per prop; the arena becomes 1920x1080 WebP.
  Run with `PD=5` (prop separation dilation, tuned for the approved props sheet).
- `contact.py OUT` — QA contact sheets on solid blue plus per-frame pixel stats.
- Sources (not committed, 2+ MB each): `~/Code/team-buddies-art-staging/task7-w1/props.png`, `task7-w2/*.png`.
- Needs Python with numpy, scipy, pillow (WebP).

Budget: all of `public/art` <= 3 MB (currently ~0.93 MB).

Known art notes for Task 8: the crate drawn in the `carry` frames varies per character; draw `prop_crate.webp` over
the carry frame if a uniform crate is wanted. `fruit_longan` and `dessert_khanomchan` are the buddy units — scale them
down (about 0.75) in game.
