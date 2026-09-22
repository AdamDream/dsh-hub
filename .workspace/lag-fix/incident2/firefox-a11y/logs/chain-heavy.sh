#!/bin/sh
# Wait for the light matrix runner to finish, then start the heavy-workload batch.
PID=$(cat /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/firefox-a11y/logs/runner-pid.txt)
while [ -d "/proc/$PID" ]; do sleep 5; done
sleep 20   # let the lock settle
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/firefox-a11y
nohup node firefox-a11y.mjs --phase=matrix --mode=headless --reps=3 \
  --n=30000 --m=20000 --f=120 --k=20000 --t=3000 --batch=500 \
  --lockwait=40 --timeout=180 --tag=ffh > logs/ffheavy-runner.log 2>&1 &
echo $! > logs/heavy-runner-pid.txt
echo "heavy runner started pid=$(cat logs/heavy-runner-pid.txt) at $(date +%T)" >> logs/chain.log
