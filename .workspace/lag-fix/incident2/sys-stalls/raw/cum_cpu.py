#!/usr/bin/env python3
"""Cumulative CPU consumed since process start, grouped by category (read-only)."""
import os
HZ = os.sysconf("SC_CLK_TCK")
DSH_HOST_PID = 10806
DSH_MARK = ("ms-playwright","headless_shell","dsh web","host-click-probe","run-frozen",
            "raf-face-runner","matrix.mjs","host-drift","theme-open-ab","run-campaign.sh",
            "frozen-2026","click-probe","sentinel","gdb")
USER_MARK = ("/snap/firefox/","gnome-shell","/usr/bin/Xorg","/usr/lib/xorg/Xorg",
             "gnome-session-binary","/usr/bin/wechat","WeChatAppEx","bytedance-feishu",
             "/opt/bytedance/feishu","fcitx5","terminator","ding@rastersoft",
             "WebKitWebProcess","gnome-remote-desktop","cc-switch","update-manager")
TP_MARK = ("/usr/local/.OCular","LAgent","LSDHelper","LMonitorFileOP","LSGTransmit",".Ocular")

def cmdline(pid):
    try:
        with open("/proc/%d/cmdline"%pid,"rb") as f:
            return f.read().decode("utf-8","replace").replace("\x00"," ").strip()
    except OSError: return ""

procs={}
for e in os.listdir("/proc"):
    if not e.isdigit(): continue
    try:
        raw=open("/proc/%s/stat"%e,"rb").read().decode("utf-8","replace")
    except OSError: continue
    rp=raw.rfind(")"); lp=raw.find("(")
    if rp<0 or lp<0: continue
    try: pid=int(raw[:lp].strip())
    except ValueError: continue
    rest=raw[rp+2:].split()
    if len(rest)<22: continue
    try: procs[pid]={"pid":pid,"comm":raw[lp+1:rp],"state":rest[0],"ppid":int(rest[1]),
                     "cpu":int(rest[11])+int(rest[12]),"rss":int(rest[21])*4096}
    except ValueError: continue

dsh=set()
for pid in procs:
    cur,h=pid,0
    while cur and h<64:
        if cur==DSH_HOST_PID: dsh.add(pid); break
        n=procs.get(cur)
        if n is None: break
        cur=n["ppid"]; h+=1

agg={}
tot=0
for pid,st in procs.items():
    blob=cmdline(pid)+" "+st["comm"]
    if pid==DSH_HOST_PID: k="DSH_HOST"
    elif pid in dsh: k="DSH_SUBAGENT"
    elif any(m in blob for m in DSH_MARK): k="DSH_SUBAGENT"
    elif any(m in blob for m in TP_MARK): k="THIRD_PARTY"
    elif any(m in blob for m in USER_MARK): k="USER"
    else: k="SYSTEM"
    agg.setdefault(k,[0,0,0])
    agg[k][0]+=st["cpu"]; agg[k][1]+=1; agg[k][2]+=st["rss"]
    tot+=st["cpu"]

print("CUMULATIVE CPU-SECONDS CONSUMED SINCE EACH PROCESS STARTED (current process table)")
print("total CPU-seconds across all live processes = %.1f  (over uptime %.0f min, 32 cores)" % (tot/HZ, float(open('/proc/uptime').read().split()[0])/60))
print()
print("%-14s %12s %9s %8s %10s" % ("CLASS","cpu_sec","%of_cpu","procs","rss_MB"))
for k in ["DSH_HOST","DSH_SUBAGENT","USER","SYSTEM","THIRD_PARTY"]:
    v=agg.get(k,[0,0,0])
    print("%-14s %12.1f %8.1f%% %8d %10.0f" % (k, v[0]/HZ, 100.0*v[0]/tot if tot else 0, v[1], v[2]/1048576.0))
print()
print("--- top individual consumers by cumulative CPU ---")
rows=sorted(((st["cpu"],pid,st["comm"],cmdline(pid)) for pid,st in procs.items()),reverse=True)
for c,pid,comm,cl in rows[:18]:
    print("  %9.1f cpu_sec  pid=%-7d %-18s %s" % (c/HZ, pid, comm[:18], cl[:88]))
