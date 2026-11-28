import json, base64, urllib.request, time, sys, os, subprocess
KEY = open(os.environ.get('GK','../.gemkey')).read().strip(); S = json.load(open('script.json'))
G = {
 'TEACH': ('Iapetus', 'a dry, tired high-school teacher: first line honestly surprised and suspicious, second line flat and strict; leave a clear one-second pause between lines'),
 'MOM': ('Sulafat', 'a warm American mom: first line loud and cheerful calling up the stairs, cut off suddenly mid-word; second line confused; third line gentle and a little worried; last line touched, almost crying, loving; leave a clear one-second pause between lines'),
 'NEV': ('Achird', 'a teenage boy: first line proud but bad Spanish, a little awkward and funny; second line quiet, lonely and scared, almost a whisper; leave a clear one-second pause between lines'),
 'JAKE': ('Puck', 'a goofy, energetic teenage best friend; he really laughs out loud where he writes hahaha; amazed and hyper in the frozen-time lines, teasing about the mustache, a little hurt when the joke gets no laugh, then sincere when asking for the promise; leave a clear one-second pause between lines'),
 'NA': ('Charon', 'playful, curious, fast-paced American YouTube storyteller; warm, with comedic timing and a smile in the voice on the jokes, a hushed amazed tone when time freezes; leave a clear one-second pause between paragraphs'),
 'NB': ('Charon', 'the mood turns: the storyteller gets quieter, worried and slower, then lonely and sad, then a small hopeful lift at the end; natural, never robotic; leave a clear one-second pause between paragraphs'),
 'NC': ('Charon', 'warm and relieved, gentle and happy, then a playful spooky whisper for the three thirty-three twist, and a friendly upbeat question at the very end; leave a clear one-second pause between paragraphs'),
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
