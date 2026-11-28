import json, subprocess, numpy as np
SR = 48000; T = json.load(open('timing.json')); P = {x['id']: i for i, x in enumerate(T)}; ps = lambda i: T[P[i]]['start']; pe = lambda i: T[P[i]]['end']
END0 = T[-1]['end'] + .7; DUR = END0 + 13; N = int(DUR * SR); t = np.arange(N) / SR; rnd = np.random.default_rng(9)
def load(f, rate=1.0):
    af = f'asetrate={int(SR*rate)},aresample={SR}' if rate != 1 else f'aresample={SR}'
    return np.frombuffer(subprocess.run(['ffmpeg','-loglevel','error','-i',f,'-af',af,'-ac','1','-f','f32le','-'],capture_output=True).stdout, np.float32).astype(np.float64)
def put(b, x, at, g=1.0):
    i = int(at * SR)
    if i >= len(b) or i < 0: return
    x = x[:len(b) - i]; b[i:i + len(x)] += x * g
env = lambda L, a=.005, r=.05: np.minimum(1, np.minimum(np.arange(L) / (a * SR + 1), (L - np.arange(L)) / (r * SR + 1)))
# ---- voices
voice = np.zeros(N)
for i, x in enumerate(T):
    a = load(x['file']); put(voice, a, x['start'], .8 if x['who'] == 'KIDS' else 1.0)
    if x['who'] == 'KIDS':
        for r, d, g in [(.9, .035, .5), (1.1, .06, .45), (.82, .09, .4), (1.2, .02, .35), (.95, .12, .35)]: put(voice, load(x['file'], r), x['start'] + d, g)
# ---- music bed (low, ducked)
mus = np.zeros(N)
def pluck(f, L=.35, dec=9):
    tt = np.arange(int(L*SR))/SR; return (np.sin(2*np.pi*f*tt)+.35*np.sin(4*np.pi*f*tt)+.12*np.sin(6*np.pi*f*tt))*np.exp(-dec*tt)*np.minimum(1,tt*400)
def pad(f, L):
    tt = np.arange(int(L*SR))/SR; e = np.minimum(1, tt/.6)*np.minimum(1, (L-tt)/.6); return (np.sin(2*np.pi*f*tt)+.5*np.sin(2*np.pi*f*1.003*tt)+.3*np.sin(4*np.pi*f*tt))*e
C = [[261.6,329.6,392.0],[196.0,246.9,293.7],[220.0,261.6,329.6],[174.6,220.0,261.6]]
Am = [[220.0,261.6,329.6],[174.6,220.0,261.6],[146.8,174.6,220.0],[164.8,207.7,246.9]]
W = [[261.6,329.6,392.0],[220.0,261.6,329.6],[174.6,220.0,261.6],[196.0,246.9,293.7]]
def section(a, b, bpm, ch, mode, g=1.0):
    beat = 60/bpm; i = 0; tt = a
    while tt < b - .05:
        c = ch[int(i/8) % len(ch)]
        if mode == 'play':
            put(mus, pluck(c[[0,1,2,1,0,2,1,2][i%8]]*2, .3, 11), tt, .16*g)
            if i % 2 == 0: put(mus, pluck(c[0]/2, .45, 6), tt, (.2 if i % 4 == 0 else .1)*g)
            if i % 2 == 1: h = np.diff(rnd.standard_normal(int(.04*SR))*np.exp(-np.arange(int(.04*SR))/SR*120), prepend=0); put(mus, h, tt, .04*g)
            if i % 4 == 0: kt = np.arange(int(.25*SR))/SR; put(mus, np.sin(2*np.pi*(55+70*np.exp(-kt*30))*kt)*np.exp(-kt*14), tt, .28*g)
        elif mode == 'tense':
            if i % 8 == 0:
                for f in c: put(mus, pad(f, min(4*beat, b-tt)), tt, .05*g)
            if i % 2 == 0: put(mus, pluck(c[0]/2, .3, 10), tt, .22*g)
            if i % 4 == 2: put(mus, pluck(c[2]*2, .25, 14), tt, .08*g)
        elif mode == 'warm':
            if i % 8 == 0:
                for f in c: put(mus, pad(f, min(4*beat, b-tt)), tt, .05*g)
            if i % 2 == 0: put(mus, pluck(c[[0,1,2,1][(i//2)%4]]*2, .6, 5), tt, .1*g)
        elif mode == 'spooky':
            if i % 8 == 0: put(mus, pad(c[0]*.5, min(4*beat, b-tt)), tt, .07*g); put(mus, pad(c[1]*1.06, min(4*beat, b-tt)), tt, .03*g)
            if i % 4 == 0: put(mus, pluck(c[2]*4, .5, 6), tt, .05*g)
        i += 1; tt = a + i*beat/2

# ---- Ep3 music: playful -> tense twist -> lonely -> warm -> spooky ending
section(.3, ps(7) - .2, 112, C, 'play', .8); section(ps(7) - .2, ps(39) - .6, 112, C, 'play', 1.0)
section(ps(39) - .6, ps(56) - .5, 84, Am, 'tense'); section(ps(56) - .5, ps(62) - .3, 66, Am, 'warm', .7)
section(ps(62) - .3, ps(72) - .4, 84, Am, 'tense', .8); section(ps(72) - .4, ps(81) - .5, 92, W, 'warm', 1.0)
section(ps(81) - .5, ps(85) + .4, 70, Am, 'spooky'); section(ps(85) + .4, DUR - .5, 66, Am, 'spooky', 1.2)
FROZEN = [(pe(3)-.08, ps(8)+.5), (ps(11), pe(11)), (ps(13), pe(17)), (ps(19), pe(19)), (ps(21), pe(23)), (ps(24), pe(24)), (ps(27), pe(30)), (ps(31), pe(33)), (ps(37), ps(37)+1.4), (ps(50), pe(51)), (ps(56), pe(61)), (ps(85)+.4, END0)]
fz = np.zeros(N)
for a, b in FROZEN: fz[int((a-.1)*SR):int((b+.1)*SR)] = 1
fz = np.convolve(fz, np.ones(4800)/4800, 'same')
g = np.ones(N)
for x in T: a, b = int((x['start']-.15)*SR), int((x['end']+.2)*SR); g[a:b] = .22
g = np.convolve(g, np.ones(4800)/4800, 'same'); mus *= g * (1 - .7*fz)
for a in [ps(39)-.6, ps(56)-.5, ps(62)-.3, ps(72)-.4, ps(81)-.5]:
    i = int(a*SR); w = int(.8*SR); mus[max(0,i-w):i] *= np.linspace(1,.3,min(w,i)); mus[i:i+w] *= np.linspace(.3,1,w)[:len(mus[i:i+w])]
mus *= np.clip((DUR - t)/1.5, 0, 1)
mus = mus/np.abs(mus).max()*.2
sfx = np.zeros(N); bg = np.zeros(N)
def tone(f, L, dec=6): tt = np.arange(int(L*SR))/SR; return np.sin(2*np.pi*f*tt)*np.exp(-tt*dec)
def whoosh(L=.45):
    n = rnd.standard_normal(int(L*SR)); n = np.convolve(n, np.ones(30)/30, 'same'); tt = np.arange(len(n))/len(n); return n*np.sin(np.pi*tt)**2
kt = np.arange(int(1.2*SR))/SR; BOOM = np.sin(2*np.pi*(45+60*np.exp(-kt*12))*kt)*np.exp(-kt*3.5)
for i in range(1, len(T)): put(bg, whoosh(), T[i]['start'] - .35, .02)
# frozen-world shimmer (very low) + freeze/unfreeze hits
sh = np.zeros(N); tt = t; sh = (np.sin(2*np.pi*1318*tt)+.6*np.sin(2*np.pi*1760*tt*1.001))*(.5+.5*np.sin(2*np.pi*.4*tt)); bg += sh*fz*.006
for a, b in FROZEN:
    rw = whoosh(.6)[::-1]*np.linspace(0,1,int(.6*SR))**2; put(sfx, rw, a-.6, .06); put(sfx, BOOM, a, .18); put(sfx, tone(2637, .8, 5), a, .03)
    if b < END0 - 1: put(sfx, whoosh(.35), b-.05, .05)
SNAP = ps(8)+.5; put(sfx, BOOM, SNAP, .3); put(sfx, rnd.standard_normal(int(.05*SR))*np.exp(-np.arange(int(.05*SR))/SR*90), SNAP, .25)
# juice splash
sp = rnd.standard_normal(int(.5*SR))*np.exp(-np.arange(int(.5*SR))/SR*9); sp = np.convolve(sp, np.ones(6)/6, 'same'); put(sfx, sp, SNAP+.55, .12)
# alarm beeps (ringing windows)
def beeps(a, b, g=.07):
    x = a
    while x < b:
        for j in range(4): put(sfx, tone(2093, .07, 3)*np.minimum(1, np.arange(int(.07*SR))/120), x + j*.12, g)
        x += .9
beeps(.4, ps(1)+.75); beeps(ps(63)-.15, ps(67)-.15+.35*(pe(67)-ps(67)), .05); beeps(ps(83)-.15, ps(85)+.4, .06)
# snooze presses: plastic click + soft thump
SNOOZES = [ps(1)+.75, ps(12)+.9, ps(12)+1.9, ps(12)+2.9, ps(85)+.4]
for x in SNOOZES:
    c = rnd.standard_normal(int(.03*SR))*np.exp(-np.arange(int(.03*SR))/SR*200); put(sfx, c, x, .25); put(sfx, tone(140, .15, 25), x, .3)
# plug pull, wall clock ticks, cheering crowd, bounce, window click, sparkle at zero
put(sfx, rnd.standard_normal(int(.06*SR))*np.exp(-np.arange(int(.06*SR))/SR*80), ps(67)-.15+.35*(pe(67)+.6-ps(67)), .3)
for x in np.arange(ps(70), pe(71), 1.0): put(sfx, rnd.standard_normal(int(.015*SR))*np.exp(-np.arange(int(.015*SR))/SR*300), x, .1)
for x in np.arange(ps(36), pe(36), .33): put(sfx, tone(90, .12, 30), x, .25)
for j, f in enumerate([523, 659, 784, 1046]): put(sfx, tone(f, .3, 6), ps(80)+.9+j*.1, .08)
put(sfx, rnd.standard_normal(int(.02*SR))*np.exp(-np.arange(int(.02*SR))/SR*250), ps(88)-.15+.45*(pe(88)+.5-ps(88)), .15)
put(sfx, BOOM, ps(47)+.4, .2); put(sfx, BOOM, ps(85)+.4, .3); put(sfx, BOOM, ps(7)+.3, .2)
def amb(a, b, kind, gg):
    L = int((b-a)*SR); n = rnd.standard_normal(L)
    if kind == 'crowd': n = (np.convolve(n, np.ones(12)/12, 'same') - np.convolve(n, np.ones(90)/90, 'same')); tq = np.arange(L)/SR; n *= (.6+.4*np.sin(2*np.pi*3.1*tq)*np.sin(2*np.pi*.7*tq))
    elif kind == 'room': n = np.convolve(n, np.ones(400)/400, 'same')*6
    elif kind == 'town': n = np.convolve(n, np.ones(200)/200, 'same')*4
    put(bg, n*env(L, .3, .3), a, gg*.35)
W_ = lambda i: (ps(i)-.15, (T[P[i]+1]['start']-.15) if P[i]+1 < len(T) else END0)
for i in [9, 20, 35, 39, 40, 41, 42, 45, 53, 54, 69, 71, 72, 73, 74, 75, 76]: a, b = W_(i); amb(a, b, 'crowd' if i in [35,41,42,45,53,54,72,73,74,75,76] else 'room', .05 if i in [35,41,42,45,53,54,72,73,74,75,76] else .015)
a, b = W_(36); amb(a, b, 'crowd', .2); a = ps(37)+1.4; b = W_(37)[1]; amb(a, b, 'crowd', .45)
for x in np.arange(ps(37)+1.4, W_(37)[1], .9): put(sfx, tone(1200, .1, 20), x, .02)
bg *= g * (1 - .85*fz)
mix = voice + mus + sfx + bg
mix = np.tanh(mix*1.1)/1.1*.9; mix *= np.minimum(1, np.minimum(t/.2, (DUR-t)/.5))
mix.astype(np.float32).tofile('mix.f32')
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','f32le','-ar',str(SR),'-ac','1','-i','mix.f32','-af','loudnorm=I=-14:TP=-1.5:LRA=11','-ar','48000','-ac','2','audio.wav'], check=True)
rms = lambda x: 20*np.log10(np.sqrt(np.mean(x[x != 0]**2)) + 1e-9)
print('DUR', round(DUR, 2), 'voice dB', round(rms(voice), 1), 'music dB', round(rms(mus), 1))
