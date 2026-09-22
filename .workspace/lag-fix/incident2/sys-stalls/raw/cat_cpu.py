#!/usr/bin/env python3
"""Read-only per-process CPU accounting for the "is the system stalled?" question.

Samples /proc/<pid>/stat (utime+stime) twice, computes the delta per PID, then
classifies every process by walking the ppid chain and by cmdline markers.

Classes (the three the user asked for, with DSH split so the investigation
load can be separated from the host itself):
  DSH_HOST      the `dsh web` process itself
  DSH_SUBAGENT  every descendant of the dsh host = the investigation load
  USER          the human's interactive desktop stack
  SYSTEM        OS daemons + kernel threads + automatic updaters/indexers
  THIRD_PARTY   /usr/local management agents (OCular), not DSH and not user

Output is pure text on stdout. Reads /proc only; never signals any process.
"""
import os
import sys
import time

HZ = os.sysconf("SC_CLK_TCK")
NCPU = os.cpu_count()

DSH_HOST_PID = 10806  # node /home/.../bin/dsh web  (verified via /proc/10806/stat)

DSH_MARK = (
    "ms-playwright", "headless_shell", "dsh web", "host-click-probe", "run-frozen",
    "raf-face-runner", "matrix.mjs", "host-drift", "theme-open-ab", "run-campaign.sh",
    "frozen-2026", "click-probe", "sentinel", "gdb", "--run 1",
)
USER_MARK = (
    "/snap/firefox/", "gnome-shell", "/usr/bin/Xorg", "gnome-session-binary",
    "/usr/bin/wechat", "WeChatAppEx", "bytedance-feishu", "fcitx5", "terminator",
    "ding@rastersoft", "WebKitWebProcess", "gnome-remote-desktop", "cc-switch",
)
TP_MARK = ("/usr/local/.OCular", "LAgent", "LSDHelper", "LMonitorFileOP", "LSGTransmit", ".Ocular")


def parse_stat(path):
    try:
        with open(path, "rb") as fh:
            raw = fh.read().decode("utf-8", "replace")
    except OSError:
        return None
    rp = raw.rfind(")")
    if rp < 0:
        return None
    lp = raw.find("(")
    try:
        pid = int(raw[:lp].strip())
    except ValueError:
        return None
    comm = raw[lp + 1:rp]
    rest = raw[rp + 2:].split()
    if len(rest) < 22:
        return None
    try:
        return {
            "pid": pid, "comm": comm, "state": rest[0], "ppid": int(rest[1]),
            "utime": int(rest[11]), "stime": int(rest[12]),
            "nthreads": int(rest[17]), "rss": int(rest[21]) * 4096,
        }
    except ValueError:
        return None


def cmdline(pid):
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as fh:
            return fh.read().decode("utf-8", "replace").replace("\x00", " ").strip()
    except OSError:
        return ""


def snapshot():
    out = {}
    for e in os.listdir("/proc"):
        if e.isdigit():
            st = parse_stat("/proc/%s/stat" % e)
            if st:
                out[st["pid"]] = st
    return out


def build_classifier(procs, cmds):
    """Return a function pid -> class string."""
    dsh_set = set()
    for pid, st in procs.items():
        cur, hops = pid, 0
        while cur and hops < 64:
            if cur == DSH_HOST_PID:
                dsh_set.add(pid)
                break
            nxt = procs.get(cur)
            if nxt is None:
                break
            cur = nxt["ppid"]
            hops += 1

    def klass(pid):
        st = procs[pid]
        cl = cmds.get(pid, "")
        blob = cl + " " + st["comm"]
        if pid == DSH_HOST_PID:
            return "DSH_HOST"
        if pid in dsh_set:
            return "DSH_SUBAGENT"
        for m in DSH_MARK:
            if m in blob:
                return "DSH_SUBAGENT"
        for m in TP_MARK:
            if m in blob:
                return "THIRD_PARTY"
        for m in USER_MARK:
            if m in blob:
                return "USER"
        return "SYSTEM"

    return klass


def main():
    dur = float(sys.argv[1]) if len(sys.argv) > 1 else 20.0
    a = snapshot()
    t0 = time.time()
    time.sleep(dur)
    elapsed = time.time() - t0
    b = snapshot()
    cmds = {pid: cmdline(pid) for pid in b}

    klass = build_classifier(b, cmds)
    buckets = {}
    for pid, sb in b.items():
        sa = a.get(pid)
        if sa is None:
            continue
        d = (sb["utime"] - sa["utime"]) + (sb["stime"] - sa["stime"])
        if d <= 0:
            continue
        k = klass(pid)
        buckets.setdefault(k, []).append(
            (d, pid, sb["comm"], cmds.get(pid, ""), sb["state"], sb["rss"])
        )

    gran = elapsed * HZ            # ticks one core delivers in the window
    cap = NCPU * gran              # ticks the whole machine delivers
    total = sum(r[0] for rows in buckets.values() for r in rows)

    print("window=%.2fs  NCPU=%d  busy_ticks=%d  machine_capacity_ticks=%.0f" % (
        elapsed, NCPU, total, cap))
    print("MACHINE UTILISATION = %.2f%%  (%.2f of %d cores busy)" % (
        100.0 * total / cap, total / gran, NCPU))
    print()

    order = ["DSH_SUBAGENT", "DSH_HOST", "USER", "SYSTEM", "THIRD_PARTY"]
    labels = {
        "DSH_SUBAGENT": "DSH subagents  (MY investigation load)",
        "DSH_HOST": "DSH host       (dsh web process itself)",
        "USER": "USER           (human interactive apps)",
        "SYSTEM": "SYSTEM         (OS daemons, kernel, auto-updaters)",
        "THIRD_PARTY": "THIRD_PARTY    (/usr/local OCular agents)",
    }
    print("%-14s %10s %10s %10s  %s" % ("CLASS", "cores", "%machine", "%of_busy", "procs"))
    for k in order:
        rows = buckets.get(k, [])
        s = sum(r[0] for r in rows)
        print("%-14s %10.3f %9.2f%% %9.1f%%  %d" % (
            k, s / gran, 100.0 * s / cap, (100.0 * s / total if total else 0), len(rows)))
    print()

    for k in order:
        rows = sorted(buckets.get(k, []), reverse=True)
        if not rows:
            continue
        s = sum(r[0] for r in rows)
        print("=" * 104)
        print("%s   total=%.3f cores (%.2f%% of machine, %.1f%% of all busy CPU)" % (
            labels[k], s / gran, 100.0 * s / cap, 100.0 * s / total if total else 0))
        print("=" * 104)
        for d, pid, comm, cl, state, rss in rows[:12]:
            print("  %7.2f%%core  pid=%-7d %-18s rss=%6.0fMB st=%s  %s" % (
                100.0 * d / gran, pid, comm[:18], rss / 1048576.0, state, cl[:110]))
        if len(rows) > 12:
            rest = sum(r[0] for r in rows[12:])
            print("  ... %d further procs, %.2f%%core combined" % (
                len(rows) - 12, 100.0 * rest / gran))
        print()


main()
