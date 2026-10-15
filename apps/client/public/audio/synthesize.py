"""Original Talad War synthesis, dedicated CC0-1.0. No samples/voices/AI audio.
Run: python3 synthesize.py <output-directory>. Requires ffmpeg on PATH.
"""
import array
import math
from pathlib import Path
import random
import subprocess
import sys
import wave

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
RATE = 44100
rng = random.Random(2309)

def note(n):
    return 440 * 2 ** ((n - 69) / 12)

def tone(buf, start, duration, midi, amp, style='mallet'):
    count = int(duration * RATE)
    offset = int(start * RATE)
    freq = note(midi)
    for i in range(count):
        t = i / RATE
        env = min(1, t / .004) * min(1, (duration - t) / .025)
        if style == 'bass':
            value = math.sin(2 * math.pi * freq * t) + .2 * math.sin(4 * math.pi * freq * t)
            env *= math.exp(-t * 5)
        else:
            value = math.sin(2 * math.pi * freq * t) + .28 * math.sin(2 * math.pi * freq * 2 * t) + .08 * math.sin(2 * math.pi * freq * 3 * t)
            env *= math.exp(-t * 9)
        buf[(offset + i) % len(buf)] += amp * env * value

def save(key, buf):
    peak = max(abs(v) for v in buf)
    gain = min(.70 / peak, 2)
    pcm = array.array('h', (round(v * gain * 32767) for v in buf))
    wav = OUT / f'{key}.wav'
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    for ext, codec in [('ogg', ['-c:a', 'libvorbis', '-q:a', '3']), ('mp3', ['-c:a', 'libmp3lame', '-b:a', '64k'])]:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), '-af', 'loudnorm=I=-18:TP=-2:LRA=7', '-ar', str(RATE), *codec, str(OUT / f'{key}.{ext}')], check=True)
    wav.unlink()

# Sixteen 4/4 bars at 120 BPM, mallet melody, offbeat chords, pizzicato bass.
music = [0.0] * (32 * RATE)
progression = [(48, [72, 76, 79, 81]), (53, [72, 77, 81, 79]), (55, [74, 79, 83, 81]), (48, [76, 79, 84, 79]), (45, [72, 76, 81, 79]), (53, [77, 81, 84, 81]), (55, [74, 79, 83, 86]), (48, [76, 74, 72, 79])]
for bar in range(16):
    root, melody = progression[bar % 8]
    start = bar * 2
    for beat in range(4):
        tone(music, start + beat * .5, .4, root + (7 if beat % 2 else 0), .18, 'bass')
        for n in [root + 12, root + 16, root + 19]:
            tone(music, start + beat * .5 + .25, .18, n, .045)
        tone(music, start + beat * .5, .34, melody[beat], .17)
        if (bar + beat) % 3 == 0:
            tone(music, start + beat * .5 + .25, .18, melody[beat] + (2 if bar % 2 else -2), .09)
    # A gentle shaker plus wooden tick, no cymbal/high-frequency spikes.
    for subdivision in range(8):
        offset = int((start + subdivision * .25) * RATE)
        lp = 0
        for i in range(int(.065 * RATE)):
            lp = .7 * lp + .3 * rng.uniform(-1, 1)
            music[(offset + i) % len(music)] += .07 * lp * math.exp(-i / RATE * 65) * min(1, i / 100)
save('music', music)

settings = {
    'fire': (.20, 900, 230, .12), 'throw': (.32, 260, 780, .03),
    'explosion': (.95, 110, 38, .6), 'hitUnit': (.18, 380, 130, .08),
    'hitStall': (.26, 160, 65, .2), 'death': (.65, 420, 90, .02),
    'respawn': (.65, 300, 900, .01), 'crateLand': (.24, 180, 65, .22),
    'cratePick': (.22, 420, 780, .01), 'crateDrop': (.24, 330, 150, .08),
    'openStarted': (.50, 380, 620, .02), 'opened': (.85, 500, 700, .01),
    'padFull': (.28, 230, 160, .02), 'matchOver': (1.9, 500, 700, .01),
}
for key, (duration, f0, f1, noise) in settings.items():
    buf = [0.0] * int(duration * RATE)
    phase = 0
    lp = 0
    for i in range(len(buf)):
        t = i / RATE
        p = t / duration
        freq = f0 + (f1 - f0) * p
        phase += 2 * math.pi * freq / RATE
        lp = .85 * lp + .15 * rng.uniform(-1, 1)
        env = min(1, t / .005) * min(1, (duration - t) / .03) * math.exp(-p * 4)
        wobble = 1 + .2 * math.sin(2 * math.pi * 18 * t)
        buf[i] = env * (.4 * math.sin(phase) * wobble + noise * lp)
    if key in ('opened', 'matchOver', 'respawn'):
        buf = [0.0] * len(buf)
        notes = [72, 76, 79, 84] if key != 'respawn' else [67, 72, 79]
        spacing = .16 if key != 'matchOver' else .32
        for k, n in enumerate(notes):
            tone(buf, k * spacing, min(.5, duration - k * spacing), n, .4)
        if key == 'matchOver':
            for n in [72, 76, 79, 84]:
                tone(buf, 1.25, .6, n, .15)
    save(key, buf)
print(f'Generated 15 original cues x Ogg/MP3 in {OUT}')
