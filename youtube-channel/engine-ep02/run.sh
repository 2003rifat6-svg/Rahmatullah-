#!/bin/bash
set -e
cd "$(dirname "$0")"
DUR=$(python3 -c "import json;T=json.load(open('timing.json'));print(T[-1]['end']+.7+13)")
A=$(python3 -c "print(round($DUR/3,2))"); B=$(python3 -c "print(round(2*$DUR/3,2))")
node render.js p1.mp4 30 - 0 $A > r1.log 2>&1 &
node render.js p2.mp4 30 - $A $B > r2.log 2>&1 &
node render.js p3.mp4 30 - $B $DUR > r3.log 2>&1 &
wait
printf "file 'p1.mp4'\nfile 'p2.mp4'\nfile 'p3.mp4'\n" > parts.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i parts.txt -c copy video.mp4
echo RENDER_DONE
