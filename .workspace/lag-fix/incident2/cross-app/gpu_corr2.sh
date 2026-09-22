#!/bin/bash
# Read-only. Correlate iGPU busy% with chrome-process COUNT and total system CPU.
D=/sys/class/drm/card2/device
echo "t,gpu_busy,n_chrome_procs,total_cpu_pct,firefox_cpu_pct"
read_total(){ awk '/^cpu /{idle=$5+$6; tot=0; for(i=2;i<=11;i++) tot+=$i; print tot, idle}' /proc/stat; }
cpu_ticks(){ awk '{print $14+$15}' /proc/$1/stat 2>/dev/null; }
ff_list=$(pgrep -f "snap/firefox" | tr '\n' ' ')
prev=$(read_total)
prevff=0; for p in $ff_list; do v=$(cpu_ticks $p); prevff=$((prevff+${v:-0})); done
for i in $(seq 1 120); do
  sleep 1
  gb=$(cat $D/gpu_busy_percent 2>/dev/null || echo 0)
  nch=$(pgrep -f "headless_shell|ms-playwright" 2>/dev/null | wc -l)
  cur=$(read_total)
  pt=$(echo $prev|cut -d' ' -f1); pi=$(echo $prev|cut -d' ' -f2)
  ct=$(echo $cur|cut -d' ' -f1);  ci=$(echo $cur|cut -d' ' -f2)
  cpup=$(awk -v pt=$pt -v pi=$pi -v ct=$ct -v ci=$ci 'BEGIN{d=ct-pt; if(d<=0){print 0} else {printf "%.1f",100*(d-(ci-pi))/d}}')
  prev=$cur
  ffnow=0; for p in $(pgrep -f "snap/firefox" 2>/dev/null); do v=$(cpu_ticks $p); ffnow=$((ffnow+${v:-0})); done
  # guard against process churn: only trust when counts match
  nff=$(pgrep -f "snap/firefox" 2>/dev/null | wc -l); prevnff=$(echo $ff_list|wc -w)
  ffd=$((ffnow-prevff))
  if [ "$nff" != "$prevnff" ] || [ $ffd -lt 0 ]; then ffp="NA"; else ffp=$(awk -v d=$ffd 'BEGIN{printf "%.1f",100*d/100}'); fi
  prevff=$ffnow; ff_list=$(pgrep -f "snap/firefox"|tr '\n' ' ')
  echo "$i,$gb,$nch,$cpup,$ffp"
done
