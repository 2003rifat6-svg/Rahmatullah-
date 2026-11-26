#!/usr/bin/env python3
"""Make the whole narration with Gemini TTS (Charon), in few requests, then split into paragraphs
and write timing.json with real durations. Usage: python3 -I tts.py <episode_dir>"""
import json, base64, subprocess, urllib.request, time, sys, os
E = sys.argv[1]; os.chdir(E)
KEY = open(os.path.join(os.path.dirname(E.rstrip('/')), '.gemkey')).read().strip()
paras = [p['text'] for p in json.load(open('timing.json'))]
STYLE = 'calm, slightly mysterious, intimate American storyteller; natural pacing; slow down before reveals; leave a two second silence between paragraphs'
CHUNK = 10
os.makedirs('vo', exist_ok=True)

def tts(text, out):
    body = {"model": "gemini-3.8-flash-tts", "store": False, "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": STYLE}]}]}],
            "response_format": {"type": "audio"}, "generation_config": {"speech_config": [{"voice": "Charon"}]}}
    for a in range(6):
        try:
            req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions", data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
            d = json.load(urllib.request.urlopen(req, timeout=300))
            b = [b for s in d.get('steps', []) if s.get('type') == 'model_output' for b in s.get('content', []) if b.get('type') == 'audio'][-1]
            open(out, 'wb').write(base64.b64decode(b['data'])); return True
        except Exception as e:
            msg = getattr(e, 'read', lambda: b'')().decode()[:200] if hasattr(e, 'read') else str(e)
            print('retry', a, e, msg, flush=True); time.sleep(30)
    return False

def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))
def silences(f, db=-40, d=.3):
    err = subprocess.run(['ffmpeg', '-i', f, '-af', f'silencedetect=noise={db}dB:d={d}', '-f', 'null', '-'], capture_output=True, text=True).stderr
    out, st = [], None
    for line in err.splitlines():
        if 'silence_start' in line: st = float(line.split('silence_start:')[1])
        elif 'silence_end' in line and st is not None: en = float(line.split('silence_end:')[1].split('|')[0]); out.append((st, en)); st = None
    return out

segs = []
for c0 in range(0, len(paras), CHUNK):
    group = paras[c0:c0 + CHUNK]; f = f'vo/chunk_{c0:02d}.wav'
    if not os.path.exists(f) and not tts('\n\n'.join(group), f): sys.exit('TTS failed at chunk %d' % c0)
    D = dur(f); sil = [s for s in silences(f) if s[0] > .05 and s[1] < D - .05]
    cuts = sorted(sorted(sil, key=lambda s: s[1] - s[0], reverse=True)[:len(group) - 1])
    if len(cuts) < len(group) - 1: sys.exit(f'chunk {c0}: found {len(cuts)} pauses for {len(group)} paragraphs')
    bounds = [0] + [(a + b) / 2 for a, b in cuts] + [D]
    for i, p in enumerate(group):
        o = f'vo/p{c0 + i:02d}.wav'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f, '-ss', str(bounds[i]), '-to', str(bounds[i + 1]), '-af',
                        'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,aresample=48000', o], check=True)
        segs.append((p, o, dur(o)))
        print(f'{c0 + i:02d} {dur(o):5.2f}s  {len(p.split()) / max(dur(o), .1):.2f} w/s  {p[:60]}', flush=True)

# build the real timeline (extra breath before big beats)
BIG = {4: .9, 8: .8, 15: .7, 23: .7, 32: .8, 43: .9, 51: 1.0, 57: .7, 62: .9, 65: .8, 66: 1.6}
t = .6; timing = []
for i, (p, o, d) in enumerate(segs):
    t += BIG.get(i, 0)
    timing.append({"start": round(t, 3), "end": round(t + d, 3), "text": p, "file": o}); t += d + .42
json.dump(timing, open('timing.json', 'w'), indent=0)
print('total', round(t, 1), 's')
