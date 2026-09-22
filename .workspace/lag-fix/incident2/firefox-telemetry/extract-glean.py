#!/usr/bin/env python3
"""Read-only extractor for Firefox Glean's own storage (data.safe.bin).

Container layout established by byte-level verification on this machine
(Firefox 155.0.1, glean-core "safe" serialization, NOT LMDB):

    record := [u64 keylen][key utf8][u64 vallen][value_block][0..7 zero pad]
    value_block := [u8 TAG][u64 paylen][payload]

Verified on: metrics#a11y.backplate, metrics#gfx.display.count,
metrics#gfx.status.compositor, metrics#gfx.display.primary_width.

TAG values seen so far:
    0x09 = scalar wrapper (payload begins with a sub-tag: 0x06 int, 0x07 string,
           0x03 keyed/dict, 0x0B histogram-ish)
    0x00 = raw JSON blob (e.g. the addons list)
"""
import json
import struct
import sys

U64 = struct.Struct("<Q")
U32 = struct.Struct("<I")


def u64(b, o):
    return U64.unpack_from(b, o)[0]


def u32(b, o):
    return U32.unpack_from(b, o)[0]


def parse_file(path):
    buf = open(path, "rb").read()
    n = len(buf)
    header = {"magic_word0": u64(buf, 0), "declared_count": u64(buf, 8)}
    recs = []
    # The record area does not always start at 16 and inter-record spacing is not
    # uniform across record kinds; therefore we anchor on keys that are preceded by
    # an exact u64 keylen and followed by a plausible vallen, then read the value.
    off = 16
    problems = []
    while off + 16 <= n:
        start = off
        kl = u64(buf, off)
        if not (1 <= kl <= 400):
            problems.append({"offset": start, "why": "keylen=%d" % kl})
            break
        if off + 8 + kl + 8 > n:
            problems.append({"offset": start, "why": "truncated"})
            break
        key = buf[off + 8:off + 8 + kl]
        vo = off + 8 + kl
        vallen = u64(buf, vo)
        if vallen < 9 or vo + 8 + vallen > n:
            problems.append({"offset": start, "why": "vallen=%d key=%r"
                             % (vallen, key[:60])})
            break
        vb = buf[vo + 8:vo + 8 + vallen]
        tag = vb[0]
        paylen = u64(vb, 1)
        payload = vb[9:9 + paylen]
        recs.append({"offset": start, "keylen": kl,
                     "key": key.decode("utf8", "replace"),
                     "vallen": vallen, "tag": tag, "paylen": paylen,
                     "payload": payload, "vb_extra": len(vb) - 9 - paylen})
        off = vo + 8 + vallen
        pad = (-off) % 8
        if pad and buf[off:off + pad] == b"\x00" * pad:
            off += pad
    return header, recs, problems


def dec_int(p):
    if len(p) < 4:
        return None
    w = u32(p, 0)
    if w not in (1, 2, 4, 8) or len(p) < 4 + w:
        return None
    return int.from_bytes(p[4:4 + w], "little")


def dec_string(p):
    if len(p) < 4:
        return None
    sl = u32(p, 0)
    return p[4:4 + sl].decode("utf8", "replace")


def main():
    path = sys.argv[1]
    header, recs, problems = parse_file(path)
    print(json.dumps(header))
    print("records parsed:", len(recs))
    if problems:
        print("problems:", json.dumps(problems, indent=2))
    from collections import Counter
    print("tag hist:", dict(sorted(Counter(r["tag"] for r in recs).items())))
    for r in recs:
        if not r["key"].startswith("metrics#"):
            continue
        if not (r["key"].startswith("metrics#gfx") or r["key"].startswith("metrics#a11y")):
            continue
        p = r["payload"]
        inner = p[0] if p else None
        note = ""
        if inner == 0x06:
            note = "int=%s" % dec_int(p[1:])
        elif inner == 0x07:
            note = "str=%r" % dec_string(p[1:])
        print("%-50s tag=%#04x paylen=%-6d inner=%s %s"
              % (r["key"], r["tag"], r["paylen"],
                 ("%#04x" % inner) if inner is not None else "-", note))


if __name__ == "__main__":
    main()
