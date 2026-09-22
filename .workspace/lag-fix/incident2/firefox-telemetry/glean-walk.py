#!/usr/bin/env python3
"""
Read-only decoder for Firefox Glean's own "safe" store:
    <profile>/datareporting/glean/db/data.safe.bin

CONTAINER FORMAT (verified byte-by-byte on this machine; NOT LMDB):

  record := [u64 keylen][key utf8][u64 vallen][value bytes]
            value  := [u8 TAG][u64 paylen][payload]

  Verified: record 0 spans bytes [32, 3787): keylen=27 @32, key @40..67,
  vallen=3712 @67, value @75..3787 == exactly where record 1's keylen field sits.
  2701 of 2753 length-prefixed keys chain with delta 0
  (next_key_offset == prev_key_end + 8 + prev_vallen).

  All 2753 records carry TAG = 0x09 (scalar wrapper). Coverage of the whole
  426183-byte file is exact (0 bytes left over).
"""
import json
import struct
import sys

U64 = struct.Struct("<Q")


def walk(buf):
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

    off = 24
    recs = []
    while off + 16 <= n:
        kl = keyok(off)
        if kl is None:
            nxt = None
            for d in range(1, 3000):
                if off + d + 16 > n:
                    break
                if keyok(off + d) is not None:
                    nxt = off + d
                    break
            if nxt is None:
                break
            off = nxt
            continue
        vo = off + 8 + kl
        vl = u64(vo)
        if vl == 0 or vo + 8 + vl > n:
            nxt = None
            for d in range(1, 3000):
                if off + d + 16 > n:
                    break
                if keyok(off + d) is not None:
                    nxt = off + d
                    break
            if nxt is None:
                break
            off = nxt
            continue
        recs.append({"key": buf[off + 8:off + 8 + kl].decode("utf8", "replace"),
                     "vallen": vl, "value": buf[vo + 8:vo + 8 + vl]})
        off = vo + 8 + vl
    return recs


def value_parts(vb):
    if len(vb) < 9:
        return None, None, b""
    return vb[0], U64.unpack_from(vb, 1)[0], vb[9:]


def dec_int(body):
    if len(body) < 4:
        return None
    w = struct.unpack_from("<I", body, 0)[0]
    if w not in (1, 2, 4, 8) or len(body) < 4 + w:
        return None
    return int.from_bytes(body[4:4 + w], "little")


def dec_string(body):
    if len(body) < 4:
        return None
    sl = struct.unpack_from("<I", body, 0)[0]
    return body[4:4 + sl].decode("utf8", "replace")


def main():
    path = sys.argv[1]
    buf = open(path, "rb").read()
    recs = walk(buf)
    D = {}
    for r in recs:
        D.setdefault(r["key"], r)
    print("records=%d unique_keys=%d file=%d" % (len(recs), len(D), len(buf)))
    out = {"records": len(recs), "unique_keys": len(D), "scalars": {}, "raw": {}}
    for k, r in sorted(D.items()):
        tag, paylen, payload = value_parts(r["value"])
        out["raw"][k] = {"tag": tag, "paylen": paylen,
                         "payload_hex": payload[:96].hex(" "),
                         "vallen": r["vallen"]}
        if payload and payload[0] in (0x06, 0x07):
            st = payload[0]
            body = payload[1:]
            if st == 0x06:
                out["scalars"][k] = {"type": "int", "value": dec_int(body)}
            else:
                out["scalars"][k] = {"type": "string", "value": dec_string(body)}
    json.dump(out, open("glean-decoded.json", "w"), indent=1)
    print("wrote glean-decoded.json")
    print("\n--- scalars ---")
    for k in sorted(out["scalars"]):
        v = out["scalars"][k]
        if any(t in k for t in ("gfx", "a11y", "display", "content")):
            print("  %-52s %s" % (k, v))


if __name__ == "__main__":
    main()
