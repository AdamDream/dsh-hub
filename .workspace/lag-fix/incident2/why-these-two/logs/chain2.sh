#!/usr/bin/env bash
set -u
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/why-these-two/tools
node panel-compare.mjs --run aba --order A --sections nav --reps 3 --browser chrome-headless --ablate aba \
  --vw 1440 --vh 900 --dsf 2 --lock-wait-ms 180000 --quiet-wait-ms 120000 --settle 2500 --scroll-ms 900 --idle-ms 3000
echo "### ABA DONE $(date +%T)"
