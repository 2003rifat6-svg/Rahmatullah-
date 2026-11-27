import json, subprocess, numpy as np
from pocketsphinx import Decoder
from fa_helpers import norm, PR
S=json.load(open('script.json')); B=json.load(open('fa_bounds.json'))
B['JAKE']={'idx':[i for i,x in enumerate(S) if x[2]=='JAKE'],'bounds':[0,8.4,14.1,17.4,27.5,32.1,39.0,42.2]}
def pcm(f): return np.frombuffer(subprocess.run(['ffmpeg','-loglevel','error','-i',f,'-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout,np.int16).astype(float)
def align_ok(x,text):
    d=Decoder(samprate=16000)
    for k,v in PR.items(): d.add_word(k,v,False)
    w=norm(text); d.set_align_text(' '.join(w)); d.start_utt(); d.process_raw(x.astype(np.int16).tobytes(),full_utt=True); d.end_utt()
    if d.hyp() is None: return None
    sg=[(s.word,s.start_frame/100,(s.end_frame+1)/100) for s in d.seg() if s.word not in('<s>','</s>','<sil>','[NOISE]')]
    return sg
def refine(x,c,win=.3):
    # lowest-energy 40 ms point within ±win of c
    h=640; a=max(0,int((c-win)*16000)); b=min(len(x)-h,int((c+win)*16000))
    e=[np.sqrt(np.mean(x[i:i+h]**2)) for i in range(a,b,80)]
    return (a+80*int(np.argmin(e))+h/2)/16000
final={}
for g,v in B.items():
    x=pcm(f'vo/{g}.wav'); bd=list(v['bounds'])
    for n in range(1,len(bd)-1): bd[n]=round(refine(x,bd[n],.12),3)
    for n,i in enumerate(v['idx']):
        a,b=bd[n],bd[n+1]; seg=x[int(a*16000):int(b*16000)]
        sg=align_ok(seg,S[i][1])
        tag='OK' if sg else 'FAIL'
        # check edges are quiet
        ea=np.sqrt(np.mean(x[int(a*16000):int(a*16000)+480]**2)) if a>0 else 0
        eb=np.sqrt(np.mean(x[int(b*16000)-480:int(b*16000)]**2))
        print(f'{g:6} L{i:02d} {a:6.2f}-{b:6.2f} {tag} edgeRMS {ea:5.0f} {eb:5.0f}  {S[i][1][:50]}')
        final[i]=(g,a,b)
json.dump(final,open('final_bounds.json','w'))
