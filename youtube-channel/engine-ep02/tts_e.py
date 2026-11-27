import json,sys
exec(open('tts_ep2.py').read().split('for g, (voice, style) in G.items():')[0])
G2={'NE':('Charon','playful, curious, fast-paced American YouTube storyteller; warm, with comedic timing and a smile in the voice on the jokes; leave a clear one-second pause between paragraphs'),
'JE':('Puck','a goofy, energetic teenage best friend; first line coaxing his pet parrot like a proud dad, second line joking and he really laughs out loud at hahaha; leave a clear one-second pause between lines'),
'PAR':('Leda','a loud, squawky, high-pitched cartoon parrot screeching the word, each one sharp and bird-like'),
'NEVE':('Achird','a teenage boy screaming his own name as loud as he can into an empty gym, long and stretched out')}
for g,(v,st) in G2.items():
    out=f'vo/{g}.wav'
    if os.path.exists(out): continue
    lines=[x[1] for x in S if x[2]==g]; print(g,len(lines),flush=True); tts('\n\n'.join(lines),v,st,out); time.sleep(21)
print('ALL_TTS_OK')
