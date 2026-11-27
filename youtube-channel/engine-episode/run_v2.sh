#!/bin/bash
set -e
cd "$(dirname "$0")"
DUR=$(python3 -c "import json;T=json.load(open('timing.json'));print(T[-1]['end']+3.2)")
A=$(python3 -c "print(round($DUR/3,2))"); B=$(python3 -c "print(round(2*$DUR/3,2))")
node render.js v2p1.mp4 30 - 0 $A > v2r1.log 2>&1 &
node render.js v2p2.mp4 30 - $A $B > v2r2.log 2>&1 &
node render.js v2p3.mp4 30 - $B $DUR > v2r3.log 2>&1 &
wait
printf "file 'v2p1.mp4'\nfile 'v2p2.mp4'\nfile 'v2p3.mp4'\n" > parts_v2.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i parts_v2.txt -c copy video.mp4
python3 -I finalize2.py
echo V2_DONE
