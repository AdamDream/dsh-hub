#!/usr/bin/env python3
"""Read-only decoder: Firefox 155 Glean safe-store distribution metrics.

Verified layout:
  value_block := [u8 tag=0x09][u64 paylen][payload]
  payload     := [u8 subtag][body]
  subtag 0x01 counter : body = [u32 value]                      (8-byte counter)
  subtag 0x02/0x03/0x0b distribution:
      body = [8-byte header][ n * 16-byte entry ][ 8-byte footer ]
      entry  = u64 w0, u64 w1
               bucket_min = w0 & 0x0000FFFFFFFFFFFF   (48-bit little-endian)
               count      = (w1 >> 48)                (top 16 bits)
      n derived from len(body) = 8 + 16n + 8
"""
import struct, sys
U64 = struct.Struct("<Q"); U32 = struct.Struct("<I")
MASK = 0x0000FFFFFFFFFFFF
buf = open(sys.argv[1] if len(sys.argv) > 1 else "data.safe.snapshot.bin","rb").read()
def body(key):
    kb = key.encode(); o = buf.find(kb)
    if o < 0: return None
    kl = U64.unpack_from(buf, o-8)[0]
    vo = o + kl; vl = U64.unpack_from(buf, vo)[0]
    vb = buf[vo+8:vo+8+vl]
    pl = U64.unpack_from(vb, 1)[0]; p = vb[9:9+pl]
    return p[0], p[1:]
def decode(key):
    st, b = body(key)
    if st == 0x01:
        return {"kind":"counter","value":U32.unpack_from(b,0)[0],"body_len":len(b)}
    n = (len(b) - 16) // 16
    ent = [(U64.unpack_from(b,8+16*i)[0] & MASK, U64.unpack_from(b,8+16*i+8)[0] >> 48) for i in range(n)]
    foot = U64.unpack_from(b, 8+16*n)[0]
    return {"kind":"distribution","n":n,"body_len":len(b),"footer_u64":foot,
            "footer_count":foot>>48,"footer_rest":foot&MASK,
            "total_count":sum(c for _,c in ent),
            "nonempty":sum(1 for _,c in ent if c),
            "entries":ent}
KEYS=["metrics#gfx.checkerboard.severity","metrics#gfx.checkerboard.duration",
 "metrics#gfx.checkerboard.potential_duration","metrics#gfx.checkerboard.peak_pixel_count",
 "metrics#gfx.composite_time","metrics#gfx.composite_frame_roundtrip_time",
 "metrics#gfx.scroll_present_latency","metrics#gfx.content.frame_time.from_paint",
 "metrics#gfx.content.frame_time.from_vsync","metrics#gfx.content.frame_time.with_svg",
 "metrics#gfx.content.frame_time.without_resource_upload","metrics#gfx.content.paint_time",
 "metrics#gfx.content.full_paint_time","metrics#gfx.skipped_composites",
 "metrics#a11y.tree_update_timing"]
for k in KEYS:
    d = decode(k)
    print("="*88); print(k)
    if d["kind"]=="counter":
        print("  COUNTER value = %d  (body_len=%d)"%(d["value"],d["body_len"])); continue
    print("  n=%d nonempty=%d sum(counts)=%d footer_count=%d footer_rest=%d"%(
        d["n"],d["nonempty"],d["total_count"],d["footer_count"],d["footer_rest"]))
    tim = all(m == (1 << (i//8)) for i,(m,c) in enumerate(d["entries"]))
    print("  all bucket_min == 2^floor(i/8) NANOSECONDS : %s" % ("YES" if tim else "no"))
    for i,(m,c) in enumerate(d["entries"]):
        if c: print("     bucket_min=%d ns (%.4f ms)  count=%d" % (m, m/1e6, c))
