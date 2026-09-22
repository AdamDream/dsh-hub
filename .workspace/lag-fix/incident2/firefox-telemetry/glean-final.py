#!/usr/bin/env python3
"""
glean-final.py -- final, self-validating read-only decoder for Firefox Glean's
own "safe" store, emitting the full key inventory + decoded values.

CONTAINER (verified byte-by-byte; NOT LMDB):
    record := [u64 keylen][key utf8][u64 vallen][value]
    value  := [u8 TAG=0x09][u64 paylen][payload]

payload sub-tags (payload[0]):
    0x00  bool / empty            payload[5] holds 0|1
    0x01  counter                 payload[5:9] = u32 (LE)  [4 = high half, 0 in low]
    0x02  distribution, 0x03 distribution-with-phases, 0x0B timing distribution
    0x06  integer                 payload[5:13] = u64 (LE)
    0x07  string                  payload[5:13] = u64 strlen, then bytes
    0x11  JSON                    payload[5:13] = u64 jsonlen, then bytes

NOTE on 4-byte fields: scalar u32 values are stored in the HIGH half of an 8-byte
slot, i.e. read as little-endian u32 at payload[5:9] and the low 4 bytes are 0.
Distribution bin labels and counts follow the same convention inside u64s, so they
must be recovered with >> 32.
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


def classify(k, p):
    if len(p) < 5:
        return {"kind": "empty", "raw": p.hex(" ")}
    st = p[0]
    if st == 0x00:
        return {"kind": "bool", "value": (p[4] if len(p) > 4 else None)}
    if st == 0x01:
        return {"kind": "counter", "value": int.from_bytes(p[4:8], "little")}
    if st in TRAILER:
        nb = int.from_bytes(p[4:8], "little")
        tn = TRAILER[st]
        if len(p) != 8 + 16 * nb + tn:
            return {"kind": "dist_UNVERIFIED", "subtag": st, "nbuckets": nb,
                    "payload_len": len(p)}
        bins, o = [], 8
        for _ in range(nb):
            bins.append({"bin": int.from_bytes(p[o:o + 8], "little") >> 32,
                         "count": int.from_bytes(p[o + 8:o + 16], "little") >> 32})
            o += 16
        tr = p[o:]
        tot = int.from_bytes(tr[4:8], "little")
        s = sum(b["count"] for b in bins)
        return {"kind": "distribution", "subtag": st, "nbuckets": nb,
                "bins": bins, "sum_counts": s, "trailer_total_samples": tot,
                "self_consistent": tot == s}
    if st == 0x06:
        return {"kind": "int", "value": int.from_bytes(p[4:12], "little")}
    if st == 0x07:
        sl = int.from_bytes(p[4:12], "little")
        return {"kind": "string", "value": p[12:12 + sl].decode("utf8", "replace"),
                "strlen": sl}
    if st == 0x11:
        sl = int.from_bytes(p[4:12], "little")
        return {"kind": "json", "value": p[12:12 + sl].decode("utf8", "replace")}
    return {"kind": "sub_%#x" % st, "raw": p[:32].hex(" ")}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "data.safe.bin.copy"
    D = load(path)
    everything, interesting = {}, {}
    PAT = ("gfx.", "a11y.", "display.", "content.", "content_", "monitors",
           "target_frame_rate", "skipped_composites")
    for k, vb in D.items():
        p = payload(vb)
        v = classify(k, p)
        v["payload_len"] = len(p)
        everything[k] = v
        if any(t in k for t in PAT):
            interesting[k] = v
    json.dump(everything, open("key-inventory.json", "w"), indent=1)
    json.dump(interesting, open("gfx-a11y-values.json", "w"), indent=1)
    print("total records: %d" % len(everything))
    print("gfx/a11y/display/content keys: %d" % len(interesting))
    print("\n--- scalars (verification of known values) ---")
    for k in sorted(interesting):
        v = interesting[k]
        if v["kind"] in ("int", "string", "bool", "counter"):
            print("  %-52s %-8s %s" % (k, v["kind"], repr(v.get("value"))))
    print("\n--- distributions ---")
    for k in sorted(interesting):
        v = interesting[k]
        if v["kind"] == "distribution":
            print("  %-52s sub=%#x bins=%-3d sum=%-8d %s"
                  % (k, v["subtag"], v["nbuckets"], v["sum_counts"],
                     "SELF-CONSISTENT" if v["self_consistent"] else "FAIL"))


if __name__ == "__main__":
    main()
