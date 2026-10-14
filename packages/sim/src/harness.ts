/** CLI harness: the only node-facing entry of the sim package (node builtins + perf timing allowed here only). */
import { pathToFileURL } from 'node:url';
import { TICK_HZ, createMatch, step } from './index';
import type { Team } from './types';

export interface BatchOpts {
  games: number;
  seed0: number;
  maxMinutes: number;
}

export interface BatchResult {
  games: number;
  medianSec: number;
  p90Sec: number;
  winRate: Record<Team, number>;
  timeouts: number;
  msPerTick: number;
}

export interface TargetCheck {
  ok: boolean;
  failures: string[];
}

const TEAMS: readonly Team[] = ['fruit', 'dessert'];

/** Balance targets from the design doc Q7 / plan Global Constraints. */
const MEDIAN_SEC: readonly [number, number] = [300, 480];
const WIN_RATE: readonly [number, number] = [0.45, 0.55];
const TIMEOUT_RATE_MAX = 0.02;
const MS_PER_TICK_MAX = 0.5;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

/**
 * Runs `games` all-bot matches (no human unit) with seeds seed0..seed0+games-1 and
 * returns balance stats. Same opts always produce an identical result except msPerTick,
 * which measures real host timing. A match that reaches maxMinutes counts as a timeout
 * draw: neither win rate includes it, and its duration counts as maxMinutes in the
 * duration percentiles.
 */
export function runBatch(opts: BatchOpts): BatchResult {
  const games = Math.max(1, Math.floor(opts.games));
  const maxTicks = Math.max(1, Math.floor(opts.maxMinutes * 60 * TICK_HZ));
  const wins: Record<Team, number> = { fruit: 0, dessert: 0 };
  let timeouts = 0;
  let ticks = 0;
  const durations: number[] = [];
  const inputs = new Map();
  const t0 = performance.now();
  for (let i = 0; i < games; i++) {
    let s = createMatch(opts.seed0 + i, { humanUnit: null });
    while (s.winner === null && s.tick < maxTicks) {
      s = step(s, inputs);
      ticks++;
    }
    if (s.winner === null) timeouts++;
    else wins[s.winner]++;
    durations.push(s.tick / TICK_HZ);
  }
  const msPerTick = (performance.now() - t0) / Math.max(1, ticks);
  durations.sort((a, b) => a - b);
  return {
    games,
    medianSec: quantile(durations, 0.5),
    p90Sec: quantile(durations, 0.9),
    winRate: {
      fruit: wins.fruit / games,
      dessert: wins.dessert / games,
    },
    timeouts,
    msPerTick,
  };
}

/** Checks a batch result against the balance bands; every miss becomes one message. */
export function checkTargets(r: BatchResult): TargetCheck {
  const failures: string[] = [];
  const push = (ok: boolean, msg: string): void => {
    if (!ok) failures.push(msg);
  };
  push(
    r.medianSec >= MEDIAN_SEC[0] && r.medianSec <= MEDIAN_SEC[1],
    `median ${r.medianSec.toFixed(1)}s outside ${MEDIAN_SEC[0]}-${MEDIAN_SEC[1]}s`,
  );
  for (const team of TEAMS) {
    push(
      r.winRate[team] >= WIN_RATE[0] && r.winRate[team] <= WIN_RATE[1],
      `${team} win rate ${(r.winRate[team] * 100).toFixed(1)}% outside ${(WIN_RATE[0] * 100).toFixed(0)}-${(WIN_RATE[1] * 100).toFixed(0)}%`,
    );
  }
  push(
    r.timeouts / r.games <= TIMEOUT_RATE_MAX,
    `timeouts ${r.timeouts}/${r.games} (${((r.timeouts / r.games) * 100).toFixed(1)}%) above ${TIMEOUT_RATE_MAX * 100}% cap`,
  );
  push(
    r.msPerTick <= MS_PER_TICK_MAX,
    `msPerTick ${r.msPerTick.toFixed(3)} above ${MS_PER_TICK_MAX} cap`,
  );
  return { ok: failures.length === 0, failures };
}

interface CliArgs extends BatchOpts {
  assert: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const flag = (name: string, def: number): number => {
    const i = argv.indexOf(`--${name}`);
    const v = i >= 0 ? Number(argv[i + 1]) : Number.NaN;
    return Number.isFinite(v) ? v : def;
  };
  return {
    games: flag('games', 1),
    seed0: flag('seed0', 1),
    maxMinutes: flag('max-minutes', 15),
    assert: argv.includes('--assert'),
  };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const result = runBatch(args);
  const check = checkTargets(result);
  const out = check.ok ? { ...result, assert: 'pass' } : { ...result, assert: check.failures };
  console.log(JSON.stringify(out));
  return args.assert && !check.ok ? 1 : 0;
}

// CLI entry only when run directly (npm run sim -> tsx src/harness.ts); imports stay inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
