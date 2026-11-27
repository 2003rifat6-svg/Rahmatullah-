#!/usr/bin/env python3
"""Split each narration chunk into its paragraphs with dynamic programming:
cuts must sit in real pauses; each segment length should match the paragraph's word count."""
import json, subprocess, os
E = os.path.dirname(os.path.abspath(__file__)); os.chdir(E)
paras = [p['text'] for p in json.load(open('timing_v1.json'))]
CHUNK, KEEP = 10, 66
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))
def silences(f, db=-38, d=.12):
    err = subprocess.run(['ffmpeg', '-i', f, '-af', f'silencedetect=noise={db}dB:d={d}', '-f', 'null', '-'], capture_output=True, text=True).stderr
    out, st = [], None
    for line in err.splitlines():
        if 'silence_start' in line: st = float(line.split('silence_start:')[1])
        elif 'silence_end' in line and st is not None: out.append((st, float(line.split('silence_end:')[1].split('|')[0]))); st = None
    return out
def weight(p):  # speaking "cost" of a paragraph: words + extra for dramatic pauses/sentences
    return len(p.split()) + 1.6 * p.count('...') + .6 * sum(p.count(x) for x in '.?!') + .3 * p.count(',')

os.makedirs('vo2', exist_ok=True); segs = []
import sys
ONLY = int(sys.argv[1]) if len(sys.argv) > 1 else None
for c0 in range(0, len(paras), CHUNK):
    if ONLY is not None and c0 != ONLY: continue
    full = paras[c0:c0 + CHUNK]; wav = f'vo/chunk_{c0:02d}.wav'; D = dur(wav)
    sil = [s for s in silences(wav) if s[0] > .05 and s[1] < D - .05]
    speech_start = silences(wav, d=.05)[0][1] if silences(wav, d=.05) and silences(wav, d=.05)[0][0] < .05 else 0
    cands = [((a + b) / 2, b - a) for a, b in sil]
    W = [weight(p) for p in full]; rate = (D - speech_start) / sum(W)   # seconds per weight unit (includes pauses)
    N, C = len(full), len(cands)
    pos = [0.0] + [c[0] for c in cands] + [D]; slen = [0.0] + [c[1] for c in cands] + [9.0]
    INF = 1e18; best = [[INF] * (C + 2) for _ in range(N + 1)]; back = [[-1] * (C + 2) for _ in range(N + 1)]
    best[0][0] = 0
    for i in range(1, N + 1):
        for j in range(1, C + 2):
            if i == N and j != C + 1: continue
            if i < N and j == C + 1: continue
            for k in range(j):
                if best[i - 1][k] >= INF: continue
                L = pos[j] - pos[k]; exp = W[i - 1] * rate
                cost = ((L - exp) / exp) ** 2 * 4 - min(slen[j], 2.0) * (1 if j <= C else 0)
                v = best[i - 1][k] + cost
                if v < best[i][j]: best[i][j] = v; back[i][j] = k
    path = [C + 1]
    for i in range(N, 0, -1): path.append(back[i][path[-1]])
    path = path[::-1]; bounds = [pos[j] for j in path]; print('  bounds', [round(b,2) for b in bounds])
    for i, p in enumerate(full):
        if c0 + i >= KEEP: break
        o = f'vo2/p{c0 + i:02d}.wav'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ss', f'{bounds[i]:.3f}', '-to', f'{bounds[i + 1]:.3f}', '-af',
                        'silenceremove=start_periods=1:start_threshold=-52dB,areverse,silenceremove=start_periods=1:start_threshold=-52dB,areverse,aresample=48000', o], check=True)
        d = dur(o); w = len(p.split()) / max(d, .1)
        print(f'{c0 + i:02d} {d:5.2f}s {w:4.2f} w/s  {p[:58]}{"  <-- CHECK" if w < 1.3 or w > 3.8 else ""}', flush=True)
        segs.append((p, o, d))
BIG = {4: .6, 8: .5, 15: .45, 23: .45, 32: .5, 43: .6, 51: .8, 57: .4, 62: .6, 65: .5}
t = .5; timing = []
for i, (p, o, d) in enumerate(segs):
    t += BIG.get(i, 0); timing.append({"start": round(t, 3), "end": round(t + d, 3), "text": p, "file": o}); t += d + .3
json.dump(timing, open('timing.json', 'w'), indent=0)
print('video ~', round(t + 2.5, 1), 's')
