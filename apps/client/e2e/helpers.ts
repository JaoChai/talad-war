import { expect, type CDPSession, type Page } from '@playwright/test';
import type { MatchStats } from '../src/stats';
import type { AudioLogEntry, StallFeedback } from '../src/testHooks';

/** Minimal shape of window.__talad.state() used by the e2e specs. */
export interface HookUnit {
  id: number;
  team: 'fruit' | 'dessert';
  pos: { x: number; y: number };
  carrying: number | null;
  gun: unknown;
  bombs: number;
  hp: number;
  deadUntilTick: number | null;
  /** R2: bots are authored by the sim; control ownership is `!isBot`. */
  isBot: boolean;
  /** Persistent class; omitted for basic teammates. */
  classId?: string;
  /** Persistent super-buddy perk; survives death. */
  superBuddy?: boolean;
  bombsSuper?: boolean;
}

export interface HookState {
  seed: number;
  tick: number;
  units: HookUnit[];
  crates: {
    id: number;
    pos: { x: number; y: number };
    state: string;
    landTick: number;
    kind: string;
  }[];
  pads: Record<
    string,
    {
      origin: { x: number; y: number };
      cells: (number | null)[][];
      opening: {
        byUnit: number;
        doneTick: number;
        snapshot: string;
        classId?: string;
      } | null;
    }
  >;
  stalls: Record<string, { team: string; pos: { x: number; y: number }; hp: number }>;
  projectiles: { id: number }[];
  events: {
    kind: string;
    tick: number;
    target?: unknown;
    dmg?: number;
    source?: unknown;
    team?: unknown;
    unitId?: unknown;
    spawnedUnitId?: unknown;
    classId?: unknown;
    fromUnitId?: unknown;
    toUnitId?: unknown;
  }[];
  winner: string | null;
  commands: {
    fruit: 'attack' | 'guard' | 'fetch' | null;
    dessert: 'attack' | 'guard' | 'fetch' | null;
  };
}

declare global {
  interface Window {
    __talad: {
      artFeedback(): import('../src/testHooks').ArtFeedback;
      renderSnapshot(
        prev: import('@talad/sim').MatchState,
        cur: import('@talad/sim').MatchState,
        alpha: number,
      ): void;
      stats(): MatchStats;
      audioLog(): AudioLogEntry[];
      audioReady(): boolean;
      musicGain(): number;
      unitFeedback(id: number): {
        now: number;
        attackAt: number;
        x: number;
        y: number;
        width: number;
        flipX: boolean;
        slash: { kind: string; screenSize: number; alpha: number } | null;
      };
      stallFeedback(team: 'fruit' | 'dessert'): StallFeedback;
      state(): HookState;
      setSeed(seed: number): void;
      fastForward(ticks: number): void;
      setCommand(team: 'fruit' | 'dessert', cmd: 'attack' | 'guard' | 'fetch' | null): void;
      placeUnit(unitId: number, x: number, y: number): void;
      setPadCrates(team: 'fruit' | 'dessert', cols: number[]): void;
      setPadLayout(
        team: import('@talad/sim').Team,
        entries: ReadonlyArray<{
          col: number;
          layer: 0 | 1;
          kind?: import('@talad/sim').CrateKind;
        }>,
      ): void;
      setStallHp(team: 'fruit' | 'dessert', hp: number): void;
      /** R2-11 dev-only staging: step one tick with explicit per-unit inputs. */
      stepInputs(inputs: ReadonlyArray<readonly [number, import('@talad/sim').UnitInput]>): void;
    };
  }
}

export async function enterMatch(page: Page): Promise<void> {
  await expect(page).toHaveTitle('Talad War');
  await page.waitForFunction(
    () => window.__talad !== undefined || document.querySelector('[data-screen="title"]') !== null,
  );
  if (await page.locator('[data-screen="title"]').count()) {
    await page.getByRole('button', { name: 'เล่น', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__talad !== undefined || document.querySelector('[data-screen="howto"]') !== null,
    );
    if (await page.locator('[data-screen="howto"]').count())
      await page.getByRole('button', { name: 'ข้าม', exact: true }).click();
  }
  await page.waitForFunction(() => window.__talad !== undefined, undefined, { timeout: 20_000 });
}

export async function waitHooks(page: Page): Promise<void> {
  await enterMatch(page);
}

export async function getState(page: Page): Promise<HookState> {
  return page.evaluate(() => window.__talad.state());
}

/** Sample the REAL open request before advancing its remaining sim ticks. */
export async function finishOpening(page: Page): Promise<void> {
  // A wall-clock poll can see zero live ticks. Consume the actual input merge,
  // never fabricate open:true, then require the real sim to accept the channel.
  await stepRealInputs(page, 1);
  const accepted = await page.evaluate(() => {
    const state = window.__talad.state();
    const opening = state.pads.fruit!.opening;
    if (opening === null) return false;
    window.__talad.fastForward(Math.max(0, opening.doneTick - state.tick));
    return true;
  });
  expect(accepted, 'real input started an opening before finishing its ticks').toBe(true);
}

// One discovery per document: repeated module/queryObjects walks cost ~1s each
// locally and can themselves exhaust a slow runner's channel-test budget.
const realInputTargets = new WeakMap<Page, { cdp: CDPSession; gamesId: string }>();

/**
 * Sample the actual keyboard/touch/R2 merge and use the existing stepInputs
 * hook. CDP accesses the scene only in this test utility; no production API.
 * Optional enemy re-docking is deterministic staging, never synthetic fire:
 * removing the real pointer handler must still leave the enemy unharmed.
 */
export async function stepRealInputs(
  page: Page,
  ticks: number,
  adjacentEnemyId?: number,
): Promise<HookState> {
  return realInputs(page, ticks, adjacentEnemyId);
}

/**
 * Lead-approved fixture clock for the two real-input specs. Hold only this
 * page's live scene accumulator; rendering, trusted events and humanInputs
 * stay real. stepInputs/fastForward explicitly own every measured sim window.
 * Navigation/page teardown discards the scene (and its instance-only override).
 * Other specs and production FixedLoop/RAF are unchanged.
 */
export async function holdSceneTicks(page: Page): Promise<void> {
  await realInputs(page, 0, undefined, true);
}

async function realInputs(
  page: Page,
  ticks: number,
  adjacentEnemyId?: number,
  holdLive = false,
): Promise<HookState> {
  const cached = realInputTargets.get(page);
  const cdp = cached?.cdp ?? (await page.context().newCDPSession(page));
  const stepTarget = async (gamesId: string) => {
    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId: gamesId,
      functionDeclaration: `function(ticks, enemyId, holdLive) {
        const game = this.find(g => g.scene?.isActive('match'));
        if (!game) return null;
        const scene = game.scene.getScene('match');
        if (holdLive) scene.loop.advance = () => 0;
        const startTick = window.__talad.state().tick;
        for (let i = 0; i < ticks; i++) {
          if (enemyId !== null) {
            const s = window.__talad.state();
            const me = s.units.find(u => !u.isBot);
            const enemy = s.units.find(u => u.id === enemyId);
            if (!me || !enemy) throw new Error('Combat staging unit missing');
            window.__talad.placeUnit(enemyId, me.pos.x + 0.6, me.pos.y);
          }
          window.__talad.stepInputs(Array.from(scene.humanInputs()));
        }
        const state = window.__talad.state();
        if (state.tick - startTick !== ticks) {
          throw new Error('Real-input window did not run all ' + ticks + ' ticks');
        }
        return state;
      }`,
      arguments: [{ value: ticks }, { value: adjacentEnemyId ?? null }, { value: holdLive }],
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value as HookState | null;
  };
  try {
    if (cached) {
      const state = await stepTarget(cached.gamesId);
      if (!state) throw new Error('Cached match scene is no longer active');
      return state;
    }
    const hook = await cdp.send('Runtime.evaluate', { expression: 'window.__talad.artFeedback' });
    const details = await cdp.send('Runtime.getProperties', { objectId: hook.result.objectId! });
    const scopes = details.internalProperties!.find((p) => p.name === '[[Scopes]]')!;
    const list = await cdp.send('Runtime.getProperties', {
      objectId: scopes.value!.objectId!,
      ownProperties: true,
    });
    const module = list.result.find((p) => p.value?.description === 'Module')!;
    const bindings = await cdp.send('Runtime.getProperties', {
      objectId: module.value!.objectId!,
      ownProperties: true,
    });
    for (const binding of bindings.result.filter((p) => p.value?.objectId)) {
      const prototype = await cdp.send('Runtime.callFunctionOn', {
        objectId: binding.value!.objectId!,
        functionDeclaration: 'function() { return this?.Game?.prototype; }',
      });
      if (!prototype.result.objectId) continue;
      const games = await cdp.send('Runtime.queryObjects', {
        prototypeObjectId: prototype.result.objectId,
      });
      const state = await stepTarget(games.objects.objectId!);
      if (state) {
        realInputTargets.set(page, { cdp, gamesId: games.objects.objectId! });
        // A new document invalidates CDP object handles. Page/context closure
        // destroys the session automatically; never reuse it across navigation.
        const invalidate = () => {
          realInputTargets.delete(page);
          void cdp.detach().catch(() => {});
          page.off('framenavigated', onNavigation);
          page.off('close', invalidate);
        };
        const onNavigation = (frame: ReturnType<Page['mainFrame']>) => {
          if (frame === page.mainFrame()) invalidate();
        };
        page.on('framenavigated', onNavigation);
        page.once('close', invalidate);
        return state;
      }
    }
    throw new Error('Live match scene not found for real-input stepping');
  } finally {
    if (!realInputTargets.has(page)) await cdp.detach();
  }
}

export function padCrateCount(st: HookState): number {
  return (st.pads.fruit?.cells ?? []).reduce(
    (n, col) => n + col.filter((c) => c !== null).length,
    0,
  );
}

/**
 * The controlled hook unit: the lowest-ID `!isBot` unit, exactly like the
 * production helper (sim control.ts). Body-derived, including while dead.
 */
export function controlledHookUnit(s: HookState): HookUnit | null {
  let controlled: HookUnit | null = null;
  for (const unit of s.units) {
    if (!unit.isBot && (controlled === null || unit.id < controlled.id)) controlled = unit;
  }
  return controlled;
}

export function nearestGroundCrate(
  st: HookState,
  from: { x: number; y: number },
): { id: number; pos: { x: number; y: number } } | null {
  let best: { id: number; pos: { x: number; y: number } } | null = null;
  let bestD = Infinity;
  for (const crate of st.crates) {
    if (crate.state !== 'ground') continue;
    const d = Math.hypot(crate.pos.x - from.x, crate.pos.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = crate;
    }
  }
  return best;
}

export function nearestEnemy(st: HookState, team: 'fruit' | 'dessert'): HookUnit | null {
  let best: HookUnit | null = null;
  let bestD = Infinity;
  const me = controlledHookUnit(st); // drivers steer the controlled body, not ID 0
  if (!me) return null;
  for (const u of st.units) {
    if (u.team === team || u.deadUntilTick !== null) continue;
    const d = Math.hypot(u.pos.x - me.pos.x, u.pos.y - me.pos.y);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

/** One driver drives the human unit the same way on desktop (keys) and mobile (joystick). */
export interface Driver {
  steer(dx: number, dy: number): Promise<void>;
  /** Pick/Drop pulse (E key or Pick button). */
  action(): Promise<void>;
  /** Open! (E key or Open! button). */
  open(): Promise<void>;
  /** Throw a bomb (Q key or Throw button). */
  throwBomb(): Promise<void>;
  /** Fire tap (mouse click or Fire button tap). */
  fireTap(): Promise<void>;
  release(): Promise<void>;
}

function norm(dx: number, dy: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

export async function keyDriver(page: Page): Promise<Driver> {
  const held = new Set<string>();
  const setKey = async (code: string, on: boolean) => {
    if (on && !held.has(code)) {
      await page.keyboard.down(code);
      held.add(code);
    } else if (!on && held.has(code)) {
      await page.keyboard.up(code);
      held.delete(code);
    }
  };
  return {
    steer: async (dx, dy) => {
      const v = norm(dx, dy);
      await setKey('KeyW', v.y < -0.35);
      await setKey('KeyS', v.y > 0.35);
      await setKey('KeyA', v.x < -0.35);
      await setKey('KeyD', v.x > 0.35);
    },
    action: () => page.keyboard.press('KeyE'),
    open: () => page.keyboard.press('KeyE'),
    throwBomb: () => page.keyboard.press('KeyQ'),
    fireTap: async () => {
      // Click near the human's screen position: slap/gun fire is aim-agnostic
      // for the nearest-enemy target, so the exact point does not matter.
      await page.mouse.move(660, 340);
      await page.mouse.down();
      await page.waitForTimeout(70);
      await page.mouse.up();
    },
    release: async () => {
      for (const code of [...held]) await setKey(code, false);
    },
  };
}

export async function joyDriver(page: Page, cdp: CDPSession): Promise<Driver> {
  const BASE = { x: 180, y: 285 };
  const RADIUS = 56;
  const points = new Map<number, { x: number; y: number }>();

  const send = async (type: 'touchStart' | 'touchMove' | 'touchEnd', changed: number[]) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: changed.map((id) => {
        const p = points.get(id)!;
        return { x: p.x, y: p.y, id };
      }),
    });
  };
  const add = async (id: number, x: number, y: number) => {
    points.set(id, { x, y });
    await send('touchStart', [id]);
  };
  const move = async (id: number, x: number, y: number) => {
    points.set(id, { x, y });
    await send('touchMove', [...points.keys()]);
  };
  const remove = async (id: number) => {
    const p = points.get(id);
    if (!p) return;
    points.delete(id);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: p.x, y: p.y, id }],
    });
  };
  const tapButton = async (id: number, selector: string) => {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`touch button missing: ${selector}`);
    await add(id, box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(90);
    await remove(id);
  };

  return {
    steer: async (dx, dy) => {
      const v = norm(dx, dy);
      if (!points.has(1)) await add(1, BASE.x, BASE.y);
      await move(1, BASE.x + v.x * RADIUS, BASE.y + v.y * RADIUS);
    },
    action: () => tapButton(2, '#tw-btn-pick'),
    open: () => tapButton(2, '#tw-btn-open'),
    throwBomb: () => tapButton(2, '#tw-btn-throw'),
    fireTap: () => tapButton(2, '#tw-btn-fire'),
    release: async () => {
      for (const id of [...points.keys()]) await remove(id);
    },
  };
}

export interface DriveOpts {
  within?: number;
  budgetMs?: number;
}

/**
 * Deterministic waypoint follower: steer straight at the target, and when the
 * unit stops making progress, alternate axis-only steering to slide around
 * obstacles. No random retries — bounded budget, fixed strategy ladder.
 */
export async function driveTo(
  page: Page,
  driver: Driver,
  target: { x: number; y: number },
  opts: DriveOpts = {},
): Promise<boolean> {
  const within = opts.within ?? 0.45;
  const budget = opts.budgetMs ?? 45_000;
  const t0 = Date.now();
  let last: { x: number; y: number } | null = null;
  let axisMode = 0;
  let sinceProgress = 0;
  while (Date.now() - t0 < budget) {
    const st = await getState(page);
    const me = controlledHookUnit(st); // drivers steer the controlled body, not ID 0
    if (!me) return false;
    if (me.deadUntilTick !== null) {
      await driver.release();
      await page.waitForTimeout(300);
      continue;
    }
    const dx = target.x - me.pos.x;
    const dy = target.y - me.pos.y;
    if (Math.hypot(dx, dy) <= within) {
      await driver.release();
      return true;
    }
    if (last && Math.hypot(me.pos.x - last.x, me.pos.y - last.y) < 0.1) {
      sinceProgress += 1;
      if (sinceProgress >= 8) {
        axisMode = (axisMode + 1) % 3; // direct → x-only → y-only
        sinceProgress = 0;
      }
    } else {
      sinceProgress = 0;
    }
    last = { ...me.pos };
    let sx = dx;
    let sy = dy;
    if (axisMode === 1) sy = 0;
    if (axisMode === 2) sx = 0;
    await driver.steer(sx, sy);
    await page.waitForTimeout(110);
  }
  await driver.release();
  return false;
}
