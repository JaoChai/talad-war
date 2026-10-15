# Talad War original audio — CC0-1.0

All 15 compositions/cues were synthesized specifically for Talad War, using
`synthesize.py` (Python standard-library oscillators, seeded noise, envelopes,
and additive mallets/bass), then encoded with FFmpeg. No external samples,
recordings, AI-generated audio, or voices are used.

To the extent possible under law, the contributors dedicate these original
compositions, sound recordings, and the generator to the public domain under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
Attribution is not required. No third-party sample licence applies.

Source for **every** file below: the original generator
<https://github.com/JaoChai/talad-war/blob/wt/t9b-audio/apps/client/public/audio/synthesize.py>.
Synthesis/encoding reference: <https://ffmpeg.org/ffmpeg-filters.html#loudnorm>.
The MP3 is a codec fallback of the same cue, not an additional sound variation.

| File | Content | Seconds (decoded Ogg) | Licence |
| --- | --- | ---: | --- |
| music.ogg | Original 16-bar, 120 BPM playful market mallet loop | 32.00 | CC0-1.0 |
| music.mp3 | Same music, older-Safari fallback | 32.00 | CC0-1.0 |
| fire.ogg | Bubbly water-gun squirt | 0.20 | CC0-1.0 |
| fire.mp3 | Same fire cue, codec fallback | 0.20 | CC0-1.0 |
| throw.ogg | Rising cartoon bomb toss | 0.32 | CC0-1.0 |
| throw.mp3 | Same throw cue, codec fallback | 0.32 | CC0-1.0 |
| explosion.ogg | Low, soft cartoon boom | 0.95 | CC0-1.0 |
| explosion.mp3 | Same explosion cue, codec fallback | 0.95 | CC0-1.0 |
| hitUnit.ogg | Rubber-like unit impact | 0.18 | CC0-1.0 |
| hitUnit.mp3 | Same unit-hit cue, codec fallback | 0.18 | CC0-1.0 |
| hitStall.ogg | Wooden stall thud | 0.26 | CC0-1.0 |
| hitStall.mp3 | Same stall-hit cue, codec fallback | 0.26 | CC0-1.0 |
| death.ogg | Descending cartoon whistle | 0.65 | CC0-1.0 |
| death.mp3 | Same death cue, codec fallback | 0.65 | CC0-1.0 |
| respawn.ogg | Rising three-note arrival | 0.65 | CC0-1.0 |
| respawn.mp3 | Same respawn cue, codec fallback | 0.65 | CC0-1.0 |
| crateLand.ogg | Soft crate landing clunk | 0.24 | CC0-1.0 |
| crateLand.mp3 | Same landing cue, codec fallback | 0.24 | CC0-1.0 |
| cratePick.ogg | Upward pickup pop | 0.22 | CC0-1.0 |
| cratePick.mp3 | Same pickup cue, codec fallback | 0.22 | CC0-1.0 |
| crateDrop.ogg | Downward drop pop | 0.24 | CC0-1.0 |
| crateDrop.mp3 | Same drop cue, codec fallback | 0.24 | CC0-1.0 |
| openStarted.ogg | Rising opening anticipation | 0.50 | CC0-1.0 |
| openStarted.mp3 | Same opening cue, codec fallback | 0.50 | CC0-1.0 |
| opened.ogg | Four-note item-built ta-da | 0.85 | CC0-1.0 |
| opened.mp3 | Same built cue, codec fallback | 0.85 | CC0-1.0 |
| padFull.ogg | Comical low rejection wobble | 0.28 | CC0-1.0 |
| padFull.mp3 | Same pad-full cue, codec fallback | 0.28 | CC0-1.0 |
| matchOver.ogg | Major arpeggio and victory chord | 1.90 | CC0-1.0 |
| matchOver.mp3 | Same win jingle, codec fallback | 1.90 | CC0-1.0 |

## Reproduce / encoding

From the repository root, with Python 3 and FFmpeg (libvorbis/libmp3lame):

```sh
python3 apps/client/public/audio/synthesize.py apps/client/public/audio
```

The generator uses seed 2309 and 44.1 kHz mono PCM, with >=4 ms attacks and
>=25 ms releases, then `loudnorm=I=-18:TP=-2:LRA=7`, resampled to 44100 Hz.
Ogg uses `-c:a libvorbis -q:a 3`; MP3 uses `-c:a libmp3lame -b:a 64k`.
Re-encoding with another FFmpeg version can produce different bytes.
Measured encoded peaks: -7.8 to -1.8 dBFS across both formats, all below -1 dBFS.
MP3 container durations include encoder padding; the longest SFX is 1.933061 s.

Music is one exact 32-second phrase; note/release tails wrap into the start
before encoding, so the decoded Ogg buffer loops continuously. Ogg is tried
first; MP3 is fetched only after Ogg fetch/decode fails, supporting Safari
before 18.4 (which added Ogg Vorbis). Web Audio decodes to in-memory buffers;
no HTML media-element loop gap is introduced. Native Safari was not available
for hardware audition; the fallback path is covered by injected decode failure.

Runtime music gain is 0.3, ducked to 0.12 for 400 ms after each explosion.
SFX gain is 0.25 after auditioning a dense seeded match; a 24-voice oldest-first
cap and a soft compressor tame overlapping hits. Match over stops the loop
and plays the jingle. The title-screen mute control belongs to Task 10.
