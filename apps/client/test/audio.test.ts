import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMatch } from '@talad/sim';
import type { MatchEvent, Projectile } from '@talad/sim';
import { AudioMixer, sfxForTick } from '../src/audio';

const projectile = (id: number, kind: 'bullet' | 'bomb'): Projectile => ({
  id,
  kind,
  team: 'fruit',
  pos: { x: 20, y: 12 },
  vel: { x: 1, y: 0 },
  ttlTicks: 20,
});
const event = (kind: string, target?: number | string): MatchEvent => ({ tick: 1, kind, target });

// The fake replaces only browser I/O; the real mixer owns gains, timers and policy.
function browserAudio() {
  const sources: { loop: boolean; started: boolean; stopped: boolean }[] = [];
  const gains: { value: number; setValueAtTime(v: number): void }[] = [];
  const context = {
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 32 })),
    createDynamicsCompressor: () => ({
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect() {},
    }),
    createGain: () => {
      const gain = {
        value: 1,
        setValueAtTime(v: number) {
          this.value = v;
        },
      };
      gains.push(gain);
      return { gain, connect() {} };
    },
    createBufferSource: () => {
      const source = {
        loop: false,
        started: false,
        stopped: false,
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    },
  };
  const factory = vi.fn(() => context as unknown as AudioContext);
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(new ArrayBuffer(8), {
        headers: { 'content-type': 'audio/ogg' },
      }),
  );
  return { context, sources, gains, factory, fetcher };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sfxForTick', () => {
  it.each([
    ['explosion', undefined, 'explosion'],
    ['hit', 0, 'hitUnit'],
    ['hit', 'dessert', 'hitStall'],
    ['death', undefined, 'death'],
    ['respawn', undefined, 'respawn'],
    ['crateLand', undefined, 'crateLand'],
    ['cratePick', undefined, 'cratePick'],
    ['crateDrop', undefined, 'crateDrop'],
    ['openStarted', undefined, 'openStarted'],
    ['opened', undefined, 'opened'],
    ['padFull', undefined, 'padFull'],
    ['matchOver', undefined, 'matchOver'],
  ] as const)('maps %s target=%s to %s', (kind, target, key) => {
    const cur = createMatch(7);
    cur.events = [event(kind, target)];
    expect(sfxForTick(null, cur)).toEqual([key]);
  });
  it('maps only new bullet and bomb ids, including the first tick', () => {
    const prev = createMatch(7);
    prev.projectiles = [projectile(100, 'bullet'), projectile(101, 'bomb')];
    const cur = structuredClone(prev);
    cur.projectiles.push(projectile(102, 'bullet'), projectile(103, 'bomb'));
    expect(sfxForTick(prev, cur)).toEqual(['fire', 'throw']);
    expect(sfxForTick(cur, cur)).toEqual([]);
    expect(sfxForTick(null, prev)).toEqual(['fire', 'throw']);
  });
  it('caps each key independently at three per tick', () => {
    const cur = createMatch(7);
    cur.events = Array.from({ length: 6 }, () => event('hit', 0));
    cur.projectiles = Array.from({ length: 5 }, (_, i) => projectile(i + 100, 'bullet'));
    expect(sfxForTick(null, cur)).toEqual([
      'hitUnit',
      'hitUnit',
      'hitUnit',
      'fire',
      'fire',
      'fire',
    ]);
  });
  it('ignores unrelated events without mutating either state', () => {
    const cur = createMatch(7);
    cur.events = [event('crateSpawn'), event('hit')];
    const before = structuredClone(cur);
    expect(sfxForTick(null, cur)).toEqual([]);
    expect(cur).toEqual(before);
  });
});

describe('AudioMixer', () => {
  it('stays silent and does not fetch or construct audio until a gesture unlocks it', async () => {
    const io = browserAudio();
    const mixer = new AudioMixer({ contextFactory: io.factory, fetcher: io.fetcher });
    mixer.play('fire');
    expect(io.factory).not.toHaveBeenCalled();
    expect(io.fetcher).not.toHaveBeenCalled();
    await mixer.unlock();
    expect(io.sources.filter((s) => s.started && s.loop)).toHaveLength(1);
    mixer.dispose();
  });
  it('ducks 0.3 to 0.12 for exactly 400ms on explosion', async () => {
    vi.useFakeTimers();
    const io = browserAudio();
    const mixer = new AudioMixer({ contextFactory: io.factory, fetcher: io.fetcher });
    await mixer.unlock();
    expect(mixer.musicGain).toBe(0.3);
    mixer.play('explosion');
    expect(mixer.musicGain).toBe(0.12);
    expect(io.gains[0]!.value).toBeCloseTo(0.12);
    vi.advanceTimersByTime(399);
    expect(mixer.musicGain).toBe(0.12);
    vi.advanceTimersByTime(1);
    expect(mixer.musicGain).toBe(0.3);
    mixer.dispose();
  });
  it('extends duck until 700ms when another explosion arrives at 300ms', async () => {
    vi.useFakeTimers();
    const mixer = new AudioMixer({ contextFactory: () => null });
    await mixer.unlock();
    mixer.play('explosion');
    vi.advanceTimersByTime(300);
    mixer.play('explosion');
    vi.advanceTimersByTime(399);
    expect(mixer.musicGain).toBe(0.12);
    vi.advanceTimersByTime(1);
    expect(mixer.musicGain).toBe(0.3);
    mixer.dispose();
  });
  it('mutes both actual gains and stays muted through duck expiry, then restores', async () => {
    vi.useFakeTimers();
    const io = browserAudio();
    const mixer = new AudioMixer({ contextFactory: io.factory, fetcher: io.fetcher });
    await mixer.unlock();
    mixer.play('explosion');
    mixer.setMuted(true);
    expect([mixer.musicGain, mixer.sfxGain, ...io.gains.map((g) => g.value)]).toEqual([0, 0, 0, 0]);
    vi.advanceTimersByTime(400);
    expect(mixer.musicGain).toBe(0);
    mixer.setMuted(false);
    expect([mixer.musicGain, mixer.sfxGain]).toEqual([0.3, 0.25]);
    mixer.dispose();
  });
  it('does not throw without AudioContext or when constructing/resuming audio fails', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const unavailable = new AudioMixer();
    await expect(unavailable.unlock()).resolves.toBeUndefined();
    expect(() => {
      unavailable.play('fire');
      unavailable.dispose();
    }).not.toThrow();
    const broken = new AudioMixer({
      contextFactory: () => {
        throw new Error('disabled');
      },
    });
    await expect(broken.unlock()).resolves.toBeUndefined();
    broken.dispose();
    const io = browserAudio();
    io.context.resume.mockRejectedValue(new Error('not allowed'));
    const rejected = new AudioMixer({ contextFactory: io.factory, fetcher: io.fetcher });
    await expect(rejected.unlock()).resolves.toBeUndefined();
    rejected.dispose();
  });
  it('falls back to mp3 on ogg decode failure and starts one loop across repeated unlocks', async () => {
    const io = browserAudio();
    io.context.decodeAudioData.mockRejectedValueOnce(new Error('unsupported ogg'));
    const mixer = new AudioMixer({ contextFactory: io.factory, fetcher: io.fetcher });
    await Promise.all([mixer.unlock(), mixer.unlock()]);
    expect(io.fetcher.mock.calls.some(([url]) => String(url).endsWith('.mp3'))).toBe(true);
    expect(io.sources.filter((s) => s.loop && s.started)).toHaveLength(1);
    mixer.dispose();
  });
  it('contains failed asset loads and never queues stale effects for a later unlock', async () => {
    const io = browserAudio();
    io.fetcher.mockResolvedValue(new Response('not audio', { status: 404 }));
    const mixer = new AudioMixer({ contextFactory: io.factory, fetcher: io.fetcher });
    mixer.play('fire');
    await expect(mixer.unlock()).resolves.toBeUndefined();
    expect(io.sources).toHaveLength(0);
    expect(() => mixer.play('fire')).not.toThrow();
    mixer.dispose();
  });
  it('stops music for matchOver, plays the jingle once, and disposes all sources', async () => {
    const io = browserAudio();
    const mixer = new AudioMixer({ contextFactory: io.factory, fetcher: io.fetcher });
    await mixer.unlock();
    mixer.play('matchOver');
    expect(mixer.musicGain).toBe(0);
    expect(io.sources[0]!.stopped).toBe(true);
    expect(io.sources.filter((s) => !s.loop && s.started)).toHaveLength(1);
    mixer.play('matchOver');
    expect(io.sources.filter((s) => !s.loop && s.started)).toHaveLength(1);
    mixer.dispose();
    expect(io.sources.every((s) => s.stopped)).toBe(true);
  });
});
