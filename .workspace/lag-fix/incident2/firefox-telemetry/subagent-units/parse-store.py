#!/usr/bin/env python3
"""Precise read-only parser for Firefox 155 Glean safe store -> numeric decoding.

Record layout (verified on this file):
    record := [u64 keylen][key utf8][u64 vallen][value_block]
    value_block := [u8 tag][u64 paylen][payload]     # len == 9 + paylen
    payload := [u8 subtag][subtag-body]
subtags: 0x01 u32 counter | 0x02 custom_distribution | 0x03 linear-dist variant
         0x04 ISO date | 0x06 int | 0x07 string | 0x0b memory/timing distribution
"""
import struct, sys, json

U64 = struct.Struct("<Q"); U32 = struct.Struct("<I")

class Store:
    def __init__(self, path):
        self.buf = open(path, "rb").read()
        self.n = len(self.buf)
    def u64(self, o): return U64.unpack_from(self.buf, o)[0]
    def rec(self, key):
        kb = key.encode(); o = self.buf.find(kb)
        if o < 0: raise KeyError(key)
        keyoff = o - 8
        keylen = self.u64(keyoff)
        assert keylen == len(kb), (keylen, len(kb))
        vo = keyoff + 8 + keylen
        vallen = self.u64(vo)
        vb = self.buf[vo+8: vo+8+vallen]
        tag = vb[0]; paylen = self.u64(1); payload = vb[9:9+paylen]
        return {"keyoff": keyoff, "keylen": keylen, "vallen": vallen,
                "tag": tag, "paylen": paylen, "subtag": payload[0] if payload else None,
                "body": payload[1:] if payload else b"", "payload": payload}
    def show(self, key):
        r = self.rec(key); b = r["body"]; st = r["subtag"]
        out = {"key": key, "key_offset": r["keyoff"], "vallen": r["vallen"],
               "tag": hex(r["tag"]), "subtag": hex(st), "body_len": len(b)}
        if st == 0x01:
            out["counter"] = U32.unpack_from(b, 0)[0]
        elif st in (0x02, 0x03):
            # layout: [u32 nbuckets?] then interleaved [u64 count][u64 value]
            n = U32.unpack_from(b, 0)[0]
            out["first_u32"] = n
            pairs = []; o = 4
            while o + 16 <= len(b):
                pairs.append((self.u64(o) if False else U64.unpack_from(b, o)[0],
                              U64.unpack_from(b, o+8)[0])); o += 16
            out["npairs"] = len(pairs); out["leftover"] = b[o:].hex(" ")
            out["pairs"] = pairs
        elif st == 0x04:
            L = U32.unpack_from(b, 0)[0]; out["date"] = b[4:4+L].decode()
            out["trailing"] = list(struct.unpack_from("<Q", b, 4+L)) if len(b) >= 4+L+8 else None
        elif st == 0x06:
            w = U32.unpack_from(b, 0)[0]; out["int"] = int.from_bytes(b[4:4+w], "little")
        elif st == 0x07:
            L = U32.unpack_from(b, 0)[0]; out["string"] = b[4:4+L].decode("utf8", "replace")
        elif st == 0x0b:
            n = U32.unpack_from(b, 0)[0]
            out["first_u32"] = n
            pairs = []; o = 4
            while o + 16 <= len(b):
                pairs.append((U64.unpack_from(b, o)[0], U64.unpack_from(b, o+8)[0])); o += 16
            out["npairs"] = len(pairs); out["leftover"] = b[o:].hex(" ")
            out["pairs"] = pairs
        else:
            out["raw"] = b[:64].hex(" ")
        return out

if __name__ == "__main__":
    s = Store(sys.argv[1] if len(sys.argv) > 1 else "data.safe.snapshot.bin")
    keys = sys.argv[2:]
    for k in keys:
        print(json.dumps(s.show(k), indent=2))
