# Brevane editing playbook (Ep2 version, use for Ep3+)

Engine: `engine-ep02/` (three.js in headless Chromium; `window.frame(t)` → JPEG; `render.js` renders 3 parts in parallel; `run.sh` joins them).

## Pipeline
1. `script.json` (lines with speaker/group) → Gemini TTS, one wav per voice group (10 req/day per key, keys never committed).
2. Force-align with pocketsphinx (`fa2.py`) → `final_bounds.json` → `align_fa.py` cuts lines (input-side `-ss/-t`), speeds them up per voice, builds `timing.json`. Gaps: 0.5 s for characters, 0.64 s for the narrator, plus extra pauses before big beats.
3. `ep02.js`: one `S[id] = (t,k) => {...}` shot function per line (k = 0..1 progress). CAPS for bottom captions, LABELS for top-left day/time, money counter ramps tied to the story.
4. `preview2.js` (`FR=.2,.5,.9 node preview2.js ids...`) → pv/*.jpg. Check every shot.
5. `mix2.py`: voice + low ducked music + bg (whoosh/ambience, ducked) + on-time SFX, then loudnorm, then `volume=1.6dB,alimiter=limit=0.84` → about -14 LUFS.
6. `run.sh` (about 75 min) → `video.mp4`; mux with audio → final mp4. Check duration, LUFS, and a 1 fps contact sheet.

## Style checklist
- Hook in the first 10 s: phone notification + counter + clock.
- Counter in the top right always moves with the story; LABELS in the top left (Day / time).
- Shots of 4 s or less; slow push-ins on close-ups; phone close-ups drift.
- Captions only for the key facts (rule/number), bottom center, never over faces.
- A loophole/test section in the first 2 min keeps the rules fun (Ep2: parrot, echo, sleep-talk).
- Twist around 50-55%, emotional drop with music change, cliffhanger in the last line, then a 13 s end card.
- Length 7+ min. No Shorts. No burned-in subtitles (SRT separate).

## Sound checklist
- Music about 23 dB under voice, ducked to 22% under speech.
- Whooshes/ambience very low (bg bus, ducked).
- Clear on-time SFX: dings, coin ticks, phone buzz, footsteps, cash register, horn, button thump+click, news sting.
- Rush moments: accelerating dings + buzz. Button moments: reverse whoosh → thump/click/boom on the press frame.

## QA before delivery
- Every line re-aligned to its own text (no mid-word cuts).
- No blank or clipped frames (camera inside props or characters).
- Duration and LUFS checked; SRT matches timing; chapters updated in UPLOAD.md.
