import json,base64,urllib.request,time,sys,os
KEY=open('../.gemkey').read().strip()
N='upbeat, curious, fast-paced American YouTube storyteller; playful and warm; crisp delivery'
L=[('n0','Charon',N,"Seven-oh-two a.m. Your phone buzzes."),
   ('n1','Charon',N,"Plus one dollar. Sender: unknown. Memo... your name."),
   ('mom','Sulafat','a mom calling loudly up the stairs, cheerful but impatient',"Nev! Breakfast!"),
   ('n2','Charon',N,"Ding. Another dollar."),
   ('teacher','Iapetus','a bored teacher taking attendance, flat',"Nev?"),
   ('kids','Leda','excited teenagers chanting loudly in a cafeteria',"Nev! Nev! Nev! Nev!"),
   ('n3','Charon',N+'; build excitement, then slow down on the last words',"So what if you earned one dollar... every time someone said your name?")]
for name,voice,style,text in L:
  out=f'vo/{name}.wav'
  if os.path.exists(out): continue
  body={"model":"gemini-3.8-flash-tts","store":False,"input":[{"type":"user_input","content":[{"type":"text","text":text,"annotations":[{"type":"speech_metadata","style":style}]}]}],"response_format":{"type":"audio"},"generation_config":{"speech_config":[{"voice":voice}]}}
  for a in range(8):
    try:
      d=json.load(urllib.request.urlopen(urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions",data=json.dumps(body).encode(),headers={'Content-Type':'application/json','x-goog-api-key':KEY}),timeout=200))
      b=[b for s in d.get('steps',[]) if s.get('type')=='model_output' for b in s.get('content',[]) if b.get('type')=='audio'][-1]
      raw=base64.b64decode(b['data']); open(out,'wb').write(raw); print(name,'ok',b.get('mime_type'),flush=True); break
    except Exception as e:
      print(name,a,str(e)[:60],(e.read()[:150] if hasattr(e,'read') else b''),flush=True); time.sleep(25)
  else: sys.exit('fail '+name)
