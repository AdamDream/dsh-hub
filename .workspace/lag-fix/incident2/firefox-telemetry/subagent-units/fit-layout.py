#!/usr/bin/env python3
"""Fit the on-disk Histogram layout emitted by glean-core's storage
(serde: values HashMap<u64,u64>, count u64, sum u64, bucketing{...}).
Search small header offsets so that, for every metric, the bytes right after
the (min,count) entry block decode as plausible count/sum."""
import struct, sys
U64=struct.Struct("<Q")
buf=open(sys.argv[1] if len(sys.argv)>1 else "data.safe.snapshot.bin","rb").read()
def body(k):
    kb=k.encode(); o=buf.find(kb); kl=U64.unpack_from(buf,o-8)[0]
    vo=o+kl; vl=U64.unpack_from(buf,vo)[0]; vb=buf[vo+8:vo+8+vl]
    pl=U64.unpack_from(vb,1)[0]; p=vb[9:9+pl]
    return p[0], p[1:]
TIMING=["metrics#gfx.checkerboard.duration","metrics#gfx.composite_time",
 "metrics#gfx.scroll_present_latency","metrics#gfx.content.paint_time",
 "metrics#gfx.content.full_paint_time","metrics#gfx.composite_frame_roundtrip_time",
 "metrics#gfx.checkerboard.potential_duration","metrics#a11y.tree_update_timing",
 "metrics#gfx.content.frame_time.from_vsync"]
CUSTOM=["metrics#gfx.checkerboard.severity","metrics#gfx.checkerboard.peak_pixel_count",
 "metrics#gfx.content.frame_time.from_paint","metrics#gfx.content.frame_time.with_svg",
 "metrics#gfx.content.frame_time.without_resource_upload"]
def try_fit(KEYS, expect_func):
    print("### trying %d metrics" % len(KEYS))
    for start in range(0,16):
      for tailmode in ("n","n+8"):
        ok=True; res=[]
        for k in KEYS:
            st,b=body(k)
            if len(b) < start+16: ok=False;break
            n=(len(b)-start)//16
            lo=[U64.unpack_from(b,start+16*i)[0] for i in range(n)]
            cnt=[U64.unpack_from(b,start+16*i+8)[0] for i in range(n)]
            if not expect_func(lo): ok=False;break
            tot=sum(cnt)
            rem=len(b)-(start+16*n)
            res.append((k,n,tot,rem,b[start+16*n:]))
        if ok and res:
            import collections
            rems=collections.Counter(r[3] for r in res)
            print("  start=%d remainders=%s" % (start, dict(rems)))
            for k,n,tot,rem,trail in res[:3]:
                print("     %s n=%d sumcounts=%d rem=%d trail=%s" % (k,n,tot,rem,trail.hex(' ')))
            return start
    return None
t=try_fit(TIMING, lambda lo: all(lo[i]==(1<<(i//8)) for i in range(len(lo))))
print("TIMING start =",t)
c=try_fit(CUSTOM, lambda lo: all(lo[i]<=lo[i+1] for i in range(len(lo)-1)) and lo[0] in (0,1))
print("CUSTOM start =",c)
