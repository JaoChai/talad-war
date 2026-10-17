# Talad War v2 R2 Classes and Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four persistent teammate classes, deterministic class recruitment and teammate switching, retaining the shipped R1 game and its balance gates.

**Architecture:** A wall recruits a NEW class teammate; it does not transform the opener. Class traits remain unit-owned, equipment remains slot-owned, and control is derived from the existing `isBot` flag rather than a second client-only player ID. The pure sim owns all choices, opening completion, abilities and switching; DOM controls only submit tick inputs, while frame-attached accessories reuse the eight existing character sheets.

**Tech Stack:** Existing TypeScript simulation, Vitest, Phaser 4, DOM/CSS HUD, Vite, Playwright and the existing CLI balance harness. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-classes-crates-four-teams-design.md`, especially §§2, 4 recipe table, 5, 7 and 8.3/8.4/8.7. Source approved design: `/home/jaochai/Code/team-buddies-art-staging/v2-r2-2026-10-17/2026-10-16-classes-crates-four-teams-design.md`. Additional owner approval: 2026-10-17 “A”, the two `img/r2_classes_*.png` samples and `img/r2_pick_mockup.png` in that staging directory, with the accessory descriptions in the planning card. The design file's old “draft” header is not an instruction to reopen the owner's approval.

## Global Constraints

- PLAN ONLY here: the only deliverable written to staging is `plan-r2.md`. No product edits, commits, branches, PRs or deploys were made by the Architect.
- Implementation base: `JaoChai/talad-war`, fetched `origin/main` = `892cb2cc5a9157fdd947f4d6e38f6ea5716af87f` (live v0.0.17 according to the card). Rebase implementation briefs against the actual base before starting; line numbers below refer to that SHA, not a moving checkout.
- “Team cap stays 5 (alive + dead), start 3.” Class recruitment uses a slot just like ordinary buddy recruitment. There is no reclass/upgrade-existing-unit command in R2.
- “Class and ‘super teammate’ bonuses belong to the unit and survive death/respawn”; gun, heavy weapon, bombs and crate do not survive. A plain stacked buddy is classless.
- “Whole arena stays on screen (no camera)”: retain 40×24, existing collision radii and pad geometry. Keep `Team` as an extensible string-literal union; class/control APIs accept `Team`/unit IDs, never a new boolean team representation. Do not implement R3.
- “median 5–8 min”, two-team wins “45–55 %”, 1,000 all-bot matches, zero timeouts. Removal floor is pinned here to **0.40**, inclusive, for the banned side, with both sides tested separately.
- LOCKED: `RESPAWN_TICKS`, `OPEN_TICKS`, `TEAM_CAP`, `STALL_MAX_HP`, pad sizes, `UNIT_SPEED`, `CARRY_SPEED`, all drop intervals, and **all R1 recipe/super constants**. R2 may add class-specific multipliers, not change their bases or R1 profiles.
- Art remains ≤3,000,000 B; first-load total remains ≤5,000,000 B. Do not raise either test silently. A contingency art ceiling ≤3,200,000 B needs owner approval and must still fit the unchanged total-load ceiling.
- Workers copy Lead-supplied art; they never generate, redraw or recut art. No new character sheets, audio or dependencies.
- Thai UI copy; English code and plan. Keep existing command, input, journey, quality and independent-loadout semantics except the explicit contextual class-pick changes below.
- Every implementation card inherits Gate G, the port rule, PR-body contract and assertion-migration rules below. Run targeted specs while iterating; run the entire local e2e suite at most once per worker, at its end.
- Work only in a dispatcher-provided task worktree, never the primary working tree or another task's `.worktrees/`. Release/deploy remains `dev-release` work under a separate explicit release authorization.

## Review Focus

1. **Stale choice / death / changed pad:** a queued class tap must not consume a replacement wall or recruit after its opener dies. R2-3 `stale_choice_and_cancel_boundaries` pins this.
2. **Persistent traits versus transient slots:** class, super quality and bot/human ownership survive a death, while equipment and Ninja cooldown do not. R2-4 `all_classes_respawn_with_traits_without_items` pins this.
3. **Overlapping healers / simultaneous lethal damage:** heal rate must not multiply, revive a corpse or depend on unit iteration order. R2-4 `healing_is_max_not_sum_and_never_revives` pins this.
4. **Control handoff with held inputs / dead source / sparse IDs:** never move or fire the new body with buffered inputs, and never target an array index as an ID. R2-5 `switch_discards_source_actions_and_is_order_stable`, R2-10 `handoff_clears_all_control_latches` and R2-11 real-input e2e pin this.
5. **Small viewport / tall Giant / missing accessory:** recruitment and control must remain readable without hiding cargo or the head at the upper edge; failure of an icon must leave a usable named button. R2-8 geometry/art tests and R2-11 layout/failure-state e2e pin this.

---

## 1. Verified baseline and source map

All existing-behaviour statements in this plan cite repository-relative `file:line` ranges from the fetched SHA above. “New” interfaces and values are design decisions, not claims that they already exist. The inspected tree was a `git archive origin/main` extracted OUTSIDE the repository at `/home/jaochai/.hermes/profiles/dev-architect/cache/scratch/r2-main`.

### Measurements actually executed

| Command / location                                                                           | Observed result                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git -C /home/jaochai/Code/talad-war fetch origin` then `git ... rev-parse origin/main`      | exit 0; SHA above. `git status --short` showed existing untracked `vc-base*` directories; they were not touched.                                                                       |
| `npm ci` in scratch archive                                                                  | exit 0; 181 packages added, 184 audited; **5 high severity vulnerabilities** reported. No audit fix or dependency change performed.                                                    |
| `npm run typecheck && npm run lint && npm run format:check` in scratch                       | exit 0; both workspace typechecks and lint passed; “All matched files use Prettier code style!”                                                                                        |
| `npm test` in scratch                                                                        | exit 0; sim: **19 files, 199 passed, 3 expected fail (202)**; client: **9 files, 85 passed**. Included production build and “Load budget: **4626079 / 5000000 bytes — OK**”.           |
| `npm run sim -- --games 200 --assert` in scratch                                             | exit 0; median **310.15 s**, p90 **370.325 s**, fruit **0.53**, dessert **0.47**, draws **0**, timeouts **0**, ms/tick **0.04065765506514504**, `assert: "pass"`.                      |
| `npm run sim -- --games 1000 --assert` in scratch                                            | exit 0; median **308.625 s**, p90 **371.505 s**, fruit **0.492**, dessert **0.508**, draws **0**, timeouts **0**, ms/tick **0.04034000649897507**, `assert: "pass"`. Full JSON in §10. |
| Recursive Python `Path.rglob` sum of `apps/client/public/art`                                | **2,578,522 B**, leaving **421,478 B** to the 3,000,000 B ceiling.                                                                                                                     |
| `cmp docs/superpowers/specs/2026-10-16-classes-crates-four-teams-design.md <staging-design>` | exit 0; approved design is already present byte-for-byte.                                                                                                                              |
| `hermes profile list`                                                                        | exit 0; proposed execution profiles `dev-backend`, `dev-frontend`, `dev-qa`, `dev-reviewer`, `dev-release` exist. No cards created by this plan-only task.                             |

A fresh 1,000-game baseline is recorded in the execution-evidence addendum at the end. No baseline Playwright run, live browser inspection, screenshot comparison, animation/media check or R2 balance run was performed by the Architect. Baseline test counts above are not R2 acceptance results.

### Live source/consumer ledger

| Concern                                    | Existing implementation and every direct production consumer relevant to the change                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types / recipes                            | `packages/sim/src/types.ts:3-15,22-49,62-68,103-120`: `Team`, `ItemBan`, input, unit, opening and match rules. `packages/sim/src/pad.ts:6-15,71-95,105-127,142-149`: recipe union, matcher, bans/quality, preview, open eligibility. Four walls currently return null; legacy malformed floating one/two-cell fixtures are also accepted by the matcher. Preserve that R1 oracle outside the four newly legal wall masks. |
| Opening / cap                              | `packages/sim/src/open.ts:23-32,40-88,92-115,119-128`: snapshot channel, death/content cancellation, cap recheck, buddy ID allocation/spawn, consume entire pad. Existing cancellation does **not** check that the opener stays on the pad.                                                                                                                                                                               |
| Phase ordering                             | `packages/sim/src/step.ts:38-65,79-122,124-137,142-149`: clone, bot inputs, movement before opening, open completion **before** combat, then respawn. New rules must respect the completion-before-combat boundary, not claim to cancel an already-completed opening retroactively.                                                                                                                                       |
| Stats / combat                             | `packages/sim/src/items.ts:71-78`: max HP and speed helpers; direct consumers `packages/sim/src/step.ts:142-146`, `packages/sim/src/combat.ts:113-128`. Slap and cooldown: `combat.ts:65-89,225-246`. Blast-source routing and damage/death: `combat.ts:310-355`. Weapons/quality remain in `items.ts:28-68`.                                                                                                             |
| Crate ejection                             | `packages/sim/src/pad.ts:22-37,56-63`: pad-cell/top helpers. `packages/sim/src/crates.ts:102-115,122-144`: real-object drop and deterministic nearest-ground resolution (0.1 grid, distance/x/y tie). `packages/sim/src/map.ts` supplies its walkability checks; reuse them, do not add a second collision system.                                                                                                        |
| Setup / bot identity                       | `packages/sim/src/setup.ts:25-50,55-71`: default human ID 0, `humanUnit: null` means all bots; 3+3 initial units. `packages/sim/src/step.ts:58-65`: bots override passed inputs. No stored human-control field exists in `MatchState` (`types.ts:103-120`).                                                                                                                                                               |
| Bots                                       | `packages/sim/src/bots/squad.ts:10-42,46-68,79-85`: goal, needs and human-team defaults. `packages/sim/src/bots/brain.ts:69-87,96-165,236-352,404-442,454-490`: authored inputs, fetch/channel, combat, super-first claims and placement. It derives decisions from state without persistent brain memory (`brain.ts:62-67`).                                                                                             |
| Harness                                    | `packages/sim/src/harness.ts:7-26,59-105,133-161,168-195`: options/results, recipe counters/event validation, target checking, two existing CLI bans. All-bot creation at `:79`. Existing targets are 300–480 s, 0.45–0.55 and ≤0.5 ms/tick (`:37-39`).                                                                                                                                                                   |
| Determinism / replay version               | `packages/sim/src/hash.ts:4-13,26-30`: full-state canonical hash; it automatically includes new data. `packages/sim/src/index.ts:1-19` exports modules and pins `SIM_VERSION = '0.2.4'`; `packages/sim/test/smoke.test.ts:4-7` asserts the literal. No replay-file loader/version-migration feature is being added.                                                                                                       |
| Keyboard collision                         | `apps/client/src/input/keyboard.ts:21-29,33-58`: E is pick/drop/open; Q throws. **Additional verified collision:** digits 1/2/3 already send squad commands (`apps/client/src/scenes/Match.ts:22-32,134-144`). Neither binding may change silently. No `KeyR` binding was found in `apps/client/src` in the source search.                                                                                                |
| Touch / scene ownership                    | `apps/client/src/input/touch.ts:6-12,54-92,95-118`: touch read/actions; `apps/client/src/hud/buttons.ts:16-24`: original four buttons. `apps/client/src/scenes/Match.ts:68-119,134-144,346-365,377-423`: lifecycle, key routing, fixed tick, sync, unit-0 input merge.                                                                                                                                                    |
| Every hardcoded production player consumer | `apps/client/src/scenes/Match.ts:22,353-357,400-421`; `apps/client/src/render/view.ts:201-222`; `apps/client/src/hud/status.ts:47-93`; `apps/client/src/hud/padPreview.ts:12-15`; `apps/client/src/hud/aimMarker.ts:20-25`. These all migrate to `controlledUnit(state)`; team-fruit stall bars/commands are not player-body selectors and stay fruit-scoped in R2.                                                       |
| Render geometry / animation                | `apps/client/src/render/anims.ts:11-24,26-47,53-65`: manifest and poses. `apps/client/src/scenes/Boot.ts:29-42`: character-sheet and prop loading. `apps/client/src/render/view.ts:18-26,127-198,229-239,346-352,490-499`: skins, 92 px display body, pose/lunge/flip, top clamp and cargo attachment. `apps/client/src/render/world.ts:5-13,26-29`: logical stage 1280×720, world projection, 92 px minimum draw Y.      |
| Current marker                             | `apps/client/src/render/view.ts:76-96,201-222`: gold overhead triangle; `apps/client/src/hud/aimMarker.ts:6-17`: BLUE target ring. New WHITE player ring/arrow must not replace/confuse that blue enemy-target ring or the team rings.                                                                                                                                                                                    |
| HUD / copy / tokens                        | `apps/client/src/hud/status.ts:5-26,59-93`: independent primary/cargo and bomb display with failed-image hiding. `apps/client/src/hud/padPreview.ts:36-67`: fruit-pad preview/position. `apps/client/src/i18n/th.ts:9-61,69-100`: Thai table and recipe mapping. `apps/client/src/shell.css:29-45,144-170,217-271,291-375,395-399,853-874`: tokens, controls, loadout, desktop touch hiding and short-height commands.    |
| Art schema / budget                        | `apps/client/public/art/manifest.json:2-61` gives cell 256 and first skin's 18 named frames/anchor; the eight skin records occupy `:3-475`, props/arena follow. `apps/client/test/loadBudget.test.ts:22-64,66-101,116-135`: R1 hashes, manifest files, canonical legacy hash, recursive 3 MB art and 5 MB total checks. `apps/client/scripts/check-load-budget.mjs` is invoked by the client test script.                 |
| E2E / gates                                | `apps/client/playwright.config.ts:8-34`: max two local workers, desktop 1280×800, touch 844×390, port 4173 with `reuseExistingServer`. `apps/client/e2e/helpers.ts:75-89` already asserts title `Talad War`. `.github/workflows/ci.yml:10-18`: install/type/lint/format/test/200-game asserted sim/build/e2e; `AGENTS.md:21-33` adds `run-locked talad-war-e2e`.                                                          |
| Test hooks / journey scores                | `apps/client/src/testHooks.ts:30-35,37-90`; actual hook implementation `apps/client/src/scenes/Match.ts:147-199,283-339`. `apps/client/e2e/helpers.ts:6-30,127,274` has reduced hook types and unit-0 driver assumptions. Seed-pinned score **1414.25** and displayed **1414** are in `apps/client/e2e/journey.spec.ts:102-117`; they can legitimately migrate only with measured new output.                             |

## 2. Decisions and exact simulation contracts

These are the shared contracts to copy into the corresponding card bodies. No worker may independently rename them.

### 2.1 Class data, quality and version ownership

New declarations in `packages/sim/src/types.ts`:

```ts
export type UnitClass = "boxer" | "healer" | "ninja" | "giant";
export interface ClassPick {
  classId: UnitClass;
  snapshot: string;
}
// Add to Unit (optional for legacy fixtures):
// classId?: UnitClass;
// ninjaKnockReadyTick?: number;
// Add to UnitInput (missing = no request):
// classPick?: ClassPick;
// switchNext?: boolean;
// Add to Pad.opening's existing object:
// classId?: UnitClass;
// Widen existing ItemBan:
// 'heavy' | 'super' | 'class' | UnitClass
```

Missing `classId` means basic; do not add a fifth `'basic'` class or make every legacy fixture specify it. `superBuddy === true` remains the persistent teammate-quality flag for **both** classless super buddies and super classes. Do not inherit this flag into equipment. No extra `superClass` flag or client-owned class table.

New `packages/sim/src/classes.ts` exports:

```ts
export const CLASS_IDS: readonly UnitClass[]; // boxer, healer, ninja, giant; frozen order
export interface ClassStats {
  maxHp: number;
  speedMult: number;
  slapDamage: number;
  bombDamageMult: number;
}
export function classStats(classId: UnitClass): ClassStats;
export function unitSlapDamage(unit: Unit): number;
export function unitBombDamageMult(unit: Unit): number;
// Added by the abilities card, not by the data-only card:
export function updateClassHealing(s: MatchState): void;
export function tryNinjaKnock(s: MatchState, unit: Unit): boolean;
```

`classStats` returns read-only-in-practice data, with no state mutation, RNG or wall time. Existing exported `unitMaxHp(unit: Unit): number` and `unitMoveSpeed(unit: Unit): number` stay in `items.ts`, same signatures. They consume class stats. `unitSlapDamage` defaults to `SLAP_DMG`; `unitBombDamageMult` defaults to 1.

Initial **R2-only** constants, all in `constants.ts`; these are starting values, NOT falsely labelled harness-tuned results:

| Constants                                                                                                                                              | Initial value / definition                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `BOXER_MAX_HP`, `BOXER_SPEED_MULT`, `BOXER_SLAP_DMG`                                                                                                   | 130, 1.10, 12                             |
| `HEALER_MAX_HP`, `HEALER_SPEED_MULT`                                                                                                                   | 100, 1.00                                 |
| `HEALER_RADIUS`, `HEALER_AURA_HP_PER_SEC`, `HEALER_SELF_HP_PER_SEC`                                                                                    | 3.25 world units, 4 HP/s, 2 HP/s          |
| `NINJA_MAX_HP`, `NINJA_SPEED_MULT`, `NINJA_KNOCK_COOLDOWN_TICKS`                                                                                       | 75, 1.35, 40 ticks                        |
| `GIANT_MAX_HP`, `GIANT_SPEED_MULT`, `GIANT_BOMB_DAMAGE_MULT`                                                                                           | 200, 0.75, 0.60                           |
| `CLASS_SUPER_HP_MULT`, `CLASS_SUPER_SPEED_MULT`                                                                                                        | 1.05, 1.03                                |
| `BOT_CLASS_MIN_SUPPLY`, `BOT_CLASS_TARGET_COUNT`                                                                                                       | 4 usable crates, 2 persistent class units |
| `BOT_CLASS_WOUNDED_FRACTION`, `BOT_CLASS_ENEMY_PAD_CRATES`                                                                                             | 0.65 of personal max HP, 2 crates         |
| `BOT_CLASS_DUPLICATE_PENALTY`, `BOT_CLASS_HEALER_NEED_BONUS`, `BOT_CLASS_NINJA_NEED_BONUS`, `BOT_CLASS_GIANT_NEED_BONUS`, `BOT_CLASS_BOXER_NEED_BONUS` | 4, 3, 2, 2, 1 respectively                |

Healer/Ninja/Giant slap remains 8; only Giant's bomb multiplier differs from 1. Class max HP = `round(classStats.maxHp * (superBuddy ? CLASS_SUPER_HP_MULT : 1))`. Class speed = `(carrying ? CARRY_SPEED : UNIT_SPEED) * classStats.speedMult * (superBuddy ? CLASS_SUPER_SPEED_MULT : 1)`. Thus carried-class speed changes via an explicit R2 multiplier, not by tuning the locked `CARRY_SPEED`. Basic max HP/super max HP and speeds remain EXACTLY the R1 100/101 and 1/1.01 profiles (`items.ts:71-78`, `constants.ts:54-55`). All class movement still collides with the unchanged `UNIT_RADIUS`.

Version sequence: R2-1 `0.3.0`; R2-3 `0.3.1`; R2-4 `0.3.2`; R2-5 `0.3.3`; R2-6 `0.3.4`; R2-7 `0.3.5`. Each named card changes `index.ts` and its smoke assertion TOGETHER. R2-2 is a type/telemetry/translation contract expansion only, with no changed simulation transition, so it does not bump the sim version. Client-only cards do not bump it. If integration changes sim behaviour beyond these cards, Lead assigns the next version and records why; do not reuse a replay version for different transition rules.

### 2.2 Recipe, selection and channel

- Extend `Recipe` to include `'class'`. Four exact new masks: two fully occupied **side-adjacent** columns `[0,1]`, `[0,2]`, `[1,3]`, `[2,3]`, other columns completely empty. Under the test's column-major bit order they are masks 15, 51, 204, 240. Not diagonal full columns, 3+1, floating walls, 8 crates or the existing four-flat heavy mask 85.
- `recipeResult` still ORs super quality over the consumed crates, never counts the number of super crates. A team `'class'` ban makes a class wall unavailable; a ban on one class removes that pick only, not the recipe. `'super'` forces normal quality without changing crate records. If all four classes are banned, fail closed as `notRecipe`.
- `padPreview` applies the same alive+dead `TEAM_CAP` gate to buddy AND class. Existing `Preview` discriminants/reasons remain unchanged. At cap return `{recipe:'class',super:<quality>,openable:false,reason:'teamFull'}`.
- Four choices appear **automatically when the controlled living unit can open a class wall**. There is no modal pause, provisional reservation, deadline or pending sim choice just for viewing buttons. E/Open alone must NOT start a class channel or accidentally lift a crate. Bots and humans submit the same input shape:

```ts
{
  move: { x: 0, y: 0 }, aim: null,
  fire: false, throwBomb: false, pickDrop: false,
  open: true,
  classPick: { classId: 'healer', snapshot: JSON.stringify(state.pads[team].cells) }
}
```

- Change `startOpen(s: MatchState, unitId: UnitId, classPick?: ClassPick): void`. Recheck alive, empty hands, own pad, eligibility, allowed class and exact snapshot for a class request; invalid/missing/stale picks are no-ops. Ordinary recipes retain their existing path and ignore class-only fields. `step` passes `input.classPick`; a class request is an open winner only if that request validates, so invalid picks do not suppress an otherwise explicit independent `pickDrop`. The client never emits that conflicting combination.
- Export `canStartOpen(s: MatchState, unitId: UnitId, classPick?: ClassPick): boolean` from `pad.ts`: first require existing `canOpen`; for class walls additionally require a valid allowed `classId` and matching snapshot. `step` uses it for both open-wins collection and channel start; `startOpen` uses it to guard class requests. Keep existing ordinary direct-call behaviour in `startOpen` unchanged for legacy test callers. This one validator prevents priority and start checks from disagreeing.
- Channel starts in phase 6 at the post-movement tick; `doneTick = s.tick + OPEN_TICKS`, still **20 ticks / 1 second**, not a second timing system. Capture `classId` in `pad.opening`, not just in a DOM queue. No reselection while busy. The choice belongs to the opener and the wall snapshot.
- Class-only channel cancellation: opener missing/dead, carrying, **off own pad**, content snapshot changed, cap filled, selected class banned, or a successful manual control switch away from that opener. Cancel without consuming any crates; emit `openCancelled`. Legacy R1 channels retain existing movement/carry cancellation semantics. Switching away cancellation is explicit so a newly released bot is not forced to inherit an unfinished human recruitment.
- Before selection, leaving/dying merely hides the choices; nothing is reserved. A queued pick includes its displayed wall snapshot and source unit ID on the client; discard it if either changes before sampling. Sim snapshot validation is authoritative for replays and direct callers too.
- Completion recruits exactly **one new bot** using existing unique-ID/first-spawn-slot rules (`open.ts:92-115`), with chosen `classId`, HP from `unitMaxHp`, `superBuddy` when appropriate, empty slots and ready cooldowns. Opener's equipment, class and control do not change. Consume the whole wall only after all checks pass. A plain buddy never inherits the opener's class.
- Extend `opened` events for class results with `classId` and `spawnedUnitId`; retain existing `unitId` as the **opener**, plus `recipe`, `super`, `team`, `tick`. Existing recipe events do not gain misleading class fields. This is the harness's pick-count source.
- Preserve phase ordering: a death already present at the opening phase cancels. A lethal projectile later on the same completion tick cannot undo the class already recruited before combat (`step.ts:114-130`). Tests must name this boundary rather than reorder R1 combat.

### 2.3 Abilities and persistence

**Boxer:** replace slap damage for units AND stalls with `unitSlapDamage`; retain 1.2 range and 10-tick cooldown. Gun/heavy/bomb stats do not improve merely because the wielder is Boxer.

**Healer:** after `updateProjectiles`, before `updateRespawns`, apply one simultaneous healing pass to living friendly units, including carrying/opening units. For each target compute the maximum applicable rate from the PRE-HEAL living positions/HP: self rate 2 HP/s if Healer; other living Healers within inclusive squared radius `3.25²` offer 4 HP/s. Take **max, not sum**, even when both self and an ally qualify. Apply `rate * DT` once, clamped to `unitMaxHp`. No line-of-sight rule, enemy/stall/crate healing, resurrection or extra super-heal multiplier. Fractional HP is retained; use tolerance in tests, not platform-time accumulation. Dead providers contribute zero. No per-tick heal sound/event spam is needed.

**Ninja:** only an unarmed, non-carrying, living Ninja whose ordinary slap is ready can knock. “On an enemy pad” means the Ninja's **centre** maps to a column using `padCellAt(enemyPad, unit.pos)` after movement; select that column, not a nearby/random column. If its top crate exists and `s.tick >= (ninjaKnockReadyTick ?? 0)`, call `liftTop`, then `dropCrateAt(s, crateId, padCellCenter(enemyPad, col))`. The existing resolver puts the SAME crate/quality on legal ground nearest that point, including its established distance/x/y tie rule; it is not stolen, deleted, launched as a projectile or auto-carried. Set `ninjaKnockReadyTick = s.tick + 40`; spend the ordinary slap cooldown; emit `{kind:'ninjaKnock',unitId,team:unit.team,padTeam,col,crateId,tick}` alongside the existing crate-drop event. Knock wins over unit/stall slap for that attack, never double-hits. If the column is empty or knock cooldown is not ready, use ordinary slap behaviour (which can hit an enemy in range). Other classes cannot steal/lift enemy pads by pick/drop. Content change cancels a still-running opening at the next opening phase; an opening already completed earlier that tick is not retroactively cancelled. Do not alter the shared ground resolver to achieve mirror symmetry.

**Giant:** multiply incoming damage by 0.60 ONLY for `source === 'bombs'`, normal or super bombs. Do not reduce coconut/heavy, gun, slap or stall damage. The `hit.dmg` event reports the reduced amount actually subtracted (existing overkill accounting policy remains). No change to collision radius; visual size is independent.

Death/respawn preserves `classId`, `superBuddy`, team, ID and `isBot`. Existing equipment-clear rules remain; reset `ninjaKnockReadyTick` to 0 at respawn, as an ability cooldown rather than a permanent bonus. No class/stat downgrade on death; no cap refund; no auto-switch on death. New class recruits always start at their personal full HP.

### 2.4 Switching and replay

New `packages/sim/src/control.ts`:

```ts
export function controlledUnit(s: MatchState): Unit | null;
export function nextLivingTeammate(s: MatchState, fromId: UnitId): Unit | null;
export function switchControl(s: MatchState, fromId: UnitId): UnitId | null;
```

`controlledUnit` finds the lowest-ID `!isBot` unit, including a dead one; ordinary production has exactly one, all-bot matches have none. Do not infer control from ID 0 or from an array index. Multiple manual bodies remain a legacy/test-fixture tolerance, not a new multiplayer feature. Switching is accepted only from the returned controlled unit, never a bot/unknown caller.

`nextLivingTeammate` sorts same-team units by **numeric ID**, selects the first living ID greater than `fromId`, wraps to the smallest living ID, excludes the source and all enemies/dead targets. It may switch FROM a dead source. No eligible target = null/no-op, including an all-dead squad, a lone survivor already controlled, and an all-bot match. Alive+dead cap is irrelevant to switching; newly recruited units join the same ID order. No cooldown or RNG; one edge-triggered pulse per press/tap. A held key is not repeated.

Add phase **1b** after squad commands and before bot inputs. On `switchNext`, attempt handoff on the fresh clone. A successful handoff flips only the source to bot and target to human, leaves all positions/HP/items intact, cancels any class channel owned by the source, emits `{kind:'controlSwitched',fromUnitId,toUnitId,team,tick}`. Both source and target receive **idle input for the handoff tick**, overriding any pre-submitted map input and excluding the newly released body from bot authoring for that tick. Other bots still run. Next tick the released body uses ordinary state-derived `botInput` under the existing squad command, carrying/armed/dead state; no copied human target or hidden brain cache. Failed switch attempts do not erase valid ordinary source actions. Match-over short-circuit continues to forbid switching.

Client reset on successful `controlSwitched`: clear keyboard held/pulse sets, touch joystick/fire/pulses and pointer capture, mouse fire/aim, pending class pick and all per-unit action queues. Ignore key auto-repeat until release/re-press. Do not remap source movement/fire onto the target. Keyboard movement resumes on a fresh press; touch on a fresh gesture; mouse fire on a fresh pointerdown. Drain controls even while the source is dead, so switch remains available without buffering a bomb/open for its respawn. Portrait/visibility pause must clear pending action latches, not replay them on resume.

**OWNER? KEY:** Recommend **R** (`KeyR`) for switching, leave **Q throw** and **E pick/drop/open** unchanged. A) approve R (recommended); B) keep design's Q for switch and explicitly choose a replacement throw key plus update tutorial/tests. Do not silently bind Q, E or Tab. Tab must keep native button focus navigation. UI integration is gated on this answer, not this plan's completion.

**Digits:** while class choices are available, 1–4 mean Boxer/Healer/Ninja/Giant respectively and **must not also send squad commands**. During a class channel owned by the controlled unit swallow 1–4 rather than sending a delayed command. A bot's opening does not steal the human's command shortcuts. Outside those contexts, 1/2/3 keep attack/guard/fetch. Native Enter/Space activates focused class buttons. This is a scoped explicit priority rule, not a wholesale rebind of command keys.

## 3. Bots, telemetry and balance procedure

### 3.1 Need and class selection

Keep exported `teamNeeds(s: MatchState, team: Team): Recipe | null`. Add in `bots/squad.ts`:

```ts
export function chooseClass(s: MatchState, team: Team): UnitClass | null;
```

Default selection is pure and does not consume `s.rng`. Disallow banned choices. Prefer classes not already present **including dead teammates**, because their traits persist. Initial deterministic ranking:

1. For each allowed class, start with `-BOT_CLASS_DUPLICATE_PENALTY * persistentTeamCountOfThatClass` (initial penalty 4).
2. Healer adds `BOT_CLASS_HEALER_NEED_BONUS` (3 initially) if at least two living teammates are below `BOT_CLASS_WOUNDED_FRACTION * unitMaxHp`.
3. Ninja adds `BOT_CLASS_NINJA_NEED_BONUS` (2) if enemy pad holds at least `BOT_CLASS_ENEMY_PAD_CRATES` crates.
4. Giant adds `BOT_CLASS_GIANT_NEED_BONUS` (2) if a living enemy holds bombs or a heavy weapon.
5. Boxer adds `BOT_CLASS_BOXER_NEED_BONUS` (1) if the living squad has no gun and no bombs.
6. Highest score wins; equal scores use `CLASS_IDS` rotated left by unsigned `s.seed % 4`. No team-name/global-ID bonus; mirrored teams get mirrored decisions. null only if no allowed class exists.

This seeded tie-break is deliberate composition variety, not a random choice at open time: the selected class and snapshot still travel in the replay input. All score constants above belong in `constants.ts` from R2-1; do not scatter tuning literals in brain code. Freeze structural predicates, tie order and algorithm in R2-6; R2-7 tunes named numeric knobs only.

`teamNeeds` priority, before normal R1 fallback: finish a ready legal class wall; continue a partial wall containing an upper layer if it can extend to a class wall; finish existing three-flat heavy commitment; retain initial-gun need; otherwise choose class when below cap, below `BOT_CLASS_TARGET_COUNT`, at least one living team gun exists and usable supply ≥`BOT_CLASS_MIN_SUPPLY`. Remaining needs use R1 bombs/buddy/heavy logic. A banned/no-allowed-class wall must not freeze the builder: lift its own upper crate using ordinary pick/drop and reuse it, never delete crates. The plain buddy path remains reachable when class supply is low, recipe banned or cap preferences favour it.

Class placement: select an exact legal wall **superset** of the current occupied cells, choosing the first canonical pair in `[0,1],[0,2],[1,3],[2,3]`, then place ground in those columns before uppers, lower canonical column first. Dessert uses the existing reverse-column canonicalization (`brain.ts:454-464`). Do not open the intermediate gun, bombs or plain buddy while extending to that committed wall. A wall need must not convert an existing incompatible three/four-flat heavy layout into a wall.

`botInput` passes `{open:true,classPick:{classId:chooseClass(...),snapshot:...}}` when ready. Carrying builders safely unload before opening as in R1. Move class-opening hold to a top-level brain rule so it is honored even when the bot goal changes; class-channel hold has **zero movement** and no pick/drop, not the current fetch-only mill that could leave a pad (`brain.ts:96-109`). Other bots must not lift a teammate's reserved wall while a channel runs.

Class-aware behaviour is bounded: Healer under autonomous attack follows the most wounded living ally (ascending HP fraction, then squared distance, then numeric ID), holds within aura radius, otherwise uses normal goal; explicit guard/fetch remains authoritative. Unarmed attack-goal Ninja raids the nearest occupied enemy pad column until empty, then resumes normal attack, using `fire:true` on its column even without an auto-aim unit target. Boxer and Giant use existing attack logic. Released bodies enter these same rules on the tick after a switch; no memory reset API.

Natural-use acceptance: unmodified setup, seeds **1–6**, `humanUnit:null`, run each to a winner or the existing 15-minute cutoff, collect real `opened` events. Across the six, EACH class must have ≥1 recruitment. Report per-seed recipe/quality/class counts and aggregate. Do not pre-grant classes, force class-choice inputs, fake events or silently widen seeds until a lucky selection appears. If a measured change requires a larger declared fixed set, get Lead approval first; ≥6 is the owner's minimum, not permission to cherry-pick.

### 3.2 Harness extensions and acceptance

Retain `BatchOpts`/`runBatch`/`checkTargets` signatures. Extend `ItemBan` as in §2.1; extend CLI `--ban-item` to `heavy|super|class|boxer|healer|ninja|giant`, still requiring a paired valid team. Fail with exit 1 for invalid/partial flags. Per-class bans reject only that recruitment; whole-class recipe ban prevents wall opens. The opposing team is never banned by implication.

Add `BatchResult.classPicks: Record<Team, Record<UnitClass, number>>`; count successful `opened` class events only, not started/cancelled channels. Add `'class'` to both recipe count tables and the event validator. The new class counter must match an independent real-event observer test. Do not change stall-damage source categories just because a class caused damage: Boxer slap remains `slap`; reduced Giant hits are unit hits, not attacker stall damage.

Final exact runs, seed0 1 and max-minutes 15, with full JSON retained in a linked PR comment/artifact:

```sh
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team fruit --ban-item boxer --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team dessert --ban-item boxer --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team fruit --ban-item healer --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team dessert --ban-item healer --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team fruit --ban-item ninja --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team dessert --ban-item ninja --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team fruit --ban-item giant --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team dessert --ban-item giant --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team fruit --ban-item class --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team dessert --ban-item class --assert
```

Unbanned run: median 300–480 s inclusive, each side 0.45–0.55 inclusive, timeouts 0, ms/tick ≤0.5. Banned runs: banned side ≥0.40, timeouts 0, ms/tick ≤0.5; do not incorrectly impose symmetric 45–55 on a one-sided ban. Also rerun the existing fruit/dessert `heavy` and `super` ban pairs, 1,000 games each, as R1 regression evidence. Preserve raw denominators/draws: wins/games, not wins/decisive-games (`harness.ts:120-124`).

To fit one worker run, separate bot correctness (R2-6) from final balance (R2-7). Use 50-game unasserted probes while tuning; finalize the full matrix only after choosing constants. Run the matrix sequentially to avoid distorting ms/tick through parallel CPU contention; heartbeat during it. Starting baseline cost was about a minute for 200 games on this host; do not promise a fixed runtime on another worker. If the one-run budget is reached before the matrix finishes, hand off exact completed JSON and the next command to Lead; never mark acceptance complete or weaken locked constants.

Allowed tuning: only R2 class HP/multipliers/slap/heal/radius/Ninja cooldown and named R2 bot priority/supply knobs, symmetric for both teams. Update the numeric test expectations and a small measured before/after table with each accepted tuning change. Do not tune class appearance to affect simulation; do not weaken target bands, timeouts, recipe oracle or old super stats.

## 4. Approved-look implementation and executable Lead art brief

### 4.1 Overlay limitation and owner gate

The approved **direction** is the supplied fruit/dessert class samples and pick-flow mockup; their approved descriptions are reproduced here, not a claim of pixel-by-pixel visual verification by the Architect. Actual PNG metadata measured: class sample files 2172×724 each, pick mockup 1844×853. No new visual page is proposed.

**OWNER? ACCESSORIES:** A) recommended **overlay-compatible costume**: Boxer red mongkhon head ring; Healer white cap with green leaf; Ninja black mask plus short scarf; Giant bronze horned yak helmet with a compact static shoulder collar, body scaled 1.20×. Show red gloves / herb basket / small sword prominently in their badge and pick icons, **not as fake hand-held animated equipment**. B) demand those details attached to animated hands/body, requiring additional per-frame body/hand art and new approval/scope/budget. A single head-following overlay cannot correctly animate boxing gloves, an herb basket swinging in a hand, a sword in a hand or independently moving shoulder plates. Nor can one forward accessory synthesize a new rear view; existing horizontal flip is retained. Lead must tell the owner these limitations BEFORE cutting. Workers must not silently omit approved sample details or generate new sheets to compensate.

Planning may finish with this question open. Lead art production and client art integration require owner confirmation of A or a revised approved brief. All geometry/contracts below describe A, not permission to choose B autonomously.

### 4.2 Files and manifest keys

Deliver **15 transparent WebP files** (no flattened background), plus one updated `manifest.json`. Exact destination is `apps/client/public/art/`. Do not change any existing character WebP, R1 prop bytes, arena or audio. Use identical assets for both teams; the underlying character/team ring supplies identity. Icon artwork contains no Thai text or numbers; DOM supplies labels and shortcuts.

| Files, one per listed suffix                                                                            | Count | Canvas  | Registration / anchor                                                                               | Content                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ----: | ------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `class_head_boxer.webp`, `class_head_healer.webp`, `class_head_ninja.webp`, `class_head_giant.webp`     |     4 | 256×256 | `props.class_head_<id>`; anchor `[0.5,0.5]`, reference head-fit line from `(64,128)` to `(192,128)` | Mongkhon; cap/leaf; mask/short scarf; horned helmet/static collar. Head-fit line is transparent metadata geometry, NOT a drawn line. Lower scarf/collar may extend down within canvas; keep all visible pixels within a 4 px transparent gutter. |
| `class_badge_boxer.webp`, `class_badge_healer.webp`, `class_badge_ninja.webp`, `class_badge_giant.webp` |     4 | 64×64   | `props.class_badge_<id>`; centre `[0.5,0.5]`                                                        | Round cream/ink badge: glove / leaf basket / sword / yak helmet; readable at 24 logical stage px. No blue/red/green/yellow badge backgrounds suggesting a third team.                                                                            |
| `class_pick_boxer.webp`, `class_pick_healer.webp`, `class_pick_ninja.webp`, `class_pick_giant.webp`     |     4 | 128×128 | `props.class_pick_<id>`; centre `[0.5,0.5]`                                                         | Larger version of the same class silhouette, readable at 40 CSS px. These can depict the omitted hand-held costume details as ICONS.                                                                                                             |
| `control_ring.webp`                                                                                     |     1 | 128×64  | `props.control_ring`; centre `[0.5,0.5]`                                                            | White elliptical ground ring, 6 source-px white stroke, 3 source-px dark outer keyline, transparent centre; visible outline within canvas.                                                                                                       |
| `control_arrow.webp`                                                                                    |     1 | 48×48   | `props.control_arrow`; bottom centre `[0.5,1]`                                                      | White DOWN-pointing arrow with dark keyline; no team tint.                                                                                                                                                                                       |
| `control_switch.webp`                                                                                   |     1 | 96×96   | `props.control_switch`; centre `[0.5,0.5]`                                                          | Two white curved arrows around one neutral cream silhouette, ink keyline.                                                                                                                                                                        |

Every prop entry remains exactly `{ "file": "<file>", "width": <pixels>, "height": <pixels> }` so the existing generic prop loader (`Boot.ts:35-37`) works. Put class-specific attachment metadata in new top-level `classArt`, not extra arbitrary fields on legacy prop entries:

```ts
interface HeadFrame {
  x: number;
  y: number;
  width: number;
}
interface ClassArtManifest {
  headFrames: Record<string, HeadFrame[]>; // all 8 existing skin keys; exactly 18 entries each
  classes: Record<
    UnitClass,
    {
      head: string;
      badge: string;
      pick: string;
      anchor: [number, number]; // [0.5, 0.5], coordinates in the accessory canvas
      fitWidth: number; // 128 accessory source pixels
      bodyScale: number; // giant 1.20, all others 1.00
    }
  >;
  control: { ring: string; arrow: string; switchIcon: string };
}
```

Keys: `classArt.classes.boxer.head = 'class_head_boxer'`, `.badge = 'class_badge_boxer'`, `.pick = 'class_pick_boxer'`, and likewise for healer/ninja/giant; `classArt.control = {ring:'control_ring',arrow:'control_arrow',switchIcon:'control_switch'}`. Extend `ArtManifest` with optional `classArt?: ClassArtManifest`; retain `cell`, all eight character entries, all old props and arena intact. Existing animation frame numbering is unchanged: idle 0–3, run 4–9, carry 10–13, windup 14, slap 15, hurt 16, ko 17 (`manifest.json:8-56`). No extra animated accessory sheets.

### 4.3 Head landmark measurement, transforms and clipping

Lead supplies the **144 measured `HeadFrame` records**, not a worker-estimated single offset. For EACH source cell on EACH existing sheet, measure the centre `(x,y)` of the visible face/head's eye-line in that 256×256 cell, and `width` between left/right head contour at that line, ignoring leaves/hair/stalks/accessories. For eyeless/occluded poses use the same skull landmarks tracked from that skin's neighboring frames, not the overall alpha bounding box. The measurement is part of the art deliverable. Source coordinates include the sheet cell's transparent margins. Record even KO frame 17 for completeness, though dead class art is hidden. Schema validation: exact existing skin keys, 18 finite entries, `0≤x,y≤256`, `0<width≤256`; missing data is a rejected art bundle, not a fixed-offset fallback accepted as finished.

Overlay transform is fully specified: body sprite current frame `i` selects that skin's `headFrames[i]`. With `sx = body.displayWidth / 256`, `sy = body.displayHeight / 256`, body origin `(ox,oy)` and `flipX`,

- `screenX = body.x + (flipX ? -(head.x - ox*256) : head.x - ox*256) * sx`;
- `screenY = body.y + (head.y - oy*256) * sy`;
- accessory width = `head.width / 128 * 256 * sx`; height = `head.width / 128 * 256 * sy`;
- accessory origin `[0.5,0.5]`, flip exactly with the body; front layer `body.depth + 0.2`; no second bob, lunge or independent timer.

The body display size already contains pose squash/lunge and Giant 1.20×, so do NOT multiply class scale again on the accessory. Sync after `playCharacterPose` and body flip, and on Phaser `animationupdate` so an auto-advanced frame cannot leave a one-frame offset. Static/reduced-motion poses use the same transform. Rebind on skin/frame changes and remove listeners/sprites on destroy; hide head/badge/marker for dead units. Classless units have no class head/badge. Badge = 24×24 logical stage px centred above the union of body/head/cargo bounds, 4 px gap; existing super star is separate, 16×16 logical px to its right with 4 px gap, not a team-colour change.

Use a shared pure geometry calculation for the union of scaled body, accessory, cargo and overhead decorations. Move draw feet DOWN only enough to keep that union's top ≥2 logical stage px; keep the original sim position/collision unchanged. The 92 px body constant (`view.ts:25`) becomes `92 * bodyScale`, including pose animation. Overhead cargo offset `(207/256) * UNIT_DISPLAY_HEIGHT` (`view.ts:495-499`) must use the scaled height too. Size Giant's ground team ring and the WHITE control ring 1.20× visually without widening its hitbox. Test y=0.45 with normal and super cargo; a 92 px-only top clamp is not sufficient. Do not rewrite the world projection or zoom the arena.

Lead provides contact sheets over **all 8 skins × all 18 frames × both horizontal flips** for all four accessories, plus a short run/carry/slap clip. Inspect cap/leaf and mask fit, Giant collar/cargo intersections, badge/super/arrow spacing, and top-edge clipping. A static shoulder collar cannot promise independently articulated armour; this is part of OWNER? A above.

### 4.4 Byte allocation and delivery receipt

Reserve **≤260,000 B new images**: headwear ≤35,000 each (140,000); badges ≤4,000 each (16,000); pick icons ≤18,000 each (72,000); ring ≤10,000; arrow ≤6,000; switch ≤16,000. Reserve **≤20,000 B manifest growth**, including head landmarks. Planned maximum art total = **2,858,522 B**, leaving **141,478 B** art headroom. This fits 3 MB without a raise if cuts meet those limits; it is a target budget, not measured new-asset output. Existing first-load headroom is **373,921 B** from the measured build; the combined 280,000 B art delta leaves **93,921 B for code/build growth**. Final build must still prove ≤5 MB; do not spend the larger art-only headroom without checking total load, or trade unreadable icons for passing bytes.

Lead's bundle receipt lists each filename/key, decoded dimensions, bytes, SHA-256, total image bytes, manifest delta, all-art bytes and a list of unchanged old-file hashes. Client worker validates it against real files. If the art or first-load gate fails, first optimize unused transparency/lossless alpha and WebP quality within the approved look; do not touch existing approved files or raise tests. **OWNER? BUDGET, conditional only:** A) recommended keep 3 MB and recut/optimize; B) approve an art ceiling at most 3.2 MB, but only with a measured ≤5 MB total-load plan. A raise does not grant a total-load exception.

## 5. Client UI contract, tokens, states and widths

Approved visual reference: `img/r2_pick_mockup.png` and the approved class samples, with overlay limitations explicitly gated above. Retain the existing night-market HUD, not a new site/page or a broad restyle. Load `design-system` and `ui-ux-pro-max` for client work.

### Tokens and placement

Put R2-only component rules in NEW `apps/client/src/r2.css`, imported by `shell.css`; no new framework/token package. Alias existing colours/typography (`shell.css:29-45`) into these scoped tokens on `.tw-screen-hud`:

- `--tw-r2-ink:#1b1030`, `--tw-r2-paper:#fff5d9`, `--tw-r2-text:#fff`, `--tw-r2-panel:rgba(27,16,48,.92)`, `--tw-r2-focus:#ffd75e`, `--tw-r2-super:#ff3fa4`;
- keep team colours blue `#2f7bff`, red `#ff4a3d`; player marker white with ink keyline, never tinted by team/class;
- spaces 4/8/12/16 px; panel/button radius 10/12 px, badge/ring circular; 2 px panel border; focus outline 3 px gold, offset 3 px; no focus suppression;
- font `'Noto Sans Thai',Tahoma,sans-serif`, weight 700, label 16 px/22 px; keyboard hint 12 px/16 px. Button labels visible, not title-only tooltips.

Targets: touch **844×390**, desktop **1280×800**, retain existing short-landscape **667×320** regression layout and portrait **390×844** pause. Whole arena FIT view remains unchanged. Use safe-area insets for all fixed edges.

- Class tray `#tw-class-pick`, `role=group`, accessible name `เลือกอาชีพ`, horizontally centred, bottom `max(16px,env(safe-area-inset-bottom))`, width 336 px, 8 px padding. Four **72×76 CSS px** icon+label buttons, 8 px gaps; header occupies 22 px + 4 px gap. Icons 40×40, labels 16/22, no ellipsis. At width ≤740 px use 280 px tray, 4 px gaps, four 60×72 buttons, 8 px side padding and 14/20 labels. Use border-box so these dimensions fit. Tray sits in the centre gap, not the right command/action column. Add `pointer-events:auto` only to the tray/buttons; no full-screen pointer blocker or modal focus trap. Joystick zone yields pointer starts over controls.
- Switch `#tw-btn-switch` is a separate screen-HUD button visible for **both** desktop and touch, NOT inside the touch-only `.tw-btn` hiding selector (`shell.css:395-399`). Position left `max(16px,env(safe-area-inset-left))`, top `max(56px,calc(env(safe-area-inset-top) + 56px))`; 112×56 CSS px; 24 px icon + visible `สลับตัว` label and R hint after owner approval. Does not occupy existing Open/Throw/Fire positions, timer or independent item panel.
- Controlled marker: white ground ring at drawn feet, 52×26 logical stage px (×1.20 for Giant); white down arrow 20×20 logical px above the class badge/super-star union with 4 px clearance. Keep blue auto-aim target ring and team ground ring visible beneath/around it. No bob for reduced motion; otherwise existing small bob only on the arrow, not headwear.
- No overlap among the class tray, switch, commands, timer/loadout, action buttons and viewport edges at the target sizes. Pairwise bounding-box tests include actual maximum normal/super held-item labels. At 667×320 the 280 px tray must clear the existing Pick button by at least 8 px; do not just shrink text until it disappears.

### States (no new network screen)

| State                       | Required presentation / input                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot/loading assets         | Retain existing boot/title flow; do not show an interactive tray before a match exists. No fabricated class-loader progress. Missing art uses named text controls and a geometric marker fallback.                                       |
| Empty/basic/non-recipe pad  | Hide class tray. Existing preview and single Open behaviour remain. A full team gets existing Thai `ทีมเต็มแล้ว` and no actionable class choice.                                                                                         |
| Class wall ready            | Replace ordinary Open with four choices; order boxer/healer/ninja/giant, mouse/touch/native button activation and digits 1–4. Never hide the super preview/star. Disabled banned choices remain labelled; ordinary matches have no bans. |
| Opening                     | Four choices replaced by a noninteractive `กำลังสร้างลูกทีม…` status with remaining channel fraction; no fake second timer. Disable reselection; movement can cancel class channel. No paused world.                                     |
| Cancellation/death/leaving  | Clear pending selection; hide tray/status once no longer valid; show choices again only when eligibility is freshly true. No auto-selection on returning.                                                                                |
| Switch unavailable          | Button visible, disabled with Thai accessible description `ไม่มีลูกทีมที่สลับได้`; still accessible when source is dead if another target lives.                                                                                         |
| Switch success              | Marker, auto-aim, glow, loadout, controls and pickup/open checks all bind to the new body on the same sync. No body-0 fallback flash.                                                                                                    |
| Icon/accessory load failure | Hide failed decorative image, keep Thai names/keyboard hints usable; body and text/class identity remain. WHITE ring/arrow have primitive fallbacks. No console crash or repeated per-frame failed image fetches.                        |
| Match over / portrait pause | No new actions; tray hidden, switch disabled/hidden behind existing journey/rotate overlay. Resume does not replay queued pick/switch/fire.                                                                                              |

New exact Thai strings in `i18n/th.ts` (keep existing strings except the explicit how-to expansion): `recipeClass:'ลูกทีมอาชีพ'`, `classBoxer:'นักมวย'`, `classHealer:'หมอยา'`, `classNinja:'นินจา'`, `classGiant:'ยักษ์'`, `chooseClass:'เลือกอาชีพ'`, `classOpening:'กำลังสร้างลูกทีม…'`, `switchUnit:'สลับตัว'`, `switchUnavailable:'ไม่มีลูกทีมที่สลับได้'`, `controlledUnit:'ตัวที่ควบคุม'`. Export `className(classId:UnitClass):string`, and extend exhaustive `recipeName`. New `howtoBuildBody` exactly:

> บนแท่นของทีม: 1 ลังได้ปืน • 2 ลังข้างกันได้ระเบิด • 2 ลังซ้อนกันได้ลูกทีม • 4 ลังเต็มพื้นได้บาซูก้ามะพร้าว • 2 เสาซ้อนคู่ได้ลูกทีมอาชีพ เลือกด้วยปุ่มหรือ 1–4 • ลังดาวทำให้ของพิเศษ

After OWNER? key approval, R2-11 extends `howtoWinBody` to append exactly ` กด สลับตัว หรือ R เพื่อควบคุมลูกทีมคนถัดไป` if R is chosen; if B is chosen Lead supplies the approved alternate key/copy before implementation. R2-2 i18n tests cover every `UnitClass`, `Recipe`, both quality labels and all static new state strings, not merely Thai regex presence; R2-11's journey/how-to browser assertion pins the owner-approved key suffix. Thus R2-2's sim contract work need not wait for the key answer.

## 6. Gate G, common PR requirements and migration policy

Each card below includes this gate by reference; **Lead must paste the entire block into each dispatched implementation card**, together with its specific targeted command and the port rule. This is not permission to substitute an older v1 plan gate.

```sh
npm ci
npm run typecheck && npm run lint && npm run format:check && npm test
npm run sim -- --games 200 --assert
npm run build -w @talad/client
ss -ltn | grep ':4173 '
# Expected: NO OUTPUT (grep exit 1 means no listener); if any listener appears, STOP.
run-locked talad-war-e2e npm run e2e
```

Run the preflight immediately before e2e; `talad-war` and `dice-bandits` share 4173 and `reuseExistingServer`. Never kill another project's process. Keep the title assertion `await expect(page).toHaveTitle('Talad War')` in every new spec's match-entry path; don't treat the right port as proof of the right project. Max local e2e workers 2; full local suite once at the end, targeted specs before then. Record the direct command's real exit/output, not `echo $?` after a pipeline or a success wrapper. If a pending shared port blocks the gate, report it as an external blocker with A/B and recommendation.

For media verification on art/marker/UI motion: record a Playwright video of the relevant run/carry/slap/switch sequence, then `media-check <actual-clip-path> --ask "Check class head attachment, clipping, marker handoff and flicker; report timestamps" --expect "No drift, clipping, duplicate control marker or flashing; approved class silhouettes remain readable"`. Quote the actual VERDICT and timestamps. `SKIPPED` requires manual inspection and an explicit disclosure; never claim a media pass from static assertions alone.

**Every implementation PR body** (≤20,000 characters) must include: plan/spec paths, card scope, owner-answer status if applicable, exact gate commands and concise real counts, changed public interfaces/values, `Out-of-plan changes` (explicit `None` if none), and `Migrated assertions` (old → new, file/test, reason, supporting run/comment link; explicit `None` if none). Full sim JSON, lengthy CI logs, images and clips belong in linked PR comments/artifacts, not pasted into the body. Run `pr-body-check <task-id> <pr-number> --repo JaoChai/talad-war` before review; fix missing sections, or if SKIPPED manually inspect `gh pr view <pr> --json body`. Follow the team rule of one final `gh pr checks <pr> --watch` after final push, not a polling loop. No deploy/merge authority in an implementer card.

**Migration policy:** writing a new RED test means observing its intended failure first, not rewriting old snapshots until green. Freeze old R1 assertions where behaviour is unchanged. Allowed migrations are enumerated per card and in §8; report measured values, never invented replacements. An unrelated red assertion is a blocker/investigation, not an automatic permission to expand owned files. Gate counts must name the pre-existing 3 expected failures, not claim they are ordinary passes or add new expected failures.

## 7. Worker-sized implementation card briefs

The decomposition deliberately separates the cross-workspace recipe/translation/telemetry contract from recipe execution, and separates DOM components from scene wiring. This keeps each implementation card to **at most eight specified files** on the verified base (conditional missing-spec copy excluded); no 15-file “small change” is hidden in a migration footnote. Lead's 15-file art bundle is an external produced-art handoff, not product-code scope. Do not parallelize cards touching the same hotspots.

Suggested assignees below are real installed profiles, not tasks created by this planning run. Lead creates graph nodes only after the owner-question gates are resolved as appropriate. Dependency order:

`R2-1 → R2-2 → R2-3 → R2-4 → R2-5 → R2-6 → R2-7`; Lead art follows this plan and OWNER? accessories, then `R2-8 → R2-9`; `R2-10` follows R2-3/R2-5 and OWNER? key; `R2-11` joins R2-7/R2-9/R2-10. Serialize R2-9 and R2-11 against any other `Match.ts`/`view.ts` edits. Finish with independent `dev-reviewer` and `dev-qa` cards created by Lead; release only after owner play/explicit authorization.

### R2-1 — Persistent class profiles and shared pick/control data (dev-backend)

**Files (8):** modify `packages/sim/src/types.ts`, `constants.ts`, `items.ts`, `index.ts`; create `packages/sim/src/classes.ts`, `packages/sim/test/classProfiles.test.ts`; modify `packages/sim/test/smoke.test.ts`; create `docs/plans/2026-10-17-v2-r2-classes-switching.md`. Conditional ninth file ONLY if absent: copy the approved design to `docs/superpowers/specs/2026-10-16-classes-crates-four-teams-design.md` unchanged; it is already present and `cmp` passed on the inspected base. Copy THIS plan unchanged from staging; do not format/rewrite its contents during the copy.

**Consumes/produces:** §2.1 class types, all initial constants, `CLASS_IDS`, `classStats`, `unitSlapDamage`, `unitBombDamageMult`, existing `unitMaxHp`/`unitMoveSpeed` extended without signature changes; optional input/opening fields from §2.1; broaden `ItemBan` type but do not implement the new bans yet. Do NOT broaden `Recipe` in this card. Export `classes.ts`; SIM_VERSION `0.3.0`.

**Live consumers:** `items.ts:71-78` → `step.ts:142-146`, `combat.ts:113-128`; `types.ts:22-49,62-68,119` → all ordinary typed fixtures. `index.ts:1-19` / `smoke.test.ts:6` literal pair. The constants' existing locked values are at `constants.ts:11-72`.

- [ ] **1 RED:** create `classProfiles.test.ts` with named tests `class_order_and_profiles_use_exported_constants`, `super_class_profile_does_not_reuse_basic_super_profile`, `basic_profiles_and_equipment_are_unchanged`, `class_carry_speed_uses_locked_base`. Construct units by cloning `createMatch(1).units[0]`, set `classId`, carrying and quality. Assert class order and each profile's exact relationship to its exported class constants; assert Boxer HP/speed/slap exceed basic, Ninja is faster with lower HP, Giant slower with higher HP and bomb multiplier below 1. Super HP is `Math.round(base*CLASS_SUPER_HP_MULT)`; speed is `6*mult*CLASS_SUPER_SPEED_MULT`; carrying speed is `4*mult`. Basic normal/super HP remains literal 100/101 and speed 6/`6*1.01`; original weaponStats/bombStats are frozen. Starting numeric constants are §2.1; final tuned values will be pinned by R2-7, so do not hardcode tunable initial values into cross-card behavioural tests. Run `cd packages/sim && ../../node_modules/.bin/vitest run test/classProfiles.test.ts`, capture intended missing-export/behaviour failure.
- [ ] **2 Implement:** the exact §2.1 data contracts/profiles and optional fields, without healing/knock hooks. Keep optional flags omitted on ordinary initial units rather than rewriting every fixture.
- [ ] **3 Docs/version:** copy plan unchanged, conditional spec copy, export classes, bump version and smoke literal together. Verify copied-file bytes with `cmp`; update no approved spec text.
- [ ] **4 GREEN/gate:** targeted command above, then Gate G; include exact counts. Commit only these files on the task branch.
- [ ] **5 Handoff:** report immutable profiles, helper signatures and copied-plan hash to R2-2/3/4. PR body must contain `Out-of-plan changes` and `Migrated assertions`.

**Acceptance:** class calculations and existing basic/super/equipment values pinned; no initial class grants or behaviour/ability shortcuts. **Migrations:** version literal only; no old weapon/movement assertion weakened. **Out of scope:** recipes, class spawning, abilities, bots, control switching, UI/assets.

Representative RED assertions (imports are the named public contracts above):

```ts
const basic = createMatch(1).units[0]!;
expect(unitMaxHp({ ...basic, classId: "boxer" })).toBe(BOXER_MAX_HP);
expect(unitMoveSpeed({ ...basic, classId: "ninja", carrying: 900 })).toBe(
  4 * NINJA_SPEED_MULT,
);
expect(unitMaxHp({ ...basic, superBuddy: true })).toBe(101);
```

**E2E rule:** before the one final full e2e, `ss -ltn | grep ':4173 '` must print nothing; never kill another project's process; assert title `Talad War`; use `run-locked talad-war-e2e`, ≤2 local workers. Full gate: G.

### R2-2 — Exhaustive recipe, telemetry and Thai contracts (dev-backend)

**Files (6):** modify `packages/sim/src/pad.ts` (type union ONLY), `packages/sim/src/harness.ts`, `packages/sim/test/harness.test.ts`, `packages/sim/test/r1Bots.test.ts`, `apps/client/src/i18n/th.ts`, `apps/client/test/i18n.test.ts`.

**Consumes/produces:** R2-1 `UnitClass`/`CLASS_IDS`; publish `Recipe` including `'class'`, new `classPicks` telemetry, CLI ban vocabulary and `className`/all §5 Thai strings. `matchRecipe` and opening behaviour stay R1 until R2-3. This is the independently testable public data/translation/observability contract, not an empty scaffold. Do not enable an unimplemented class shape or bump replay version for type-only changes.

**Live consumers:** `pad.ts:6-15`; `harness.ts:23-26,63-65,84-94,168-181`; `th.ts:69-84`. Exhaustive consumer migrations are `harness.test.ts:23-37,57-75`, `r1Bots.test.ts:401-435`, `i18n.test.ts:11,24-39,60-62`. Existing static Recipe counters cannot be left to silently produce `NaN`.

- [ ] **1 RED:** in `i18n.test.ts`, add `'class'` to exhaustive Recipe records/list and assert `recipeName('class') === 'ลูกทีมอาชีพ'`, all four exact class names, super suffix and new state strings/how-to copy. In `harness.test.ts`, extend the independent observer/result fixture with class zeros and `classPicks`; add CLI acceptance for paired new ban tokens and rejection of invalid/partial tokens. Run `cd apps/client && ../../node_modules/.bin/vitest run test/i18n.test.ts` and `cd packages/sim && ../../node_modules/.bin/vitest run test/harness.test.ts`; intended failure is missing mappings/telemetry or rejected supported flags.
- [ ] **2 Implement:** widen only the Recipe type; update telemetry/event parser/counters and CLI validation as §3.2, keeping existing balance bands and denominators. Classes currently count zero naturally; only completed events can increment them once R2-3 exists.
- [ ] **3 Preserve old oracle coverage:** in `r1Bots.test.ts` add class counters to all exhaustive maps, but keep the natural-use assertion explicitly over the four R1 recipes until R2-6's separate five-recipe/class test. Do not prematurely require natural class use from old bots or remove R1 coverage. Update exact Thai maps/how-to assertions together, no missing fallback English.
- [ ] **4 GREEN/gate:** the two targeted commands, then G; no sim transition/version change in this card.
- [ ] **5 Handoff:** publish exact `BatchResult.classPicks` and legal ban tokens; PR body includes `Out-of-plan changes` and `Migrated assertions` with the exhaustive-counter/copy migrations listed.

**Acceptance:** whole repo typechecks with five-recipe types; ordinary games still have exactly R1 transitions; no zero/NaN telemetry keys; Thai coverage includes every class. **Migrations:** exhaustive counter objects, R1-only enumeration boundary, how-to exact copy. **Out of scope:** shape matching, executing class pick/bans in the sim, balance tuning, components.

```ts
expect(recipeName("class")).toBe("ลูกทีมอาชีพ");
expect(CLASS_IDS.map(className)).toEqual(["นักมวย", "หมอยา", "นินจา", "ยักษ์"]);
expect(
  runBatch({ games: 1, seed0: 1, maxMinutes: 0.001 }).classPicks.fruit,
).toEqual({ boxer: 0, healer: 0, ninja: 0, giant: 0 });
```

**E2E rule:** `ss -ltn | grep ':4173 '` must print nothing before final full e2e; never kill another project's process; assert `Talad War`; locked run, ≤2 workers. Full gate: G.

### R2-3 — Class wall, validated pick input and recruitment (dev-backend)

**Files (7):** modify `packages/sim/src/pad.ts`, `open.ts`, `step.ts`, `index.ts`; modify `packages/sim/test/pad.test.ts`, `smoke.test.ts`; create `packages/sim/test/classPick.test.ts`.

**Consumes/produces:** R2-1 fields/profiles and R2-2 recipe/ban/telemetry contracts; implements §2.2, `canStartOpen(s,id,classPick?):boolean`, new `startOpen(s,id,classPick?)`, persistent opening `classId`, completed class event. SIM_VERSION `0.3.1`. No transform-existing-unit path.

**Live consumers:** matcher/result/preview/eligibility at `pad.ts:71-149`; `step.ts:79-122` open priority/start; `open.ts:23-88,92-128` channel/spawn; observer in `harness.ts:84-94` and all client calls through `canOpen`/`padPreview` (`keyboard.ts:50`, `Match.ts:355`, `hud/padPreview.ts:41`). Client E/Open must safely no-op on a class wall with no choice until UI wiring lands.

- [ ] **1 RED:** update the 256-mask oracle in `pad.test.ts:355-413` to permit ONLY masks 15/51/204/240 in addition to heavy 85; assert all other R1 outputs unchanged, including floating legacy fixtures. Add `classPick.test.ts`: `four_walls_and_each_super_position`, `choice_required_and_each_class_recruits_new_bot`, `team_cap_counts_dead_and_completion_rechecks`, `stale_choice_and_cancel_boundaries`, `class_and_individual_bans_fail_closed`, `completion_precedes_same_tick_combat`, `class_pick_replay_is_pure`. Run `cd packages/sim && ../../node_modules/.bin/vitest run test/pad.test.ts test/classPick.test.ts`, capture intended failures.
- [ ] **2 Implement:** exact wall masks, OR quality, class bans/cap and input validation; pass the pick through step without changing normal Open priority. Extend spawn helper parameters internally to optional class/quality and initialize HP after traits. Add event fields from §2.2.
- [ ] **3 Pin timing/cancellation:** select at tick T, assert no new unit through T+19 and exactly one at T+20; no choice/stale snapshot/banned class consumes nothing. Death/off-pad/carry/content/cap changes before completion cancel and leave crates. Two same-team attempted openers recruit at most one; same-snapshot tie follows existing ascending unit iteration. Plain buddy from a class opener is classless. Replay a fixed input tape through two independently created states; assert full equality/hash and unchanged original input state. No fabricated hash literal.
- [ ] **4 GREEN/gate:** targeted command, version+smoke pair, then G. Do not weaken OPEN_TICKS or the recipe oracle for passing.
- [ ] **5 Handoff:** publish new event schema and cancellation semantics, including completion-before-combat. PR body includes `Out-of-plan changes` and `Migrated assertions` for wall-mask changes.

**Acceptance:** all four choices work via real sim input; recruitment/cap/quality/persistence state is correct; existing gun/bombs/buddy/heavy tests still pass unchanged except approved wall oracle/version migrations. **Out of scope:** healing/combat abilities, automatic bot selection, UI, switching.

```ts
const s = createMatch(1);
s.pads.fruit.cells = [
  [100, 101],
  [102, 103],
  [null, null],
  [null, null],
];
expect(matchRecipe(s.pads.fruit)).toBe("class");
expect(padPreview(s, "fruit")).toEqual({
  recipe: "class",
  super: false,
  openable: true,
});
// The full recruit test adds real crate objects, a source on pad, its snapshot and 20 steps.
```

**E2E rule:** `ss -ltn | grep ':4173 '` empty before final full e2e; never kill another project's process; assert `Talad War`; locked run, ≤2 workers. Full gate: G.

### R2-4 — Class abilities, lethal boundaries and respawn (dev-backend)

**Files (7):** modify `packages/sim/src/classes.ts`, `combat.ts`, `step.ts`, `index.ts`; create `packages/sim/test/classAbilities.test.ts`, `classReplay.test.ts`; modify `packages/sim/test/smoke.test.ts`.

**Consumes/produces:** R2-1 profile helpers and R2-3 recruitment; implements `updateClassHealing`, `tryNinjaKnock` from §2.1/2.3 and class-aware slap/damage/respawn. SIM_VERSION `0.3.2`. Constants stay at R2-1 values until the tuning cards.

**Live consumers:** `combat.ts:65-89,113-128,225-246,310-355`; `step.ts:124-130`; existing `dropCrateAt`/`liftTop` at `crates.ts:102-115`/`pad.ts:56-63`. Do not edit or duplicate crate-ground resolution.

- [ ] **1 RED:** write `classAbilities.test.ts` named tests: `boxer_slaps_units_and_stalls_not_guns` (damage equals exported `BOXER_SLAP_DMG`, initially 12 versus ordinary 8); `healing_is_max_not_sum_and_never_revives` (20 ticks: ally gains `HEALER_AURA_HP_PER_SEC`, self alone `HEALER_SELF_HP_PER_SEC`, two providers still one aura rate, clamp personal max, exact exported radius edge included/outside excluded, enemy/corpse/stall untouched); `ninja_knocks_top_of_occupied_enemy_column_only` (same ID/quality on legal ground, upper before lower, no stealing); `ninja_cooldowns_and_opening_phase_boundary` (exported cooldown boundary); `giant_reduces_bombs_only` (45 times exported `GIANT_BOMB_DAMAGE_MULT`, initially 27, gun/heavy/slap unchanged); `all_classes_respawn_with_traits_without_items`. Use exported tunable constants in these behavioural expectations, not frozen initial class values; leave R1 literals frozen. Run `cd packages/sim && ../../node_modules/.bin/vitest run test/classAbilities.test.ts test/classReplay.test.ts`; observe intended failures.
- [ ] **2 Implement:** hook helpers at the exact phases above; compute healing from a stable pre-heal snapshot and max rate. Keep damage event values consistent with reduced damage. Reset only transient Ninja cooldown on respawn.
- [ ] **3 Replay/regression:** `classReplay.test.ts` uses a captured deterministic tape containing class opening, heal overlap, Ninja knock, projectile deaths and respawn; replay twice with equality/hash and input-state immutability. Reorder healer provider arrays in isolated direct-helper tests and assert identical per-ID HP. Assert a Ninja on own/empty pad, with gun/crate, on cooldown or dead cannot knock. Assert a cancelled still-running wall retains all remaining crates and a completed earlier opening is not undone.
- [ ] **4 GREEN/gate:** targeted tests, version+smoke, then G. Preserve R1 combat/range/cooldown/quality and damage-source assertions.
- [ ] **5 Handoff:** report ability ordering and damage/event examples; PR body includes `Out-of-plan changes` and `Migrated assertions` (`None` beyond version unless real evidence says otherwise).

**Acceptance:** §2.3 fully exercised; no stacking, revive, trait loss, double slap/knock or hidden RNG. **Out of scope:** ability visuals/audio, bot tactical tuning, constants tuning, input/control.

```ts
const s = createMatch(1);
Object.assign(s.units[0]!, {
  classId: "healer",
  hp: 50,
  pos: { x: 12, y: 12 },
});
Object.assign(s.units[1]!, { hp: 50, pos: { x: 12, y: 12 } });
updateClassHealing(s);
expect(s.units[0]!.hp).toBeCloseTo(50 + HEALER_SELF_HP_PER_SEC * DT);
expect(s.units[1]!.hp).toBeCloseTo(50 + HEALER_AURA_HP_PER_SEC * DT);
```

**E2E rule:** empty `ss -ltn | grep ':4173 '` before final full e2e; never kill another project's process; title `Talad War`; locked run, ≤2 workers. Full gate: G.

### R2-5 — Deterministic control handoff in the sim (dev-backend)

**Files (5):** create `packages/sim/src/control.ts`, `packages/sim/test/control.test.ts`; modify `packages/sim/src/step.ts`, `index.ts`, `packages/sim/test/smoke.test.ts`.

**Consumes/produces:** R2-1 optional `switchNext`, R2-3 class channel; exact §2.4 control helpers and event. No new required MatchState field; `createMatch(seed,{humanUnit:null})` remains all-bot. SIM_VERSION `0.3.3`.

**Live consumers:** `setup.ts:30-50`, `types.ts:33-49,103-120`, `step.ts:51-65,67-70`; existing state-derived bot brain `bots/brain.ts:69-87`. Later client migration consumer list is in §1; do not edit client code here.

- [ ] **1 RED:** `control.test.ts`: `cycles_sorted_ids_and_skips_dead_enemies`, `dead_source_can_switch_but_no_target_is_noop`, `switch_discards_source_actions_and_is_order_stable`, `released_body_uses_current_bot_goal_next_tick`, `switch_cancels_source_class_channel_without_losing_wall`, `all_bot_and_match_over_are_unchanged`. Use sparse IDs and shuffle arrays in helper-only tests; expected cycle e.g. same-team IDs 2,9,40 gives 2→9→40→2, skipping dead 9 gives 2→40. Run `cd packages/sim && ../../node_modules/.bin/vitest run test/control.test.ts`; observe missing helper/behaviour failure.
- [ ] **2 Implement:** phase 1b, eligibility/order, flags/events and source/target idle tick exactly as §2.4. A bot cannot hijack control even if its supplied map entry says switch. Keep state clone/purity.
- [ ] **3 Pin edges:** successful source `fire/throw/open/pickDrop/move` are all discarded; target pre-buffered map entries are ignored; failed switch leaves valid ordinary inputs intact; dead source is not revived; cargo/weapon/class flags stay attached to bodies. Next tick a released carrying unit uses fetch logic, a squad-commanded unit follows that command, dead bot waits for respawn. Two copies of an input tape including switch+death+recruitment yield identical full states/hashes.
- [ ] **4 GREEN/gate:** targeted test, version/smoke pair, G.
- [ ] **5 Handoff:** exact helper/event schema to client cards; PR body includes `Out-of-plan changes` and `Migrated assertions`.

**Acceptance:** one production human owner, no transfer of items/inputs, switch works at team cap and from a dead body, no auto-switch/death-policy change. **Out of scope:** key decision, keyboard/touch/UI, camera, multiplayer control.

```ts
const s = createMatch(1);
expect(switchControl(s, 0)).toBe(1);
expect(controlledUnit(s)?.id).toBe(1);
expect(s.units.find((u) => u.id === 0)?.isBot).toBe(true);
expect(controlledUnit(createMatch(1, { humanUnit: null }))).toBeNull();
```

**E2E rule:** `ss -ltn | grep ':4173 '` prints nothing before final full e2e; never kill another project's process; assert `Talad War`; locked run, ≤2 workers. Full gate: G.

### R2-6 — Natural bot class building, selection and class tactics (dev-backend)

**Files (8):** modify `packages/sim/src/bots/squad.ts`, `bots/brain.ts`, `constants.ts`, `index.ts`; modify `packages/sim/test/bots.test.ts`, `r1Bots.test.ts`, `smoke.test.ts`; create `packages/sim/test/r2Bots.test.ts`.

**Consumes/produces:** R2-3 pick/ban/channel contracts, R2-4 abilities, R2-5 released-body policy; `chooseClass(s,team)` and §3.1 bot decisions. SIM_VERSION `0.3.4`. Consume the named R2 scoring knobs from R2-1; never edit R1 values.

**Live consumers:** `squad.ts:10-42,46-68,79-85`; `brain.ts:69-87,96-165,236-352,404-442,454-490`; R1 expected priorities at `r1Bots.test.ts:51-119,213-244,247-285`, natural count maps `:401-435`; old natural buddy/bomb checks in `bots.test.ts:59-79,402-404`.

- [ ] **1 RED:** in `r2Bots.test.ts` add `wall_builds_without_premature_open`, `needs_respect_supply_cap_bans_and_partial_wall`, `choose_class_is_need_based_seed_tied_and_pure`, `bot_channel_holds_under_goal_change`, `ninja_raids_and_healer_supports`, `six_natural_seeds_recruit_each_class`. Assert class placement visits one canonical pair only, no early gun/bombs/buddy open, picked class allowed and event-driven actual recruit. Run `cd packages/sim && ../../node_modules/.bin/vitest run test/r2Bots.test.ts`; missing natural use must fail before implementation.
- [ ] **2 Implement:** §3.1 priority, selection, legal wall extension/recovery, identical human/bot choice command and exact zero-move channel hold. Preserve super-first claim prerequisites and same-crate tie handling from R1.
- [ ] **3 Regressions:** add mirror/purity tests for every allowed class and banned alternative; no RNG advance on `chooseClass`/`botInput`. Migrate only priority fixtures whose state NOW satisfies class demand: add explicit R1-isolating preconditions (e.g. whole-class ban or cap) when the test is specifically about heavy/bombs, and add new assertions proving the R2 priority. Do not delete old heavy/buddy natural-use requirements. Six natural seeds log per-seed/aggregate counts as §3.1, each ends with a winner.
- [ ] **4 GREEN/gate:** targeted R2/R1 bot tests, 50-game probes if needed, version/smoke, G. If the asserted 200-game gate fails, tune only the named R2 knobs in owned constants or ask Lead to coordinate R2-7 on this head; never pretend it passes or weaken targets.
- [ ] **5 Handoff:** include natural-use event counts, changed priority fixtures and tuning table; PR body includes `Out-of-plan changes` and `Migrated assertions`.

**Acceptance:** ≥1 successful pick of EACH class across fixed seeds 1–6, ordinary recipes still used, bots never deadlock on bans/partial walls, mirror steering and purity retained. **Out of scope:** final 1,000-game acceptance matrix, UI, new pathfinding, R3 targeting.

```ts
const s = createMatch(1, { humanUnit: null });
s.itemBans = { fruit: ["boxer", "ninja", "giant"] };
const before = stateHash(s);
expect(chooseClass(s, "fruit")).toBe("healer");
expect(stateHash(s)).toBe(before);
// The natural-seed test asserts each real-event aggregate class counter is >= 1, not this fixture.
```

**E2E rule:** `ss -ltn | grep ':4173 '` empty before final full e2e; never kill another project's process; title `Talad War`; locked run, ≤2 workers. Full gate: G.

### R2-7 — Balance matrix, ban enforcement audit and measured journey migration (dev-backend)

**Files (8):** modify `packages/sim/src/constants.ts`, `harness.ts`, `index.ts`; modify `packages/sim/test/harness.test.ts`, `smoke.test.ts`, `apps/client/e2e/journey.spec.ts`; create `packages/sim/test/r2Balance.test.ts`, `docs/plans/2026-10-17-r2-balance-results.md`.

**Consumes/produces:** R2-2 telemetry/CLI, R2-3 enforcement, R2-6 real bot use; final tuned R2 constants and measured matrix, SIM_VERSION `0.3.5`. `runBatch`/`checkTargets` API and locked bands unchanged. If a correctness bug is found outside owned files, return it to its owning card rather than expand this card.

**Live consumers:** `harness.ts:59-130,133-161,168-210`; independent oracle `harness.test.ts:57-98,137-159,168-204`; `journey.spec.ts:102-117` seeded score assertions. Earlier cards created the new ban enforcement; this card tests it, not a second ban mechanism.

- [ ] **1 RED:** `r2Balance.test.ts` checks checkTargets boundaries with real-shaped fixtures (unbanned median 299.99 fails, 300 and 480 pass, 480.01 fails; win .4499 fails/.45 passes, .55 passes/.5501 fails; banned .3999 fails/.40 passes; any timeout fails); replay of short real runBatch counts matches an independently stepped observer; each class/whole-recipe ban yields zero prohibited class picks for only the banned side. Add rejection tests for malformed ban flags if not already covered. Run `cd packages/sim && ../../node_modules/.bin/vitest run test/r2Balance.test.ts test/harness.test.ts`; new coverage must expose a real missing assertion/behaviour before changing it, not invent a failure if implementation already passes (report already-covered cases honestly).
- [ ] **2 Tune:** run 50-game probes, change only named R2 constants; `r2Balance.test.ts` pins the final chosen numeric table. Earlier class tests consume exported tunable constants and freeze only R1 literals, so no out-of-scope prior-test edit is needed. If an accidental prior literal blocks tuning, return it to its owning card/Lead rather than silently exceeding the eight-file scope. Record before/after metrics and all final values in the results doc.
- [ ] **3 Final matrix:** execute §3.2's 11 R2 runs plus four R1 ban regressions sequentially. Retain exact commands, head SHA, all JSON, exits, class counts, draw/timeout denominators and final constants. Repeated same-seed short batch equality excludes only measured msPerTick. No selected subset substituted for the matrix.
- [ ] **4 Journey/gate:** after the port preflight, run `run-locked talad-war-e2e npm run e2e -w @talad/client -- e2e/journey.spec.ts` against the final sim head, measure the replacement for 1414.25/1414 with its seed/steps, then migrate both exact assertions together with a linked log; no guessed number or broad `>0` replacement. Run G once at end. New score may coincidentally remain unchanged; in that case report no migration.
- [ ] **5 Handoff:** results doc links raw evidence in PR comments/artifacts; PR body includes `Out-of-plan changes`, `Migrated assertions`, concise matrix table and final counts, not full logs.

**Acceptance:** final §3.2 bands/matrix pass, each class demonstrably non-mandatory, no R1 ban regression, deterministic counters, exact score migration justified. **Out of scope:** changing locked constants/bands/timeouts, improving audit vulnerabilities, changes to bot algorithms beyond R2 named knobs, art/client feature work.

```ts
const r = runBatch({ games: 1, seed0: 1, maxMinutes: 0.001 });
const band = {
  ...r,
  medianSec: 300,
  winRate: { fruit: 0.5, dessert: 0.5 },
  timeouts: 0,
  msPerTick: 0.1,
};
expect(checkTargets(band).ok).toBe(true);
expect(checkTargets({ ...band, medianSec: 299.99 }).ok).toBe(false);
expect(
  checkTargets(
    { ...band, winRate: { fruit: 0.3999, dessert: 0.6 } },
    { team: "fruit", item: "healer" },
  ).ok,
).toBe(false);
```

**E2E rule:** `ss -ltn | grep ':4173 '` prints nothing before targeted/final server use; never kill another project's process; assert `Talad War`; final full run locked, ≤2 workers. Full gate: G plus the matrix above.

### R2-8 — Lead art ingestion and frame-attached class rendering (dev-frontend)

**Prerequisite:** Lead's §4 bundle and receipt, OWNER? accessory decision, all 144 head landmarks, and approved no-raise budget or explicit alternative. Do not start with placeholder art or generate it. Depends on R2-4; coordinate against R2-9's `view.ts` work.

**Code/test files (8):** modify `apps/client/src/render/anims.ts`, `scenes/Boot.ts`, `render/view.ts`, `apps/client/test/loadBudget.test.ts`; create `apps/client/src/render/classGeometry.ts`, `render/classDecorations.ts`, `apps/client/test/classGeometry.test.ts`, `apps/client/e2e/r2Art.spec.ts`. **Produced-art ingestion, separately enumerated:** copy the 15 exact WebPs and `public/art/manifest.json` from §4 byte-for-byte from Lead's bundle. This is the only >8 physical-file exception, because those 16 files are externally approved artifacts, not worker-authored code.

**Consumes/produces:** §4 `ClassArtManifest`, existing sim class flags/stats; new `classVisualGeometry(...)` pure calculations and `ClassDecorations` Phaser adapter. Exact signatures:

```ts
export interface BodyTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  flipX: boolean;
}
export interface VisualBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function classVisualGeometry(
  body: BodyTransform,
  head: HeadFrame,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  bounds: VisualBounds;
};
export class ClassDecorations {
  constructor(scene: Phaser.Scene, manifest: ArtManifest | undefined);
  sync(
    unit: Unit,
    body: Phaser.GameObjects.Sprite,
    cargoBounds: VisualBounds | null,
  ): VisualBounds | null;
  destroy(): void;
}
```

`HeadFrame`/`ClassArtManifest` are defined/exported in `anims.ts` with §4 schema. `classVisualGeometry` implements the exact §4 transform; the view computes feet clamp from union bounds before final placement, reserving an additional 24 logical px for the later control arrow on every controlled body. `ClassDecorations.sync` returns the union bounds of body/head/cargo/badge/super star (null for dead), which R2-9 passes to its marker; it owns accessory/badge/super-star sprites, not the control marker. `Boot.ts` validates referenced keys/landmark lengths and still uses existing props loader; failures fall back without crashing, but a malformed delivered manifest fails asset tests.

**Live consumers:** `anims.ts:11-24,53-65` → `Boot.ts:23-42`, `view.ts:80,145-198,229-239`; display/clamp/cargo at `view.ts:346-352,490-499`. Manifest legacy hash assertions `loadBudget.test.ts:78-89` must strip ONLY new top-level `classArt` and the 15 new prop keys before hashing; keep the existing 16 pre-R1 props, R1 SHA checks and canonical old hash unchanged.

- [ ] **1 RED:** `classGeometry.test.ts`: exact source-to-screen calculation for both flips, per-frame bob, nonuniform pose scale and Giant; computed union including super cargo never top-clips at world y=.45. Extend loadBudget test to require every new key/dimension/hash from the actual receipt, 8×18 finite landmarks, unchanged old manifest projection/hashes and actual recursive byte budget. Run `cd apps/client && ../../node_modules/.bin/vitest run test/classGeometry.test.ts test/loadBudget.test.ts`; fail on missing assets/metadata before copying.
- [ ] **2 Ingest/schema:** copy approved bundle, validate schema/receipt and add typed metadata. Do not recompress Lead bytes in the worker or replace old hashes. Keep generic props loading and full manifest field compatibility.
- [ ] **3 Render:** implement §4 frame tracking, Giant scale and dynamic clamp/cargo offsets; no double bob/scale or new physics. Missing-art graceful fallback; clean listener/sprite lifecycle. Preserve classless and R1 glow/projectile rendering.
- [ ] **4 GREEN/visual:** pure geometry/manifest tests cover all 8 skins×18 landmark entries, both flips and four class accessories, including KO metadata. Run `run-locked talad-war-e2e npm run e2e -w @talad/client -- e2e/r2Art.spec.ts` after the port preflight. It uses existing `renderSnapshot`/`artFeedback` hooks and controlled animation-clock advancement for the visible idle/run/carry/windup/slap/hurt poses, all skins/classes, super/non-super and classless, dead/revive, y=.45 with normal/super cargo. KO is hidden by the existing dead branch (`view.ts:152-155`), so assert hidden art rather than requiring a visible KO animation that does not exist. Assert texture keys/bounds/scale and attach contact sheets. Record actual run/carry/slap clip, run §6 media-check, then G.
- [ ] **5 Handoff:** receipt totals and old-file hash preservation, screenshots/clip/media verdict, no asset placeholders. PR body includes `Out-of-plan changes` and `Migrated assertions` for the legacy manifest projection only.

**Acceptance:** approved overlay fit, 1.20× Giant, no clipping or drift, 3 MB art/5 MB real build gates, all old art unchanged. **Out of scope:** hand animation, new character sheets, control marker, pick/switch UI, generating art or raising budgets.

```ts
expect(
  classVisualGeometry(
    {
      x: 50,
      y: 300,
      width: 256,
      height: 256,
      originX: 0.5,
      originY: 0.984375,
      flipX: false,
    },
    { x: 128, y: 100, width: 128 },
  ),
).toMatchObject({ x: 50, y: 148, width: 256, height: 256 });
```

**E2E rule:** `ss -ltn | grep ':4173 '` empty before server use; never kill another project's process; assert `Talad War`; final full suite locked, ≤2 workers. Full gate: G plus receipt/media evidence.

### R2-9 — Controlled-body HUD binding and white marker (dev-frontend)

**Files (8):** modify `apps/client/src/render/view.ts`, `hud/status.ts`, `hud/padPreview.ts`, `hud/aimMarker.ts`, `apps/client/test/hud.test.ts`; create `apps/client/src/render/controlledMarker.ts`, `apps/client/test/controlHud.test.ts`, `apps/client/e2e/r2ControlVisual.spec.ts`.

**Consumes/produces:** R2-5 `controlledUnit`/`nextLivingTeammate`, R2-8 approved art/scaled geometry. Replace all body-0 selectors in these modules; NEW `ControlledMarker` has `constructor(scene, manifest)`, `sync(unit:Unit|null, body:Phaser.GameObjects.Sprite|null, overheadBounds:VisualBounds|null):void`, `destroy():void`. It owns exactly one white ring/arrow pair, reusing the view's actual drawn body/decorations bounds and primitive fallback. No class adornments duplicated in it.

**Live consumers:** `view.ts:76-96,201-222`, `status.ts:59-93`, `padPreview.ts:12-15`, `aimMarker.ts:20-25`; tests currently assume ID 0 at `hud.test.ts:135-204,314-316`. Preserve public HUD sync signatures, changing only data selection. Preview positioning remains on fruit pad; glow follows controlled unit eligibility. Existing blue aim ring targets the new body's enemy, not itself.

- [ ] **1 RED:** `controlHud.test.ts`: create two same-team units with different gun/quality/bombs/cargo, flip control with real sim helper and assert exact independent held-item labels, glow cell and hidden-dead state now follow target ID. Include sparse IDs and nonzero `humanUnit`. Run `cd apps/client && ../../node_modules/.bin/vitest run test/controlHud.test.ts test/hud.test.ts` and capture failures from hardcoded body-0 assumptions.
- [ ] **2 Implement:** all four selectors and the marker adapter; remove old gold human triangle only, not team/aim rings. Never store a second mutable selected ID. Include source ID in memoization only if necessary to avoid stale per-unit render state.
- [ ] **3 Visual RED/GREEN:** `r2ControlVisual.spec.ts` stages prev/cur via existing renderSnapshot, switches to a class-bearing sparse-ID body, checks one ring/arrow, no marker on corpse/all-bot state, Giant and upper-edge geometry and stable reduced-motion position. Verify item panel still has BOTH primary/cargo and independent bomb quality/count.
- [ ] **4 Gate/media:** targeted tests, then `run-locked talad-war-e2e npm run e2e -w @talad/client -- e2e/r2ControlVisual.spec.ts` after the port preflight; clip of marker handoff and §6 media-check, then G. Do not assume client input is already wired (R2-11 owns live scene input).
- [ ] **5 Handoff:** selector inventory completed, bounds and fallback evidence. PR body includes `Out-of-plan changes` and `Migrated assertions` (selector-specific fixtures only).

**Acceptance:** render/HUD never read player body by index 0; white marker distinct from blue target/team colours, all quality/loadout info correct for the selected unit. **Out of scope:** scene control queue, key binding, buttons/CSS, camera, team-bar redesign.

```ts
const s = createMatch(1);
s.units[1]!.bombs = 2;
switchControl(s, 0);
const hud = new MatchHud(document.createElement("div"));
hud.sync(s);
expect(hud.itemEl.textContent).toContain("ระเบิด ×2");
```

**E2E rule:** `ss -ltn | grep ':4173 '` empty before final full e2e; never kill another project's process; assert `Talad War`; locked run, ≤2 workers. Full gate: G.

### R2-10 — Tested class/switch controls and compact HUD components (dev-frontend)

**Prerequisite:** OWNER? key answer recorded; use R only if approved. R2-3/5 public contracts and R2-2 Thai copy required. May build components without scene integration; do not edit `Match.ts` concurrently with R2-11.

**Files (8):** modify `apps/client/src/input/keyboard.ts`, `input/touch.ts`, `apps/client/test/keyboard.test.ts`; create `apps/client/src/input/r2Controls.ts`, `hud/classPick.ts`, `hud/switch.ts`, `apps/client/src/r2.css`, `apps/client/test/r2Controls.test.ts`.

**Consumes/produces:** preserve existing `KeyboardInput.read(state,unitId,opts?):UnitInput`, touch read shape and current E/Q semantics outside class context. Add `resetForHandoff():void` to keyboard and touch; touch method clears pointer capture/vector/fire/pulses. New shared context/helpers:

```ts
export interface ClassPickContext {
  unitId: UnitId;
  snapshot: string;
}
export function classPickContext(s: MatchState): ClassPickContext | null;
// keyboard handleKey now accepts optional context and returns whether a digit was consumed:
// handleKey(code:string, down:boolean, context?:ClassPickContext|null):boolean
export class R2Controls {
  constructor();
  queuePick(context: ClassPickContext, classId: UnitClass): void;
  queueSwitch(): void;
  read(s: MatchState): Partial<UnitInput>; // consumes one-shot requests; validates source/snapshot
  resetForHandoff(): void;
}
export class ClassPickHud {
  constructor(
    mount: HTMLElement,
    onPick: (context: ClassPickContext, classId: UnitClass) => void,
  );
  sync(s: MatchState): void;
  destroy(): void;
}
export class SwitchHud {
  constructor(mount: HTMLElement, onSwitch: () => void);
  sync(s: MatchState): void;
  destroy(): void;
}
```

`classPickContext` is nonnull only when the controlled unit can open a class wall; HUD caches exactly the displayed context and sends it with the selected class. Keyboard digits cache that context at keydown. `R2Controls.read` returns a pick only if source/snapshot still match and canOpen still holds; request is consumed even when stale. Keyboard switch returns `switchNext:true` once per approved key press. Shared controller merges DOM switch/class requests later in the scene; do not introduce another simulation API. `ClassPickHud.sync` computes channel progress from sim ticks, not a wall-clock interval. CSS exactly §5; add no global restyle.

**Live consumers:** `keyboard.ts:21-58`, `touch.ts:95-118`, `Match.ts:134-139,400-421` (later integration), `buttons.ts:16-24` unchanged; new switch lives in screen HUD, not hidden touch buttons. Existing digit squad mapping `Match.ts:28-32` must be explicitly routed by next card.

- [ ] **1 RED:** `r2Controls.test.ts` tests `choice_context_and_stale_source_snapshot_are_one_shot`, `four_named_buttons_and_channel_states`, `switch_enabled_for_dead_source_with_live_target`, `handoff_clears_all_control_latches`, `failed_icon_keeps_Thai_button_name`. Extend keyboard tests for 1–4 mapped picks only in class context, approved switch edge/no-repeat, unchanged Q throw/E normal, and E on class wall never lift/open-without-choice. Run `cd apps/client && ../../node_modules/.bin/vitest run test/r2Controls.test.ts test/keyboard.test.ts`; capture intended failures.
- [ ] **2 Implement input adapters:** exact queues/context/resets above; consume pending invalid actions without reissuing. Keyboard must clear all held/pulses and ignore repeated keydowns after handoff until a new physical press. Touch reset releases captures safely even after cancellation; no stuck fire/joystick.
- [ ] **3 Components/styles:** four visible labelled icons and contextual status, disabled/no-target switch, complete states/tokens/target widths from §5. Native keyboard focus/Enter/Space work. Component pointer events do not propagate into canvas fire/joystick. Don't import CSS into shell or wire scene yet; those are R2-11's integration scope.
- [ ] **4 GREEN/gate:** targeted commands and G; new components independently tested but not claimed live-wired. Use DOM tests for progress/error/cleanup; don't add timers that leak between scenes.
- [ ] **5 Handoff:** component signatures, approved key and pending integration requirements. PR body includes `Out-of-plan changes` and `Migrated assertions` (explicit approved-context keyboard changes only).

**Acceptance:** tested complete components/queues with safe stale/held-input semantics, styles ready for approved HUD widths. **Out of scope:** scene wiring, new hooks/e2e fixtures, art production, changing squad commands outside the class context.

```ts
const controls = new R2Controls();
controls.queueSwitch();
expect(controls.read(createMatch(1)).switchNext).toBe(true);
expect(controls.read(createMatch(1)).switchNext).not.toBe(true);
controls.queueSwitch();
controls.resetForHandoff();
expect(controls.read(createMatch(1)).switchNext).not.toBe(true);
```

**E2E rule:** `ss -ltn | grep ':4173 '` empty before final full e2e; never kill another project's process; assert `Talad War`; locked run, ≤2 workers. Full gate: G.

### R2-11 — Scene integration, real-input e2e and final client gate (dev-frontend)

**Files (8):** modify `apps/client/src/scenes/Match.ts`, `apps/client/src/testHooks.ts`, `apps/client/src/shell.css`, `apps/client/src/i18n/th.ts`, `apps/client/e2e/helpers.ts`; create `apps/client/e2e/r2Classes.spec.ts`, `r2Switch.spec.ts`, `r2Layout.spec.ts`. The i18n change is ONLY §5's owner-approved switch-key tutorial suffix. No sim changes or score retuning here.

**Consumes/produces:** R2-7 final sim/score, R2-9 selector/marker, R2-10 adapters/components and owner-approved key. Remove `HUMAN_UNIT` and all player-ID-zero uses in Match.ts. Integrate new screen-HUD components and CSS import; ordinary action buttons stay in touch controls. New dev-only hook `stepInputs(inputs:ReadonlyArray<readonly [UnitId,UnitInput]>):void` calls the SAME `stepTick` and `syncAll` used by real play, for deterministic staging only; no prod-mode public mutation API. Existing `placeUnit` resolves by `.find(id)` rather than array index. Extend reduced helper types with `isBot`, `classId`, `superBuddy`, full opening fields and new events as needed; add `controlledHookUnit(state)` to the test helper and migrate its two driver ID-0 assumptions (`helpers.ts:127,274`). Old ID-0 tests that intentionally test the default start remain valid and need not all be rewritten.

**Live consumers:** full selector/key/tick list in §1; specifically `Match.ts:134-144,283-288,346-365,377-423`, `testHooks.ts:56-90`, `helpers.ts:6-30,127,274`, tutorial copy at `i18n/th.ts:25-26`; `shell.css:395-399` must not hide the new screen-HUD switch. Export `controlledHookUnit(s:HookState):HookUnit|null` from helpers, selecting the lowest-ID `!isBot` unit exactly as the production helper does.

- [ ] **1 RED e2e first:** create `r2Classes.spec.ts` (normal/super wall, all 4 real button and digit choices, mouse/touch/Enter activation, no ordinary Open, 20-tick channel, cap/cancel/stale states), `r2Switch.spec.ts` (real key and button handoff, previous body becomes bot, per-unit loadout/aim/glow, held fire/WASD/joystick does not transfer, dead-source switch and no-target disabled), `r2Layout.spec.ts` (844×390,1280×800,667×320 and portrait pause; pairwise control bounds, Thai names/focus, reduced motion and blocked-icon fallback). Use existing title assertion/entry helpers; stage the pad with existing hooks, then exercise production input, not hook-created successful events. After the port preflight run `run-locked talad-war-e2e npm run e2e -w @talad/client -- e2e/r2Classes.spec.ts e2e/r2Switch.spec.ts e2e/r2Layout.spec.ts` against the pre-wiring head and capture expected missing-control/behaviour failures.
- [ ] **2 Integrate scene:** initialize/reset/destroy new controls/HUD every match; sample `controlledUnit` each tick INCLUDING dead sources; merge keyboard/touch/R2 requests once. Contextual digits win over command keys and are swallowed during class channel. Hide touch Open for class recipes. Clear all latches/mouse state on actual `controlSwitched`, visibility/portrait transition and shutdown; do not copy movement into the handoff tick. Register DOM activation so clicks do not fire the canvas weapon.
- [ ] **3 Test observability:** add the guarded hook/type/helper updates above; `renderSnapshot` syncs the new HUD as well as view/loadout so visual fixtures do not leave stale controls. Retain production hook stripping (`testHooks.ts:30-35`); no fake pause of gameplay while choosing. Exercise recruitment → switch to newly spawned class → use ability → death/respawn; assert same class/quality persists and slots clear, using real sim steps.
- [ ] **4 GREEN/final gate:** targeted specs, verify all width/state/overlap checks (≥8 px where specified), record motion clip + §6 media-check, then G exactly once for the complete local suite. Confirm ordinary journey/quality/bomb/touch/audio suites still pass and final production build/load budget remains ≤5 MB. Do not alter seeded journey scores again without returning to R2-7's measured migration process.
- [ ] **5 Review handoff:** PR body contains `Out-of-plan changes` and `Migrated assertions`, owner answers, full-gate counts, screenshot/clip and matrix links; body ≤20,000 chars. Independent reviewer/QA execute their lanes; do not deploy.

**Acceptance:** all §5 screens/states/widths work in real client input; all direct production player selectors use control helper; no buffered action leak, class-choice/command collision, hidden desktop switch, unreadable marker or lost held-item UI; production hooks absent. **Out of scope:** new mode/title page, four teams, spectator/results redesign, artwork generation, new audio, live deploy.

```ts
await enterMatch(page); // includes exact Talad War title assertion
const before = await getState(page);
const from = controlledHookUnit(before)!;
await page.getByRole("button", { name: /^สลับตัว/ }).click();
await expect
  .poll(async () => controlledHookUnit(await getState(page))?.id)
  .not.toBe(from.id);
const after = await getState(page);
expect(after.units.find((u) => u.id === from.id)?.isBot).toBe(true);
```

**E2E rule:** before targeted/final server use `ss -ltn | grep ':4173 '` must print nothing; never kill another project's process; every spec asserts `Talad War`; one final full suite via `run-locked talad-war-e2e npm run e2e`, ≤2 local workers. Full gate: G, plus §5 state/width and media checks.

## 8. Assertion migration ledger and hotspot ownership

| Category / existing assertion                                                                              | Owner / permitted migration                                                                                                                                                                                   | Never do                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SIM_VERSION '0.2.4'`, `smoke.test.ts:6`                                                                   | R2-1/3/4/5/6/7 paired versions listed §2.1                                                                                                                                                                    | Change export but forget literal; reuse a changed transition's replay version.                           |
| All-256-shape R1 oracle and four walls null, `pad.test.ts:355-413`                                         | R2-3 changes only four new wall masks; keeps heavy85/R1 malformed fixture oracle                                                                                                                              | Replace exhaustive mask coverage with one happy-path wall.                                               |
| Exhaustive recipe/telemetry objects, `harness.test.ts:23-37,57-75`; `r1Bots.test.ts:401-435`               | R2-2 add class zeros and classPicks; R2-6 adds natural-use requirement                                                                                                                                        | Delete counters, tolerate NaN, remove R1 recipe-use assertions.                                          |
| Exact basic/super/gun/heavy/bomb stats, `r1Combat.test.ts:65-96`, `items.ts:71-78`                         | Frozen; class tests use separate profiles                                                                                                                                                                     | Rebaseline old stats to mask a broad multiplier bug.                                                     |
| Class initial numeric profile assertions (new R2-1)                                                        | R2-7 tunes exported R2 constants; algebra tests should consume them, final-value table pinned in R2-7 test. If R2-1 accidentally hardcodes a tunable literal, Lead routes a same-owner correction explicitly. | Unlisted file edits under “test cleanup”, silently changing the initial table in this copied plan.       |
| Bot need/placement assertions, `r1Bots.test.ts:51-119,213-285` and `bots.test.ts:59-79`                    | R2-6 isolate genuinely R1-specific preconditions and add corresponding R2 priority test                                                                                                                       | Mass snapshot updates or suppressing a missing heavy/buddy recipe.                                       |
| Thai recipe/how-to literal and exhaustive `Record<Recipe>`, `i18n.test.ts:11-62`                           | R2-2 exact copy from §5; selected key tutorial suffix after owner answer                                                                                                                                      | Translating to English to fit width or removing exhaustive compile checks.                               |
| Canonical pre-R1 manifest hash / count, `loadBudget.test.ts:78-89`                                         | R2-8 remove ONLY new R2 prop keys/top-level metadata from the legacy projection; keep original hash/count and R1 SHA fixtures                                                                                 | Recompute old hash over a changed legacy file, ignore unreferenced files in byte total, raise 3 MB/5 MB. |
| Default player-ID-0 HUD/unit tests, `hud.test.ts:135-204,314-316`; helper assumptions `helpers.ts:127,274` | R2-9/11 add nonzero-ID coverage and move selectors to ownership; keep deliberate default-ID fixtures                                                                                                          | Treat array reorder as control change; rewrite every old fixture without a reason.                       |
| Seeded journey damage 1414.25 / displayed1414, `journey.spec.ts:105,117`                                   | ONLY R2-7, actual final-head seed/run output with exact old→new migration record                                                                                                                              | Guess value, use any-number assertion or unrelated minimum, migrate in a UI card.                        |
| Three pre-existing expected sim failures                                                                   | Keep and identify them in reports                                                                                                                                                                             | Claim all 202 ordinary passes or add expected-failure tests for unimplemented R2.                        |

**Hotspots:** `packages/sim/src/types.ts`, `constants.ts`, `index.ts`, `step.ts`, `pad.ts`, `open.ts`; `apps/client/src/render/view.ts`, `scenes/Match.ts`, `i18n/th.ts`, `test/loadBudget.test.ts`. The dependency graph intentionally serializes owners. If another card is touching one at runtime, post `hotspot: <path> — <reason>` and coordinate through Lead; no silent parallel conflict resolution or out-of-scope refactor of the 677-line renderer / 425-line scene (`view.ts`/`Match.ts` inspected totals). New class/marker/controls files keep this release from adding another monolith.

## 9. Open owner questions, acceptance and out of scope

### OWNER? answers required downstream

1. **Key conflict:** A) R switches, Q still throws, E still picks/opens (recommended). B) Q switches; owner explicitly names replacement throw key. Holds R2-10/11 key integration only.
2. **Overlay fidelity:** A) head-following costume + Giant static collar, gloves/basket/sword in badge/pick icons (recommended). B) true animated hand/body details with revised scope/sample/budget. Holds Lead cutting/R2-8, not sim implementation.
3. **Budget contingency only if measurements fail:** A) optimize within 3 MB art/5 MB total (recommended). B) explicitly approve ≤3.2 MB art, still ≤5 MB total. No raise needed on the proposed allocation, and no implied approval.

No other product decisions are delegated to workers: class recruitment is new-unit spawn, source/target switch idling and cancellation are fixed, pick timing/quality/cap/persistence/ordering are fixed, and tuning is limited to named R2 knobs.

### Release acceptance checklist (not yet executed for R2)

- [ ] Exact four wall masks → selectable class teammate; R1 recipe/quality values unchanged.
- [ ] All four classes' abilities, normal/super stats and persistent respawn traits exercised by deterministic tests/tapes.
- [ ] Class cap/invalid/stale/death/leaving/switch cancellation, same-tick combat boundary and same-pad opener race covered.
- [ ] Switch from living/dead source, no-target/cap/all-bot edges, sorted sparse IDs, previous body bot takeover, and no action-buffer leak covered in sim/client.
- [ ] Natural seeds1–6 recruit each class at least once; all five recipes and super outcomes still observed naturally.
- [ ] 1,000-game unbanned R2 and both-side per-class/whole-class removal runs pass; existing R1 removal pairs also pass, final knobs recorded.
- [ ] Lead art receipt/144 landmarks/assets verified; overlay limitation approved; no new sheets; ≤3 MB art and ≤5 MB measured total load.
- [ ] Thai pick/switch/status/copy, independent per-body loadout, white ring/arrow, blue auto-aim and whole arena readable at approved widths/states; native focus and fallbacks work.
- [ ] Gate G and independent review/QA real evidence attached; `Out-of-plan changes`/`Migrated assertions` complete; owner plays R2 before release authorization.

**Out of scope for every card:** R3 teams/corners/new-team art/four-way targeting/elimination/watch mode/mode chooser; vehicles or 8-crate recipes; stealth/invisibility; online/accounts; new maps/camera; reclassifying an existing full-cap unit; stealing enemy-pad crates except specified Ninja knock; character sheet regeneration; new audio/music; dependency/audit fixes; workflow/tag/version-release/deploy work. An observation in these areas becomes a separate Lead decision, not implementation scope creep.

## 10. Plan self-review and execution evidence addendum

Self-review completed against the approved design: §2 anti-goals map to recipe clarity, UI identity, natural bot-use, removal balance and replay tests; §5 maps to R2-1 through R2-11; §7 maps to matrix/load/layout/media acceptance; §8.3/.4/.7 map to explicit choices/overlays/persistence. R3 is excluded without narrowing Team. Types/event names and downstream signatures above have one owner each. All five Review Focus items have named tests. File scopes include migration paths, not just implementation modules. Every card has RED→implementation→GREEN/gate→handoff steps, ≤5 per card, ≤8 code/test/doc files, except the explicitly enumerated Lead-produced asset ingestion and conditional design copy.

A 60 fps target with 20 units is a **design target**, not a measured baseline or a promise from headless tests. Independent QA should capture frame-time evidence with 20 rendered units at 844×390 on its available device, state the device, and report any inability to verify mid-range-phone performance. Do not label desktop headless throughput a phone-fps pass. No new profiling subsystem is required in a worker card.

Fresh baseline command, executed in the external scratch archive: `npm run sim -- --games 1000 --assert`, actual exit **0**. Direct harness JSON:

```json
{
  "games": 1000,
  "medianSec": 308.625,
  "p90Sec": 371.505,
  "winRate": { "fruit": 0.492, "dessert": 0.508 },
  "draws": 0,
  "timeouts": 0,
  "msPerTick": 0.04034000649897507,
  "opens": {
    "fruit": { "gun": 8727, "bombs": 8344, "buddy": 1978, "heavy": 4232 },
    "dessert": { "gun": 8678, "bombs": 8352, "buddy": 1981, "heavy": 4229 }
  },
  "superOpens": { "fruit": 2107, "dessert": 2144 },
  "stallDamage": {
    "fruit": {
      "slap": 2704888,
      "gun": 863088,
      "bombs": 1255837.5,
      "heavy": 874701.25
    },
    "dessert": {
      "slap": 2761704,
      "gun": 860052,
      "bombs": 1273050,
      "heavy": 875081.25
    }
  },
  "assert": "pass"
}
```

All R2 results remain unexecuted planning targets until implementation workers provide evidence. No code, branch, PR or deployment was changed by the planning task.

Plan-only verification: a scratch Python validator confirmed the four mask values, image/manifest arithmetic, 15 art files, 144 head records, 45 fully-qualified file/line references within existing source ranges, and 11 card briefs with five steps each plus their port/PR-body clauses. This is a structural check, not execution of proposed R2 tests. The initial plan-format check reported formatting issues (exit 1); the plan was formatted with the repository's Prettier and a fresh check passed (exit 0, “All matched files use Prettier code style!”). Final primary-repository `git diff --exit-code` and `git diff --cached --exit-code` both passed, and status retained only the same four pre-existing `vc-base*` untracked directories. The approved source design still compared byte-for-byte equal to its existing repository copy.
