import json, re, subprocess, sys
from pocketsphinx import Decoder
from n2w import num2words
S = json.load(open('script.json'))
d0 = Decoder(samprate=16000)
def norm(t):
    t = t.replace('$', ' dollars ').replace('%',' percent ').replace('#','').replace('&',' and ')
    t = re.sub(r'(\d),(\d)', r'\1\2', t)
    t = re.sub(r'\d+', lambda m: ' '+num2words(int(m.group()))+' ', t)
    t = re.sub(r"[^a-zA-Z' ]", ' ', t.replace('-', ' ')).lower()
    return [w.strip("'") for w in t.split() if w.strip("'")]
oov = set()
for s in S:
    for w in norm(s[1]):
        if d0.lookup_word(w) is None: oov.add(w)

PR={'hahaha':'HH AA HH AA HH AA','kiddo':'K IH D OW','licious':'L IH SH AH S','nev':'N EH V','nevster':'N EH V S T ER','nevvy':'N EH V IY'}
import numpy as np
out={}
for g in sys.argv[1].split(','):
    idx=[i for i,x in enumerate(S) if x[2]==g]
    words=[]; owner=[]
    for n,i in enumerate(idx):
        w=norm(S[i][1]); words+=w; owner+=[n]*len(w)
    raw=subprocess.run(['ffmpeg','-loglevel','error','-i',f'vo/{g}.wav','-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout
    d=Decoder(samprate=16000)
    for k,v in PR.items(): d.add_word(k,v,False)
    d.set_align_text(' '.join(words))
    d.start_utt(); d.process_raw(raw,full_utt=True); d.end_utt()
    if d.hyp() is None: print(g,'ALIGN FAIL'); continue
    segs=[(s.word.split('(')[0],s.start_frame/100,(s.end_frame+1)/100) for s in d.seg() if s.word not in ('<s>','</s>','<sil>','[NOISE]')]
    ok=len(segs)==len(words)
    print(g,'aligned',len(segs),'/',len(words),'OK' if ok else 'MISMATCH',flush=True)
    if not ok: continue
    D=len(raw)/32000
    bounds=[0.0]
    for n in range(1,len(idx)):
        last=max(k for k in range(len(words)) if owner[k]==n-1); first=last+1
        e=segs[last][2]; s=segs[first][1]
        bounds.append(round((e+s)/2 if s>e else e,3))
        print(f'   cut {n}: "{segs[last][0]}" ends {e:.2f} | "{segs[first][0]}" starts {s:.2f}  gap {s-e:.2f}')
    bounds.append(round(segs[-1][2]+.25,3))
    out[g]={'idx':idx,'bounds':bounds}
json.dump(out,open(sys.argv[2],'w'))
