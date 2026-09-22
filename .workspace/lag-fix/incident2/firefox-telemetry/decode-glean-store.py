#!/usr/bin/env python3
"""
Read-only decoder for Firefox Glean's own "safe" store:
    <profile>/datareporting/glean/db/data.safe.bin

CONTAINER FORMAT (established by byte-level verification on this machine,
Firefox 155.0.1 snap, glean-core; this is NOT LMDB):

    file    := [u64 fmt_version=3][u64 record_count][record]*
    record  := [u64 keylen][key utf8 : keylen bytes][u64 vallen][value : vallen bytes]
    value   := [u8 TAG][u64 paylen][payload : paylen bytes]

No inter-record padding. Evidence: for 2701 of 2753 keys the relation
    key_start = prev_key_start + 8 + prev_keylen + 8 + prev_vallen
holds exactly (delta 0), and keylen fields sit at key_start-8 for 2541/2929
inline key occurrences.

TAG (observed):
    0x09  scalar wrapper; payload[0] is a sub-tag:
            0x02 array/count, 0x03 keyed dict, 0x06 int, 0x07 string,
            0x0B histogram-ish (distribution)
    0x00  raw JSON blob
"""
import json
import struct
import sys

U64 = struct.Struct("<Q")


def u64(b, o):
    return U64.unpack_from(b, o)[0]


def read_records(buf, verbose=False):
    n = len(buf)
    diag = {"fmt_version": u64(buf, 0), "declared_count": u64(buf, 8), "problems": []}
    off = 16
    recs = []
    while off + 16 <= n:
        # resync: keylen must be plausible AND followed by a printable key
        kl = u64(buf, off)
        if kl == 0 or off + 16 + kl > n or not _plausible_key(buf, off + 8, kl):
            # try to resync by scanning forward
            nxt = _resync(buf, off)
            if nxt is None:
                diag["problems"].append({"offset": off, "why": "resync failed",
                                         "u64": u64(buf, off)})
                break
            diag["problems"].append({"offset": off, "why": "resync +%d" % (nxt - off)})
            off = nxt
            continue
        key = buf[off + 8:off + 8 + kl].decode("utf8", "replace")
        vo = off + 8 + kl
        vl = u64(buf, vo)
        if vl == 0 or vo + 8 + vl > n:
            nxt = _resync(buf, off + 1)
            if nxt is None:
                diag["problems"].append({"offset": off, "why": "vallen=%d key=%r" % (vl, key),
                                         "declared": diag.pop("declared_count", None)})
                break
            off = nxt
            continue
        vb = buf[vo + 8:vo + 8 + vl]
        recs.append({"offset": off, "keylen": kl, "key": key, "vallen": vl,
                     "tag": vb[0], "paylen": u64(vb, 1) if vl >= 9 else None,
                     "valuebytes": vb})
        off = vo + 8 + vl
    diag["parsed"] = len(recs)
    diag["end_offset"] = off
    diag["file_size"] = n
    diag["leftover"] = n - off
    return recs, diag


def _plausible_key(buf, o, kl):
    if kl < 2 or kl > 300 or o + kl > len(buf):
        return False
    seg = buf[o:o + kl]
    if b"#" not in seg:
        return False
    for c in seg:
        if c < 0x20 or c >= 0x7F:
            return False
    return True


def _resync(buf, off):
    """Find the next offset o>off where u64(o)==len(key) and key looks valid."""
    n = len(buf)
    for o in range(off, min(n - 16, off + 4096)):
        kl = u64(buf, o)
        if 2 <= kl <= 300 and _plausible_key(buf, o + 8, kl):
            return o
    return None


# ---------------- value decoding ----------------

def sub_int(p):
    """[u32 width][width bytes LE]"""
    if len(p) < 4:
        return None
    w = struct.unpack_from("<I", p, 0)[0]
    if w not in (1, 2, 4, 8) or len(p) < 4 + w:
        return None
    return int.from_bytes(p[4:4 + w], "little")


def sub_string(p):
    if len(p) < 4:
        return None
    sl = struct.unpack_from("<I", p, 0)[0]
    if len(p) < 4 + sl:
        return None
    return p[4:4 + sl].decode("utf8", "replace")


def sub_json(p):
    if len(p) < 4:
        return None
    sl = struct.unpack_from("<I", p, 0)[0]
    return p[4:4 + sl].decode("utf8", "replace")


def decode_value(vb):
    """Return (kind, value, extra)."""
    if len(vb) < 9:
        return "short", None, vb.hex(" ")
    tag = vb[0]
    paylen = u64(vb, 1)
    payload = vb[9:9 + paylen]
    extra = len(vb) - 9 - paylen
    if tag == 0x00:
        return "json", sub_json(payload), {"extra": extra}
    if tag != 0x09:
        return "tag_%#x" % tag, None, {"payload_hex": payload[:48].hex(" "), "extra": extra}
    if not payload:
        return "empty", None, {"extra": extra}
    st = payload[0]
    body = payload[1:]
    if st == 0x06:
        return "int", sub_int(body), {"extra": extra}
    if st == 0x07:
        return "string", sub_string(body), {"extra": extra}
    if st == 0x02:
        return "list", sub_json(body), {"extra": extra}
    if st == 0x03:
        return "keyed", decode_keyed(body), {"extra": extra}
    if st == 0x0B:
        return "dist11", None, {"payload_hex": body.hex(" "), "extra": extra}
    return "sub_%#x" % st, None, {"payload_hex": body[:64].hex(" "), "extra": extra}


def decode_keyed(p):
    """Best-effort keyed dict: [u32 n] then repeated entries."""
    if len(p) < 4:
        return None
    n = struct.unpack_from("<I", p, 0)[0]
    o = 4
    out = {}
    for _ in range(n):
        if o + 4 > len(p):
            break
        klen = struct.unpack_from("<I", p, o)[0]
        o += 4
        if o + klen > len(p):
            break
        k = p[o:o + klen].decode("utf8", "replace")
        o += klen
        out.setdefault(k, None)
        if o + 8 <= len(p):
            v = u64(p, o)
            o += 8
            out[k] = v
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "data.safe.bin.copy"
    buf = open(path, "rb").read()
    recs, diag = read_records(buf)
    print(json.dumps(diag, indent=2)[:2000])
    from collections import Counter
    print("tag hist:", dict(sorted(Counter(r["tag"] for r in recs).items())))
    for r in recs:
        if not r["key"].startswith("metrics#"):
            continue
        kind, val, extra = decode_value(r["valuebytes"])
        if r["key"].startswith(("metrics#gfx", "metrics#a11y")):
            print("%-50s tag=%#04x kind=%-8s %s" % (r["key"], r["tag"], kind,
                                                    json.dumps(val)[:150]))


if __name__ == "__main__":
    main()
