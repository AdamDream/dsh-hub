#!/usr/bin/env python3
"""Verify distribution layout in Firefox 155 Glean safe store (data.safe.bin).
Layout (established from the bytes, consistent for every metric checked):
  subtag 0x01 counter : [u32 value]
  subtag 0x02/0x03/0x0b distribution body:
      offset 0 : u8/u32 header
      offset 5 : u32 nentries
      then nentries * (u64 bucket_lower_bound, u64 count)
      then a trailing block (per-metric constants + f64)
Read-only.
"""
import struct, sys
U64=struct.Struct("<Q"); U32=struct.Struct("<I"); F64=struct.Struct("<d")
KEYS=["metrics#gfx.checkerboard.severity","metrics#gfx.checkerboard.duration",
 "metrics#gfx.checkerboard.potential_duration","metrics#gfx.checkerboard.peak_pixel_count",
 "metrics#gfx.composite_time","metrics#gfx.composite_frame_roundtrip_time",
 "metrics#gfx.scroll_present_latency","metrics#gfx.content.frame_time.from_vsync",
 "metrics#gfx.content.frame_time.from_paint","metrics#gfx.content.frame_time.with_svg",
 "metrics#gfx.content.frame_time.without_resource_upload","metrics#gfx.content.paint_time",
 "metrics#gfx.content.full_paint_time","metrics#gfx.skipped_composites",
 "metrics#a11y.tree_update_timing"]
buf=open(sys.argv[1] if len(sys.argv)>1 else "data.safe.snapshot.bin","rb").read()
def body(k):
    kb=k.encode(); o=buf.find(kb); kl=U64.unpack_from(buf,o-8)[0]
    vo=o+kl; vl=U64.unpack_from(buf,vo)[0]; vb=buf[vo+8:vo+8+vl]
    pl=U64.unpack_from(vb,1)[0]; p=vb[9:9+pl]
    return o-8, p[0], p[1:]
for k in KEYS:
    ko,st,b=body(k)
    print("="*92); print("%s\n  key_offset=%d subtag=%#x body_len=%d"%(k,ko,st,len(b)))
    if st==0x01:
        print("  COUNTER: u32 value = %d" % U32.unpack_from(b,0)[0]); continue
    n=U32.unpack_from(b,4)[0]
    ent=[(U64.unpack_from(b,5+16*i)[0], U64.unpack_from(b,5+16*i+8)[0]) for i in range(n)]
    used=5+16*n; trail=b[used:]
    ok = all(lo==(1<<(i//8)) for i,(lo,c) in enumerate(ent)) if st==0x0b else None
    print("  nentries=%d consumed=%d trailing=%d bytes"%(n,used,len(trail)))
    if st==0x0b:
        print("  TIMING: bucket lower bounds == 2^floor(i/8) NANOSECONDS : %s"%("CONFIRMED" if ok else "NO"))
    if len(trail)>=8:
        d=F64.unpack_from(trail,len(trail)-8)[0]
        print("  trailing: %s | last8 as f64 = %r | as u64 = %d"%(trail[:-8].hex(' '), d, U64.unpack_from(trail,len(trail)-8)[0]))
    if len(trail)>=8:
        print("  trailing u32 pair (first 8 bytes): [%d][%d]"%(U32.unpack_from(trail,0)[0],U32.unpack_from(trail,4)[0]))
    print("  non-zero buckets (lower_bound_ns -> count):")
    for i,(lo,c) in enumerate(ent):
        if c: print("    i=%-3d lower_bound=%-22d  %s   count=%d"%(i,lo,("2^%d ns"%(i//8)).ljust(8),c))
    print("  TOTAL COUNT = %d" % sum(c for _,c in ent))
