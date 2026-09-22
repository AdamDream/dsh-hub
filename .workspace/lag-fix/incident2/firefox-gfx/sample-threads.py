#!/usr/bin/env python3
"""Read-only per-thread CPU sampler for the live Firefox session.
Purpose: decide whether WebRender rasterizes on CPU worker threads (software/SWGL)
or whether the render/compositor threads are mostly idle (waiting on GPU).

Reads ONLY /proc/<pid>/task/<tid>/stat and /proc/stat. Never writes to the profile,
never signals any process.
"""
import os, time, sys, collections, json

HZ = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 6.0

def firefox_pids():
    out = []
    for e in os.listdir("/proc"):
        if not e.isdigit():
            continue
        try:
            with open("/proc/%s/cmdline" % e, "rb") as f:
                cl = f.read().split(b"\0")
        except OSError:
            continue
        if cl and cl[0].endswith((b"/firefox", b"/crashhelper")) and b"/snap/firefox/" in cl[0]:
            out.append(int(e))
    return sorted(out)

def role(pid):
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as f:
            cl = f.read().decode("utf-8", "replace")
    except OSError:
        return "?"
    if "crashhelper" in cl:
        return "crashhelper"
    if "-contentproc" not in cl:
        return "BROWSER(parent)"
    for tag in ("rdd", "socket", "utility", "forkserver", "tab", "gpu"):
        pass
    if " -isForBrowser" in cl:
        return "content(tab)"
    if " forkserver" in cl:
        return "content(forkserver)"
    if " socket" in cl:
        return "content(socket)"
    if " rdd" in cl:
        return "rdd"
    if " utility" in cl:
        return "utility"
    return "content(?)"

def snapshot(pids):
    snap = {}
    for pid in pids:
        try:
            tdir = "/proc/%d/task" % pid
            tids = os.listdir(tdir)
        except OSError:
            continue
        for tid in tids:
            try:
                with open("%s/%s/stat" % (tdir, tid), "rb") as f:
                    data = f.read().decode("utf-8", "replace")
                # comm is in parens and may contain spaces/parens -> split on last ')'
                pre, post = data.rsplit(")", 1)
                comm = pre.split("(", 1)[1]
                flds = post.split()
                utime = int(flds[11]); stime = int(flds[12])   # fields 14,15 overall
            except (OSError, ValueError, IndexError):
                continue
            snap[(pid, int(tid))] = (comm, utime + stime)
    return snap

def cpu_total():
    with open("/proc/stat") as f:
        for line in f:
            if line.startswith("cpu "):
                p = [int(x) for x in line.split()[1:]]
                return sum(p), p[3] + (p[4] if len(p) > 4 else 0)
    return 0, 0

pids = firefox_pids()
print("Firefox pids: %s" % pids)
for p in pids:
    print("  %-7d %s" % (p, role(p)))
print("sampling %.1fs ..." % DUR)

a = snapshot(pids); tot_a, idle_a = cpu_total()
time.sleep(DUR)
b = snapshot(pids); tot_b, idle_b = cpu_total()

wall = DUR
ncpu = os.cpu_count()
busy_frac = 1.0 - (idle_b - idle_a) / max(1, (tot_b - tot_a))
print("\n=== machine: %d logical CPUs, aggregate busy over %.1fs = %.1f%% ===" % (ncpu, DUR, busy_frac * 100))

agg = collections.defaultdict(lambda: [0.0, 0.0, 0])  # role -> [cpu_s, threads_active, nthreads]
perthread = []
for k, (comm, t1) in b.items():
    if k not in a:
        continue
    d = (t1 - a[k][1]) / HZ
    # strip the "#N" suffix to group pools
    pool = comm.split("#")[0] if "#" in comm else comm
    r = role(k[0])
    agg[(r, pool)][0] += d
    agg[(r, pool)][1] += d
    agg[(r, pool)][2] += 1
    if d > 0.001:
        perthread.append((d, r, comm, k[0], k[1]))

perthread.sort(reverse=True)
tot_ff = sum(x[0] for x in perthread)
print("=== total Firefox CPU consumed in window: %.2f CPU-s (%.2f cores avg) ===" % (tot_ff, tot_ff / wall))
print("\n=== per-THREAD (top 30, only >1ms) ===")
print("%-8s %-18s %-18s %s" % ("cpu_s", "role", "thread-name", "pid/tid"))
for d, r, comm, pid, tid in perthread[:30]:
    print("%-8.3f %-18s %-18s %d/%d" % (d, r, comm, pid, tid))

print("\n=== grouped by (role, thread-pool) ===")
print("%-18s %-20s %9s %6s" % ("role", "pool", "cpu_s", "nthr"))
for (r, pool), (s, _, n) in sorted(agg.items(), key=lambda kv: -kv[1][0]):
    if s > 0.0005:
        print("%-18s %-20s %9.3f %6d" % (r, pool, s, n))

print("\n=== WebRender-thread totals (all roles) ===")
wr = collections.defaultdict(float)
for d, r, comm, pid, tid in perthread:
    for tag in ("WRWorkerLP", "WRWorker", "WRRenderBackend", "WRSceneBuilderLP",
                "WRSceneBuilder", "WrGlyphRasterizer", "Compositor", "Renderer",
                "SoftwareVsyncThread", "CanvasRenderer", "RendererBackend"):
        if comm.startswith(tag):
            wr[tag] += d
for k, v in sorted(wr.items(), key=lambda kv: -kv[1]):
    print("  %-22s %8.3f CPU-s" % (k, v))
print("\n  GPU-process threads present? " + ("no 'gpu' contentproc found" if not any(role(p).startswith("content") and "gpu" in role(p) for p in pids) else "yes"))
