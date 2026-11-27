#!/bin/bash
set -e
cd "$(dirname "$0")"
S1=$(python3 -c "import json;print(json.dumps(json.load(open('shorts.json'))['s1']))")
S2=$(python3 -c "import json;print(json.dumps(json.load(open('shorts.json'))['s2']))")
node render_short.js short1_v.mp4 "$S1" "NEVER TURN THIS ON" > sh1.log 2>&1 &
node render_short.js short2_v.mp4 "$S2" "A TEXT FROM THE FUTURE" > sh2.log 2>&1 &
wait
python3 -I - <<'PY'
import json, subprocess
R = json.load(open('shorts.json'))
for name, ranges in R.items():
    parts = []
    for i, (a, b) in enumerate(ranges):
        o = f'{name}_a{i}.wav'; subprocess.run(['ffmpeg','-y','-loglevel','error','-i','audio3.wav','-ss',str(a),'-to',str(b),'-af','afade=t=in:d=0.05,afade=t=out:st=%f:d=0.08' % (b-a-0.08),o],check=True); parts.append(o)
    # end card: soft ding + silence 2.5s
    subprocess.run(['ffmpeg','-y','-loglevel','error','-f','lavfi','-i',"aevalsrc='0.22*sin(2*PI*1320*t)*exp(-t*6)+0.1*sin(2*PI*1980*t)*exp(-t*9)':s=48000:d=2.5",'-ac','2',f'{name}_end.wav'],check=True); parts.append(f'{name}_end.wav')
    open(f'{name}_list.txt','w').write(''.join(f"file '{p}'\n" for p in parts))
    subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',f'{name}_list.txt','-ar','48000','-ac','2',f'{name}_audio.wav'],check=True)
    n = {'s1': 'short1', 's2': 'short2'}[name]
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',f'{n}_v.mp4','-i',f'{name}_audio.wav','-c:v','copy','-c:a','aac','-b:a','192k','-shortest',f'Brevane_01_Short{n[-1]}.mp4'],check=True)
    print('made', f'Brevane_01_Short{n[-1]}.mp4')
PY
echo SHORTS_DONE
