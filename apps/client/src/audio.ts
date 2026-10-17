import type { MatchState } from '@talad/sim';

export const SFX_KEYS = [
  'fire',
  'throw',
  'explosion',
  'hitUnit',
  'hitStall',
  'death',
  'respawn',
  'crateLand',
  'cratePick',
  'crateDrop',
  'openStarted',
  'opened',
  'padFull',
  'matchOver',
] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

/** Only sim deltas: called once per stepped tick, never once per render frame. */
export function sfxForTick(prev: MatchState | null, cur: MatchState): SfxKey[] {
  const sounds: SfxKey[] = [];
  const counts = new Map<SfxKey, number>();
  const add = (key: SfxKey) => {
    const count = counts.get(key) ?? 0;
    if (count < 3) sounds.push(key);
    counts.set(key, count + 1);
  };
  for (const event of cur.events) {
    if (event.kind === 'hit') {
      if (typeof event.target === 'number') add('hitUnit');
      else if (typeof event.target === 'string') add('hitStall');
    } else {
      const key = SFX_KEYS.find((key) => key === event.kind);
      if (key) add(key);
    }
  }
  const oldIds = new Set(prev?.projectiles.map((p) => p.id));
  for (const p of cur.projectiles) {
    if (!oldIds.has(p.id)) add(p.kind === 'bomb' ? 'throw' : 'fire');
  }
  return sounds;
}

let soundOn = true;

/** Storage can be denied in private/embedded browsers; session choice still works. */
export function readSoundPreference(): boolean {
  try {
    const saved = localStorage.getItem('tw.sound');
    if (saved !== null) soundOn = saved !== 'off';
  } catch {
    // Retain the in-memory preference.
  }
  return soundOn;
}

export function writeSoundPreference(on: boolean): void {
  soundOn = on;
  try {
    localStorage.setItem('tw.sound', on ? 'on' : 'off');
  } catch {
    // The game remains playable without storage.
  }
}

interface AudioOptions {
  contextFactory?: () => AudioContext | null;
  fetcher?: typeof fetch;
}

/** Native Web Audio, lazy and fire-and-forget. Audio failures never stop the game. */
export class AudioMixer {
  private context: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private music: AudioBufferSourceNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Set<AudioBufferSourceNode>();
  private loading: Promise<void> | null = null;
  private duckTimer: ReturnType<typeof setTimeout> | undefined;
  private ducked = false;
  private muted = false;
  private ended = false;
  private disposed = false;
  private ready = false;

  constructor(private readonly options: AudioOptions = {}) {}

  get musicGain(): number {
    return this.muted || this.ended || this.disposed ? 0 : this.ducked ? 0.12 : 0.3;
  }
  get sfxGain(): number {
    return this.muted || this.disposed ? 0 : 0.25;
  }
  get isReady(): boolean {
    return this.ready;
  }

  /** Call directly in a trusted pointer/key handler, not after an awaited load. */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.initialize().catch(() => {
      /* Silent fallback: no audio device. */
    });
    return this.loading;
  }

  private async initialize(): Promise<void> {
    const factory =
      this.options.contextFactory ??
      (() => (typeof globalThis.AudioContext === 'function' ? new AudioContext() : null));
    this.context = factory();
    const ctx = this.context;
    if (!ctx) return;
    // resume() is invoked before the first await, preserving user activation.
    const resumed = ctx.resume();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    // A bounded voice count plus bus compression keeps overlapping cartoon cues tame.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    this.musicBus.connect(limiter);
    this.sfxBus.connect(limiter);
    limiter.connect(ctx.destination);
    this.applyGains();
    await resumed;
    await Promise.all(
      ['music', ...SFX_KEYS].map(async (key) => {
        for (const ext of ['ogg', 'mp3']) {
          try {
            const response = await (this.options.fetcher ?? fetch)(`/audio/${key}.${ext}`);
            if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/'))
              continue;
            const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
            if (!this.disposed) this.buffers.set(key, buffer);
            return;
          } catch {
            /* Older Safari: try the MP3; unavailable assets stay silent. */
          }
        }
      }),
    );
    if (this.disposed) return;
    this.ready = true;
    if (!this.ended) this.music = this.startSource('music', true);
  }

  /** Returns true only when a decoded buffer was actually started. */
  play(key: SfxKey): boolean {
    if (this.disposed || this.ended) return false;
    if (key === 'explosion') {
      this.ducked = true;
      clearTimeout(this.duckTimer);
      this.duckTimer = setTimeout(() => {
        this.ducked = false;
        this.applyGains();
      }, 400);
      this.applyGains();
    }
    if (key === 'matchOver') {
      this.ended = true;
      clearTimeout(this.duckTimer);
      this.stopSource(this.music);
      this.music = null;
      this.applyGains();
    }
    return this.startSource(key, false) !== null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGains();
  }

  /** Scene shutdown owns the context, active sources and duck timeout. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    clearTimeout(this.duckTimer);
    this.applyGains();
    this.stopSource(this.music);
    for (const voice of this.voices) this.stopSource(voice);
    this.voices.clear();
    this.buffers.clear();
    try {
      void this.context?.close().catch(() => {});
    } catch {
      /* Device disappeared. */
    }
  }

  private startSource(key: string, loop: boolean): AudioBufferSourceNode | null {
    try {
      const ctx = this.context;
      const buffer = this.buffers.get(key);
      const bus = loop ? this.musicBus : this.sfxBus;
      if (!this.ready || !ctx || !buffer || !bus) return null;
      // Steal the oldest effect rather than losing a new important cue in a busy tick.
      if (!loop && this.voices.size >= 24) {
        const oldest = this.voices.values().next().value;
        if (oldest) {
          this.stopSource(oldest);
          this.voices.delete(oldest);
        }
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      source.connect(bus);
      source.onended = () => {
        this.voices.delete(source);
        source.disconnect();
      };
      source.start();
      if (!loop) this.voices.add(source);
      return source;
    } catch {
      return null;
    }
  }

  private stopSource(source: AudioBufferSourceNode | null): void {
    try {
      source?.stop();
    } catch {
      /* Already ended or device unavailable. */
    }
  }

  private applyGains(): void {
    try {
      const time = this.context?.currentTime ?? 0;
      this.musicBus?.gain.setValueAtTime(this.musicGain, time);
      this.sfxBus?.gain.setValueAtTime(this.sfxGain, time);
    } catch {
      /* Audio is optional even if a context fails after unlock. */
    }
  }
}
