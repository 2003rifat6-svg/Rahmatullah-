#!/usr/bin/env python3
"""After video.mp4 is rendered: build narration track + sound design, mux, write SRT + chapters.
Usage: python3 -I finalize.py <episode_dir>"""
import json, subprocess, sys, os
E = sys.argv[1]; os.chdir(E)
T = json.load(open('timing.json'))
DUR = T[-1]['end'] + 1.6
ps = lambda i: T[i]['start']; pe = lambda i: T[i]['end']
def mid(i, k): return ps(i) + (pe(i) - ps(i)) * k

# ---- sound effects (synth) at story beats ----
FX = {
  'ding':  "0.22*sin(2*PI*1320*t)*exp(-t*6)+0.1*sin(2*PI*1980*t)*exp(-t*9)",
  'click': "0.7*sin(2*PI*2200*t)*exp(-t*140)+0.4*sin(2*PI*900*t)*exp(-t*90)",
  'boom':  "0.9*sin(2*PI*(45+35*exp(-t*8))*t)*exp(-t*2.2)",
  'whoosh':"0.18*sin(2*PI*(300+900*t)*t)*exp(-t*3)",
  'tick':  "0.3*sin(2*PI*1800*t)*exp(-t*80)",
  'glitch':"0.15*sin(2*PI*80*t)*sin(2*PI*7*t)",
}
LEN = {'ding': .8, 'click': .1, 'boom': 2.5, 'whoosh': .7, 'tick': .1, 'glitch': 1.5}
events = []
# hook toggle (shot window of p4: approach 0-45%, flip 45-60%)
w4s, w4e = ps(4) - .15, ps(5) - .15
events += [('click', w4s + (w4e - w4s) * .47), ('boom', w4s + (w4e - w4s) * .5)]
events += [('tick', ps(1) + .4)]
for i in [8, 24, 26, 28, 45, 46, 47]: events.append(('ding', ps(i) + .25))
for i in [51, 62]: events.append(('ding', ps(i) + .6))
events += [('whoosh', ps(19) + .5), ('whoosh', ps(21) + .6), ('boom', ps(37) + .3), ('glitch', ps(54)), ('boom', ps(55) + .5), ('boom', ps(65) + .6), ('boom', ps(59) + .4)]
inputs, filt = [], []
inputs += ['-f', 'lavfi', '-i', f"aevalsrc='0.05*sin(2*PI*55*t)+0.035*sin(2*PI*82.4*t)*(0.6+0.4*sin(2*PI*0.2*t))+0.015*sin(2*PI*110.3*t)':s=48000:d={DUR}"]
labels = []
# silence the bed right before the twist and after the last line
filt.append(f"[0]volume='if(between(t,{ps(51)-.6},{ps(51)+.3})+between(t,{pe(65)},{ps(66)}),0.05,1)':eval=frame,afade=t=in:d=2,afade=t=out:st={DUR-2}:d=2,aformat=channel_layouts=stereo[bed]")
labels.append('[bed]')
n = 1
for i, p in enumerate(T):
    inputs += ['-i', p['file']]; ms = int(p['start'] * 1000)
    filt.append(f"[{n}]aresample=48000,volume=1.7,adelay={ms}|{ms},aformat=channel_layouts=stereo[v{i}]"); labels.append(f'[v{i}]'); n += 1
for j, (kind, at) in enumerate(events):
    inputs += ['-f', 'lavfi', '-i', f"aevalsrc='{FX[kind]}':s=48000:d={LEN[kind]}"]; ms = int(at * 1000)
    filt.append(f"[{n}]adelay={ms}|{ms},aformat=channel_layouts=stereo[f{j}]"); labels.append(f'[f{j}]'); n += 1
filt.append(''.join(labels) + f"amix=inputs={len(labels)}:normalize=0,alimiter=limit=0.9[a]")
open('mix_filter.txt', 'w').write(';'.join(filt))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex_script', 'mix_filter.txt', '-map', '[a]', '-t', str(DUR), '-c:a', 'pcm_s16le', 'audio.wav'], check=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', 'video.mp4', '-i', 'audio.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', 'Brevane_01_Hidden_Mode.mp4'], check=True)

# ---- SRT (separate file, not burned in) ----
def ts(x): h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60; return f"{h:02d}:{m:02d}:{int(s):02d},{int((s - int(s)) * 1000):03d}"
srt = []
NUM = [("three thirty-three AM", "3:33 AM"), ("Twelve forty-one PM", "12:41 PM"), ("Twelve forty-one.", "12:41."), ("twelve forty", "12:40"), ("seven AM", "7 AM"),
       ("Ninety-nine percent", "99%"), ("chapter seven", "Chapter 7"), ("Chapter seven", "Chapter 7"), ("four fifteen", "4:15"), ("Forty notifications", "40 notifications"),
       ("Forty little", "40 little"), ("Sixty percent", "60%"), ("One percent", "1%"), ("one percent", "1%"), ("Twenty percent. Ten. Five.", "20%. 10%. 5%."),
       ("Three percent", "3%"), ("Eight fourteen AM", "8:14 AM"), ("eight fourteen", "8:14"), ("twenty miles", "20 miles"), ("It cost you two", "It cost you 2")]
def show(s):
    for a, b in NUM: s = s.replace(a, b)
    return s
for i, p in enumerate(T, 1): srt.append(f"{i}\n{ts(p['start'])} --> {ts(p['end'] + .15)}\n{show(p['text'])}\n")
open('Brevane_01_Hidden_Mode.en.srt', 'w').write('\n'.join(srt))
# ---- chapters (YouTube needs 0:00 first, each >= 10 s) ----
def mmss(x): x = int(x); return f"{x // 60}:{x % 60:02d}"
CH = [(0, 'The setting that only appears at 3:33 AM'), (8, 'A message from 12:41 PM'), (15, 'The cafeteria test'), (23, 'One perfect week'),
      (32, 'The battery'), (43, 'Messages from yourself'), (51, 'Mom'), (57, 'The car keys'), (62, 'The update')]
open('chapters.txt', 'w').write('\n'.join(f"{mmss(0 if i == 0 else ps(i) - .2)} {name}" for i, name in CH))
print(open('chapters.txt').read()); print('duration', DUR)
