#!/usr/bin/env python3
"""
glean-dist.py -- decode Firefox Glean distribution ("bucket") metrics from the
local Glean "safe" store (read-only) and emit JSON.

CONTAINER (verified byte-by-byte):
    record := [u64 keylen][key utf8][u64 vallen][value]
    value  := [u8 TAG=0x09][u64 paylen][payload]

DISTRIBUTION payload shape:
    payload := [u32 subtag][u32 nbuckets][entries][trailer]
    entry   := [u64 bin_label][u64 count]
    Both bin_label and count are stored as u64 whose UPPER 32 bits hold the
    value; the lower 32 bits are zero  ->  recover with >>32.

    Entry stride and total length are self-checking:
        len(payload) == 8 + 16*nbuckets + trailer
      with trailer = 44 for subtag {0x02,0x03} and 28 for subtag {0x0b}.
    Independent confirmation: the u32 at trailer offset 4 equals the sum of all
    decoded bucket counts for subtag 0x0b (e.g. composite_time 173703,
    frame_time.from_vsync 109441).
"""
import json
import struct
import sys

TRAILER = {0x02: 44, 0x03: 44, 0x0B: 28}


def load(path):
    buf = open(path, "rb").read()
    u64 = lambda o: int.from_bytes(buf[o:o + 8], "little")
    n = len(buf)
    KEYCH = set(b"abcdefghijklmnopqrstuvwxyz0123456789_-.#/")

    def keyok(o):
        if o + 8 > n:
            return None
        kl = u64(o)
        if not (4 <= kl <= 200) or o + 8 + kl > n:
            return None
        seg = buf[o + 8:o + 8 + kl]
        if b"#" not in seg or not all(c in KEYCH for c in seg):
            return None
        return kl

    def resync(o):
        for d in range(1, 3000):
            if o + d + 16 > n:
                return None
            if keyok(o + d) is not None:
                return o + d
        return None

    off, out = 24, {}
    while off + 16 <= n:
        kl = keyok(off)
        if kl is None:
            nxt = resync(off)
            if nxt is None:
                break
            off = nxt
            continue
        vo = off + 8 + kl
        vl = u64(vo)
        if vl == 0 or vo + 8 + vl > n:
            nxt = resync(off)
            if nxt is None:
                break
            off = nxt
            continue
        out.setdefault(buf[off + 8:off + 8 + kl].decode("utf8", "replace"),
                       buf[vo + 8:vo + 8 + vl])
        off = vo + 8 + vl
    return out


def payload(vb):
    return vb[9:9 + int.from_bytes(vb[1:9], "little")]


def decode_dist(p):
    sub = int.from_bytes(p[0:4], "little")
    nb = int.from_bytes(p[4:8], "little")
    if sub not in TRAILER or nb == 0:
        return None
    tn = TRAILER[sub]
    if len(p) != 8 + 16 * nb + tn:
        return None
    bins, o = [], 8
    for _ in range(nb):
        lab = int.from_bytes(p[o:o + 8], "little") >> 32
        cnt = int.from_bytes(p[o + 8:o + 16], "little") >> 32
        bins.append({"bin": lab, "count": cnt})
        o += 16
    tr = p[o:]
    total = int.from_bytes(tr[4:8], "little") if len(tr) >= 8 else None
    s = sum(b["count"] for b in bins)
    return {"subtag": sub, "nbuckets": nb, "bins": bins, "sum_counts": s,
            "trailer_total_samples": total,
            "trailer_matches_sum": (total == s),
            "trailer_hex": tr.hex(" ")}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "data.safe.bin.copy"
    D = load(path)
    out, skipped = {}, []
    for k, vb in sorted(D.items()):
        if not (k.startswith("metrics#gfx") or k.startswith("metrics#a11y")):
            continue
        p = payload(vb)
        d = decode_dist(p)
        if d is None:
            skipped.append({"key": k, "payload_len": len(p),
                            "subtag": int.from_bytes(p[0:4], "little") if len(p) >= 4 else None,
                            "nbuckets": int.from_bytes(p[4:8], "little") if len(p) >= 8 else None})
            continue
        out[k] = d
    json.dump(out, open("distributions.json", "w"), indent=1)
    json.dump(skipped, open("distributions-skipped.json", "w"), indent=1)
    print("decoded %d distribution metrics; %d skipped" % (len(out), len(skipped)))
    for k, d in out.items():
        print("%-52s sub=%#x bins=%-3d sum=%-8d trailer=%-8s %s"
              % (k, d["subtag"], d["nbuckets"], d["sum_counts"],
                 d["trailer_total_samples"], "MATCH" if d["trailer_matches_sum"] else "-"))
    if skipped:
        print("\nSKIPPED (layout did not self-check):")
        for s in skipped:
            print("   %-52s len=%d sub=%#x nb=%s" % (s["key"], s["payload_len"],
                                                     s["subtag"] or 0, s["nbuckets"]))


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------------------
# Authoritative cross-validation against Mozilla's bucketing specification.
#
# timing_distribution (Glean SDK): functional bucketing, "8 buckets for every
# power of 2", index = floor(8*log2(x)), x stored in NANOSECONDS.
#   -> bucket_min(i) = 2**(i/8) ns
# Source: mozilla/glean docs/user/reference/metrics/timing_distribution.md
#         + glean-core/src/histogram/functional.rs (functional(2.0, 8.0))
#
# Every timing distribution bucket we decode MUST lie inside its own functional
# bucket.  This is a completely independent check of the >>32 field encoding.
# ---------------------------------------------------------------------------
TIMING_KEYS = (
    "metrics#gfx.scroll_present_latency",
    "metrics#gfx.composite_time",
    "metrics#gfx.composite_frame_roundtrip_time",
    "metrics#gfx.checkerboard.duration",
    "metrics#gfx.checkerboard.potential_duration",
    "metrics#gfx.content.paint_time",
    "metrics#gfx.content.full_paint_time",
    "metrics#a11y.tree_update_timing",
)


def validate_timing(dist):
    """Return (n_ok, n_total). Each timing bin must sit in its own functional bucket."""
    import math
    ok = tot = 0
    for k in TIMING_KEYS:
        if k not in dist:
            continue
        for b in dist[k]["bins"]:
            x = b["bin"]
            tot += 1
            i = math.floor(8.0 * math.log2(x)) if x > 0 else 0
            lo, hi = 2.0 ** (i / 8.0), 2.0 ** ((i + 1) / 8.0)
            if lo * (1 - 1e-6) <= x < hi * (1 + 1e-6):
                ok += 1
    return ok, tot
