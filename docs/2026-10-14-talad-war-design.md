# Talad War (working title) — Design v1

Status: draft for owner (Marci) approval · 2026-10-14
Reference art: `../style-samples/A_market.png` (style direction only, not final art)
Decision ledger: `../style-samples/ledger.md`

## 1. Intent

A modern browser game inspired by **Team Buddies** (PS1, 2000): teams race to grab crates that fall
from the sky, carry them home, and stack them on a pad; the shape of the stack decides what you get
(a gun, a bomb, a new teammate). We keep that loop — the part reviewers and fans loved — and fix
what reviewers hated: confusing crate placement, "what am I building?", awkward camera, dumb AI
teammates, boring single-player.

New skin: **Thai night-market war**. Team Fruit (mangosteen, rambutan, …) vs Team Thai Dessert
(khanom krok, thong yod, …). Crates are wooden fruit crates; bases are market stalls.

Why now / success: the owner wants a fresh game with a distinct Thai identity that people open from
a link on their phone and immediately get. Version 1 exists to answer one question fast:
**is the core loop fun?** Success = the owner plays a full match on a phone, understands the crate
recipes without anyone explaining them, and wants to press "Play again".

## 2. Decisions made by the owner

| # | Decision |
|---|----------|
| Q1 | v1 is **local play vs bots** on your own device. Online comes later and must reuse the same game rules (shared simulation), not a rewrite. |
| Q2/Q3 | Theme/style **A: Thai night market**, fruit team vs Thai-dessert team, glossy 2D cartoon, thick outlines, cel shading. |
| Q4 | **Mobile-first**; desktop keyboard + mouse also supported. Mobile: left virtual joystick to move; right side big buttons **Pick/Drop crate** and **Fire** with auto-aim at nearest enemy. Desktop: WASD move, mouse aim + click fire. |
| Q5 | **Win = destroy the enemy team's stall (base).** |
| Q6 | Teammates are **bots acting on their own** plus 3 squad command buttons: **Attack**, **Guard stall**, **Fetch crates**. No character switching. |
| Q7 | v1 is a **short standalone match**: open link → play, no sign-up/login, results screen + **Play again**. Unlocks, stats, accounts come later together with online. |
| Q8 | **Crate placement = the cell you stand on.** Standing on an empty pad cell drops the crate on the ground layer; standing on a cell that already holds a crate stacks it on top. While carrying near the pad, the target cell glows and the pad shows the recipe preview. Empty-handed Pick/Drop on a pad cell **takes the top crate back out** (undo a mistake). Opening is a separate **"Open!"** button that appears only when the pad holds a valid recipe. |
| Q9 | **Loadout = 2 slots: 1 gun + 1 bomb stack.** Fire button shoots the gun; a **Throw** button appears next to it only while you hold bombs, showing the count. **Dying loses everything**: you respawn empty-handed (default slap), so crate fighting stays central all match. |
| Stack | Everything on **Cloudflare**. |

Owner accepted (did not object to) these proposals from Monday:
- Match length target **5–8 minutes**.
- v1 scope: **1 map, 2 teams, 3 characters per team** (player + 2 bot teammates vs 3 bot enemies).
- v1 crate recipes (3): **1 crate = gun**, **2 crates side by side = bomb**, **2+ crates stacked vertically = new teammate**.
- **Ghost preview** on the pad: while arranging, the pad shows what the current arrangement will produce ("this will make: Bomb"), and carried crates **snap** into the nearest pad cell.

## 3. Core rules (v1)

**Map.** One fixed arena (a market street). Each team has a stall (base, has HP) and next to it a
**2×2×2 stacking pad** (8 cells: 2 wide × 2 deep × 2 high). A large crate-drop zone in the middle,
a small drop zone near each base. Crates fall with a visible shadow before landing.

**Carrying.** A character carries at most one crate (above its head), moves slower while carrying,
and cannot fire while carrying. Being hit makes you drop the crate.

**Stacking (Q8).** Pick/Drop while carrying and standing on one of your own pad's 4 floor cells
places the crate in that column: ground layer if empty, upper layer if the ground is occupied
(column full = no-op with a shake). The target cell glows while you carry a crate near the pad, and
the pad always shows the preview of what its contents will produce. Pick/Drop with empty hands on
an occupied cell lifts the top crate back out.

**Opening (Q8).** An **"Open!"** button (desktop: E) appears only when you stand at your own pad and
its contents form a valid recipe. Opening takes ~1 s with a pop animation and converts the whole
pad. The item goes to the opener (gun/bomb) or spawns at the stall (teammate).

**Recipes v1.**
- 1 crate → **Gun** (light ranged weapon; e.g. water gun). Fills the gun slot (replaces an older gun).
- 2 crates side by side → **Bombs** (thrown, area damage, 3 uses). Fills/refills the bomb slot; the gun is kept.
- 2 crates stacked vertically → **New teammate** (bot), spawns at the stall.
- Anything else → preview says it is not a recipe yet.

**Combat.** Default weapon is a weak melee/slap so an unarmed character is never helpless.
Auto-aim on mobile targets the nearest enemy unit or enemy stall in range.

**Stall.** Has HP, can be damaged by any weapon. When a stall is destroyed the match ends; the
team that destroyed it wins (owner decision Q5 — see open question in §9).

**Squad commands.** One tap applies to all bot teammates:
- **Attack** — push toward the enemy stall, fight what they meet.
- **Guard stall** — stay near own stall/pad, intercept enemies.
- **Fetch crates** — collect crates, stack them on own pad by a simple plan (aim for the recipe the team lacks).
With no command, bots pick a role by simple priorities.

**Enemy bots** use the same input interface as a human player (move/fire/pick/drop/command), so
they plug into online later as "fill-in" seats.

## 4. Screens (v1)

1. **Title** — Play button (+ sound toggle). Optional 3-step "how to play" cards on first launch.
2. **Match** — arena; joystick + Pick/Drop + Fire + 3 command buttons (mobile); top bar: both stall HP bars, timer.
3. **Results** — winner, a few fun numbers (crates stacked, items built, stall damage), **Play again**.

## 5. Look and sound

- Glossy 2D cartoon, thick dark outlines, cel shading, bright saturated colours; team colour must read
  instantly at phone size (Fruit = blue accents, Dessert = red accents, as in the sample).
- Fixed top-down 3/4 camera following the player — no camera rotation (fixes the original's main complaint).
- No painted text in art; all text rendered by the game.
- Music default ~25–35 % volume, ducked under explosions; SFX playful (Worms-like humour).

## 6. Tech (Cloudflare)

- **Client:** TypeScript + Phaser (2D), built with Vite, served by **Cloudflare Workers Static Assets**.
  v1 needs no backend at all.
- **Shared simulation package:** pure TypeScript, no Phaser/DOM imports; fixed tick (e.g. 20 Hz),
  seeded RNG, state in / inputs in → state out. The client renders and interpolates. Bots live here
  too. This package is what the online server will run later.
- **Headless balance harness:** run N bot-vs-bot matches in Node to measure match length and side win
  rate. Targets: median match 5–8 min, each side 45–55 % wins over 1000 matches.
- **Later (not v1):** online rooms = 1 Durable Object per room (room code, authoritative sim at
  15–20 Hz, bots fill empty seats). Note: a DO running a live tick is billed for wall-clock duration
  while the match runs (hibernation does not apply during a match); one room lives in one location,
  usually near its creator. D1 for accounts/stats, R2 for large assets if needed.

## 7. Goals / non-goals / anti-goals

**Goals (v1):** one map, 2 teams × 3, 3 recipes with preview, squad commands, stall-destruction win,
5–8 min matches, mobile + desktop controls, deployed on Cloudflare at a shareable URL.

**Non-goals (v1):** online play, accounts, unlocks, saved stats, story/levels, more maps, vehicles,
heavy weapons, bonus (blue) crates, mega-crates, stealing from the enemy pad, character switching,
split-screen, more than 2 teams.

**Anti-goals (a failure even if it "works"):**
- A first-time player cannot tell what a stack will produce.
- Crates are fiddly to place (missed cells, wrong slot) on a phone.
- Teammates look stupid (stand still, walk into walls, ignore commands).
- Camera makes the action hard to read.
- Pixel-art look (owner chose glossy cartoon).

## 8. Builder calls (Monday's choices, not owner decisions — owner may override)

1. **Recipe matching:** a pad matches a recipe only when it holds exactly that shape (1 crate; 2
   adjacent ground crates; 1 column of 2). Any other content previews "not a recipe yet".
2. **Respawn:** a downed character respawns empty-handed at its own stall after ~5 s while the stall
   stands; a team whose stall is gone cannot respawn (the match is over anyway, per Q5).
2b. **Bots** obey the same Q8/Q9 rules (stand on a cell to place, Open! only on a valid recipe).
3. **Team size cap:** max 5 characters per team (start 3, up to +2 via recipe).
4. **Orientation:** landscape on phones; portrait shows a "rotate your phone" prompt.
5. **UI language:** Thai first, strings kept in one table so English can be added cheaply.
6. **Load budget:** first playable load ≤ ~5 MB on a phone connection; 60 fps target on a mid-range phone.

## 9. Left to the builder / open items

- Exact numbers (HP, damage, speeds, drop rate) — tuned with the balance harness.
- Character roster names and final art (to be generated from the style sample after approval).
- Repo name, game name, Kanban board/topic setup.
