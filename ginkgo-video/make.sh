#!/usr/bin/env bash
# Renders the 60s 1080x1920 video: 4 parallel chunks -> concat -> synthesized soundtrack -> out/final.mp4
# Needs: node, python3 (numpy, scipy). Set CHROME_PATH to use a specific Chromium build.
set -euo pipefail
cd "$(dirname "$0")"
npm install --silent
FF=./node_modules/ffmpeg-static/ffmpeg
mkdir -p out/seg
python3 -m http.server 8765 >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV' EXIT
sleep 1
EVENTS=out/events.json node preview.mjs out/cover 1 0
for i in 0 1 2 3; do node render.mjs $((i*450)) $((i*450+450)) out/seg/part$i.mp4 & done
wait
printf "file 'seg/part%d.mp4'\n" 0 1 2 3 > out/list.txt
$FF -loglevel error -y -f concat -safe 0 -i out/list.txt -c copy out/video.mp4
python3 audio.py out/events.json out/music.wav
$FF -loglevel error -y -i out/video.mp4 -i out/music.wav -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out/final.mp4
echo "done: out/final.mp4"
