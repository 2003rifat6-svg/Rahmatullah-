#!/bin/bash
# Full pipeline: narration -> parallel render -> concat -> mix -> SRT/chapters
set -e
E="$(cd "$(dirname "$0")" && pwd)"; cd "$E"
python3 -I tts.py "$E"
DUR=$(python3 -c "import json;T=json.load(open('timing.json'));print(T[-1]['end']+1.6)")
A=$(python3 -c "print(round($DUR/3,2))"); B=$(python3 -c "print(round(2*$DUR/3,2))")
node render.js part1.mp4 30 - 0 $A > r1.log 2>&1 &
node render.js part2.mp4 30 - $A $B > r2.log 2>&1 &
node render.js part3.mp4 30 - $B $DUR > r3.log 2>&1 &
wait
printf "file 'part1.mp4'\nfile 'part2.mp4'\nfile 'part3.mp4'\n" > parts.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i parts.txt -c copy video.mp4
python3 -I finalize.py "$E"
echo PIPELINE_DONE
