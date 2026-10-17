/** CLI harness: the only node-facing entry of the sim package (node builtins + perf timing allowed here only). */
import { pathToFileURL } from 'node:url';
import { CLASS_IDS, TICK_HZ, createMatch, step } from './index';
import type { Recipe } from './pad';
import type { ItemBan, Team, UnitClass } from './types';

export interface BatchOpts {
  games: number;
  seed0: number;
  maxMinutes: number;
  ban?: { team: Team; item: ItemBan };
}

export interface BatchResult {
  games: number;
  medianSec: number;
  p90Sec: number;
  winRate: Record<Team, number>;
  /** Q10: matches where both stalls died in the same tick — count for neither team. */
  draws: number;
  timeouts: number;
  msPerTick: number;
  opens: Record<Team, Record<Recipe, number>>;
  /** Completed class recruits only; started/cancelled channels do not count. */
  classPicks: Record<Team, Record<UnitClass, number>>;
  superOpens: Record<Team, number>;
  /** Damage credited to the attacking team, including overkill as emitted by hit events. */
  stallDamage: Record<Team, Record<'slap' | 'gun' | 'bombs' | 'heavy', number>>;
}

export interface TargetCheck {
  ok: boolean;
  failures: string[];
}

const TEAMS: readonly Team[] = ['fruit', 'dessert'];

/** Balance targets from the design doc Q7 / plan Global Constraints. */
const MEDIAN_SEC: readonly [number, number] = [300, 480];
const WIN_RATE: readonly [number, number] = [0.45, 0.55];
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
 * which measures real host timing. A match that reaches maxMinutes counts as a
 * timeout; a Q10 match where both stalls die in the same tick counts as a draw;
 * both are excluded from both win rates and their duration counts toward the
 * duration percentiles.
 */
export function runBatch(opts: BatchOpts): BatchResult {
  const games = Math.max(1, Math.floor(opts.games));
  const maxTicks = Math.max(1, Math.floor(opts.maxMinutes * 60 * TICK_HZ));
  const wins: Record<Team, number> = { fruit: 0, dessert: 0 };
  const opens: BatchResult['opens'] = {
    fruit: { gun: 0, bombs: 0, buddy: 0, heavy: 0, class: 0 },
    dessert: { gun: 0, bombs: 0, buddy: 0, heavy: 0, class: 0 },
  };
  const classPicks: BatchResult['classPicks'] = {
    fruit: { boxer: 0, healer: 0, ninja: 0, giant: 0 },
    dessert: { boxer: 0, healer: 0, ninja: 0, giant: 0 },
  };
  const superOpens: BatchResult['superOpens'] = { fruit: 0, dessert: 0 };
  const stallDamage: BatchResult['stallDamage'] = {
    fruit: { slap: 0, gun: 0, bombs: 0, heavy: 0 },
    dessert: { slap: 0, gun: 0, bombs: 0, heavy: 0 },
  };
  let draws = 0;
  let timeouts = 0;
  let ticks = 0;
  const durations: number[] = [];
  const inputs = new Map();
  const t0 = performance.now();
  for (let i = 0; i < games; i++) {
    let s = createMatch(opts.seed0 + i, { humanUnit: null });
    if (opts.ban) s.itemBans = { [opts.ban.team]: [opts.ban.item] };
    while (s.winner === null && s.tick < maxTicks) {
      s = step(s, inputs);
      for (const e of s.events) {
        if (e.kind === 'opened' && (e.team === 'fruit' || e.team === 'dessert')) {
          if (
            e.recipe !== 'gun' &&
            e.recipe !== 'bombs' &&
            e.recipe !== 'buddy' &&
            e.recipe !== 'heavy' &&
            e.recipe !== 'class'
          )
            throw new Error(`Unknown opened recipe: ${String(e.recipe)}`);
          opens[e.team][e.recipe]++;
          if (e.recipe === 'class') {
            if (!CLASS_IDS.some((id) => id === e.classId))
              throw new Error(`Unknown opened class: ${String(e.classId)}`);
            classPicks[e.team][e.classId as UnitClass]++;
          }
          if (e.super === true) superOpens[e.team]++;
        }
        if (e.kind === 'hit' && (e.target === 'fruit' || e.target === 'dessert')) {
          if (
            e.source !== 'slap' &&
            e.source !== 'gun' &&
            e.source !== 'bombs' &&
            e.source !== 'heavy'
          )
            throw new Error(`Unknown stall damage source: ${String(e.source)}`);
          if (typeof e.dmg !== 'number') throw new Error('Non-numeric stall damage');
          stallDamage[e.target === 'fruit' ? 'dessert' : 'fruit'][e.source] += e.dmg;
        }
      }
      ticks++;
    }
    if (s.winner === null) timeouts++;
    else if (s.winner === 'draw') draws++;
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
    draws,
    timeouts,
    msPerTick,
    opens,
    classPicks,
    superOpens,
    stallDamage,
  };
}

/** Checks a batch result against the balance bands; every miss becomes one message. */
export function checkTargets(r: BatchResult, ban?: BatchOpts['ban']): TargetCheck {
  const failures: string[] = [];
  const push = (ok: boolean, msg: string): void => {
    if (!ok) failures.push(msg);
  };
  if (ban) {
    push(
      r.winRate[ban.team] >= 0.4,
      `${ban.team} banned-${ban.item} win rate ${(r.winRate[ban.team] * 100).toFixed(1)}% below 40%`,
    );
  } else {
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
  }
  push(r.timeouts === 0, `timeouts ${r.timeouts}/${r.games} above zero cap`);
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
  const teamIndex = argv.indexOf('--ban-team');
  const itemIndex = argv.indexOf('--ban-item');
  let ban: BatchOpts['ban'];
  if (teamIndex >= 0 || itemIndex >= 0) {
    const team = argv[teamIndex + 1];
    const item = argv[itemIndex + 1];
    if (
      teamIndex < 0 ||
      itemIndex < 0 ||
      (team !== 'fruit' && team !== 'dessert') ||
      (item !== 'heavy' &&
        item !== 'super' &&
        item !== 'class' &&
        !CLASS_IDS.some((id) => id === item))
    )
      throw new Error(
        'Use paired --ban-team fruit|dessert --ban-item heavy|super|class|boxer|healer|ninja|giant',
      );
    ban = { team, item: item as ItemBan };
  }
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
    ...(ban ? { ban } : {}),
  };
}

function main(): number {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const result = runBatch(args);
  const check = checkTargets(result, args.ban);
  const out = check.ok ? { ...result, assert: 'pass' } : { ...result, assert: check.failures };
  console.log(JSON.stringify(out));
  return args.assert && !check.ok ? 1 : 0;
}

// CLI entry only when run directly (npm run sim -> tsx src/harness.ts); imports stay inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
