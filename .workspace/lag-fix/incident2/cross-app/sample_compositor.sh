#!/bin/bash
# Read-only compositor load sampler. Does not touch any user process.
HZ=$(getconf CLK_TCK)
read_cpu(){ awk '{print $14+$15}' /proc/$1/stat 2>/dev/null; }
count_warn(){ journalctl -b --no-pager --since "-5 s" 2>/dev/null | grep -c "needs an allocation"; }
echo "t,gnome_shell_cpu_pct,xorg_cpu_pct,isoworkers_cpu_pct,warn_per_s"
for i in $(seq 1 20); do
  g0=$(read_cpu 4139); x0=$(read_cpu 3884)
  w0=$(count_warn)
  sleep 1
  g1=$(read_cpu 4139); x1=$(read_cpu 3884)
  w1=$(count_warn)
  gp=$(awk -v a=$g0 -v b=$g1 -v h=$HZ 'BEGIN{printf "%.1f",100*(b-a)/h}')
  xp=$(awk -v a=$x0 -v b=$x1 -v h=$HZ 'BEGIN{printf "%.1f",100*(b-a)/h}')
  echo "$i,$gp,$xp,0,$w1"
done
