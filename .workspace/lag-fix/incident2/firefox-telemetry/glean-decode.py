#!/usr/bin/env python3
"""
Read-only decoder for Firefox Glean's own "safe" storage:
    <profile>/datareporting/glean/db/data.safe.bin

Discovered container layout (Firefox 155.0.1 / glean-core, NOT LMDB):

    file   := [u64 header0][u64 record_count]  then record_count records
    record := [u64 keylen][key utf8][u64 vallen][value_block] [0..7 pad] 
    value_block := [u8 tag][u64 paylen][payload]        # len(value_block) == 9+paylen
    padding pads to an 8-byte boundary before the next record.

Header observed: header0 = 3 (format version), record_count = 769 (== actual count).

This script NEVER writes into the profile: it only reads a copy.
"""
import json
import os
import struct
import sys
from collections import OrderedDict

U64 = struct.Struct("<Q")


class Rec:
    __slots__ = ("offset", "keylen", "key", "vallen", "tag", "paylen", "payload", "pad")

    def __repr__(self):
        return "Rec(%r tag=%d paylen=%d)" % (self.key, self.tag, self.paylen)


def read_records(buf):
    """Walk the container. Returns (records, diagnostics)."""
    n = len(buf)
    header0 = U64.unpack_from(buf, 0)[0]
    count = U64.unpack_from(buf, 8)[0]
    off = 16
    recs = []
    diag = {"header0": header0, "count_field": count, "problems": []}
    while off + 8 <= n:
        start = off
        keylen = U64.unpack_from(buf, off)[0]
        off += 8
        if keylen == 0 or off + keylen > n:
            diag["problems"].append({"offset": start, "why": "bad keylen=%d" % keylen,
                                     "bytes": buf[start:start + 32].hex(" ")})
            break
        key = buf[off:off + keylen]
        off += keylen
        if off + 8 > n:
            diag["problems"].append({"offset": start, "why": "truncated vallen"})
            break
        vallen = U64.unpack_from(buf, off)[0]
        off += 8
        if off + vallen > n:
            diag["problems"].append({"offset": start, "why": "vallen=%d overruns" % vallen,
                                     "key": key.decode("utf8", "replace")})
            break
        vb = buf[off:off + vallen]
        off += vallen
        r = Rec()
        r.offset = start
        r.keylen = keylen
        r.key = key
        r.vallen = vallen
        if vallen >= 9:
            r.tag = vb[0]
            r.paylen = U64.unpack_from(vb, 1)[0]
            r.payload = vb[9:9 + r.paylen]
            # trailing bytes inside value_block beyond 9+paylen
            r.pad = vallen - 9 - r.paylen
        else:
            r.tag = None
            r.paylen = None
            r.payload = b""
            r.pad = None
        recs.append(r)
        # inter-record padding: align next keylen field to 8 bytes
        pad = (-off) % 8
        if pad and off + pad <= n and buf[off:off + pad] == b"\x00" * pad:
            off += pad
    diag["parsed"] = len(recs)
    diag["end_offset"] = off
    diag["file_size"] = n
    diag["leftover"] = n - off
    return recs, diag


def dec_string(p):
    """tag 0x07 payload: [u32 strlen][bytes]"""
    if len(p) < 4:
        return None
    slen = struct.unpack_from("<I", p, 0)[0]
    return p[4:4 + slen].decode("utf8", "replace")


def dec_int(p):
    """tag 0x06 payload: [u32 width][value] (little endian, width in {1,2,4,8})"""
    if len(p) < 4:
        return None
    width = struct.unpack_from("<I", p, 0)[0]
    raw = p[4:4 + width]
    if width not in (1, 2, 4, 8) or len(raw) != width:
        return None
    return int.from_bytes(raw, "little")


def dec_counter(p):
    """keyed-counter payload: [u32 n][ n * ( [u32 klen][key][u32 vlen?][value] ) ]"""
    if len(p) < 4:
        return None
    n = struct.unpack_from("<I", p, 0)[0]
    o = 4
    out = OrderedDict()
    for _ in range(n):
        if o + 4 > len(p):
            break
        klen = struct.unpack_from("<I", p, o)[0]
        o += 4
        k = p[o:o + klen]
        o += klen
        vlen = struct.unpack_from("<I", p, o)[0]
        o += 4
        out[k.decode("utf8", "replace")] = int.from_bytes(p[o:o + vlen], "little")
        o += vlen
    return out


def decode_record(r):
    """Best-effort typed value for one record."""
    p = r.payload
    t = r.tag
    if t == 0x00:
        return {"type": "json_or_nested", "hex_head": p[:64].hex(" ")}, None
    if t == 0x06:
        return {"type": "int", "value": dec_int(p)}, None
    if t == 0x07:
        return {"type": "string", "value": dec_string(p)}, None
    if t == 0x09:
        if not p:
            return {"type": "empty"}, None
        inner = p[0]
        if inner == 0x06:
            return {"type": "int", "value": dec_int(p[1:])}, None
        if inner == 0x07:
            return {"type": "string", "value": dec_string(p[1:])}, None
        if inner == 0x03:
            return ({"type": "keyed", "value": dec_counter(p[1:])},
                    "inner=0x03 counted - see buckets")
        if inner == 0x0B:
            return ({"type": "distribution_like_tag11", "raw": p[1:].hex(" ")},
                    "tag 0x0B")
        return {"type": "marker_%#x" % inner, "raw": p[1:64].hex(" ")}, None
    if t == 0x08:
        return {"type": "boolean", "value": bool(p[0]) if p else None}, None
    return {"type": "tag_%d" % (t if t is not None else -1), "raw": p[:64].hex(" ")}, None


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "data.safe.bin.copy"
    buf = open(path, "rb").read()
    recs, diag = read_records(buf)
    print(json.dumps({k: v for k, v in diag.items() if k != "problems"}, indent=2))
    if diag["problems"]:
        print("PROBLEMS:", json.dumps(diag["problems"], indent=2))
    from collections import Counter
    c = Counter()
    for r in recs:
        c[r.tag] += 1
    print("tag histogram:", dict(sorted(c.items(), key=lambda kv: (kv[0] is None, kv[0]))))
    for r in recs:
        if r.key.startswith((b"metrics#gfx", b"metrics#a11y", b"metrics#display")):
            v, note = decode_record(r)
            print("%-52s tag=%-3s vallen=%-5s %s%s" % (
                r.key.decode(), r.tag, r.vallen, json.dumps(v)[:160],
                ("  [" + note + "]") if note else ""))


if __name__ == "__main__":
    main()
