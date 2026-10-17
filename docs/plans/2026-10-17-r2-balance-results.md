# R2-7 balance results (2026-10-17)

Final tuned R2 constants, 15-row measured balance matrix and journey score check for
`wt/v2-r2` at head `88e00fdbd84ed5e6edd351c94cf945ae713a76ee`, `SIM_VERSION '0.3.5'`.
All runs: `seed0 1`, `max-minutes 15`, `--assert`, 1000 games, executed sequentially on
the committed simulation head (no source edits during measurement). Raw JSON for every
row is retained in PR evidence comment
[6235161999](https://github.com/JaoChai/talad-war/pull/22#issuecomment-6235161999)
(sha256-verified readback); working logs live under
`.superpowers/sdd/plan-r2/r2-7-matrix/` (before) and `r2-7-matrix/` (final).

## Final tuned R2 constants

| Constant | Value before | Final value | Reason |
| --- | --- | --- | --- |
| `HEALER_AURA_HP_PER_SEC` | 4 | 3.4 | Whole-class ban rows put the classed kit on the banned side's opponent; weakening the most-picked class lift (healer) restores the banned-side floor while keeping six-seed natural recruitment intact. |

No other R2 constant changed; all locked R1 constants, bands, timeouts and bot
algorithms are untouched (`r1Combat`, `smoke` and `r1Bots` suites green on this head).

## Rejected tuning candidates (measured, then reverted)

| Candidate | Measurement | Outcome |
| --- | --- | --- |
| `GIANT_MAX_HP` 200→150 | 50-seed fruit-class probe fruit .38 (< .40; baseline same seeds .40) | rejected, reverted |
| `HEALER_AURA_HP_PER_SEC` 4→3 | fruit-class-1000 .368→.411 (direction confirmed) but `r2Bots` six-natural-seeds recruitment fails (out-of-scope R2-6 assertion) | rejected, reverted |
| `HEALER_AURA_HP_PER_SEC` 4→3.4 | fruit-class .413, dessert-class .476, unbanned in band, `r2Bots` 8/8 | accepted, commit `88e00fd` |

## Final matrix — head `88e00fd` (all rows exit 0)

| Row (ban) | medianSec | fruit wins | dessert wins | timeouts | ms/tick |
| --- | --- | --- | --- | --- | --- |
| unbanned | 327.7 | 0.488 | 0.511 | 0 | 0.0527 |
| fruit-boxer | 333.6 | 0.446 (banned) | 0.553 | 0 | 0.0525 |
| dessert-boxer | 332.3 | 0.550 | 0.449 (banned) | 0 | 0.0527 |
| fruit-healer | 332.7 | 0.651 (banned) | 0.349 | 0 | 0.0544 |
| dessert-healer | 330.8 | 0.353 | 0.646 (banned) | 0 | 0.0544 |
| fruit-ninja | 306.0 | 0.581 (banned) | 0.417 | 0 | 0.0533 |
| dessert-ninja | 306.9 | 0.394 | 0.606 (banned) | 0 | 0.0526 |
| fruit-giant | 326.4 | 0.532 (banned) | 0.468 | 0 | 0.0525 |
| dessert-giant | 324.4 | 0.428 (banned) | 0.572 | 0 | 0.0527 |
| fruit-class | 313.1 | 0.413 (banned) | 0.586 | 0 | 0.0525 |
| dessert-class | 316.1 | 0.524 | 0.476 (banned) | 0 | 0.0524 |
| fruit-heavy (R1) | 349.2 | 0.480 (banned) | 0.520 | 0 | 0.0530 |
| dessert-heavy (R1) | 347.8 | 0.499 | 0.499 (banned) | 0 | 0.0524 |
| fruit-super (R1) | 327.0 | 0.473 (banned) | 0.526 | 0 | 0.0527 |
| dessert-super (R1) | 324.2 | 0.558 | 0.438 (banned) | 0 | 0.0524 |

Before tuning (head `01bb54f`, same 15×1000 matrix): every row passed except
`fruit-class` — fruit 368/1000 = .368 < locked .40 floor (exit 1). The accepted tuning
moved that row to .413 and kept every other row inside its band.

## Acceptance checks

- Unbanned band: median 327.7 ∈ [300, 480]; fruit .488 / dessert .511 ∈ [.45, .55];
  timeouts 0; ms/tick 0.0527 ≤ 0.5.
- Banned-side floor: minimum across all 14 ban rows is .413 (`fruit-class`) ≥ 0.40;
  wins counted over all games (draws in denominator: ≤1 draw per row, 0 timeouts).
- Each class demonstrably non-mandatory: both sides' banned rows ≥ floor for every
  class item, and the unbanned row recruits every class naturally on both teams
  (`classPicks` fruit boxer 157 / healer 830 / ninja 676 / giant 268; dessert
  boxer 147 / healer 791 / ninja 641 / giant 299).
- R1 ban regressions: all four `heavy`/`super` rows exit 0 with banned sides
  .480/.499/.473/.438 ≥ floor.
- Ban enforcement audit: prohibited-side `classPicks` are exactly zero in
  `fruit-class` and `dessert-class` rows while the opponent still picks classes
  (no leak); duplicate `--ban-team`/`--ban-item` flags are rejected (exit 1, pinned in
  `harness.test.ts`); boundary behavior pinned in `r2Balance.test.ts`.
- Determinism: four same-seed 1000-game repeats (unbanned, fruit-class,
  dessert-class, fruit-super) on this head are identical to the probe runs in every
  measured field except `msPerTick`.
- Journey score: `journey.spec.ts` raw/displayed dessert `stallDamage` pinned at 883
  by R2-6. Re-measured on this head with the targeted suite
  (`npm run e2e -w @talad/client -- e2e/journey.spec.ts`, double-locked, title
  asserted): exit 0, 12 passed. Score unchanged → **no migration** (card-anticipated
  outcome).

## Recipe opens, unbanned 1000 games (per Lead request)

| Team | gun | bombs | buddy | heavy | class |
| --- | --- | --- | --- | --- | --- |
| fruit | 6210 | 8388 | 67 | 2972 | 1931 |
| dessert | 6415 | 8122 | 121 | 3081 | 1878 |

Plain buddy opens ≥ 1 on both teams; the existing natural plain-buddy assertion stands.

## Exact commands

```sh
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --assert
npm run sim -- --games 1000 --seed0 1 --max-minutes 15 --ban-team <fruit|dessert> --ban-item <boxer|healer|ninja|giant|class|heavy|super> --assert
npm run e2e -w @talad/client -- e2e/journey.spec.ts
```

Runner: `.superpowers/sdd/plan-r2/r2-7-matrix.py` (sequential; per-row exit codes and
JSON in `r2-7-matrix/results.json`).
