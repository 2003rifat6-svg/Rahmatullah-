# Caption-standard SRT: <=2 lines x 42 chars, cues split at real word times (pocketsphinx on each line file)
import json, re, sys, subprocess, numpy as np
from pocketsphinx import Decoder
from fa_helpers import norm, PR
T = json.load(open(sys.argv[1])); OLD = sys.argv[2]; OUT = sys.argv[3]; MAXC = 42
def pcm(f): return np.frombuffer(subprocess.run(['ffmpeg','-loglevel','error','-i',f,'-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout,np.int16)
def words(f, text):
    d = Decoder(samprate=16000)
    for k, v in PR.items(): d.add_word(k, v, False)
    d.set_align_text(' '.join(norm(text))); d.start_utt(); d.process_raw(pcm(f).tobytes(), full_utt=True); d.end_utt()
    if d.hyp() is None: return None
    return [(s.start_frame/100, (s.end_frame+1)/100) for s in d.seg() if s.word not in ('<s>','</s>','<sil>','[NOISE]','(NULL)')]
blocks = open(OLD, encoding='utf-8-sig').read().strip().split('\n\n')
disp = [' '.join(b.split('\n')[2:]) for b in blocks]
def wrap(t):
    if len(t) <= MAXC: return t
    sp = [i for i in (m.start() for m in re.finditer(' ', t)) if i <= MAXC and len(t)-i-1 <= MAXC] or [m.start() for m in re.finditer(' ', t)]
    best = min(sp, key=lambda i: max(i, len(t)-i-1) - (8 if t[i-1] in '.,?!:' else 0))
    return t[:best] + '\n' + t[best+1:]
def chunks(t, label):
    lim = 2*MAXC - len(label)
    fits = lambda u, lb='': len(lb+u) <= 2*MAXC and max(len(l) for l in wrap(lb+u).split('\n')) <= MAXC
    if fits(t, label): return [t]
    parts = re.findall(r'.+?(?:\.\.\.|[.?!])(?=\s|$)|.+$', t)
    parts = [p.strip() for p in parts if p.strip()]
    out = []
    for p in parts:
        while not fits(p, label if not out else ''):  # split long sentence at comma/ellipsis/space near middle
            cand = [m.end() for m in re.finditer(r'(,|\.\.\.)\s', p)] or [m.start() for m in re.finditer(' ', p)]
            c = min(cand, key=lambda i: abs(i - len(p)/2)); out.append(p[:c].strip()); p = p[c:].strip()
        if out and fits(out[-1] + ' ' + p, label if len(out) == 1 else '') and len(out[-1]) < 30: out[-1] += ' ' + p
        else: out.append(p)
    return out
cues = []; fails = 0
for i, x in enumerate(T):
    t = disp[i]; m = re.match(r'^([A-Z .]+): ', t); label = m.group(0) if m else ''; body = t[len(label):]
    ch = chunks(body, label); w = words(x['file'], x['text']) if len(ch) > 1 else None
    s0, e0 = x['start'], x['end']; nxt = T[i+1]['start'] if i+1 < len(T) else e0 + 2
    if len(ch) > 1 and not w: fails += 1
    # boundary times
    tot = sum(len(norm(c)) or 1 for c in ch); acc = 0; bounds = [s0]
    for c in ch[:-1]:
        acc += len(norm(c)) or 1
        if w:
            k = min(len(w)-1, max(1, round(acc / tot * len(w)))); bounds.append(s0 + (w[k-1][1] + w[k][0]) / 2)
        else: bounds.append(s0 + (e0 - s0) * acc / tot)
    bounds.append(min(e0 + .35, nxt - .05))
    for n, c in enumerate(ch): cues.append((bounds[n], bounds[n+1], wrap((label if n == 0 else '') + c)))
def ts(v): v = max(0, v); return f'{int(v//3600):02d}:{int(v%3600//60):02d}:{int(v%60):02d},{int(round(v%1*1000))%1000:03d}'
open(OUT, 'w').write('\n'.join(f'{n+1}\n{ts(a)} --> {ts(b)}\n{t}\n' for n, (a, b, t) in enumerate(cues)))
print(len(T), 'lines ->', len(cues), 'cues; align fails', fails, '; max line', max(len(l) for c in cues for l in c[2].split('\n')))
