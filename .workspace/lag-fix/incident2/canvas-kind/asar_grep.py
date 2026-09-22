#!/usr/bin/env python3
"""Read-only offset-attributed grep over an ASAR archive (fast path).

Uses GNU `grep -a -b` on the raw archive for scanning speed, then maps each byte
offset back to the owning ASAR member using the cached member index
(raw/asar_members.tsv, produced by asar_index.py) and locates the line number by
reading ONLY [member_offset, hit] bytes of that member (never the whole member).

Read-only: the archive is only ever opened 'rb' / read by grep.
"""
import bisect
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASAR = "/usr/lib/chatgpt/resources/app.asar"
TSV = os.path.join(HERE, "raw", "asar_members.tsv")

PAT = sys.argv[1]
MAX = int(sys.argv[2]) if len(sys.argv) > 2 else 60
CTX = int(sys.argv[3]) if len(sys.argv) > 3 else 120
FIXED = len(sys.argv) > 4 and sys.argv[4] == "fixed"

entries = []
base = 4272712
with open(TSV) as fh:
    next(fh)
    for line in fh:
        p, s, o, u = line.rstrip("\n").split("\t")
        if u == "1" or s == "0":
            continue
        entries.append((int(o), p, int(s)))
entries.sort()
offs = [e[0] for e in entries]

def slice_at(abs_off, before, after):
    """Read only [abs_off-before, abs_off+after) from the archive. Bounded memory."""
    start = max(0, abs_off - before)
    with open(ASAR, "rb") as fh:
        fh.seek(start)
        return fh.read(before + after), start


def count_newlines(o, upto, cap=48 << 20):
    """Count newlines in [o, upto) in bounded chunks (no whole-member load)."""
    if upto - o > cap:
        return -1
    n = 0
    with open(ASAR, "rb") as fh:
        fh.seek(o)
        remaining = upto - o
        while remaining > 0:
            chunk = fh.read(min(1 << 20, remaining))
            if not chunk:
                break
            n += chunk.count(b"\n")
            remaining -= len(chunk)
    return n + 1


def owner(abs_off):
    i = bisect.bisect_right(offs, abs_off) - 1
    if i < 0:
        return None
    o, p, s = entries[i]
    if o <= abs_off < o + s:
        return (o, p, s)
    return None


cmd = ["grep", "-a", "-b", "-o", "-E"]
if FIXED:
    cmd.append("-F")
cmd += ["-e", PAT, ASAR]
proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
if proc.returncode not in (0, 1):
    sys.stderr.write(proc.stderr.decode("utf-8", "replace")[:2000])
    sys.exit(proc.returncode)

hits = 0
last_key = None
for line in proc.stdout.decode("utf-8", "replace").splitlines():
    if hits >= MAX:
        break
    try:
        off_s, _ = line.split(":", 1)
        abs_off = int(off_s)
    except ValueError:
        continue
    own = owner(abs_off)
    if not own:
        continue
    o, p, s = own
    in_off = abs_off - o
    lo_pad = CTX // 2
    hi_pad = CTX if not FIXED else CTX + len(PAT)
    snip, _start = slice_at(abs_off, lo_pad, hi_pad)
    ln = count_newlines(o, abs_off)
    ln = "?" if ln < 0 else ln
    snip = snip.decode("utf-8", "replace").replace("\n", "\\n")
    print(f"### {p}:{ln}  (member_off={in_off}/{s})")
    print(f"    {snip[:400]}")
    hits += 1
print(f"--- hits printed: {hits} (cap {MAX}) ---")
