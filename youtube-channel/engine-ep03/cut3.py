import json, subprocess, numpy as np
from pocketsphinx import Decoder
from fa_helpers import norm, PR
S=json.load(open('script.json')); B=json.load(open('fa_bounds.json'))
def pcm(f): return np.frombuffer(subprocess.run(['ffmpeg','-loglevel','error','-i',f,'-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout,np.int16).astype(float)
def align_ok(x,text):
    d=Decoder(samprate=16000)
    for k,v in PR.items(): d.add_word(k,v,False)
    d.set_align_text(' '.join(norm(text))); d.start_utt(); d.process_raw(x.astype(np.int16).tobytes(),full_utt=True); d.end_utt()
    return d.hyp() is not None
def refine(x,c,win):
    h=640; a=max(0,int((c-win)*16000)); b=min(len(x)-h,int((c+win)*16000))
    e=[np.sqrt(np.mean(x[i:i+h]**2)) for i in range(a,b,80)]
    return (a+80*int(np.argmin(e))+h/2)/16000
F={}; bad=0
for g,v in B.items():
    x=pcm(f'vo/{g}.wav'); bd=list(v['bounds'])
    for n in range(1,len(bd)-1): bd[n]=round(refine(x,bd[n],.12),3)
    for n,i in enumerate(v['idx']):
        a,b=bd[n],bd[n+1]; ok=align_ok(x[int(a*16000):int(b*16000)],S[i][1])
        eb=np.sqrt(np.mean(x[int(b*16000)-480:int(b*16000)]**2))
        if not ok or eb>300: bad+=1; print(f'{g} L{i} {a:.2f}-{b:.2f} ok={ok} endRMS={eb:.0f} {S[i][1][:50]}')
        F[str(i)]=[g,a,b]
json.dump(F,open('final_bounds.json','w')); print('lines',len(F),'problems',bad)
