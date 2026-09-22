#!/bin/sh
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/firefox-a11y
PID=$(cat logs/heavy-runner-pid.txt)
while [ -d "/proc/$PID" ]; do sleep 5; done
echo "heavy gecko batch exited at $(date +%T)" >> logs/chain2.log
sleep 20

# --- Blink cross-check: same page, same heavy workload, 3 conditions x 3 reps
nohup node blink-a11y.mjs --reps=3 \
  --n=30000 --m=20000 --f=120 --k=20000 --t=3000 --batch=500 \
  --lockwait=35 --tag=blinkh > logs/blinkh-runner.log 2>&1 &
BPID=$!
echo "blink runner pid=$BPID at $(date +%T)" >> logs/chain2.log
while [ -d "/proc/$BPID" ]; do sleep 5; done
echo "blink batch exited at $(date +%T)" >> logs/chain2.log
sleep 20

# --- Headed Gecko: the user's real configuration (real GTK/ATK bridge + AT-SPI)
nohup node firefox-a11y.mjs --phase=matrix --mode=headed --reps=3 \
  --n=30000 --m=20000 --f=120 --k=20000 --t=3000 --batch=500 \
  --lockwait=35 --timeout=180 --tag=ffhead > logs/ffhead-runner.log 2>&1 &
echo "headed runner pid=$! at $(date +%T)" >> logs/chain2.log
