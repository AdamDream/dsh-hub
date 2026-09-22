#!/bin/bash
# Read-only: correlate iGPU busy% with concurrent headless-chromium load.
D=/sys/class/drm/card2/device
HZ=$(getconf CLK_TCK)
cpu_of(){ awk '{print $14+$15}' /proc/$1/stat 2>/dev/null; }
echo "t,gpu_busy,headless_chromium_cpu,firefox_cpu,gnome_shell_cpu,xorg_cpu,loadavg1"
prev_hl=""; prev_ff=""; prev_gs=""; prev_x=""
for i in $(seq 1 60); do
  gb=$(cat $D/gpu_busy_percent 2>/dev/null || echo 0)
  hl0=0; ff0=0; gs0=0; x0=0
  for p in $(pgrep -f "headless_shell|ms-playwright.*chrome" 2>/dev/null); do
    v=$(cpu_of $p); [ -n "$v" ] && hl0=$((hl0+v)); done
  for p in $(pgrep -f "snap/firefox" 2>/dev/null); do v=$(cpu_of $p); [ -n "$v" ] && ff0=$((ff0+v)); done
  gs0=$(cpu_of 4139); x0=$(cpu_of 3884)
  sleep 1
  hl1=0; ff1=0
  for p in $(pgrep -f "headless_shell|ms-playwright.*chrome" 2>/dev/null); do
    v=$(cpu_of $p); [ -n "$v" ] && hl1=$((hl1+v)); done
  for p in $(pgrep -f "snap/firefox" 2>/dev/null); do v=$(cpu_of $p); [ -n "$v" ] && ff1=$((ff1+v)); done
  gs1=$(cpu_of 4139); x1=$(cpu_of 3884)
  # per-process-count-independent: report total ticks delta scaled by HZ
  hlp=$(awk -v a=$hl0 -v b=$hl1 -v h=$HZ 'BEGIN{printf "%.1f",100*(b-a)/h}')
  ffp=$(awk -v a=$ff0 -v b=$ff1 -v h=$HZ 'BEGIN{printf "%.1f",100*(b-a)/h}')
  gsp=$(awk -v a=$gs0 -v b=$gs1 -v h=$HZ 'BEGIN{printf "%.1f",100*(b-a)/h}')
  xp=$(awk -v a=$x0 -v b=$x1 -v h=$HZ 'BEGIN{printf "%.1f",100*(b-a)/h}')
  la=$(cut -d' ' -f1 /proc/loadavg)
  echo "$i,$gb,$hlp,$ffp,$gsp,$xp,$la"
done
