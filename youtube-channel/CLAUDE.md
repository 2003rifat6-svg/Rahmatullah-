# Instructions for Claude — Nevermode YouTube channel

This folder is the complete plan for the owner's US-targeted animated YouTube channel **Nevermode**.

## Read first
1. `CONVERSATION_SUMMARY.md` — what the owner asked for, decisions made and why, current status and the open task list.
2. `README.md` — index and 90-day plan.

## How to work with the owner
- Reply in **simple Bengali**. The owner does not read English well.
- English only inside copy-paste blocks (titles, descriptions, scripts, prompts), formatted as:
  ▼ কপি করুন
  ```
  <English text>
  ```
  ▲ এখানে
- The owner gave full responsibility: make decisions, don't ask about things with a sensible default. Ask only when the answer truly changes the work.
- Be honest: Claude cannot create the channel or upload videos; give exact click-by-click steps instead.

## Channel rules (do not change without the owner's approval)
- Format, character (Nev), colors, voice (Charon), title formats and script structure are defined in `nevermode-studio-command.txt` and `02-brand-and-character.md`. New episodes must follow them.
- Script length 550–900 words. No real brands, no gore, content OK for 13+.
- Never copy other channels' title formats ("If X ever… DO NOT Y", "What If You Had…").
- Production tools: the owner's app Ruvo (repo `2003rifat6-svg/Rahmatullah-`), CapCut, Canva.

## New episode files
Use `episodes/ep01-phone-hidden-mode.md` as the template: summary table, TTS narration block, shot list (🎥 clips / 🖼️ stills), 3 thumbnails, upload pack, one-line Ruvo studio start.


## Owner rule (2026-11-27)
- **No Shorts.** Do not make or suggest Shorts anymore. Long videos only, every other day at 10 PM BD time.
- Style: pastel 3D + top-right counter + labels + character dialogue voices; background music kept low (~16 dB under voice), master -14 LUFS.

## Production rules from YouTube feedback on Ep1 v3 (apply to every new video)
1. **Title cards never cover a face.** On-screen title or big text goes on an empty area (top third, or over a wide/establishing shot), never over a character close-up.
2. **No static shot longer than ~4 s.** Long narration lines (e.g. reading a message) are split into 2–3 shots: slow push-in, then a reaction cut, then back. Every phone close-up gets slow motion (zoom/drift) at minimum.
3. **End-screen space:** finish every video with a 12–15 s end card (soft music, logo, two empty boxes for "next video" + subscribe) so YouTube End Screen elements fit (they need 5–20 s).
4. Keep what worked: clock/time hook in the first 10 s, top-right counter tied to the story, top-left time labels, music drop + SFX under big reveals, cliffhanger last line.
5. Always upload the English .srt as captions (never burned in).

## Audio mix rule (user feedback after Ep2)
- Voice must always be clearly heard. Music bed ~23 dB under voice (ducked to 22% while anyone speaks).
- Whooshes on cuts, ambient beds (room/town/crowd/water), risers, booms, heartbeats: very low and ducked under voice.
- On-time sync SFX stay audible: notification dings, coin counts, phone buzz, footsteps, cash register, horn, button clicks.

## Voice line cutting rule (user feedback: words were cut mid-word)
- Never split TTS by silence guessing alone. Force-align each group wav with pocketsphinx (offline, pip) to get word timings; cut in the gap between the last word of one line and the first word of the next, refined to the quietest 40 ms point.
- Seek with `-ss <start> -t <dur>` BEFORE `-i` when slicing; output-side -ss/-to after atempo shifts the cut (this caused the Ep2 bug).
- Verify every line file by re-aligning it to its own text; only laughter lines may fail.

## Ep2 YouTube review fixes (2026-11-27), apply to every new video
- **No empty frames, ever.** Before final render, check every shot at 2+ points (`preview2.js` with `FR=.2,.5,.9`). Ep2 bug: the camera was inside a car (the grandma stood on the driveway car's spot) and showed a blank wall for 4 s. Before placing a character in a set, check the set's prop positions (sets2.js) so nothing overlaps.
- After the full render, look at a 1 frame/sec contact sheet of the whole video, not only a 1 per 18 s sheet.
- **Money-rush sections:** notification dings must speed up (gap 0.5 s → 0.13 s, slight pitch variation), plus phone buzz every ~1 s.
- **Big button moments** (e.g. "Return all"): a reverse whoosh that builds into the press, then a heavy low thump + mechanical click + boom, landing on the frame where the finger hits.
- Description: first 2 lines = story hook in plain words (who + what + twist tease). Hashtags: #3DAnimation #AnimatedStory #WhatIf #Storytime #Brevane. Tags: the exact title phrase first.
- The owner makes thumbnails now; only deliver the video, SRT and UPLOAD.md.
- Fixing one shot: re-render only that time range (`node render.js segN.mp4 30 - a b`), cut the old video into pieces one by one (not one big filter, it runs out of memory), and join them with the concat demuxer.
- Full editing playbook: `EDITING_PLAYBOOK.md`.

## Subtitle rule (user feedback: Ep2 SRT had problems)
- Build the SRT with `engine-ep02/make_srt.py timing.json <draft.srt> <out.srt>`: caption standard, at most 2 lines × 42 chars per cue, long lines split into several cues at the real word times (pocketsphinx), line breaks at punctuation, speaker label (JAKE:, MOM:) only on the first cue of a line, cue ends ≤ next line start.
- Never deliver one-line cues longer than 42 chars.

## Ep3 lessons (shot QA)
- Preview every shot at 3 points (`FR=.12,.5,.9 node preview3.js <ids>`, files named by shot id) and look at the contact sheets before the full render. Ep3 needed ~20 camera fixes this way.
- `headCU(char, k, offset)`: the offset must point to where the character's face is looking (the `look` target turns the head). Most "back of head" shots came from this.
- Hide leftover set props that overlap new props (Ep3: the old bedroom clock covered the new alarm clock).
- Never use real time (performance.now) in shot code; every frame must be a pure function of t.
- Frozen-time look: desaturate + cyan soft-light wash, "TIME FROZEN" tag, music ducked 70%, ambience off, faint shimmer.

## Contrast rule (Ep3 user review — MUST apply every episode)
User complaint: "everything is white" — white heads vanished on white/cream walls, chairs, backgrounds.
- Every character gets a dark ink outline (inverted hull, `#2a2342`, ~1.1 cm). Char roots are tagged `userData.char = true` in core.js makeChar and sets2.js makeExtra.
- Contrast pass (`engine-ep03/contrast.js`, inserted before `window.frame`): any set surface with lightness ≥ .7 (or ≥ .58 and low saturation) becomes a mid-tone pastel (L ≈ .55–.6, S ≥ .4; grey/white gets a hue per 30 m set zone). Skip mapped, transparent, emissive, circle, cone and small road-paint planes.
- Set backgrounds (`bg` in lightRig) must be mid-tone, never near-white: school #7cb8a6, gym #8798c8, kitchen #d8a06a, library #c4946a, morning #9f88d6.
- Frozen-time filter: saturate(0.78), not 0.55 (0.55 greyed everything out).
- QA check: in every contact-sheet frame, the white head must clearly separate from what's behind it.

## Story variety (user request after Ep3) — read `STORY_VARIETY.md` before writing ANY new episode
Same cast, but rotate opening type / location / power source / structure / color mood. No bedroom-morning-phone openings for Ep4–Ep6. Avoid YouTube "generic or repetitive content" demonetization.
