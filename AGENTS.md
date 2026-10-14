The card body overrides this file when they disagree.

# Talad War — agent notes

Thai night-market crate-stacking battle game (Team Buddies-like). v1 = local play vs bots, mobile-first, Cloudflare Workers Static Assets (assets-only, no backend).

- Design (owner-approved): `docs/2026-10-14-talad-war-design.md`
- Plan (tasks, interfaces, constants): `docs/plans/2026-10-14-talad-war-v1.md` — read "Global Constraints" and your task section in full.
- Live: https://talad-war.anugooltippon.workers.dev (deployed by CI on push to `main`).

## Layout

- `packages/sim` (`@talad/sim`): pure deterministic simulation, 20 Hz fixed tick, seeded RNG, bots, balance harness (`src/harness.ts`). Exports `./src/index.ts` directly (no build step).
- `apps/client` (`@talad/client`): Phaser 4 + Vite + `@cloudflare/vite-plugin`; Playwright e2e in `apps/client/e2e`.
- `docs/` is the approved spec — never edit it in a dev card.

## Sim purity (enforced by ESLint on `packages/sim/src/**`, except `harness.ts`)

No `window`/`document`/`localStorage`, no `Math.random`, no `Date.now`, no `node:*` or `phaser` imports. All randomness goes through the RNG stored in `MatchState`. Same seed + same inputs must give the same `stateHash`.

## Gate (same as CI, run from repo root)

```
npm ci
npm run typecheck && npm run lint && npm run format:check && npm test
npm run sim -- --games 50
npm run build -w @talad/client
run-locked talad-war-e2e npm run e2e
```

- Targeted tests while iterating: `npm test -w @talad/sim`, or `node_modules/.bin/vitest run <file>` inside the workspace.
- e2e: local max `--workers=2`, never two e2e runs at once (use `run-locked talad-war-e2e`). Projects: `desktop` 1280x800, `mobile-landscape` 844x390 touch.
- Use `node_modules/.bin/<tool>` instead of `npx`; one plain command per call.

## Branch / PR

- Work on the card's branch, open or extend the PR into `main`. Never push to `main`.
- Push, then `kanban_request_review` at once with the PR URL, head SHA and pending CI run id; do not wait or park on CI.
- Merge and deploy happen only on a Release card.

## Pitfalls (verified)

- `wrangler.jsonc` `compatibility_date` is `2026-10-02`: newer dates do not start on the pinned wrangler 4.141.0 workerd.
- `apps/client/vitest.config.ts` is required; without it vitest crashes on boot in the client workspace.
