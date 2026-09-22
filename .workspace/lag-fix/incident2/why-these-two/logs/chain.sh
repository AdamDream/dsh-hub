#!/usr/bin/env bash
set -u
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/why-these-two/tools
COMMON="--order A --sections nav --lock-wait-ms 180000 --quiet-wait-ms 120000 --settle 2500 --scroll-ms 900 --idle-ms 3000"
echo "### ARM ablate-mask 1440x900 reps2 $(date +%T)"
node panel-compare.mjs --run ablate --reps 2 --browser chrome-headless --ablate mask --vw 1440 --vh 900 --dsf 2 $COMMON
echo "### ARM area2k 2560x1440 reps2 $(date +%T)"
node panel-compare.mjs --run area2k --reps 2 --browser chrome-headless --ablate mask --vw 2560 --vh 1440 --dsf 2 $COMMON
echo "### DONE $(date +%T)"
