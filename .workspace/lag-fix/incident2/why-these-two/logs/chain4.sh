#!/usr/bin/env bash
set -u
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/why-these-two/tools
echo "### ARM aba2k-b 2560x1440 reps3 ablate=aba $(date +%T)"
node panel-compare.mjs --run aba2kb --order A --sections nav --reps 3 --browser chrome-headless --ablate aba \
  --vw 2560 --vh 1440 --dsf 2 --click-timeout 30000 --lock-wait-ms 90000 --quiet-wait-ms 120000 \
  --settle 2500 --scroll-ms 900 --idle-ms 3000
echo "### ABA2KB DONE $(date +%T)"
