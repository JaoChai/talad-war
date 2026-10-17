# Talad War v2 — more recipes, super crates, classes, 4 teams (design)

Status: draft for owner approval (2026-10-16). Builds on `docs/2026-10-14-talad-war-design.md` (v1)
and the live game v0.0.16. Everything not mentioned here stays as in v1.

## 1. Intent

The owner wants Talad War closer to the original **Team Buddies** (PS1, 2000):

1. **Crate recipes by shape + colour** — more things to build, and a rarer special crate that
   upgrades whatever it is mixed into.
2. **Classes ("อาชีพ")** — teammates with different jobs/abilities, and the player can become them.
3. **4 teams, one per corner** — last stall standing wins.

Owner chose to do all three in one approved design ("C"), delivered as three releases in order.
Why: the v1 loop works (full matches on the live site, no bugs, sound OK); what is missing is the
depth and chaos of the original.

Facts from the original (sources: GameFAQs guide by JDStuart, Giant Bomb wiki, Wikipedia):
- Pad 2×2×2. Shape decides the category: 1 crate = light weapon; 2 flat = grenades; 4 flat = heavy
  weapon; 2 vertical = buddy; 4 vertical = special buddy class; 8 = vehicle.
- Normal crates are red-bordered; rarer blue-bordered **super crates** — one in any recipe makes the
  result "super" (stronger/faster/more HP).
- Classes: Infantry, Commando (more HP, faster), Medic (heals, regenerates), Ninja (very fast, sword
  cuts crates on enemy pads), Cyborg (high defence), Stealthy (invisible, steals weapons).
- Player can switch between any of their buddies. Multiplayer: up to 4 teams.

## 2. Goals / non-goals / anti-goals

**Goals:** 5 recipe shapes × normal/super; 4 classes; character switching; 4-team match on one
corner map; bots that use all of it; still mobile-first, still 5–8 min matches.

**Non-goals (this design):** vehicles / 8-crate recipe, mega-crates, online play, accounts, more
maps, stealing crates from enemy pads (except the Ninja ability below), the Stealthy class,
camera changes.

**Anti-goals (failure even if it "works"):**
- A first-time player cannot tell what a pad arrangement will produce, or whether it will be super.
- 4 teams on a phone screen turn into unreadable mush (can't find yourself, can't tell teams apart).
- Bots ignore the new stuff (as today: bots almost never build buddies).
- Super crates or one class become "always pick this" (balance harness must catch it).
- Breaking determinism of the shared sim (online later depends on it).

## 3. Release order (each is its own release, owner plays each)

| Release | Content | Owner gate before building art |
|---|---|---|
| R1 | Recipes + super crate | super-crate look + heavy-weapon look samples |
| R2 | Classes + switching | 4 class looks on existing characters (sample sheet) |
| R3 | 4 teams, 4 corners | 2 new teams' characters, stalls, map mockup |

Owner rule: art is shown as samples first and only built after the owner picks.

## 4. R1 — recipes and super crates

**Recipe table** (pad = 4 columns, 2 layers; "flat" = ground layer only; match is exact shape):

| Shape | Crates | Result | Super version (≥1 super crate in it) |
|---|---|---|---|
| 1 crate | 1 | Water gun (as now) | Faster fire + longer range |
| 2 flat, side by side | 2 | 3 bombs (as now) | Bigger radius, 5 bombs |
| 4 flat (whole ground layer) | 4 | **Heavy weapon** (new, gun slot) | More damage |
| 2 stacked, one column | 2 | Teammate (as now) | More HP + faster |
| 2 full columns side by side (2×2 wall) | 4 | **Class teammate** (R2; in R1 = not a recipe) | Super class |

- Anything else (3 crates, diagonals, 8 crates, …) = "not a recipe yet" (as now).
- Heavy weapon: a slow, area-damage launcher (theme: e.g. "coconut bazooka"); big stall damage,
  slow fire. Occupies the gun slot (replaces a light gun). Lost on death like everything else.
- **Super crate:** falls rarely (builder tunes; start ~1 in 8 centre drops, never at side zones).
  Must look different from normal crates **and from all 4 team colours** (blue/red/green/yellow are
  taken), e.g. glowing purple-silver with a star. Pad preview shows a star when the result will be
  super. Super crates can be carried/stacked/lifted like normal ones.
- Bots: pick recipes by team need, including heavy weapon and buddies; carry super crates first.

## 5. R2 — classes and switching

**Classes** (theme names are builder's call, shown to the owner in the art sample):

| Class | Idea (from original) | Ability |
|---|---|---|
| Boxer (Commando) | tough + fast | more HP, faster, stronger slap |
| Healer (Medic) | support | heals nearby teammates over time, regenerates self |
| Ninja | raider | very fast, low HP; slap on an enemy pad knocks the top crate off |
| Giant (Cyborg) | tank | lots of HP, slow, takes reduced bomb damage |

- Obtained from the 2×2-wall recipe. Opening it shows **4 class buttons instead of one "Open!"**;
  the tap picks the class (bots pick by need). Super crate → super class (more HP/speed).
- Plain 2-stacked teammate stays a classless basic teammate.
- Look: same character art + a class accessory/hat overlay and a small class badge above the head
  (no new 18-frame sheets per class).
- Team cap stays 5 (alive + dead), start 3.
- **Switching:** a "switch" button (desktop: Q) moves control to the next living teammate; the
  previous body becomes a bot. This reverses v1 decision Q6 (owner approved in this design). Whole
  arena stays on screen (no camera), so the controlled unit gets a clear marker.

## 6. R3 — 4 teams, 4 corners

- Teams: Fruit (blue, player, bottom-left), Dessert (red), + **2 new Thai-market teams** (green and
  yellow; Monday suggests Street-food and Drinks — owner can change). 3 characters each at start,
  4 character designs per team like now.
- Map: same 40×24 arena so the whole map stays on screen; stall + pad in each corner; one centre
  drop zone + one side drop zone per team; obstacles re-laid **mirror-symmetric on both axes** so all
  4 corners are equally fair. Painted floor redone in the Lantern Night style.
- Win: last team whose stall still stands. A team whose stall falls cannot respawn and its pad stops
  working; its living units fight on until killed.
- HUD: 4 stall bars. Squad "Attack" = go for the enemy stall nearest the player's character.
- Bots choose which enemy to attack (nearest / weakest stall); no "everyone gangs up on the human".
- Results show placing (1st–4th) + Play again.

## 7. Balance and quality bars

- Headless harness, 1000 bot matches per mode: median 5–8 min; 2-team mode each side 45–55 %;
  4-team mode each team 20–30 % wins; no recipe/class "removal" test may show one choice being
  mandatory (method: ban one item for one team, as done 2026-10-16).
- Phone (844×390): 60 fps target on mid-range, with up to 20 units on screen.
- Art budget: current art 2.5 MB of a 3 MB budget; R3 needs a raised budget (≤ 4 MB art, total
  first load ≤ 5 MB as in v1).
- Every card carries the E2E port-4173 rule (check `ss -ltn | grep ':4173 '` is empty, never kill
  another project's process, assert the title is Talad War).

## 8. Monday's calls (owner may override)

1. Shape = category, super crate = upgrade (matches the original; owner said "mix by colour").
2. Super-crate colour is not blue (blue = Fruit team).
3. Class via 4-button pick at open time, not random.
4. Class shown by overlay, not new full sprite sheets.
5. Keep the 40×24 arena so no camera work is needed.
6. Stealthy class and vehicles left out.
7. Class and "super teammate" bonuses belong to the unit and **survive death/respawn**; only carried
   items (gun, heavy weapon, bombs, crate) are lost on death. Otherwise a team at the 5-unit cap
   could never regain a class.
8. When the human's team is knocked out (stall down and every unit dead), show the placing at once
   with two buttons: "Watch" (spectate the rest, whole arena already on screen) and "Play again".
   The sim keeps running to decide 1st–3rd.
9. Mode choice after R3 — **owner decided (2026-10-16, "A")**: title screen offers "2 teams"
   (current v1 map, Fruit vs Dessert) and "4 teams" (corner map). Both modes are in the §7 balance
   matrix. **Design approved by owner 2026-10-16 ("A A").**

## 9. Left to the builder

All numbers (HP, damage, speeds, drop rates, heal rate), theme names of items/classes, bot
priorities, exact obstacle layout — tuned with the harness and shown to the owner via samples.
