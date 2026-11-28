import json, subprocess, os
S = json.load(open('script.json'))
def dur(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
def silences(f, db=-38, d=.12):
    err = subprocess.run(['ffmpeg','-i',f,'-af',f'silencedetect=noise={db}dB:d={d}','-f','null','-'],capture_output=True,text=True).stderr
    out, st = [], None
    for l in err.splitlines():
        if 'silence_start' in l: st = float(l.split('silence_start:')[1])
        elif 'silence_end' in l and st is not None: out.append((st, float(l.split('silence_end:')[1].split('|')[0]))); st = None
    return out
def weight(p): return len(p.split()) + 1.6*p.count('...') + .6*sum(p.count(x) for x in '.?!') + .3*p.count(',')
TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,aresample=48000'
SPEED = {'NA': 1.05, 'NB': 1.0, 'NC': 1.02, 'JAKE': 1.04}
files = {}
F=json.load(open('final_bounds.json'))
for k,(g,a0,b0) in F.items():
    i=int(k); o=f'lines/L{i:02d}.wav'; af=TRIM+',afade=t=in:d=0.02'+(f',atempo={SPEED[g]}' if g in SPEED else '')+({'PAR':',asetrate=62400,aresample=48000','NEVE':',apad=pad_dur=1.6,aecho=0.8:0.75:420|840|1260:0.45|0.28|0.15'}.get(g,''))
    subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',f'{a0:.3f}','-t',f'{b0-a0:.3f}','-i',f'vo/{g}.wav','-af',af,o],check=True); files[i]=o
for i,x in enumerate(S):
    if x[2].startswith('reuse:'): files[i]='../hook2/vt/'+x[2][6:]+'.wav'
BIG={3: 0.3, 4: 1.0, 7: 0.6, 8: 1.0, 10: 0.6, 18: 0.8, 27: 0.8, 31: 0.8, 39: 1.2, 46: 0.8, 50: 0.6, 56: 0.8, 60: 0.6, 62: 1.0, 67: 0.6, 68: 0.9, 72: 1.2, 81: 1.0, 82: 0.8, 83: 0.4, 84: 0.8, 86: 0.6, 87: 0.8, 89: 1.0, 2: 1.2, 5: 0.8, 6: 1.0, 29: 0.6, 30: 0.6, 37: 0.8, 38: 1.0, 44: 0.6, 51: 1.0, 58: 1.2, 59: 0.8, 61: 0.8, 65: 0.8, 66: 0.8, 70: 0.8, 71: 0.6, 79: 0.6, 80: 1.0, 85: 0.6, 88: 1.2}
t=.5; T=[]
for i,x in enumerate(S):
    t+=BIG.get(x[3],0); d=dur(files[i]); T.append({'id':x[3],'start':round(t,3),'end':round(t+d,3),'who':x[0],'text':x[1],'file':files[i]}); t+=d+(.5 if x[0]!='N' else .64)
json.dump(T,open('timing.json','w'),indent=0); print('voice end',round(t,1))
