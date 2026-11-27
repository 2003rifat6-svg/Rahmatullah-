# Music bed + HUD ticks for Ep1 v3 (playful plucks, ducked under every voice line, kept LOW).
import json, subprocess, numpy as np
SR = 48000; T = json.load(open('timing.json')); D = json.load(open('dialogue.json'))
ps = lambda i: T[i]['start']; pe = lambda i: T[i]['end']; DUR = T[-1]['end'] + 3.2; N = int(DUR * SR)
rnd = np.random.default_rng(3); t = np.arange(N) / SR
def put(b, x, at, g=1.0):
    i = int(at * SR); x = x[:max(0, len(b) - i)]; b[i:i + len(x)] += x * g
def pluck(f, L=.35, dec=9):
    tt = np.arange(int(L * SR)) / SR; return (np.sin(2*np.pi*f*tt) + .35*np.sin(4*np.pi*f*tt) + .12*np.sin(6*np.pi*f*tt)) * np.exp(-dec*tt) * np.minimum(1, tt*400)
def pad(f, L):
    tt = np.arange(int(L * SR)) / SR; env = np.minimum(1, tt / .6) * np.minimum(1, (L - tt) / .6)
    return (np.sin(2*np.pi*f*tt) + .5*np.sin(2*np.pi*f*1.003*tt) + .3*np.sin(4*np.pi*f*tt)) * env
mus = np.zeros(N)
def section(a, b, bpm, chords, mode):
    beat = 60 / bpm; i = 0; tt = a
    while tt < b - .05:
        bar = int(i / 8) % len(chords); ch = chords[bar]
        if mode == 'play':
            put(mus, pluck(ch[[0,1,2,1,0,2,1,2][i % 8]] * 2, .3, 11), tt, .16)
            if i % 2 == 0: put(mus, pluck(ch[0] / 2, .45, 6), tt, .2 if i % 4 == 0 else .1)
            if i % 2 == 1: h = np.diff(rnd.standard_normal(int(.04*SR)) * np.exp(-np.arange(int(.04*SR))/SR*120), prepend=0); put(mus, h, tt, .04)
            if i % 4 == 0: kt = np.arange(int(.25*SR))/SR; put(mus, np.sin(2*np.pi*(55+70*np.exp(-kt*30))*kt)*np.exp(-kt*14), tt, .28)
        elif mode == 'tense':
            if i % 8 == 0:
                for f in ch: put(mus, pad(f, min(8 * beat / 2, b - tt)), tt, .05)
            if i % 2 == 0: put(mus, pluck(ch[0] / 2, .3, 10), tt, .22)
            if i % 4 == 2: put(mus, pluck(ch[2] * 2, .25, 14), tt, .08)
        elif mode == 'warm':
            if i % 8 == 0:
                for f in ch: put(mus, pad(f, min(8 * beat / 2, b - tt)), tt, .05)
            if i % 2 == 0: put(mus, pluck(ch[[0,1,2,1][(i // 2) % 4]] * 2, .6, 5), tt, .1)
        i += 1; tt = a + i * beat / 2
    fade = np.ones(N); ia, ib = int(a * SR), int(b * SR)
    return ia, ib
C = [[261.6,329.6,392.0],[196.0,246.9,293.7],[220.0,261.6,329.6],[174.6,220.0,261.6]]
Am = [[220.0,261.6,329.6],[174.6,220.0,261.6],[146.8,174.6,220.0],[164.8,207.7,246.9]]
section(.4, ps(32) - .3, 100, C, 'play')
section(ps(32) - .3, ps(51) - 1.5, 88, Am, 'tense')
s60 = ps(60) - .15; e60 = ps(61) - .15
section(e60, ps(62) - .2, 72, [[261.6,329.6,392.0],[220.0,261.6,329.6],[174.6,220.0,261.6],[196.0,246.9,293.7]], 'warm')
# duck under every voice line (narration + dialogue)
g = np.ones(N)
for x in T + D:
    a, b = int((x['start'] - .15) * SR), int((x['end'] + .2) * SR); g[a:b] = .5
k = np.ones(4800) / 4800; g = np.convolve(g, k, 'same')
mus *= g
# soft crossfades at section edges
for a in [ps(32) - .3, ps(51) - 1.5, e60, ps(62) - .2]:
    i = int(a * SR); w = int(.8 * SR); mus[max(0, i - w):i] *= np.linspace(1, .3, min(w, i)); mus[i:i + w] *= np.linspace(.3, 1, w)[:len(mus[i:i + w])]
# HUD ticks for every -1% (very quiet)
st = [[ps(6), 100], [ps(20) + .6, 99]]
def ramp(a, b, v0, v1):
    n = v0 - v1
    for i in range(1, n + 1): st.append([a + (b - a) * i / n, v0 - i])
ramp(ps(23), pe(31), 99, 61); ramp(ps(34) - .15, pe(35), 60, 54); ramp(ps(39), pe(40), 54, 40)
tick = np.sin(2*np.pi*1900*np.arange(int(.05*SR))/SR) * np.exp(-np.arange(int(.05*SR))/SR*90)
for tt, v in st[2:]: put(mus, tick, tt, .05)
mus = mus / max(1e-6, np.abs(mus).max()) * .32   # LOW: peaks ~ -10 dBFS before mix, voice sits well above
mus.astype(np.float32).tofile('music.f32')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', 'music.f32', '-ac', '2', 'music.wav'], check=True)
print('music ok', DUR)
