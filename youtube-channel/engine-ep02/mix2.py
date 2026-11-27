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
section(.3, ps(6) - .1, 112, C, 'play'); section(ps(6) - .1, ps(30) - .6, 112, C, 'play', 1.1)
section(ps(30) - .6, ps(47) - .8, 84, Am, 'tense'); section(ps(47) - .8, ps(52) - .2, 70, Am, 'warm', .8)
section(ps(52) - .2, ps(59) - .5, 76, W, 'warm', 1.0); section(ps(59) - .5, ps(62) - .2, 70, Am, 'spooky')
section(ps(62) - .2, DUR - .5, 112, C, 'play', .9)
g = np.ones(N)
for x in T: a, b = int((x['start']-.15)*SR), int((x['end']+.2)*SR); g[a:b] = .22
g = np.convolve(g, np.ones(4800)/4800, 'same'); mus *= g
for a in [ps(30)-.6, ps(47)-.8, ps(52)-.2, ps(59)-.5, ps(62)-.2]:
    i = int(a*SR); w = int(.8*SR); mus[max(0,i-w):i] *= np.linspace(1,.3,min(w,i)); mus[i:i+w] *= np.linspace(.3,1,w)[:len(mus[i:i+w])]
mus *= np.clip((DUR - t)/1.5, 0, 1)
mus = mus/np.abs(mus).max()*.2
# ---- SFX
sfx = np.zeros(N); bg = np.zeros(N)
def coin():
    tt = np.arange(int(.6*SR))/SR; return (np.where(tt<.07,np.sin(2*np.pi*1568*tt),0)*np.exp(-tt*25)+np.where(tt>=.07,np.sin(2*np.pi*2093*(tt-.07))+.3*np.sin(2*np.pi*4186*(tt-.07)),0)*np.exp(-np.maximum(tt-.07,0)*7))*np.minimum(1,tt*2000)
COIN = coin()
DINGS = [ps(1)+.25, ps(2)+.15, ps(4)+.1] + [ps(5)+x for x in [0,.55,1.15,1.75,2.35]] + [ps(12)+3.2+j*.8 for j in range(6)] + [ps(14)+2.7+j*.55 for j in range(4)]
for d in DINGS: put(sfx, COIN, d, .2)
def ticks(a, b, step, g=.05):
    for x in np.arange(a, b, step): put(sfx, COIN[:int(.1*SR)], x, g)
ticks(ps(15), pe(15), .2); ticks(ps(20), pe(21), .09, .05); ticks(ps(22), pe(26), .07, .035); ticks(ps(28), pe(39), .25, .025)
# counter drain at "return all": falling blips
for j, x in enumerate(np.arange(ps(52)+.2, ps(52)+3.2, .06)): f = 1800 - j*25; tt = np.arange(int(.05*SR))/SR; put(sfx, np.sin(2*np.pi*f*tt)*np.exp(-tt*80), x, .05)
def buzz(at, L=.32, g=.25):
    tt = np.arange(int(L*SR))/SR; put(sfx, np.sin(2*np.pi*150*tt)**3*np.minimum(1,(L-tt)*30)*np.minimum(1,tt*60), at, g)
for b in [1.6, 2.05]: buzz(b)
for x in np.arange(ps(26)-.1, pe(26), .5): buzz(x, .3, .2)
for x in np.arange(ps(55), ps(55)+.1, 1): pass
def whoosh(L=.45):
    n = rnd.standard_normal(int(L*SR)); n = np.convolve(n, np.ones(30)/30, 'same'); tt = np.arange(len(n))/len(n); return n*np.sin(np.pi*tt)**2
for i in range(1, len(T)): put(bg, whoosh(), T[i]['start'] - .35, .025)
def amb(a, b, kind, g):
    L = int((b-a)*SR); n = rnd.standard_normal(L)
    if kind == 'crowd': n = (np.convolve(n, np.ones(12)/12, 'same') - np.convolve(n, np.ones(90)/90, 'same')); tt = np.arange(L)/SR; n *= (.6+.4*np.sin(2*np.pi*3.1*tt)*np.sin(2*np.pi*.7*tt))
    elif kind == 'room': n = np.convolve(n, np.ones(400)/400, 'same')*6
    elif kind == 'town': n = np.convolve(n, np.ones(200)/200, 'same')*4
    elif kind == 'water': n = np.convolve(n, np.ones(60)/60, 'same')*(.6+.4*np.sin(2*np.pi*.3*np.arange(L)/SR))
    put(bg, n*env(L, .3, .3), a, g*.35)
W_ = lambda i: (ps(i)-.15, (T[P[i]+1]['start']-.15) if P[i]+1 < len(T) else END0)
LOC = {}
for i in [5, 15]: LOC[i] = 'crowd'
for i in [6, 16, 25, 28, 29, 35, 38, 52, 58, 62, 'b1', 'b4', 'b6', 'c2', 'd3']: LOC[i] = 'town'
for i in [17, 30, 31, 32, 33, 40, 42, 43, 'c3', 'c4', 'd4']: LOC[i] = 'crowd_l'
LOC['c1'] = 'town'
for i in [18, 19, 20, 21, 22]: LOC[i] = 'gym'
for i, kind in LOC.items():
    a, b = W_(i)
    if kind == 'crowd': amb(a, b, 'crowd', .16)
    elif kind == 'crowd_l': amb(a, b, 'crowd', .07)
    elif kind == 'gym': amb(a, b, 'crowd', .12 if i in [18, 19] else .3)
    elif kind == 'town': amb(a, b, 'town', .05)
    for x in np.arange(a+.3, b, 1.3):
        if kind == 'town': L = int(.12*SR); tt = np.arange(L)/SR; put(sfx, np.sin(2*np.pi*(3000+1500*tt/.12)*tt)*np.sin(np.pi*tt/.12), x + rnd.random()*.5, .012)
a, b = W_(24); amb(a + 2*(b-a)/3, b, 'water', .08)
for i in [0, 1, 3, 7, 8, 9, 10, 11, 13, 23, 26, 27, 34, 45, 46, 47, 48, 49, 50, 51, 55, 'a1', 'a4', 'a5', 'a6', 'b3', 'd1', 'd2']: a, b = W_(i); amb(a, b, 'room', .015)
# cash register at money pile, car horn at the car, news sting, button press + boom, heartbeat
L = int(.5*SR); tt = np.arange(L)/SR; put(sfx, (np.sin(2*np.pi*2637*tt)+np.sin(2*np.pi*3520*tt))*np.exp(-tt*8)*.5, ps(27)+.4, .25)
L = int(.5*SR); tt = np.arange(L)/SR; put(sfx, np.sign(np.sin(2*np.pi*410*tt))*.3*env(L), ps(28)+.3, .12)
for j, f in enumerate([523, 659, 784, 1046]): L = int(.25*SR); tt = np.arange(L)/SR; put(sfx, np.sin(2*np.pi*f*tt)*np.exp(-tt*6), ps(39)-.1+j*.12, .12)
kt = np.arange(int(1.2*SR))/SR; BOOM = np.sin(2*np.pi*(45+60*np.exp(-kt*12))*kt)*np.exp(-kt*3.5)
put(sfx, np.sin(2*np.pi*2200*np.arange(int(.06*SR))/SR)*np.exp(-np.arange(int(.06*SR))/SR*120), ps(51)+.95, .4); put(sfx, BOOM, ps(51)+.95, .3)
for x in np.arange(ps(49)-.1, pe(50), .85):
    ht = np.arange(int(.2*SR))/SR; hb = np.sin(2*np.pi*50*ht)*np.exp(-ht*18); put(sfx, hb, x, .15); put(sfx, hb, x + .28, .1)
put(sfx, BOOM, ps(6)+.3, .25); put(sfx, BOOM, ps(30)-.1, .15); put(sfx, BOOM, ps(59)+.1, .15)
ri = int(1.2*SR); r = rnd.standard_normal(ri); r = np.convolve(r, np.ones(8)/8, 'same')*(np.arange(ri)/ri)**2; put(sfx, r, ps(6)-.9, .04)
for b in [ps(59)+.9]: buzz(b, .32, .2); buzz(b + .45, .32, .2)
bg *= g
mix = voice + mus*1.0 + sfx + bg
mix = np.tanh(mix*1.1)/1.1*.9; mix *= np.minimum(1, np.minimum(t/.2, (DUR-t)/.5))
mix.astype(np.float32).tofile('mix.f32')
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','f32le','-ar',str(SR),'-ac','1','-i','mix.f32','-af','loudnorm=I=-14:TP=-1.5:LRA=11','-ar','48000','-ac','2','audio.wav'], check=True)
mus.astype(np.float32).tofile('mus.f32'); voice.astype(np.float32).tofile('voice.f32')
rms = lambda x: 20*np.log10(np.sqrt(np.mean(x[x != 0]**2)) + 1e-9)
print('DUR', round(DUR, 2), 'voice dB', round(rms(voice), 1), 'music dB', round(rms(mus), 1))
