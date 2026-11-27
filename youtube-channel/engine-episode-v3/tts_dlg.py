import json,base64,urllib.request,time,sys,os
KEY=open('../.gemkey').read().strip()
L=[('jake','Puck','a goofy teenage best friend, casual, amused; leave a one second pause between the two lines',"Bro... why are you walking like a ninja?\n\nHow did you know it was gonna rain?!"),
   ('teacher','Iapetus','a dry, suspicious high-school teacher, slow',"An A. From you. Hm."),
   ('mom','Sulafat','a busy mom; first line stressed and loud, then after a one second pause the second line soft and loving',"Where are my keys?! I'm gonna be so late!\n\nLove you, kiddo.")]
for name,voice,style,text in L:
  out=f'dlg/{name}.wav'
  if os.path.exists(out): continue
  body={"model":"gemini-3.8-flash-tts","store":False,"input":[{"type":"user_input","content":[{"type":"text","text":text,"annotations":[{"type":"speech_metadata","style":style}]}]}],"response_format":{"type":"audio"},"generation_config":{"speech_config":[{"voice":voice}]}}
  for a in range(6):
    try:
      d=json.load(urllib.request.urlopen(urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions",data=json.dumps(body).encode(),headers={'Content-Type':'application/json','x-goog-api-key':KEY}),timeout=200))
      b=[b for s in d.get('steps',[]) if s.get('type')=='model_output' for b in s.get('content',[]) if b.get('type')=='audio'][-1]
      open(out,'wb').write(base64.b64decode(b['data'])); print(name,'ok',flush=True); break
    except Exception as e:
      m=(e.read()[:160] if hasattr(e,'read') else b''); print(name,a,str(e)[:50],m,flush=True)
      if b'per day' in m or b'PerDay' in m: sys.exit('DAILY_QUOTA')
      time.sleep(25)
  else: sys.exit('FAIL '+name)
