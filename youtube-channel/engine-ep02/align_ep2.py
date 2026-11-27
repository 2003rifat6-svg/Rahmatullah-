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
SPEED = {'NA': 1.06, 'NB': 1.0, 'NC': 1.03, 'JAKE': 1.04, 'NX': 1.04, 'JX': 1.04}
files = {}
for g in ['NA','NB','NC','JAKE','MOM','TEACH','ANCHOR','NEV','NX','JX']:
    idx = [i for i,x in enumerate(S) if x[2]==g]; full=[S[i][1] for i in idx]; wav=f'vo/{g}.wav'; D=dur(wav)
    tail=[x for x in silences(wav) if x[1]>D-.05]
    if tail: D=tail[-1][0]+.08
    if len(idx)==1: bounds=[0,D]
    elif g=='MOM': bounds=[0,5.9,7.43,D]
    else:
        sil=[s for s in silences(wav) if s[0]>.05 and s[1]<D-.05]; cands=[((a+b)/2,b-a) for a,b in sil]
        W=[weight(p) for p in full]; rate=D/sum(W); N,C=len(full),len(cands)
        pos=[0.0]+[c[0] for c in cands]+[D]; slen=[0.0]+[c[1] for c in cands]+[9.0]
        INF=1e18; best=[[INF]*(C+2) for _ in range(N+1)]; back=[[-1]*(C+2) for _ in range(N+1)]; best[0][0]=0
        for i in range(1,N+1):
            for j in range(1,C+2):
                if (i==N)!=(j==C+1): continue
                for k in range(j):
                    if best[i-1][k]>=INF: continue
                    L=pos[j]-pos[k]; e=W[i-1]*rate; v=best[i-1][k]+((L-e)/e)**2*4-min(slen[j],2.0)*(1 if j<=C else 0)
                    if v<best[i][j]: best[i][j]=v; back[i][j]=k
        path=[C+1]
        for i in range(N,0,-1): path.append(back[i][path[-1]])
        path=path[::-1]; bounds=[pos[j] for j in path]
    for n,i in enumerate(idx):
        o=f'lines/L{i:02d}.wav'; af=TRIM+(f',atempo={SPEED[g]}' if g in SPEED else '')
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',wav,'-ss',f'{bounds[n]:.3f}','-to',f'{bounds[n+1]:.3f}','-af',af,o],check=True)
        d=dur(o); w=len(S[i][1].split())/max(d,.1); files[i]=o
        print(f'{i:02d} {g:6} {d:5.2f}s {w:4.2f}w/s {S[i][1][:60]}{"  <-- CHECK" if w<1.2 or w>4.2 else ""}')
for i,x in enumerate(S):
    if x[2].startswith('reuse:'): files[i]='../hook2/vt/'+x[2][6:]+'.wav'
BIG={7:.9,'a1':.6,16:.9,'b1':.6,30:1.2,'c1':.6,40:.7,'d1':.8,47:1.1,59:1.2,62:.8}
t=.5; T=[]
for i,x in enumerate(S):
    t+=BIG.get(x[3],0); d=dur(files[i]); T.append({'id':x[3],'start':round(t,3),'end':round(t+d,3),'who':x[0],'text':x[1],'file':files[i]}); t+=d+(.42 if x[0]!='N' else .52)
json.dump(T,open('timing.json','w'),indent=0); print('voice end',round(t,1))
