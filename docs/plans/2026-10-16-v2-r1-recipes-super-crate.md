# Talad War v2 R1 Recipes and Super Crates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four-flat-crate coconut bazooka and recipe-wide super upgrades without changing v1's two-team rules or making either new option mandatory.

**Architecture:** Keep shape matching separate from crate quality; derive one `{recipe, super}` result for preview and opening. Keep the existing gun slot and numeric bomb count, adding explicit, backwards-compatible item metadata and a persistent super-buddy flag. Extend existing deterministic combat, bot decisions and harness rather than introducing a second rules engine.

**Tech Stack:** TypeScript, deterministic 20 Hz simulation, Vitest, Phaser 4.2.1, Vite 8.3.1, Playwright (versions: `apps/client/package.json:14-25`; tick rate: `packages/sim/src/constants.ts:4-6`).

**Spec:** Owner-approved staging file `2026-10-16-classes-crates-four-teams-design.md`, specifically §2, §4, §7, §8 and §9; task `t_a15977cf` supplies the final art choices and R1 limits. Its stale “draft” heading is superseded by approval at design lines 135-137. First implementation card copies that file to `docs/superpowers/specs/2026-10-16-classes-crates-four-teams-design.md` and this plan to `docs/plans/2026-10-16-v2-r1-recipes-super-crate.md`, byte-for-byte. These are the ONLY exceptions to `AGENTS.md:15`.

## Global Constraints

- R1 only. Two teams; `Team = 'fruit' | 'dessert'` remains a widenable union (`packages/sim/src/types.ts:3`). No classes, switching, four-team map, vehicles, stealing, camera changes, online or accounts (design §2, §5-6).
- “4 ground crates, upper layer empty → heavy”; 2×2 walls remain invalid in R1. “Super version (≥1 super crate in it)” (design §4).
- “Class and ‘super teammate’ bonuses belong to the unit and survive death/respawn; only carried items (gun, heavy weapon, bombs, crate) are lost on death” (design §8.7). Do NOT interpret “lose everything” as deleting the super-buddy flag.
- Art choices: black lacquer + hot-pink neon edges + pink star; coconut bazooka. Use the four supplied WebPs unchanged; no new character sheets or bazooka sprite.
- “Headless harness, 1000 bot matches per mode: median 5–8 min; 2-team mode each side 45–55 %” (design §7); R1 adds a hard **0 timeouts** gate and **≥40% banned-team wins** for heavy and super independently (task body).
- Phone target: 844×390, 60 fps on mid-range hardware (design §7). Do not claim device performance from a desktop screenshot.
- Sim stays pure, seeded and deterministic (`AGENTS.md:17-19`). All gameplay randomness uses `nextRandom(s)` (`packages/sim/src/rng.ts:3-12`).
- **LOCKED:** `RESPAWN_TICKS=100`, `OPEN_TICKS=20`, `TEAM_CAP=5`, `STALL_MAX_HP=6500`, `PAD_CELL_SIZE=1.5`, `PAD_FLOOR=2`, `PAD_LAYERS=2`, `UNIT_SPEED=6`, `CARRY_SPEED=4`, `DROP_INTERVAL_CENTER_TICKS=60`, `DROP_INTERVAL_SIDE_TICKS=140`, `DROP_FALL_TICKS=30`. Also preserve arena/map geometry and spawn scheduling. Sources: `packages/sim/src/constants.ts:8-19,24-27,46-55`. Super-unit speed uses a multiplier, not an edit to the locked speeds.
- Keep normal v1 gun/bomb/slap numbers unchanged initially (`packages/sim/src/constants.ts:34-45,54`). Only R1 constants and explicitly listed bot decision constants may be tuned in C5; no stealth “pacing fix” to locked/v1 constants.
- Tests outside `r1Combat.test.ts` use exported constants for tunable numerical expectations, while asserting fixed recipe counts, shape rules and relative upgrades literally. Only `r1Combat.test.ts` pins initial literal combat values; C5 owns updating those assertions with the measured tuning. Spawn tests compare against the configured probability, not a permanently hardcoded one-eighth.
- Art cap remains **3,000,000 bytes** unless measured need justifies a separate declared increase, never above **3,200,000 bytes** in R1. Total initial-load ceiling stays **5,000,000 bytes** (`apps/client/scripts/check-load-budget.mjs:23-28`).

## Review Focus

1. **Mixed-quality pad / changing contents on completion tick:** one super upgrades once, multiple supers do not stack; removing the super cancels rather than grants a stale upgrade. Pin in C3.
2. **Equipment replacement / depleted inventory / death:** normal crafting can replace a super/heavy item; no bonus leaks between slots, while the super-buddy trait survives. Pin in C2/C3/C8.
3. **Projectile outlives shooter or weapon:** its quality and damage stay those of the fired shot, not the shooter's current loadout. Pin in C2.
4. **Bots stuck midway through heavy / all armed / asymmetric pads:** finish a partial heavy, retain a builder, use canonical column choices, and still build buddies. Pin in C4.
5. **Small-screen and missing-asset states:** super identity is not colour-only; Thai labels, star and coconut remain readable, badge failure keeps textual meaning, cargo at the top edge stays on canvas. Pin in C6-C8.

---

## Project facts

### Repository audit and evidence boundary

All repository citations below refer to fetched **origin/main `89cf877b83ee0cb314be1cb343e03936faf7daa3`**, not the possibly dirty local checkout. Inspected an external `git archive origin/main` snapshot under the architect's scratch directory. No repository working-tree files were written. `git status --short` reported pre-existing untracked `vc-base-qa01/`, `vc-base-t_07195919/`, `vc-base-t_672b23d1/`, `vc-base/`; leave them alone.

| Current contract / every live consumer requiring attention                                                      | origin/main source                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Crate` has id/pos/state/landTick, no quality; unit has nullable gun and numeric bombs; projectiles bullet/bomb | `packages/sim/src/types.ts:23-45,61-69`                                                                                                |
| Centre/alternating-side schedules; cap checked before RNG; two position draws per successful spawn              | `packages/sim/src/crates.ts:28-56`                                                                                                     |
| Fall, pick and drop mutate the existing crate object; same ID survives                                          | `packages/sim/src/crates.ts:18-24,74-80,99-112`                                                                                        |
| Pad placement/lift mutate state/position, not identity                                                          | `packages/sim/src/step.ts:180-203`                                                                                                     |
| Exact v1 matcher and preview/team-cap/open guards                                                               | `packages/sim/src/pad.ts:6-10,61-108,118-128`                                                                                          |
| Opening snapshots cell IDs; changed contents/death cancel before finish; all recipe crates removed              | `packages/sim/src/open.ts:15-24,32-65,94-104`                                                                                          |
| Gun replaces; bombs refill to 3 and preserve gun; buddy construction                                            | `packages/sim/src/open.ts:60-91`                                                                                                       |
| Attack cooldowns, fresh-projectile delay, bullet collision/TTL, bomb AoE, death/respawn                         | `packages/sim/src/combat.ts:80-149,165-221,249-325`                                                                                    |
| Auto-aim: nearest live enemy by lower-ID tie, else stall if nearest rect point in range; returns stall centre   | `packages/sim/src/autoAim.ts:20-53`                                                                                                    |
| Movement currently selects normal/carry speed; `step` clones state and preserves phase order                    | `packages/sim/src/step.ts:11-25,37-46,123-148`                                                                                         |
| Canonical whole-state hash already includes all enumerable fields; no whitelist to update                       | `packages/sim/src/hash.ts:3-13,25-30`                                                                                                  |
| Initial units created centrally; replay sim version exported                                                    | `packages/sim/src/setup.ts:30-71`; `packages/sim/src/index.ts:1-18`                                                                    |
| Bot role/armed switch and gun→bombs→buddy need                                                                  | `packages/sim/src/bots/squad.ts:20-59`                                                                                                 |
| Bot fetch/open decision; attack range is hardcoded gun range; crate claim and duplicated matcher                | `packages/sim/src/bots/brain.ts:95-173,217-237,295-343,380-491`                                                                        |
| Renderer observes gun cooldown, draws gun/slap muzzle, picks cargo height and normal/air/stack textures         | `apps/client/src/render/view.ts:131-198,253-291,343-359,420-525`                                                                       |
| Renderer treats every non-bomb projectile as team shot; explosion FX uses latest tick guard                     | `apps/client/src/render/view.ts:529-599`                                                                                               |
| Boot already loads every manifest prop; manifest allows string prop keys                                        | `apps/client/src/scenes/Boot.ts:18-43`; `apps/client/src/render/anims.ts:5-24`                                                         |
| Preview derives fruit pad text; currently recipe-first branching masks teamFull text when recipe exists         | `apps/client/src/hud/padPreview.ts:22-55`                                                                                              |
| Existing HUD class owns winner only; Match constructs/syncs it and removes HUD root on shutdown                 | `apps/client/src/hud/status.ts:9-25`; `apps/client/src/scenes/Match.ts:89-103,105-118,352-361`                                         |
| Thai recipe helper only accepts 3 recipes; tutorial copy lists v1 recipes                                       | `apps/client/src/i18n/th.ts:20-23,39-45,63-72`                                                                                         |
| Touch throw count already numeric; aim marker calls sim auto-aim                                                | `apps/client/src/input/touch.ts:110-114`; `apps/client/src/scenes/Match.ts:328-333`; `apps/client/src/hud/aimMarker.ts:20-32`          |
| Audio maps all new non-bullet projectiles to throw: coconut needs explicit fire classification                  | `apps/client/src/audio.ts:21-43`                                                                                                       |
| Stats count generic opened/hit events; no recipe exhaustiveness there                                           | `apps/client/src/stats.ts:18-40`                                                                                                       |
| Test hooks can stage ground-only pads and render external snapshots; gated out of production                    | `apps/client/src/testHooks.ts:30-35,56-85`; `apps/client/src/scenes/Match.ts:24-25,158-195,257-311`; `apps/client/vite.config.ts:6-10` |
| E2E helpers duplicate partial state/hook types and assert the correct title                                     | `apps/client/e2e/helpers.ts:5-65,67-82`                                                                                                |
| Harness defaults seed0=1, 15 min; counts wins/games, reports draws/timeouts; current assert permits 2% timeouts | `packages/sim/src/harness.ts:6-34,46-88,91-115,122-142`                                                                                |
| Repo gate / CI differ: local 50 games without assert; CI 200 with assert                                        | `AGENTS.md:21-33`; `.github/workflows/ci.yml:10-18`                                                                                    |
| Art-budget test name is misleading for art: currently tests **total dist** at 5 MB, not a 3 MB art cap          | `apps/client/test/loadBudget.test.ts:20-39`; `apps/client/scripts/check-load-budget.mjs:15-28`                                         |

No edits are required to `hash.ts`, `setup.ts`, Boot, animation sheets, input/touch, aimMarker or stats if the additive contracts below are followed. Their existing tests must remain green; the consumer map above is part of every downstream card's context.

### Baseline and target numbers

**Lead-provided historical observations, NOT rerun or independently verified as 1000-game results in this planning task:** task `t_a15977cf`, “Lead baseline”, at the audited SHA:

- 1000 all-bot games: median **373 s**, p90 **448 s**, fruit **48.9%**, dessert **50.7%**, **4 draws**, **0 timeouts**, assert pass.
- 200 games: **27 bomb opens/match**, **17 gun opens/match**, **29 buddy opens total**; stall damage gun **50%**, bombs **33%**, slap **16%** (rounded reported shares).
- 200-game bans: no gun **5.5%** wins, no bombs **5.5%**, no buddy **47.5%** for the banned team. Do not use these as acceptable targets for the new items.
- Extra historical sample was described as “1200 seeds (1000–6199), dessert 55%”; that description is insufficient to reconstruct the sampled seeds. Do not silently replace it with a contiguous range.

**Fresh architect measurements on the external unmodified snapshot:**

- `node --version && npm --version && npm ci`: exit 0, Node **v26.9.0**, npm **11.19.1**, **181 packages added**; npm reported **5 high-severity vulnerabilities**. Dependency remediation is outside R1; never run `npm audit fix --force` as part of these cards.
- `npm run typecheck`: exit 0, both workspace `tsc -p tsconfig.json` invocations completed.
- In `packages/sim`: `../../node_modules/.bin/vitest run test/pad.test.ts test/open.test.ts test/crates.test.ts test/respawn.test.ts test/autoaim.test.ts test/determinism.test.ts`: exit 0, **6 files / 55 tests passed**. Initial attempt using workspace-local `node_modules/.bin/vitest` failed with exit 127; corrected to the hoisted root binary.
- In `apps/client`: `../../node_modules/.bin/vitest run test/hud.test.ts test/i18n.test.ts test/audio.test.ts test/loadBudget.test.ts`: exit 0, **4 files / 39 tests passed**. This targeted invocation did NOT execute the package script's real-build load check.
- `npm run sim -- --games 6 --seed0 1`: exit 0, `{games:6, medianSec:369.975, p90Sec:401.7, winRate:{fruit:0.5,dessert:0.5}, draws:0, timeouts:0, msPerTick:0.025274624313280362, assert:"pass"}`. This is a smoke sample, not balance acceptance.
- Python recursive file-size measurement: existing public art **2,497,698 bytes**; supplied additions **80,386 bytes** (31,038 / 30,064 / 12,260 / 7,024 respectively); projected **2,578,084 bytes before manifest growth**. No art-cap increase is presently needed. Source paths: `apps/client/public/art/` and staging `out/`.
- No full unit gate, production build, E2E, video review, 1000-game run or ban study was executed by the architect. Those are implementation evidence, not planning claims.

**R1 release acceptance:** normal batch seeds **1–1000**, median **300–480 s inclusive**, both wins/games **0.45–0.55 inclusive**, **0 timeouts**, existing **≤0.5 ms/tick** check retained; report p90 and draws without inventing a p90 gate. Six-seed bot traffic at seeds **1–6** must include gun/bombs/buddy/heavy each ≥1 and super opens ≥1. Heavy and super bans use **200 games each for each banned side**, seeds **1–200**, each banned side ≥**0.40** wins/games and 0 timeouts. Never reroll acceptance seeds.

## Task

### Locked interfaces and gameplay decisions

These are implementation instructions, not descriptions of existing code. Initial balance numbers are builder decisions authorized by design §9; C5 may tune only the allowlist below and must report final values.

**Data and compatibility**

- In `types.ts`: export `CrateKind = 'normal' | 'super'`, `WeaponKind = 'gun' | 'heavy'`, `ItemId = 'unarmed' | 'gun' | 'heavy' | 'bombs' | 'crate'`, `ItemBan = 'heavy' | 'super'`.
- `Crate.kind?: CrateKind`: absent means normal. All newly spawned production crates explicitly set kind. Optionality is intentional to keep existing normal-only fixture literals and old callers valid, NOT an invitation to use truthiness as a quality check. Check `crate.kind === 'super'`.
- Gun slot remains `Unit.gun: GunSlot | null`; exported `GunSlot = { ammoCooldownTicks:number; kind?:WeaponKind; super?:boolean }`. Missing kind means gun; missing super means false. Ordinary gun crafting keeps the legacy `{ammoCooldownTicks:0}` representation, so equality fixtures do not require bulk churn. Heavy crafting writes `{kind:'heavy',super:<boolean>,ammoCooldownTicks:0}`; super gun writes `{kind:'gun',super:true,ammoCooldownTicks:0}`.
- Keep `Unit.bombs:number`; add `bombsSuper?:boolean`. A recipe replaces the entire bomb stock with 3 normal or 5 super bombs, replacing its quality even if that downgrades. Last throw clears bombsSuper to false **after** the projectile snapshots its quality. Gun/heavy crafting leaves bombs untouched; bomb crafting leaves gun/heavy untouched.
- Add `Unit.superBuddy?:boolean`, default false. Only the new buddy gets this on a super-buddy opening. It is permanent through death/respawn, independent of both equipment flags. R2 reuses this trait; do not add a class enum or control switching now.
- Extend `Projectile.kind` with `'coconut'`; add `super?:boolean`, default false. Every newly fired projectile snapshots quality. A bullet uses gun stats, bomb uses bomb stats, coconut uses heavy stats; never look up its current shooter to recover stats.
- Optional `MatchState.itemBans?: Partial<Record<Team, readonly ItemBan[]>>` is a deterministic **harness/testing rule**, omitted in ordinary matches. It grants neither team extra items or crates. A heavy ban prevents heavy preview/open and redirects bots; a super ban suppresses all recipe quality upgrades for that team without deleting or recolouring shared crates. It is serialized by the existing whole-state hash. No UI for bans.
- Keep `Recipe` exported from `pad.ts`, widen it to `'gun'|'bombs'|'buddy'|'heavy'`; do not make Team/Recipe numeric indexes. Version the sim at each behavioral card: C1 `0.2.0`, C2 `0.2.1`, C3 `0.2.2`, C4 `0.2.3`, C5 `0.2.4`. No promise of v1 replay hash compatibility.

**Spawn, matching and opening**

- New `SUPER_CRATE_CHANCE=1/8`. In `trySpawnInZone`, only after cap permits a spawn, keep the existing angle draw then radius draw; for centre only, take a **third** RNG draw and set super iff `< SUPER_CRATE_CHANCE`. Side crates are normal and consume only two draws. A capped attempt consumes neither RNG nor ID. Do not roll during landing/rendering.
- Carry, damage-drop, manual drop, placement and lift retain crate ID/kind. Consumed crates are removed only after result quality is resolved.
- `matchRecipe(pad:Pad):Recipe|null`: keep v1 one/two-crate rules; add heavy only for exactly four occupied ground cells and **all four upper cells empty**. Three crates, diagonal pair, any four-crate upper-layer arrangement including both wall orientations, and eight crates remain null. Test every supported four-cell occupancy, not only one wall.
- Export `recipeResult(s:MatchState, team:Team): {recipe:Recipe;super:boolean}|null`: shape via matchRecipe, heavy-ban → null; super = at least one referenced crate has kind super AND team has no super ban. Missing crate records are treated as normal for compatibility with shape-only test fixtures; never fabricate a super result. This is the ONLY quality/ban resolver for `padPreview` and `finishOpen`.
- Add required `super:boolean` to **all** Preview variants. Empty/notRecipe use false; valid/teamFull use result quality. Keep reasons `empty | notRecipe | teamFull`. `canOpen` restrictions and 20-tick channel remain unchanged.
- Opening uses the resolver before clearPad, guards the buddy cap again at completion, grants exactly once, then emits `{tick,kind:'opened',recipe,super,team,unitId}`. Normal gun and heavy replace each other in both directions and reset cooldown to 0; normal can replace super. Bombs refill rather than add. Buddy does not alter opener equipment.
- Keep the cell-ID snapshot: crate kind is immutable after spawn, so changing IDs cancels a quality change. Do not mutate kind in-place to simulate a game action. Same-tick placement/lift cancellation precedes grants.

**Combat / perks**

| Constant                   | Initial value / use                                                       |
| -------------------------- | ------------------------------------------------------------------------- |
| `SUPER_GUN_COOLDOWN_TICKS` | 5 (normal 6)                                                              |
| `SUPER_GUN_RANGE`          | 10.8 (normal 9); damage remains 12                                        |
| `SUPER_BOMBS_PER_RECIPE`   | 5, locked to the approved recipe count                                    |
| `SUPER_BOMB_RADIUS`        | 2.8 (normal 2.2); damage/fuse/throw range/stall multiplier unchanged      |
| `SUPER_BUDDY_MAX_HP`       | 125 (normal 100)                                                          |
| `SUPER_BUDDY_SPEED_MULT`   | 1.1, applies to selected base OR carry speed, not to constants themselves |
| `HEAVY_DMG`                | 30 per enemy unit in the blast                                            |
| `SUPER_HEAVY_DMG`          | 42; only damage increases versus normal heavy                             |
| `HEAVY_RANGE`              | 9 world units                                                             |
| `HEAVY_COOLDOWN_TICKS`     | 30                                                                        |
| `COCONUT_SPEED`            | 12 world units/sec                                                        |
| `HEAVY_RADIUS`             | 1.6                                                                       |
| `HEAVY_STALL_MULT`         | 2; heavy/super-heavy stall hit 60/84 initially                            |

- Create `items.ts`, exported through index: `weaponStats(slot:GunSlot): {kind:WeaponKind;damage:number;range:number;cooldownTicks:number;speed:number;radius:number;stallMult:number}`, `bombStats(superBomb:boolean): {damage:number;radius:number;stallMult:number}`, `unitMaxHp(unit:Unit):number`, `unitMoveSpeed(unit:Unit):number`. All read constants; no state mutation. Normal gun radius=0/stallMult=1. Helpers keep range decisions identical across combat, bots and auto-aim.
- Coconut travels straight, using gun's explicit aim → auto-aim → facing fallback, nearest-live-enemy/stall priority and lower-ID ties. Auto-aim uses the equipped weapon's range. Preserve the existing stall-centre aiming convention; do not fix its geometry in R1.
- Fresh projectiles first advance next tick. Coconut explodes once on first enemy-unit, either stall, obstacle contact, OR range expiry; use existing bullet substep order (obstacles, stalls, enemies), with at least six substeps and no friendly-unit blocking. A zero-direction coconut expires harmlessly without an explosion. No friendly fire. AoE uses centre-distance for units and circle/rect overlap for enemy stalls, like bombs; no new line-of-sight splash occlusion.
- Clamp coconut travel to HEAVY_RANGE (track optional `distanceLeft?:number` on Projectile for coconut); TTL is `ceil(range/(speed*DT))`. This remains correct when tuning non-integral ranges. Normal bullets preserve their current TTL behavior; super gun initial range gives an integral bullet lifetime. If tuning SUPER_GUN_RANGE, keep it on the `BULLET_SPEED*DT` grid.
- Normal/super heavy occupies gun slot and can coexist with bombs. Carrying disables all attacks. Death/respawn clear gun, bombs, bombsSuper and cargo; drop the crate normally. Keep superBuddy; respawn HP uses unitMaxHp. Projectiles already fired keep flying with their own super flag.
- Emit `hit` with existing target/dmg plus `source: 'slap'|'gun'|'bombs'|'heavy'` and `super:boolean`; emit explosion with existing pos plus source and super. This lets balance tests classify actual damage instead of inferring a source from equal damage numbers. Preserve existing audio event kinds.

**Bot decisions (pure, no RNG/memory/tick lottery)**

- `teamNeeds(s,team):Recipe|null` keeps its signature. Count only living equipment; count alive+dead for team size. A heavy counts as an armed gun slot for basic coverage.
- Decision order: (1) no armed teammate → gun; (2) valid partial-heavy floor with 3 crates → heavy unless banned; (3) team holds bombs and size < cap → buddy; (4) no heavy, not banned, enough supply for heavy, and team size ≥4 → heavy; (5) no bombs → bombs; (6) size < cap → buddy; (7) no heavy, enough supply → heavy; otherwise null. “Enough supply” = compatible ground-only own pad count + own-team carried crates + unclaimed ground crates ≥4; never count falling/enemy-carried crates. Put threshold `BOT_HEAVY_MIN_SUPPLY=4` in constants; C5 may raise it, not below 4. Partial-heavy preference prevents a third crate becoming an abandoned invalid pad; this is when heavy beats re-building bombs.
- While building any heavy-compatible partial floor of 1/2 crates, choose heavy only if the same supply/size rule above still holds. A valid partial floor with 3 crates always finishes. Do not open temporary gun/bombs recipes while the chosen need is heavy.
- Null-command all-bot team: bombs/ heavy carriers attack; when a need exists retain one builder, the lowest-ID living bot not carrying bombs/heavy (carrying a crate takes priority over its equipment role). Other bots keep guard/attack defaults. Whole-team ≥2-armed attack switch only when no build is needed. Explicit commands still win. Human-team default behavior stays v1 except shape/range/quality support.
- Claim super crates before normal crates, then distance, then lower crate ID, using the SAME ordering for each earlier teammate claim. A super-banned team uses distance/ID only. Keep movement toward the chosen crate; do not remotely pick it or change human nearest-pick rules.
- Heavy placement fills empty ground columns only, in existing fruit-canonical ordering mirrored to dessert. Replace the duplicated `recipeAfterPlace` logic with a clone + existing `placeCrate` + `matchRecipe`, using a temporary ID never inserted into state. For incomplete heavy, accept only ground-only subsets of the four-floor target. Wall/upper-layer contamination is not repaired by silently deleting crates; retain v1 fallback behavior, test no crash/stuck regression.
- Bot firing/hold/stall-aim ranges use weaponStats, not GUN_RANGE. Ban-heavy teams choose normal alternatives; banned super recipes resolve normal. Six-seed natural traffic must pass without injected crates, loadouts or test-only bot strategy.

**Client contract / tokens / states**

No new page. Approved references: staging design §4; `img/r1_pad_mockup.png` (style reference only); final approved sprites in `out/`. Preserve existing match layout and character sheets. Tokens below extend the current HUD (`apps/client/src/shell.css:20-26,273-284,314-321`), not a redesign.

- Add scoped HUD tokens: `--tw-r1-ink:#1b1030`, `--tw-r1-text:#fff`, `--tw-r1-super:#ff3fa4`, `--tw-r1-panel:rgba(27,16,48,.85)`, spacing 4/8/12px, radius 10px, type `'Noto Sans Thai',Tahoma,sans-serif`, size16px/line-height22px, label weight700. Semantic component aliases refer to these primitives; no global token migration.
- Preview: retained floating placement; inline text then **20×20px** badge_super with 4px gap; heavy adds a **24×24px** coconut icon with object-fit contain. Keep 4px 12px padding. Super labels include Thai `พิเศษ` as well as the star; normal labels unchanged. Clamp bubble horizontally to 8px viewport margin. Status checks precede recipe naming: empty/finished → hidden; invalid → `ยังไม่ใช่สูตร`; teamFull → `ทีมเต็มแล้ว`, without misleading “will get”.
- Held-item HUD extends `MatchHud`, which already syncs each frame. Expose `readonly itemEl:HTMLDivElement`, class `.tw-loadout`. Position top-centre **top:32px**, transformX(-50%), max-width `calc(100vw - 208px)`, 4px/8px padding, 8px item gap, panel/radius tokens above, pointer-events none. Primary item is carried crate (quality from crate) else gun/heavy else unarmed; show bomb stock as a separate chip when >0, each with its own quality badge/text. Coconut is the heavy item icon, not a newly drawn bazooka.
- Thai helper signatures: `recipeName(recipe:Recipe):string`, `itemName(item:ItemId):string`, `qualityName(name:string,superItem:boolean):string`. Exhaustive typed maps; no fallback of unknown recipe to buddy. Fixed copy: heavy `บาซูก้ามะพร้าว`, unarmed `มือเปล่า`, crate `ลัง`, super suffix ` พิเศษ`; retain existing gun/bombs/buddy names. Update tutorial build body to `บนแท่นของทีม: 1 ลังได้ปืน • 2 ลังข้างกันได้ระเบิด • 2 ลังซ้อนกันได้ลูกทีม • 4 ลังเต็มพื้นได้บาซูก้ามะพร้าว • ลังดาวทำให้ของพิเศษ`.
- Crate textures: normal unchanged; super falling `crate_super_air`, all other super states `crate_super`. Never replace a super upper crate with normal `crate_stack2`; draw it at the existing upper offset. Use the composite `crate_stack2` only when both crates in that column are normal. In either mixed-quality order, render the upper crate with its own base texture (`crate` or `crate_super`) at the upper offset, preserving the visible super identity below; do not cover a super lower crate with a normal two-crate composite. Aspect ratios always from manifest; top-edge cargo clamp uses actual carried crate art.
- Coconut projectile texture `shot_coconut`, width42 stage px, aspect preserved, rotates along velocity; normal bullet34/bomb26 unchanged. Heavy muzzle uses existing burst geometry at 1.5× gun size (144 vs96 stage px), same160ms hold +60ms fade, no new camera shake. Heavy keeps normal idle/run/carry behavior and existing attack poses. Super muzzle outline uses hot pink; no team recolouring. Reduced motion suppresses new scale/movement pulses and keeps a static readable flash.
- Empty/unarmed HUD: show `มือเปล่า`, no broken image. Dead/finished: hide item HUD; no stale star/count. Loading: no new page/spinner; do not show unresolved icons before Match starts. Badge/icon load error: hide failed image, keep Thai name/`พิเศษ` text; no coloured square substitute. Star is decorative (`alt=''`, aria-hidden), readable combined Thai text is exposed as the accessible status name. Do not announce each render frame.
- Test desktop1280×800 and touch844×390 (existing projects: `apps/client/playwright.config.ts:15-28`), plus targeted portrait390×844 to preserve the existing rotate prompt, not create a portrait match layout. Check item panel/preview vs HP/timer/commands/joystick/buttons; no new click targets or keyboard bindings.

### Common card context and gates (copy into EVERY created implementation card)

Every proposed card below is a brief, NOT a created board task. Lead assigns actual known worker profiles and wires the dependencies. Each actual body must contain literal headings **`## Project facts`** and **`## Task`** (operator card-lint requirement), its exact file list, relevant interfaces above, consumer citations, the gate and this E2E rule. Do not dispatch from a title alone.

**Project facts:** Repo `/home/jaochai/Code/talad-war`, origin `JaoChai/talad-war`, base main audited at89cf877; use an isolated implementation worktree/feature branch. No push to main, merge or deploy. Live `https://talad-war.anugooltippon.workers.dev` is release-only. Only C1 creates the two immutable docs specified above. No other docs edits. Gates run from repo root unless a targeted command explicitly changes directory.

**Full local gate, at the end of each worker run:**

```bash
npm ci
npm run typecheck && npm run lint && npm run format:check && npm test
npm run sim -- --games 50
npm run build -w @talad/client
ss -ltn | grep ':4173 '
run-locked talad-war-e2e npm run e2e
```

Interpret the port check **separately**, not in an `&&` chain: expected empty output and grep exit1 means no listener; an `ss` error is not success. talad-war and dice-bandits share preview port4173 with reuseExistingServer. Before full E2E confirm `ss -ltn | grep ':4173 '` prints nothing. Never kill another project's process. Assert the title is **Talad War** through `enterMatch`/`waitHooks`. Lock all E2E runs, local max2 workers; targeted specs while iterating, full local E2E at most once at the end. If the port is occupied, stop/request coordination, do not bypass the check. CI asserts200 games (`.github/workflows/ci.yml:15`); C5 additionally asserts1000 and bans. Do not infer balance pass from exit0 without `--assert`.

After final feature-branch push: one `gh pr checks <pr> --watch` call (team rule overrides `AGENTS.md:38`). Every PR body lists baseline/head, scope, exact RED/GREEN/gate outputs and exit codes, changed constants before/after (or none), evidence links, and heading **`Out-of-plan changes`** with explicit `None` or a complete list. Run `pr-body-check <task id> <pr number> --repo JaoChai/talad-war` before review; repair missing items. Include relevant locked-constant, art-byte, balance and media evidence. No fabricated counts; quote actual test tails. Implementer self-reviews before handoff. Commit only the listed files on the card branch after GREEN; use the card title as a specific commit subject. Architect performs no commits/PRs.

**Dependency graph:** C1 → C2 → C3 → C4 → C5 for sim/balance; C6 depends C1; C7 depends C2+C6; C8 depends C3+C6+C7. Release waits C5+C8 plus independent QA/review. Keep C7 and C8 serialized to prevent rendering/staging collisions; no owner play/deploy is implied by any development card.

### Card C1: Super-crate identity, seeded drops and immutable source docs

**Project facts / consumers:** crate schema/fall/pick/drop (`types.ts:38-45`; `crates.ts:18-56,74-112`); pad/cargo transitions (`step.ts:180-203`); full hash (`hash.ts:3-30`); literal normal fixtures (`test/pad.test.ts:53-62`; `test/open.test.ts:55-64`; client staging `Match.ts:286-308`). Paths without a prefix in this card are under `packages/sim/src` or explicitly named tests.

**Task / exact files (7):** Modify `packages/sim/src/{types.ts,constants.ts,crates.ts,index.ts}`; create `packages/sim/test/r1Crates.test.ts`; create the two immutable docs at the exact paths in the header. No other files.

**Interfaces:** Produce CrateKind/ItemId/ItemBan and optional Crate.kind/MatchState.itemBans as specified; runtime spawns explicitly normal/super; version0.2.0. Do not widen Recipe yet. Consume unchanged spawn/pick/drop/pad APIs.

- [ ] **1 RED tests:** `r1Crates.test.ts`: `center_uses_third_seeded_draw_and_strict_configured_threshold`, `sides_are_normal_and_use_two_draws`, `capped_spawn_preserves_rng_and_nextId`, `kind_survives_fall_pick_drop_place_lift_and_damage_drop`, `hash_changes_when_only_crate_kind_changes`, `same_seed_and_actions_replay_super_traffic`. Assert draw count by advancing a cloned state through nextRandom, not flaky empirical frequency; select seeds bracketing the configured threshold through that generator. Disable bots for scripted input. Hash comparison must change only kind, not ID/tick/pos. Replay twice for2000 ticks and prove ≥1 actual super crate was exercised (search a bounded fixed seed set0–31 and record the chosen seed).
      Representative assertions for the centre-drop test (imports from sim index):
  ```ts
  const state = createMatch(1);
  state.tick = 60;
  const oracle = structuredClone(state);
  nextRandom(oracle);
  nextRandom(oracle);
  const expectedKind = nextRandom(oracle) < SUPER_CRATE_CHANCE ? 'super' : 'normal';
  spawnCrates(state);
  expect(state.crates[0]?.kind).toBe(expectedKind);
  expect(state.rng).toBe(oracle.rng);
  ```
- [ ] **2 Verify RED:** `cd packages/sim && ../../node_modules/.bin/vitest run test/r1Crates.test.ts`; expected failing kind/RNG assertions, record actual failure.
- [ ] **3 Implement** schema, probability and spawn ordering; copy both docs unchanged, verify each with `cmp`; leave old normal literals valid by design.
- [ ] **4 Verify GREEN** with the same command plus existing crates/pad/respawn/determinism targeted tests. Existing expectation migrations: none; seeded spawn positions after the first centre drop may change intentionally, never pin old replay hashes.
- [ ] **5 Final gate + self-review + commit/PR** using Common gates. **E2E rule:** shared4173/reuseExistingServer; `ss -ltn | grep ':4173 '` empty, never kill another project, assert title Talad War; locked full suite once. PR body includes **Out-of-plan changes** and copy-integrity output.

**Acceptance:** seeded centre-only quality, no side chance draws, all identity transitions/hash tested; copied docs exact; locked intervals/caps unchanged. **Out of scope:** recipes, weapon behavior, art, bots and balance tuning.

### Card C2: Gun-slot heavy combat and independent super loadouts/permanent buddy perks

**Project facts / consumers:** combat/respawn (`packages/sim/src/combat.ts:80-149,165-221,249-325`), movement (`step.ts:141-148`), auto-aim (`autoAim.ts:20-53`), gun/attack FX (`apps/client/src/render/view.ts:131-198,253-291`), client aim/audio (`apps/client/src/hud/aimMarker.ts:20-32`; `apps/client/src/audio.ts:39-42`), normal combat fixtures (`packages/sim/test/combat.test.ts:27-54`; `respawn.test.ts:14-15,62-81,106-124`). C7 updates the display/audio classifications; don't edit client here.

**Task / exact files (8):** Modify `packages/sim/src/{types.ts,constants.ts,combat.ts,autoAim.ts,step.ts,index.ts}`; create `packages/sim/src/items.ts`, `packages/sim/test/r1Combat.test.ts`.

**Interfaces:** Produce GunSlot/WeaponKind/projectile metadata, four items.ts helpers, independent equipment flags and persistent unit flag, hit/explosion source metadata, version0.2.1. Consume optional defaults and C1 crate identity. No recipe grants yet: tests arm units directly.

- [ ] **1 RED tests:** `r1Combat.test.ts`: `normal_stats_equal_v1`, `super_gun_fires_after_5_ticks_and_aims_to_10_8`, `coconut_fires_after_30_ticks_and_uses_gun_target_priority`, `coconut_contact_and_range_expiry_explode_once`, `blast_hits_all_enemies_not_friends_and_stall_for_60_or_84`, `walls_stop_coconut_and_zero_direction_is_harmless`, `fresh_projectiles_wait_one_tick`, `projectile_super_survives_shooter_death_or_replacement`, `super_bomb_radius_2_8_and_last_throw_snapshots_quality`, `death_clears_slots_not_superBuddy_and_respawn_hp_125`, `superBuddy_moves_1_1_times_base_and_carry_speed`. Assert initial literal numbers and normal invariants; after authorized tuning, change only tunable literals to approved final values in this same file. Include exact-radius edges and lower-ID auto-aim ties. Range-expiry test varies the per-shot remaining distance to a non-integral last step.
      Representative profile assertions:
  ```ts
  expect(weaponStats({ ammoCooldownTicks: 0, super: true })).toMatchObject({
    range: 10.8,
    cooldownTicks: 5,
    damage: 12,
  });
  expect(weaponStats({ ammoCooldownTicks: 0, kind: 'heavy', super: true })).toMatchObject({
    damage: 42,
    radius: 1.6,
    stallMult: 2,
  });
  expect(unitMaxHp({ ...createMatch(1).units[0]!, superBuddy: true })).toBe(125);
  ```
- [ ] **2 Verify RED:** `cd packages/sim && ../../node_modules/.bin/vitest run test/r1Combat.test.ts`; missing helpers/variants and incorrect combat assertions must fail.
- [ ] **3 Implement** helpers, collision/AoE, flags/permanent perk and cooldown/range selection. Preserve normal attack behavior; ensure crate damage-drop uses the C1 object. Normal opened-gun representation need not change. Derive projectile damage only from projectile kind/super.
- [ ] **4 Verify GREEN**, then run existing combat/autoaim/respawn/movement/attackMotion/draw/winner tests. Existing expectation migrations: no normal fixtures; additive event metadata uses objectContaining where an event contract is intentionally extended, never weaken damage/timing assertions.
- [ ] **5 Final gate + self-review + commit/PR. E2E rule:** shared4173/reuseExistingServer; `ss -ltn | grep ':4173 '` empty; never kill another project; assert Talad War; locked full suite once. PR body includes **Out-of-plan changes** and locked-constant evidence.

**Acceptance:** all new combat/perk tests pass and old normal combat stays equivalent. **Out of scope:** recipe recognition, bot decisions, art/HUD; no new SFX assets, fire buttons or attack animation sheets.

### Card C3: Exact heavy recipe, super result/grants, and exhaustive Thai IDs

**Project facts / consumers:** matcher/preview (`packages/sim/src/pad.ts:61-128`), finish/clear/spawn (`open.ts:51-104`); preview consumer (`apps/client/src/hud/padPreview.ts:34-45`), Thai union/table (`apps/client/src/i18n/th.ts:20-23,39-45,63-72`), exhaustive translation test (`apps/client/test/i18n.test.ts:11-29`); open snapshots and normal equality expectations (`packages/sim/test/open.test.ts:113-187`), preview exact objects and old four-flat rejection (`pad.test.ts:263-339`), deterministic gun equality (`determinism.test.ts:155-174`).

**Task / exact files (8):** Modify `packages/sim/src/{pad.ts,open.ts,index.ts}`, `packages/sim/test/{pad.test.ts,open.test.ts,determinism.test.ts}`, `apps/client/src/i18n/th.ts`, `apps/client/test/i18n.test.ts`.

**Interfaces:** Produce Recipe including heavy, recipeResult, Preview.super always present, opened super/unitId, all grant semantics and Thai helpers/copy above, version0.2.2. C8 owns actual badge/status UI; keep compile-time consumers green now.

- [ ] **1 RED tests:** in pad tests enumerate all256 masks of4×2 cells; keep the old matcher as the v1 oracle for counts1/2, only mask `[ground,ground,ground,ground]` becomes heavy; four-with-upper/walls/3/diagonals/8 remain null. `preview_super_is_or_not_count_and_teamFull_keeps_quality` checks none/one/multiple supers and ban behavior. In open tests: `every_recipe_normal_and_super_grants_correct_slot_or_buddy`, `gun_heavy_replace_both_ways_and_normal_downgrades`, `bomb_stock_is_replaced_not_added_and_keeps_weapon`, `super_buddy_only_marks_new_unit`, `lift_super_on_done_tick_cancels_without_consuming`, `heavy_ban_fails_closed_super_ban_grants_normal`. Assert one opened event and cleared/deleted pad crates per completion. Add replay test with staged super-heavy/bomb/buddy openings: equal full hash/state and nonzero traffic, plus isolated flag-only hash sensitivity. In i18n tests exhaustive Record coverage of4 recipes/5 item IDs and quality labels; preserve Thai text coverage/reasons.
      Representative shape/quality assertions:
  ```ts
  const state = createMatch(1);
  state.pads.fruit.cells = [
    [100, null],
    [101, null],
    [102, null],
    [103, null],
  ];
  state.crates = [
    { id: 100, kind: 'super', state: 'onPad', pos: { x: 8.75, y: 18.75 }, landTick: 0 },
  ];
  expect(matchRecipe(state.pads.fruit)).toBe('heavy');
  expect(recipeResult(state, 'fruit')).toEqual({ recipe: 'heavy', super: true });
  state.pads.fruit.cells = [
    [100, 101],
    [102, 103],
    [null, null],
    [null, null],
  ];
  expect(matchRecipe(state.pads.fruit)).toBeNull();
  ```
- [ ] **2 Verify RED:** run `cd packages/sim && ../../node_modules/.bin/vitest run test/pad.test.ts test/open.test.ts test/determinism.test.ts`, and separately client `../../node_modules/.bin/vitest run test/i18n.test.ts`; capture actual mismatches, not just compilation errors.
- [ ] **3 Implement** matcher/resolver, quality-before-consumption grants, ban rules and translations. Normal recipes remain normal with missing crate-kind records. Add completion-time buddy-cap check without consuming blocked pads.
- [ ] **4 Verify GREEN** same commands and root typecheck. Migrate existing categories narrowly: four-flat expected null→heavy; exact Preview objects gain super:false/true; all3-recipe exhaustive lists gain heavy. Legacy normal gun equality and snapshot strings stay unchanged. Include both wall orientations explicitly despite mask sweep.
- [ ] **5 Final gate + self-review + commit/PR. E2E rule:** shared4173/reuseExistingServer; `ss -ltn | grep ':4173 '` empty; never kill another project; assert Talad War; locked full suite once. PR body includes **Out-of-plan changes** and valid/invalid shape matrix.

**Acceptance:** all8 recipe-quality outcomes, mixed quality, replacement, bans, cap/cancel/replay and Thai IDs pinned. **Out of scope:** class recipe, class picker, item HUD, bot tuning or changing snapshot to a second quality representation.

### Card C4: Bots finish heavy, prioritize supers and retain buddy building

**Project facts / consumers:** `packages/sim/src/bots/squad.ts:20-59`; fetch/attack/claim/duplicated shape code `packages/sim/src/bots/brain.ts:95-173,217-237,295-343,380-491`; old normal bot result/role/mirror/full-match expectations `packages/sim/test/bots.test.ts:53-87,208-254,269-375,378-442`. C5 consumes emitted opened/hit metadata; no separate counters stored in match state.

**Task / exact files (6):** Modify `packages/sim/src/bots/{squad.ts,brain.ts}`, `packages/sim/src/{constants.ts,index.ts}`, `packages/sim/test/bots.test.ts`; create `packages/sim/test/r1Bots.test.ts`.

**Interfaces:** Existing botInput/teamNeeds signatures unchanged; new deterministic priorities above and BOT_HEAVY_MIN_SUPPLY=4; use recipe matcher/items helpers, no alternate shape rules. Version0.2.3. No public new bot API needed.

- [ ] **1 RED tests:** `r1Bots.test.ts`: `needs_gun_then_buddy_with_bombs_then_heavy_with_supply_then_bombs`, `three_floor_crates_finish_heavy_before_bomb_rebuild`, `bans_choose_legal_alternatives`, `super_first_claims_do_not_collide`, `heavy_places_4_floor_cells_never_upper_or_premature_open`, `builder_survives_armed_switch_and_loaded_heavy_attacks`, `heavy_and_super_ranges_match_combat`, `new_loadouts_and_partial_pads_are_mirror_symmetric`, `six_natural_seeds_open_all_four_recipes_and_super`. Last test uses seeds1–6, natural createMatch(...,{humanUnit:null}), default commands, max18000 ticks/game, logs counts by recipe/quality and asserts each≥1; no injection. Other fixtures cover both sides, interrupted supply and upper-layer contamination. Preserve purity/hash replay tests.
      Representative need-order assertion (direct fixture; natural traffic is tested separately):
  ```ts
  const state = createMatch(1, { humanUnit: null });
  state.units[0]!.gun = { ammoCooldownTicks: 0 };
  state.units[1]!.bombs = 1;
  expect(teamNeeds(state, 'fruit')).toBe('buddy');
  state.pads.fruit.cells = [
    [100, null],
    [101, null],
    [102, null],
    [null, null],
  ];
  expect(teamNeeds(state, 'fruit')).toBe('heavy');
  ```
- [ ] **2 Verify RED:** `cd packages/sim && ../../node_modules/.bin/vitest run test/r1Bots.test.ts`; record traffic/decision failures.
- [ ] **3 Implement** stated decision ordering and crate claims; use matchRecipe on a temporary clone for placement. Keep one useful builder and canonical mirroring, range-aware attack.
- [ ] **4 Verify GREEN** same command plus existing bots tests. Migrations: old unconditional ≥2-gun attack assertion now tests the no-build-needed case (size cap, enough loadout), and separately asserts builder retention while a need exists. Keep lone-bot gun/bombs time limits. Full-match damage-share test switches from numeric-damage classification to hit.source and includes heavy in ranged totals/denominator; preserve ≥20 bomb opens/explosions, ≥25% ranged, median≥60s and0 timeouts. Do not delete the 200-seed regression.
- [ ] **5 Final gate + self-review + commit/PR. E2E rule:** shared4173/reuseExistingServer; `ss -ltn | grep ':4173 '` empty; never kill another project; assert Talad War; locked full suite once. PR body includes **Out-of-plan changes**, actual six-seed counts and mirror/purity evidence.

**Acceptance:** real all-bot gun/bombs/buddy/heavy and super traffic, no abandoned three-floor heavy, no magic RNG or cap/timing modifications. **Out of scope:** broad navigation refactor, extra squads/classes, changing player pick priority, balancing by weakening old tests.

### Card C5: Reproducible balance telemetry, bans and R1-only tuning

**Project facts / consumers:** `packages/sim/src/harness.ts:6-34,46-88,91-147`; old fabricated BatchResult fixtures/timeouts `packages/sim/test/harness.test.ts:5-23,43-72`; npm CLI `packages/sim/package.json:8-11`; CI invocation `.github/workflows/ci.yml:15`; source-aware bot damage regression from C4. Keep CI command unchanged and strengthen harness semantics.

**Task / exact files (5):** Modify `packages/sim/src/{harness.ts,constants.ts,index.ts}`, `packages/sim/test/harness.test.ts`, `packages/sim/test/r1Combat.test.ts` (only authorized tuned-number assertions). Reports/logs go to the worker's scratch deliverables, NOT docs in the repo.

**Interfaces:** `BatchOpts` adds `ban?: {team:Team;item:ItemBan}`; `BatchResult` adds `opens:Record<Team,Record<Recipe,number>>`, `superOpens:Record<Team,number>`, `stallDamage:Record<Team,Record<'slap'|'gun'|'bombs'|'heavy',number>>`. CLI adds paired `--ban-team fruit|dessert --ban-item heavy|super`, rejects partial/unknown values with exit1. `checkTargets(result:BatchResult, ban?:{team:Team;item:ItemBan}):TargetCheck`: normal bands300–480,45–55%,0 timeouts,≤0.5ms/tick; ban mode0 timeouts/≤0.5ms/tick/banned-team≥40%, without the symmetric45–55% or normal pacing requirement. Version0.2.4.

- [ ] **1 RED tests:** harness unit tests reject1 timeout, accept0 and inclusive edges; result fixtures enumerate new counts. Verify normal/ban argument validation, per-team recipe/quality/source accumulation, wins+draws+timeouts accounting, repeated batches equal except timing. Ban policy fixtures must show heavy cannot grant/fire, super gun/bomb/buddy/heavy all resolve normal for only the banned side, unchanged opponent and shared crate RNG. Cover normal 40% rejection versus ban40% acceptance. Initially run an untuned1000-game batch as a measurement, not an assumed RED.
      Representative check assertions using the extended IN_BAND fixture:
  ```ts
  expect(checkTargets({ ...IN_BAND, timeouts: 1 }).ok).toBe(false);
  const asymmetric = { ...IN_BAND, timeouts: 0, winRate: { fruit: 0.4, dessert: 0.6 } };
  expect(checkTargets(asymmetric).ok).toBe(false);
  expect(checkTargets(asymmetric, { team: 'fruit', item: 'heavy' }).ok).toBe(true);
  ```
- [ ] **2 Verify RED:** `cd packages/sim && ../../node_modules/.bin/vitest run test/harness.test.ts`; missing telemetry/zero-timeout/ban checks fail. Record current constants and baseline results before tuning.
- [ ] **3 Implement** telemetry and CLI; set itemBans once on each newly created batch match. Tune ONLY SUPER_CRATE_CHANCE (initial1/8, range1/16–1/8), SUPER_GUN_COOLDOWN_TICKS (must <6), SUPER_GUN_RANGE (>9, on bullet-distance grid), SUPER_BOMB_RADIUS (>2.2), SUPER_BUDDY_MAX_HP (>100), SUPER_BUDDY_SPEED_MULT (>1), HEAVY_DMG, SUPER_HEAVY_DMG (>HEAVY_DMG), HEAVY_RANGE, HEAVY_COOLDOWN_TICKS (>6), COCONUT_SPEED, HEAVY_RADIUS, HEAVY_STALL_MULT, BOT_HEAVY_MIN_SUPPLY (≥4). Keep super bomb count5. Use small fixed batches while iterating, update only tuned literal assertions in r1Combat tests. Do not alter bot decision code here; escalate a genuine strategy failure to Lead rather than growing this card.
- [ ] **4 Verify GREEN and measured acceptance** with targeted harness/combat/bot tests, then `npm run sim -- --games 1000 --seed0 1 --assert`. Run four ban commands: `npm run sim -- --games 200 --seed0 1 --ban-team fruit --ban-item heavy --assert`, same with dessert/heavy, fruit/super, dessert/super. Each banned side≥40%,0 timeouts; report counts and ensure the unbanned side actually opened the item/quality being tested (nonzero), so the ban comparison is not vacuous. Report normal recipe/super opens and stall damage shares against Lead baseline. If no allowed constants meet gates, stop with evidence and owner/Lead A/B options; do not relax seeds/thresholds. C4's six-seed test must still pass.
- [ ] **5 Final Common gate + self-review + commit/PR. E2E rule:** shared4173/reuseExistingServer; `ss -ltn | grep ':4173 '` empty; never kill another project; assert Talad War; locked full suite once. PR body includes **Out-of-plan changes**, every before→after constant, final1000 and four ban JSON outputs, seeds, exits, runtime environment and unchanged locked values. Artifacts: genuine balance log/CSV, no synthetic run data.

**Acceptance:** reproducible normal and both-direction ban gates; bots use all outcomes; no mandatory new option; final constant evidence. **Out of scope:** solving v1 gun/bomb mandatory-pick history, changing win denominator, seeds, performance cap or locked pacing knobs.

### Card C6: Install approved R1 props and enforce real art/total-load budgets

**Project facts / consumers:** manifest prop schema `apps/client/src/render/anims.ts:5-24`; automatic loader `apps/client/src/scenes/Boot.ts:29-43`; existing budget tests and total-dist script `apps/client/test/loadBudget.test.ts:20-39`; `apps/client/scripts/check-load-budget.mjs:10-28`. Current measured art2,497,698 bytes +80,386 before manifest growth; no budget increase planned.

**Task / exact files (6):** Create `apps/client/public/art/{prop_crate_super.webp,prop_crate_super_air.webp,prop_shot_coconut.webp,prop_badge_super.webp}`; modify `apps/client/public/art/manifest.json`, `apps/client/test/loadBudget.test.ts`.

**Interfaces:** Merge staging `out/props_r1.json` INTO manifest.props: crate_super470×401, crate_super_air430×425, shot_coconut278×207, badge_super216×202, exact filenames. Retain every existing manifest field. Runtime keys are those four names, not filenames with prop_ prefix.

- [ ] **1 RED tests:** extend loadBudget tests with real-art checks: all four keys exist with exact dimensions/files; every referenced file exists; sum of all public/art files≤3,000,000; no duplicate prop keys or dropped old entries. Retain5MB exact-edge/over/missing-build tests. Committed tests must be self-contained and must NOT read the external staging directory. For copy-integrity assertions, pin the architect-measured SHA-256 values below; additionally compare source/destination hashes locally when copying.

| File                                                                        | Measured SHA-256                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `prop_crate_super.webp`                                                     | `22cf816ba5fbaccc6ab2e7fa154243d118bac5d6546a97157e7fdfc2331c2593` |
| `prop_crate_super_air.webp`                                                 | `b2c69fa5e801b9d05990a5724ab7c88d76491be7dd11ed5d365382086c5be2a6` |
| `prop_shot_coconut.webp`                                                    | `3aa97503f99a5d1fcb34b9e2c196efaeaed14524fa3487911f9899a267c06e27` |
| `prop_badge_super.webp`                                                     | `2574f8665f72abb91e4949208b0d5f63a059eafba698d2686961ec6e5c8e1e82` |
| Representative assertion after reading the checked-in manifest in the test: |

```ts
expect(manifest.props.crate_super).toEqual({
  file: 'prop_crate_super.webp',
  width: 470,
  height: 401,
});
expect(manifest.props.shot_coconut).toEqual({
  file: 'prop_shot_coconut.webp',
  width: 278,
  height: 207,
});
expect(actualArtBytes).toBeLessThanOrEqual(3_000_000);
```

- [ ] **2 Verify RED:** `cd apps/client && ../../node_modules/.bin/vitest run test/loadBudget.test.ts`; expected missing new props/files, record it.
- [ ] **3 Copy/merge** assets byte-for-byte; no recompression/regeneration. No Boot edit: loader is already data-driven.
- [ ] **4 Verify GREEN** targeted tests and `npm run test -w @talad/client` (includes real fresh-build budget). Record both actual art bytes and `Load budget: ... / 5000000 bytes — OK`. Budget increase is not authorized by this measured plan; if unexpectedly needed, ask Lead for a scoped script/test allowance and declare it, ceiling3.2MB art only, never5MB total.
- [ ] **5 Final gate + self-review + commit/PR. E2E rule:** shared4173/reuseExistingServer; `ss -ltn | grep ':4173 '` empty; never kill another project; assert Talad War; locked full suite once. PR body includes **Out-of-plan changes**, copy hashes, manifest entries and exact budgets.

**Acceptance:** approved art installed intact, caps verified on real files/build. **Out of scope:** art generation, animation sheets, budgets raised pre-emptively, loader/layout refactor.

### Card C7: Render super cargo and coconut combat, preserve correct SFX classification

**Project facts / consumers:** `apps/client/src/render/view.ts:131-198,253-291,343-359,420-599`; `apps/client/src/audio.ts:21-43`; normal audio fixture `apps/client/test/audio.test.ts:6-13,80-119`; renderer observations `apps/client/src/scenes/Match.ts:158-219` and `apps/client/src/testHooks.ts:37-58`; existing art behavior tests `apps/client/e2e/lanternArt.spec.ts:102-153,157-247,250-311`. No changes to existing hook shape required here.

**Task / exact files (4):** Modify `apps/client/src/render/view.ts`, `apps/client/src/audio.ts`, `apps/client/test/audio.test.ts`; create `apps/client/e2e/r1Art.spec.ts`.

**Interfaces:** Consume C1/C2 metadata and C6 texture keys. Keep MatchView.sync API; expose real projectile sprites by name `projectile-<id>` via existing artFeedback. FX data.kind becomes heavy/gun/slap and data.size144/96 for heavy/gun. Coconut uses existing fire SFX, not throw; dedupe new IDs as now.

- [ ] **1 RED tests:** audio `new_coconut_maps_to_fire_once_not_throw` and quality-independent classification. E2E r1Art uses existing renderSnapshot/clock staging, asserting exact super textures for falling/ground/carried/pad upper and both mixed stack orders; new coconut texture/rotation/aspect ratio; normal textures unchanged. Assert top-edge super cargo within720-stage bounds; heavy144 muzzle vs96 normal, one flash per attack tick, reduced-motion static behavior. Test a projectile remaining super while holder is absent/rearmed. Every scene starts via waitHooks (title guard).
      Representative audio assertions:
  ```ts
  const cur = createMatch(1);
  cur.projectiles = [
    {
      id: 900,
      team: 'fruit',
      kind: 'coconut',
      super: true,
      pos: { x: 20, y: 12 },
      vel: { x: 12, y: 0 },
      ttlTicks: 15,
    },
  ];
  expect(sfxForTick(null, cur)).toEqual(['fire']);
  expect(sfxForTick(cur, cur)).toEqual([]);
  ```
- [ ] **2 Verify RED:** client `../../node_modules/.bin/vitest run test/audio.test.ts`; root `run-locked talad-war-e2e npm run e2e -w @talad/client -- e2e/r1Art.spec.ts` (name the new describe block exactly `R1 art`). Target the client workspace directly so nested root npm scripts cannot swallow Playwright arguments. Apply port rule before targeted runs too. Expected missing textures/FX/classification assertions, not wrong-app failures.
- [ ] **3 Implement** texture/FX/height changes in existing renderer; preserve art ratios and v1 motion. Distinguish coconut from both bomb and bullet in rendering/audio, snapshot-derived visuals only. Do not introduce new sound files or shader dependencies.
- [ ] **4 Verify GREEN** targeted audio/new art plus lanternArt/stallHit specs as needed (single locked targeted invocation may select filenames). Set `test.use({video:'on'})` in the new art spec to capture a real Playwright recording for normal/heavy/super shots and carry/landing, run `media-check <recording> --ask "Check coconut identity, heavier muzzle readability, super crate visibility in carry/stack, loop timing and flicker" --expect "Distinct coconut and static readable star; no stretching, duplicate flash or strobe"`; quote actual VERDICT and timestamps. If SKIPPED, record manual frame-by-frame evidence, not an invented verdict.
- [ ] **5 Final gate + self-review + commit/PR. E2E rule:** shared4173/reuseExistingServer; `ss -ltn | grep ':4173 '` empty; never kill another project; assert Talad War; locked full suite once. PR body includes **Out-of-plan changes**, desktop/touch screenshots and recording/media evidence.

**Acceptance:** super identity survives every visual state, coconut/heavier FX/SFX correct, old normal animations and reduced-motion tests pass. **Out of scope:** new character poses/sheets, camera shakes, weapon sprite, broad view.ts extraction. Flag `hotspot: apps/client/src/render/view.ts` if another branch edits it; do not pile on.

### Card C8: Super preview, held-item HUD and deterministic interaction E2E

**Project facts / consumers:** preview and winner classes `apps/client/src/hud/padPreview.ts:22-55`, `status.ts:9-25`; construction/sync/cleanup `apps/client/src/scenes/Match.ts:89-118,286-311,352-361`; hook/helper type copies `apps/client/src/testHooks.ts:56-85`, `apps/client/e2e/helpers.ts:33-65`; HUD layout `apps/client/src/shell.css:20-26,104-159,197-284`; current exact preview text `apps/client/test/hud.test.ts:96-122`; existing E2E text expectation `apps/client/e2e/match.spec.ts:117`. Thai functions supplied by C3, do not redefine strings in HUD.

**Task / exact files (8):** Modify `apps/client/src/hud/{padPreview.ts,status.ts}`, `apps/client/src/shell.css`, `apps/client/test/hud.test.ts`, `apps/client/src/scenes/Match.ts`, `apps/client/src/testHooks.ts`, `apps/client/e2e/helpers.ts`; create `apps/client/e2e/r1Hud.spec.ts`.

**Interfaces:** PreviewText keeps constructor/sync/el; MatchHud keeps constructor/sync, adds itemEl. Add hook `setPadLayout(team:Team, entries:ReadonlyArray<{col:number;layer:0|1;kind?:CrateKind}>):void` to both hook type surfaces and gated Match implementation. It removes old pad crates, clears opening, validates columns/duplicates/support before mutating, creates unique-ID real onPad crates and syncs. Default missing kind normal. Preserve `setPadCrates(team,cols)` behavior by delegating ground normal entries. No mutable raw-state/loadout setter in production. Test rendering-only states with renderSnapshot; exercise actual crafting via input and this layout staging.

- [ ] **1 RED tests:** hud tests name heavy/super correctly, show star only for upgraded result, prefer teamFull error over recipe name, empty/finished hides preview; assert item primary/cargo and independent bomb badge/count, last bomb/death/reset clear stale quality, missing-image event keeps Thai text; normal “จะได้: ปืนฉีดน้ำ” unchanged. E2E describe `R1 HUD`: stage4 floor crates/one super, preview star+heavy; use real Open input, wait20ticks, observe heavy HUD and launch coconut via desktop/touch input. Open normal gun over heavy and super bombs over normal stock, assert replacement/5 stock/badge isolation. Separate stacked-super-buddy grant checks flag, not character switching. Test malformed hook layouts reject without changing state, repeat staging leaves no orphan crates.
      Representative HUD assertions:
  ```ts
  const state = createMatch(1);
  const hud = new MatchHud(document.createElement('div'));
  hud.sync(state);
  expect(hud.itemEl.textContent).toContain('มือเปล่า');
  state.units[0]!.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
  hud.sync(state);
  expect(hud.itemEl.textContent).toContain('บาซูก้ามะพร้าว พิเศษ');
  ```
- [ ] **2 Verify RED:** client `../../node_modules/.bin/vitest run test/hud.test.ts`; root `run-locked talad-war-e2e npm run e2e -w @talad/client -- e2e/r1Hud.spec.ts` with preflight/title rule. Observe missing hook/HUD/badge failures.
- [ ] **3 Implement** tokenized HUD/preview and staging hook only inside existing test guard. No scene lifecycle rewrites: extend MatchHud already being synced/removed. Clamp preview, keep textual super fallback, no pointer interception. Synchronize all three hook declarations/implementations.
- [ ] **4 Verify GREEN**, including translations from C3, existing hudPolish/match/journey targeted specs. Check desktop1280×800, touch844×390, portrait390×844 rotate state; live item/preview boxes inside viewport and disjoint from controls/HP/timer; failed badge image has no broken placeholder. Test initial/unarmed, all equipped qualities, empty/invalid/teamFull, death/respawn, restart and end states. Verify production build contains no __talad hook (existing guard contract at `apps/client/vite.config.ts:6-10`). Capture genuine screenshots; include a recording/media-check only if motion/FX is changed beyond C7.
- [ ] **5 Final gate + self-review + commit/PR. E2E rule:** shared4173/reuseExistingServer; `ss -ltn | grep ':4173 '` empty; never kill another project; assert Talad War; locked full suite once. PR body includes **Out-of-plan changes**, Thai/viewport/state evidence, screenshot URLs/attachments and hook-stripping check.

**Acceptance:** player can predict recipe+quality before opening, identify carried/equipped items after opening, and see errors without stale promises/stars; all IDs translated, responsive layout and actual desktop/touch crafting proven. **Out of scope:** new screen, class buttons, Q rebinding, weapon selection wheel, four-team HUD or demo-only injected result masquerading as gameplay.

## OWNER? and execution handoff

- **OWNER? Nonblocking provenance question:** Lead's extra historical “1200 seeds (1000–6199)” sample needs its actual sampled seed list/command if the owner wants that study reproduced. Recommendation: retain it as historical context; gate R1 with the explicitly fixed1–1000 and1–200 runs above. Do not guess or block implementation on this optional replay.
- **OWNER? Post-build play gate, not an unresolved implementation choice:** after R1 meets automated gates, does impact-on-contact/range-expiry coconut splash and the measured final super/buddy strength feel right? These are explicit builder proposals under design §9, not claims of additional owner approval. Show the real playable build, do not regenerate approved art. If the owner wants fuse/gravity, friendly fire, stacking bonuses or another feel change, return to Architect for a scoped amendment instead of letting a worker choose silently.
- No owner decision blocks writing this plan. No new page/design approval is missing; this is an extension of the existing match HUD using the supplied approved art and documented tokens.
- Plan self-review: all task-body requirements map to contracts/C1–C8; each card has≤5 steps and≤8 exact files (including tests/docs/assets), RED-first commands, live-consumer references and narrow migrations; protected v1 behavior and all five Review Focus cases have owning tests. No product implementation has been performed.
- **Execution method:** recommend the owner's established board worker + independent review method, running these briefs by their dependency graph. Lead should review this plan before creating/dispatching implementation cards; no extra speculative work or self-assigned cards. Final release/deploy requires its own role-authorized card after C5+C8 and QA.
