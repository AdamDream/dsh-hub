#!/usr/bin/env python3
"""1 Hz sampler for AMD iGPU busy% + foreign chromium load.

Read-only observation. Never signals any process.

CPU% is computed with PER-PID tick deltas, summing only PIDs present in BOTH
consecutive samples. This avoids the artifact where a process *exiting* makes a
whole-set tick sum go backwards and produce a bogus negative CPU%.

A window is declared CHROMIUM_QUIET only after QUIET_STREAK consecutive samples
satisfy: (no foreign chromium) OR (every foreign chromium process < QUIET_PROC%
CPU).
"""
import glob, os, sys, time

OUT, STATUS, DUR, MINE, QUIET_PROC, QUIET_STREAK = (
    sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4],
    float(sys.argv[5]), int(sys.argv[6]))

HZ = os.sysconf('SC_CLK_TCK') or 100
GPU = '/sys/class/drm/card2/device/gpu_busy_percent'


def read_int(p, default=-1):
    try:
        with open(p) as f:
            return int(f.read().strip())
    except Exception:
        return default


def snapshot():
    """pid -> (ticks, is_mine) for chromium-family processes."""
    cur = {}
    for d in glob.glob('/proc/[0-9]*'):
        try:
            pid = int(d.rsplit('/', 1)[1])
            with open(d + '/cmdline', 'rb') as f:
                cl = f.read().decode('utf8', 'replace')
            if 'headless_shell' not in cl and 'chrome-linux/chrome' not in cl:
                continue
            with open(d + '/stat') as f:
                fields = f.read().rsplit(')', 1)[1].split()
            cur[pid] = (int(fields[11]) + int(fields[12]), bool(MINE and MINE in cl))
        except Exception:
            continue
    return cur


prev = snapshot()
prev_t = time.time()
t0 = prev_t
streak = 0

with open(OUT, 'w') as log:
    log.write('ts,gpu_busy_pct,foreign_n,foreign_cpu_pct,foreign_max_proc_pct,'
              'mine_n,mine_cpu_pct,quiet_streak,load1,verdict\n')
    log.flush()
    while time.time() - t0 < DUR:
        time.sleep(1.0)
        now = time.time()
        dt = max(1e-6, now - prev_t)
        cur = snapshot()

        f_cpu = m_cpu = 0.0
        f_max = 0.0
        f_n = m_n = 0
        for pid, (ticks, is_mine) in cur.items():
            if is_mine:
                m_n += 1
            else:
                f_n += 1
            if pid in prev:                      # only PIDs alive in both samples
                pct = 100.0 * (ticks - prev[pid][0]) / HZ / dt
                pct = max(0.0, pct)              # clamp counter-reset artifacts
                if is_mine:
                    m_cpu += pct
                else:
                    f_cpu += pct
                    f_max = max(f_max, pct)
        prev, prev_t = cur, now

        gpu = read_int(GPU, -1)
        try:
            load1 = float(open('/proc/loadavg').read().split()[0])
        except Exception:
            load1 = -1.0

        chromium_quiet_now = (f_n == 0) or (f_max < QUIET_PROC)
        streak = streak + 1 if chromium_quiet_now else 0
        settled = streak >= QUIET_STREAK
        gpu_idle = (0 <= gpu < 50)

        log.write('%s,%d,%d,%.1f,%.1f,%d,%.1f,%d,%.2f,%s\n'
                  % (time.strftime('%H:%M:%S'), gpu, f_n, f_cpu, f_max,
                     m_n, m_cpu, streak, load1, 'QUIET' if settled else 'BUSY'))
        log.flush()
        with open(STATUS, 'w') as s:
            s.write('%s %s gpu=%d foreign_n=%d foreign_cpu=%.1f%% '
                    'foreign_max_proc=%.1f%% mine_n=%d mine_cpu=%.1f%% streak=%d load1=%.2f'
                    % ('CHROMIUM_QUIET' if settled else 'CHROMIUM_BUSY',
                       'GPU_IDLE' if gpu_idle else 'GPU_BUSY',
                       gpu, f_n, f_cpu, f_max, m_n, m_cpu, streak, load1))
print('sampler done')
