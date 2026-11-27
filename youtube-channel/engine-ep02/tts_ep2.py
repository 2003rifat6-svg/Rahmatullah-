import json, base64, urllib.request, time, sys, os, subprocess
KEY = open('../.gemkey').read().strip(); S = json.load(open('script.json'))
G = {
 'NA': ('Charon', 'playful, curious, fast-paced American YouTube storyteller; warm, with comedic timing and a smile in the voice on the jokes; leave a clear one-second pause between paragraphs'),
 'NB': ('Charon', 'the mood turns: the storyteller gets quieter, worried and slower, then sad and tender near the end; natural, never robotic; leave a clear one-second pause between paragraphs'),
 'NC': ('Charon', 'emotional and tender at first, building to a warm, hopeful moment, then a playful spooky whisper for the final twist, and a friendly upbeat question at the very end; leave a clear one-second pause between paragraphs'),
 'JAKE': ('Puck', 'a goofy, energetic teenage best friend; he really laughs out loud where he writes hahaha; teasing and silly in the funny lines, shocked and quiet when talking about the empty bank account, awkward when avoiding the name, confused in the last line; leave a clear one-second pause between lines'),
 'MOM': ('Sulafat', 'a warm American mom: first line puzzled and a bit worried, second line a soft surprised whisper, third line loud and cheerful calling from downstairs, then loving; leave a clear one-second pause between lines'),
 'TEACH': ('Iapetus', 'a dry, bored high-school teacher taking attendance, avoiding a name on purpose'),
 'ANCHOR': ('Kore', 'a confident TV news anchor reading breaking news, crisp and serious'),
 'NEV': ('Achird', 'a teenage boy testing a magic trick by saying his own name to his phone: first curious, then louder, then frustrated'),
}
def tts(text, voice, style, out):
    body = {"model": "gemini-3.8-flash-tts", "store": False, "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": style}]}]}],
            "response_format": {"type": "audio"}, "generation_config": {"speech_config": [{"voice": voice}]}}
    for a in range(6):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions", data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY}), timeout=300))
            b = [b for s in d.get('steps', []) if s.get('type') == 'model_output' for b in s.get('content', []) if b.get('type') == 'audio'][-1]
            open(out, 'wb').write(base64.b64decode(b['data'])); return
        except Exception as e:
            m = e.read()[:200] if hasattr(e, 'read') else b''; print(' retry', a, str(e)[:60], m, flush=True)
            if b'per day' in m.lower() or b'perday' in m.lower(): sys.exit('DAILY_QUOTA')
            time.sleep(25)
    sys.exit('FAIL ' + out)
for g, (voice, style) in G.items():
    out = f'vo/{g}.wav'
    if os.path.exists(out): continue
    lines = [x[1] for x in S if x[2] == g]
    print(g, len(lines), 'lines', flush=True); tts('\n\n'.join(lines), voice, style, out); time.sleep(21)
print('ALL_TTS_OK')
