#!/usr/bin/env python3
"""
gleanstore.py -- read-only decoder for Firefox Glean's own "safe" store
(<profile>/datareporting/glean/db/data.safe.bin).  NOT LMDB.

Container format (verified byte-by-byte; see audit.md):
    record := [u64 keylen][key utf8][u64 vallen][value]
    value  := [u8 TAG][u64 paylen][payload]

payload sub-tags observed:
    0x01  counter / scalar count        -> [u32 value]  (8 bytes total)
    0x02  array of numbers              -> [u32 count][count * u64]
    0x03  array of "phase weight" pairs -> [u32 count][count * (u64 a, u64 b)]
    0x06  single integer                -> [u32 width][width bytes LE]
    0x07  string                        -> [u32 len][bytes]
    0x0B  timing/histogram distribution
    0x11  JSON blob                     -> [u32 len][json]
    0x00  raw / empty
"""
import json
import struct

U64 = struct.Struct("<Q")
U32 = struct.Struct("<I")


def load(path):
    buf = open(path, "rb").read()
    u64 = lambda o: U64.unpack_from(buf, o)[0]
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

    off = 24
    out = {}
    order = []
    resyncs = 0
    while off + 16 <= n:
        kl = keyok(off)
        if kl is None:
            nxt = resync(off)
            if nxt is None:
                break
            off = nxt
            resyncs += 1
            continue
        vo = off + 8 + kl
        vl = u64(vo)
        if vl == 0 or vo + 8 + vl > n:
            nxt = resync(off)
            if nxt is None:
                break
            off = nxt
            resyncs += 1
            continue
        key = buf[off + 8:off + 8 + kl].decode("utf8", "replace")
        vb = buf[vo + 8:vo + 8 + vl]
        out.setdefault(key, vb)
        order.append(key)
        off = vo + 8 + vl
    return out, order, resyncs, n


def payload(vb):
    if len(vb) < 9:
        return b""
    return vb[9:9 + U64.unpack_from(vb, 1)[0]]


def dec_counter(p):
    return U32.unpack_from(p, 0)[0] if len(p) >= 4 else None


def dec_int(p):
    if len(p) < 4:
        return None
    w = U32.unpack_from(p, 0)[0]
    if w not in (1, 2, 4, 8) or len(p) < 4 + w:
        return None
    return int.from_bytes(p[4:4 + w], "little")


def dec_string(p):
    if len(p) < 4:
        return None
    sl = U32.unpack_from(p, 0)[0]
    return p[4:4 + sl].decode("utf8", "replace")


def dec_array_u64(p):
    """[u32 count][count u64] -> list"""
    if len(p) < 4:
        return None
    c = U32.unpack_from(p, 0)[0]
    vals = []
    o = 4
    for _ in range(c):
        if o + 8 > len(p):
            break
        vals.append(U64.unpack_from(p, o)[0])
        o += 8
    return vals


def dec_json(p):
    if len(p) < 4:
        return None
    sl = U32.unpack_from(p, 0)[0]
    return p[4:4 + sl].decode("utf8", "replace")


def decode(vb):
    if len(vb) < 9:
        return {"kind": "short"}
    payload_blob = payload(vb)
    if not payload_blob:
        return {"kind": "empty", "tag": vb[0]}
    st = payload_blob[0]
    body = payload_blob[1:]
    if st == 0x01:
        return {"kind": "counter", "subtag": 0x01, "value": dec_counter(body),
                "raw": body.hex(" ")}
    if st == 0x02:
        return {"kind": "array_u64", "subtag": 0x02, "values": dec_array_u64(body)}
    if st == 0x03:
        return {"kind": "pairs_u64", "subtag": 0x03,
                "values": dec_array_u64(body)}
    if st == 0x06:
        return {"kind": "int", "subtag": 0x06, "value": dec_int(body)}
    if st == 0x07:
        return {"kind": "string", "subtag": 0x07, "value": dec_string(body)}
    if st == 0x0B:
        return {"kind": "dist", "subtag": 0x0B, "raw": body.hex(" ")}
    if st == 0x11:
        return {"kind": "json", "subtag": 0x11, "value": dec_json(body)}
    return {"kind": "sub_%#x" % st, "raw": body[:64].hex(" ")}
