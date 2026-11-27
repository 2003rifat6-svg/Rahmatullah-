#!/usr/bin/env python3
"""v2 sound design: location ambiences, foley, alerts, crash+siren, music sections, breathing at 1%.
Then mux with video.mp4, write SRT + chapters. Usage: python3 -I finalize2.py"""
import json, subprocess, os
E = os.path.dirname(os.path.abspath(__file__)); os.chdir(E)
T = json.load(open('timing.json')); DUR = T[-1]['end'] + 3.2
ps = lambda i: T[i]['start']; pe = lambda i: T[i]['end']
def win(i):  # shot window of paragraph i (shots start .15 before the line)
    s = 0 if i == 0 else ps(i) - .15; e = ps(i + 1) - .15 if i + 1 < len(T) else DUR; return s, e

inputs, filt, labels = [], [], []
def add(src, at, dur=None, vol=1.0, fin=0, fout=0, extra=''):
    """src: lavfi source string. Placed at time `at` (s)."""
    n = len(inputs) // 4 if False else None
    inputs.extend(['-f', 'lavfi', '-i', src]); idx = sum(1 for x in inputs if x == '-i') - 1
    f = f"[{idx}]"
    chain = []
    if extra: chain.append(extra)
    if dur: chain.append(f"atrim=0:{dur:.3f}")
    if fin: chain.append(f"afade=t=in:d={fin}")
    if fout and dur: chain.append(f"afade=t=out:st={max(0, dur - fout):.3f}:d={fout}")
    chain += [f"volume={vol}", f"aformat=sample_rates=48000:channel_layouts=stereo", f"adelay={int(at * 1000)}|{int(at * 1000)}"]
    lab = f"[s{idx}]"; filt.append(f + ','.join(chain) + lab); labels.append(lab)
def addfile(path, at, vol):
    inputs.extend(['-i', path]); idx = sum(1 for x in inputs if x == '-i') - 1
    lab = f"[s{idx}]"; filt.append(f"[{idx}]aresample=48000,volume={vol},aformat=channel_layouts=stereo,adelay={int(at * 1000)}|{int(at * 1000)}{lab}"); labels.append(lab)
def ev(expr, d): return f"aevalsrc='{expr}':s=48000:d={d:.3f}"
def noise(color, amp, d): return f"anoisesrc=c={color}:a={amp}:r=48000:d={d:.3f}"

# ---------- locations ----------
LOC = {}
for i in range(len(T)): LOC[i] = 'bed'
for i in list(range(15, 21)) + [22]: LOC[i] = 'caf'
for i in [25]: LOC[i] = 'class'
for i in [30, 32]: LOC[i] = 'hall'
for i in [27]: LOC[i] = 'rain'
for i in [28, 29]: LOC[i] = 'store'
for i in [57, 58, 60, 61]: LOC[i] = 'house'
LOC[59] = 'highway'
AMB = {
  'bed':   (lambda d: noise('brown', .03, d), "lowpass=f=300", 1.0),
  'caf':   (lambda d: noise('pink', .25, d), "highpass=f=250,lowpass=f=2600,tremolo=f=3.3:d=0.5", .55),
  'class': (lambda d: noise('pink', .12, d), "highpass=f=250,lowpass=f=2000,tremolo=f=2.1:d=0.6", .35),
  'hall':  (lambda d: noise('pink', .2, d), "highpass=f=250,lowpass=f=2500,tremolo=f=2.7:d=0.5,aecho=0.6:0.5:60:0.3", .45),
  'rain':  (lambda d: noise('white', .3, d), "highpass=f=900,lowpass=f=7000", .5),
  'store': (lambda d: noise('pink', .05, d), "lowpass=f=1500", .5),
  'house': (lambda d: noise('brown', .03, d), "lowpass=f=350", 1.0),
  'highway': (lambda d: noise('brown', .4, d), "lowpass=f=260", 1.0),
}
# merge consecutive paragraphs with same location into one ambience bed
segs = []; cur = None
for i in range(len(T)):
    s, e = win(i)
    if cur and cur[0] == LOC[i] and abs(cur[2] - s) < .01: cur[2] = e
    else: cur = [LOC[i], s, e]; segs.append(cur)
segs[-1][2] = T[-1]['end'] + .15
for loc, s, e in segs:
    mk, fx, vol = AMB[loc]; add(mk(e - s), s, e - s, vol, .3, .3, fx)
# montage line 49: thirds cafeteria / classroom / rain
s49, e49 = win(49); third = (e49 - s49) / 3
add(noise('pink', .25, third), s49, third, .5, .1, .1, "highpass=f=250,lowpass=f=2600,tremolo=f=3.3:d=0.5")
add(noise('white', .3, third), s49 + 2 * third, third, .5, .1, .1, "highpass=f=900,lowpass=f=7000")

# ---------- foley ----------
def steps(a, b, period, vol=1.0):
    d = b - a; add(ev(f"0.35*sin(2*PI*70*t)*exp(-mod(t,{period})*35)+0.12*sin(2*PI*190*t)*exp(-mod(t,{period})*55)", d), a, d, vol)
steps(*win(15), .72); steps(win(17)[0] + .1, win(17)[0] + 1.3, .45, 1.2); steps(*win(27), .42, .8); steps(*win(30), .46); steps(win(49)[0] + 2 * third, e49, .9, .7)
CLICK = "0.7*sin(2*PI*2200*t)*exp(-t*140)+0.4*sin(2*PI*900*t)*exp(-t*90)"
DING = "0.22*sin(2*PI*1320*t)*exp(-t*6)+0.1*sin(2*PI*1980*t)*exp(-t*9)"
BOOM = "0.9*sin(2*PI*(45+35*exp(-t*8))*t)*exp(-t*2.2)"
BEEP2 = "0.16*(sin(2*PI*880*t)*lt(t,0.12)+sin(2*PI*660*t)*gt(t,0.18)*lt(t,0.30))"
TAP = "0.25*sin(2*PI*1500*t)*exp(-t*160)"
s4, e4 = win(4); add(ev(CLICK, .1), s4 + (e4 - s4) * .47); add(ev(BOOM, 2.5), s4 + (e4 - s4) * .5)
add(ev("0.3*sin(2*PI*1800*t)*exp(-t*80)", .1), ps(1) + .3)                             # clock flip
for i in [8, 24, 26, 28, 45, 46, 47]: add(ev(DING, .8), ps(i) + .25)
for i in [51, 62]: add(ev(DING, .8), ps(i) + .8)
s39, e39 = win(39); add(ev(TAP, .1), s39 + (e39 - s39) * .4)
s40, e40 = win(40); t0 = s40 + .3
while t0 < e40 - .2: add(ev(TAP, .1), t0, vol=.8); t0 += .38
add(ev("0.18*sin(2*PI*(300+900*t)*t)*exp(-t*3)", .7), ps(19) + .5)                     # whoosh: message vanishes
add(ev("0.18*sin(2*PI*(300+900*t)*t)*exp(-t*3)", .7), ps(21) + .6)
s33, e33 = win(33); add(ev(BEEP2, .35), s33 + (e33 - s33) * .45); add(ev(BEEP2, .35), s33 + (e33 - s33) * .45 + .5)
s34, e34 = win(34); e35 = win(35)[1]
for j in range(6): add(ev(BEEP2, .35), s34 + (e35 - s34) * j / 6, vol=.8)
s41, e41 = win(41); e42 = win(42)[1]
for j in range(4): add(ev(BEEP2, .35), s41 + (e42 - s41) * j / 4.3)
add(ev(BOOM, 2.5), ps(37) + .3); add(ev("0.15*sin(2*PI*80*t)*sin(2*PI*7*t)", 1.5), ps(54))   # glitch
add(ev(BOOM, 2.5), ps(55) + .5); add(ev(BOOM, 2.5), pe(65) + .1)
# crash + distant siren on the highway line
c0 = ps(59) + 1.6
add(noise('white', .6, 1.2), c0, 1.2, .5, 0, .9, "lowpass=f=3000"); add(ev(BOOM, 2.5), c0, vol=1.2)
add(ev("0.12*sin(2*PI*1650*t)*exp(-t*2.5)+0.1*sin(2*PI*2380*t)*exp(-t*3)", 1.5), c0 + .05)
sd = pe(59) - c0 - .4; add(ev("0.09*sin(2*PI*820*t+420*sin(2*PI*0.55*t))", sd), c0 + .4, sd, 1.0, 1.0, 1.0)
# breathing at 1% (music muted there)
s60, e60 = win(60)
add(noise('pink', .5, e60 - s60), s60, e60 - s60, .5, .2, .3, "highpass=f=400,lowpass=f=1600,volume='pow(max(0,sin(2*PI*0.42*t)),4)':eval=frame")

# ---------- music sections ----------
def section(expr, a, b, vol=1.0): d = b - a; add(ev(expr, d), a, d, vol, 1.5, 1.5)
CALM = "0.022*(sin(2*PI*110*t)+0.8*sin(2*PI*164.8*t)+0.6*sin(2*PI*220*t)+0.35*sin(2*PI*261.6*t))*(0.7+0.3*sin(2*PI*0.08*t))"
TENSE = "0.022*(sin(2*PI*98*t)+0.8*sin(2*PI*103.8*t)+0.5*sin(2*PI*196*t))*(0.6+0.4*sin(2*PI*0.5*t))+0.035*sin(2*PI*55*t)*exp(-mod(t,0.75)*6)"
HEART = "0.025*sin(2*PI*65*t)+0.09*sin(2*PI*50*t)*exp(-mod(t,0.9)*12)+0.06*sin(2*PI*50*t)*exp(-mod(t+0.68,0.9)*12)"
WARM = "0.022*(sin(2*PI*130.8*t)+0.8*sin(2*PI*164.8*t)+0.7*sin(2*PI*196*t)+0.4*sin(2*PI*261.6*t))*(0.7+0.3*sin(2*PI*0.1*t))"
section(CALM, 0, ps(32) - .3); section(TENSE, ps(32) - .3, ps(51) - 1.5)
section(HEART, ps(51) + .4, s60); section(WARM, e60, ps(62) - .2)
dE = pe(65) + .15 - ps(62); section(f"0.03*sin(2*PI*(70*t+25*t*t/{dE:.2f}))+0.02*sin(2*PI*(140*t+50*t*t/{dE:.2f}))", ps(62) - .2, pe(65) + .15, 1.0)
section("0.02*(sin(2*PI*110*t)+0.6*sin(2*PI*164.8*t))", pe(65) + .9, DUR, .8)

# ---------- narration ----------
for p in T: addfile(p['file'], p['start'], 1.7)

filt.append(''.join(labels) + f"amix=inputs={len(labels)}:normalize=0,alimiter=limit=0.9[a]")
open('mix_filter2.txt', 'w').write(';\n'.join(filt))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex_script', 'mix_filter2.txt', '-map', '[a]', '-t', f'{DUR:.3f}', '-c:a', 'pcm_s16le', 'audio2.wav'], check=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', 'video.mp4', '-i', 'audio2.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', 'Brevane_01_Hidden_Mode_v2.mp4'], check=True)

# ---------- SRT + chapters ----------
def ts(x): h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60; return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)) % 1000:03d}"
NUM = [("three thirty-three AM", "3:33 AM"), ("Twelve forty-one PM", "12:41 PM"), ("Twelve forty-one.", "12:41."), ("twelve forty", "12:40"), ("seven AM", "7 AM"),
       ("Ninety-nine percent", "99%"), ("chapter seven", "Chapter 7"), ("Chapter seven", "Chapter 7"), ("four fifteen", "4:15"), ("Forty notifications", "40 notifications"),
       ("Forty little", "40 little"), ("Sixty percent", "60%"), ("One percent", "1%"), ("one percent", "1%"), ("Twenty percent. Ten. Five.", "20%. 10%. 5%."),
       ("Three percent", "3%"), ("Eight fourteen AM", "8:14 AM"), ("eight fourteen", "8:14"), ("twenty miles", "20 miles"), ("It cost you two", "It cost you 2")]
def show(s):
    for a, b in NUM: s = s.replace(a, b)
    return s
open('Brevane_01_Hidden_Mode_v2.en.srt', 'w').write('\n'.join(f"{i}\n{ts(p['start'])} --> {ts(p['end'] + .15)}\n{show(p['text'])}\n" for i, p in enumerate(T, 1)))
def mmss(x): x = int(x); return f"{x // 60}:{x % 60:02d}"
CH = [(0, 'The setting that only appears at 3:33 AM'), (8, 'A message from 12:41 PM'), (15, 'The cafeteria test'), (23, 'One perfect week'),
      (32, 'The battery'), (43, 'Messages from yourself'), (51, 'Mom'), (57, 'The car keys'), (62, 'The update')]
open('chapters_v2.txt', 'w').write('\n'.join(f"{mmss(0 if i == 0 else ps(i) - .2)} {name}" for i, name in CH))
print(open('chapters_v2.txt').read()); print('duration', round(DUR, 2))
