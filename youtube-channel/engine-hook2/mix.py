import json, subprocess, numpy as np
SR=48000; TL={x['id']:x for x in json.load(open('timing.json'))}; DUR=TL['n3']['end']+1.6; N=int(DUR*SR)
def load(f, rate=1.0):
    af=f'asetrate={int(SR*rate)},aresample={SR}' if rate!=1 else f'aresample={SR}'
    raw=subprocess.run(['ffmpeg','-loglevel','error','-i',f,'-af',af,'-ac','1','-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw,np.float32).astype(np.float64)
def put(buf,x,t,g=1.0):
    i=int(t*SR); x=x[:max(0,len(buf)-i)]; buf[i:i+len(x)]+=x*g
t=np.arange(N)/SR; rnd=np.random.default_rng(7)
voice=np.zeros(N)
for k in ['n0','n1','mom','n2','teacher','n3']: put(voice,load(TL[k]['file']),TL[k]['start'],1.0)
kids=load(TL['kids']['file']); put(voice,kids,TL['kids']['start'],.8)
for r,d,g in [(.9,.035,.55),(1.1,.06,.5),(.82,.09,.4),(1.2,.02,.35)]: put(voice,load(TL['kids']['file'],r),TL['kids']['start']+d,g)
# ---- music: playful pluck, 112 bpm, C-G-Am-F
bpm=112; beat=60/bpm; mus=np.zeros(N)
def pluck(f,L=.35,dec=9):
    tt=np.arange(int(L*SR))/SR; return (np.sin(2*np.pi*f*tt)+.35*np.sin(4*np.pi*f*tt)+.12*np.sin(6*np.pi*f*tt))*np.exp(-dec*tt)*np.minimum(1,tt*400)
chords=[[261.6,329.6,392.0],[196.0,246.9,293.7],[220.0,261.6,329.6],[174.6,220.0,261.6]]
start=.3; nb=int((DUR-start)/beat*2)
for i in range(nb):
    tt=start+i*beat/2; bar=int(i/8)%4; ch=chords[bar]
    put(mus,pluck(ch[[0,1,2,1,0,2,1,2][i%8]]*2,.3,11),tt,.16)
    if i%2==0:
        put(mus,pluck(ch[0]/2,.45,6),tt,.22 if i%4==0 else .12)
    if i%2==1:  # hat
        h=rnd.standard_normal(int(.04*SR))*np.exp(-np.arange(int(.04*SR))/SR*120); h=np.diff(h,prepend=0); put(mus,h,tt,.05)
    if i%4==0:  # soft kick
        kt=np.arange(int(.25*SR))/SR; put(mus,np.sin(2*np.pi*(55+70*np.exp(-kt*30))*kt)*np.exp(-kt*14),tt,.35)
# music louder & busier in cafeteria / title
energy=np.interp(t,[0,TL['kids']['start']-.2,TL['kids']['start'],DUR-1.2,DUR],[.75,.75,1.15,1.15,0])
mus*=energy
# duck under voice
env=np.convolve(np.abs(voice),np.ones(2400)/2400,'same'); duck=1-.45*np.clip(env/0.05,0,1)
mus*=duck
sfx=np.zeros(N)
# phone vibrate (two bursts)
for b in [1.6,2.05]:
    L=int(.32*SR); tt=np.arange(L)/SR; put(sfx,np.sign(np.sin(2*np.pi*150*tt))*.5*np.sin(2*np.pi*150*tt)**2*np.minimum(1,(.32-tt)*30),b,.25)
# coin dings
ding=[TL['n1']['start']+.25,TL['mom']['start']+.15,TL['teacher']['start']+.1]+[TL['kids']['start']+x for x in [0,.55,1.15,1.75,2.35]]
def coin():
    tt=np.arange(int(.6*SR))/SR; a=np.where(tt<.07,np.sin(2*np.pi*1568*tt),0)*np.exp(-tt*25)+np.where(tt>=.07,np.sin(2*np.pi*2093*(tt-.07))+.3*np.sin(2*np.pi*4186*(tt-.07)),0)*np.exp(-np.maximum(tt-.07,0)*7)
    return a*np.minimum(1,tt*2000)
for d in ding: put(sfx,coin(),d,.22)
# rapid tiny ticks while counter climbs at the end
for i,tt in enumerate(np.arange(TL['kids']['start']+2.7,DUR-1.0,.11)): put(sfx,coin()[:int(.12*SR)],tt,.06)
# whooshes on cuts
cuts=[TL['n0']['end']+.2,TL['n1']['start']+2.4,TL['mom']['start']-.1,TL['n2']['start']-.1,TL['teacher']['start']-.15,TL['kids']['start']-.1,TL['n3']['start']+.2]
def whoosh(L=.45):
    n=rnd.standard_normal(int(L*SR)); n=np.convolve(n,np.ones(30)/30,'same'); tt=np.arange(len(n))/len(n); return n*np.sin(np.pi*tt)**2
for c in cuts: put(sfx,whoosh(),c-.2,.18)
# cafeteria crowd murmur
cs,ce=TL['kids']['start']-.1,TL['n3']['start']+.2+1.2
n=rnd.standard_normal(int((ce-cs)*SR)); n=np.convolve(n,np.ones(12)/12,'same')-np.convolve(n,np.ones(90)/90,'same')
tt=np.arange(len(n))/SR; n*=(.6+.4*np.sin(2*np.pi*3.1*tt)*np.sin(2*np.pi*.7*tt))*np.minimum(1,tt*4)*np.minimum(1,(len(n)/SR-tt)*1.5); put(sfx,n,cs,.18)
# morning birds (soft chirps) in bedroom
for b in [.6,1.1,4.0,6.3]:
    L=int(.12*SR); tt=np.arange(L)/SR; put(sfx,np.sin(2*np.pi*(3200+1500*tt/.12)*tt)*np.sin(np.pi*tt/.12),b,.04)
# title riser + impact
ti=TL['n3']['start']+.5; L=int(1.2*SR); tt=np.arange(L)/SR; r=rnd.standard_normal(L); r=np.convolve(r,np.ones(8)/8,'same')*(tt/1.2)**2; put(sfx,r,ti-1.2,.18)
kt=np.arange(int(.9*SR))/SR; put(sfx,np.sin(2*np.pi*(45+60*np.exp(-kt*12))*kt)*np.exp(-kt*4),ti,.6)
mix=voice*1.0+mus+sfx
mix=np.tanh(mix*1.1)/1.1*.9
fade=np.minimum(1,np.minimum(t/.2,(DUR-t)/.5)); mix*=fade
mix.astype(np.float32).tofile('mix.f32')
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','f32le','-ar',str(SR),'-ac','1','-i','mix.f32','-af','loudnorm=I=-14:TP=-1.5:LRA=9','-ar','48000','-ac','2','audio.wav'],check=True)
print('dur',DUR)
