#!/usr/bin/env bash
set -u
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/why-these-two/tools
# wait for the running ABA-1440 arm to release its browser
while pgrep -f "panel-compare.mjs" >/dev/null; do sleep 5; done
sleep 3
echo "### ARM aba2k 2560x1440 reps2 ablate=aba $(date +%T)"
node panel-compare.mjs --run aba2k --order A --sections nav --reps 2 --browser chrome-headless --ablate aba \
  --vw 2560 --vh 1440 --dsf 2 --lock-wait-ms 180000 --quiet-wait-ms 120000 --settle 2500 --scroll-ms 900 --idle-ms 3000
echo "### ABA2K DONE $(date +%T)"
