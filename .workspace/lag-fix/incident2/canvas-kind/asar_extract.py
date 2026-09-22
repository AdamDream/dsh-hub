#!/usr/bin/env python3
"""Read-only ASAR member extractor.

Usage: asar_extract.py <member_path_fragment> <outdir>
Copies matching members out of the archive into outdir (under the workspace).
The archive itself is opened 'rb' only and never modified.
Only members below a size cap are extracted; larger ones are reported instead.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASAR = "/usr/lib/chatgpt/resources/app.asar"
TSV = os.path.join(HERE, "raw", "asar_members.tsv")
CAP = 40 << 20

frag = sys.argv[1]
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)

n = 0
with open(TSV) as fh:
    next(fh)
    for line in fh:
        p, s, o, u = line.rstrip("\n").split("\t")
        if frag not in p:
            continue
        s = int(s)
        if u == "1":
            print(f"SKIP unpacked {p}")
            continue
        if s > CAP:
            print(f"SKIP too-big  {p} ({s})")
            continue
        with open(ASAR, "rb") as src:
            src.seek(int(o))
            body = src.read(s)
        dest = os.path.join(outdir, p.strip("/").replace("/", "__"))
        with open(dest, "wb") as out:
            out.write(body)
        print(f"WROTE {dest}  ({s} bytes)")
        n += 1
print(f"extracted {n}")
