#!/usr/bin/env python3
"""Read-only: pull per-ping legacy Telemetry gfx histograms out of archived main pings.
These are the telemetry_mirror targets of the Glean gfx.* metrics, and unlike the Glean
safe store they ARE per-ping (reset per ping), so they can be split around a GPU switch."""
import json, lz4.block, os, glob, datetime, csv
PROF = os.path.expanduser("~/snap/firefox/common/.mozilla/firefox/g05ps3km.default")
MIRRORS = ["CHECKERBOARD_DURATION","CHECKERBOARD_PEAK","CHECKERBOARD_POTENTIAL_DURATION",
 "CHECKERBOARD_SEVERITY","COMPOSITE_TIME","COMPOSITE_FRAME_ROUNDTRIP_TIME",
 "SCROLL_PRESENT_LATENCY","CONTENT_FRAME_TIME","CONTENT_FRAME_TIME_VSYNC",
 "CONTENT_FRAME_TIME_WITH_SVG","CONTENT_FRAME_TIME_WITHOUT_RESOURCE_UPLOAD",
 "CONTENT_PAINT_TIME","CONTENT_FULL_PAINT_TIME","A11Y_TREE_UPDATE_TIMING_MS",
 "COMPOSITE_SWAP_TIME"]
def demozlz4(p):
    with open(p,"rb") as f:
        assert f.read(8)==b"mozLz40\0"
        size=int.from_bytes(f.read(4),"little")
        return lz4.block.decompress(f.read(), uncompressed_size=size)
def cd(v):
    if isinstance(v,(int,float)): return datetime.datetime.fromtimestamp(v/1000)
    return datetime.datetime.fromisoformat(str(v).replace("Z","+00:00"))
rows=[]
for p in sorted(glob.glob(os.path.join(PROF,"datareporting/archived/*/*.main.jsonlz4"))):
    d=json.loads(demozlz4(p)); pl=d.get("payload",{}) or {}
    env=d.get("environment",{}) or {}
    gfx=((env.get("system") or {}).get("gfx") or {})
    act=""
    for a in (gfx.get("adapters") or []):
        if a.get("GPUActive"): act="%s:%s/%s"%(a.get("vendorID"),a.get("deviceID"),a.get("driverVendor"))
    # histograms live under payload.histograms and payload.processes.*.histograms
    buckets={}
    def grab(container, scope):
        for name,h in (container or {}).items():
            if name in MIRRORS:
                buckets["%s@%s"%(name,scope)] = h
    grab(pl.get("histograms"), "parent")
    for proc,pv in (pl.get("processes") or {}).items():
        grab((pv or {}).get("histograms"), proc)
    scal={}
    for sc,k in (("parent","gfx.skipped_composites"),):
        s=((pl.get("processes") or {}).get(sc,{}) or {}).get("scalars",{}) or {}
        if k in s: scal[k]=s[k]
    rows.append({"time":cd(d.get("creationDate")).strftime("%Y-%m-%d %H:%M:%S"),
                 "reason":(pl.get("info") or {}).get("reason"), "gpu":act,
                 "file":os.path.basename(p),"hist":buckets,"scalars":scal})
rows.sort(key=lambda r:r["time"])
with open("legacy-gfx-perping.json","w") as f: json.dump(rows,f,indent=1,ensure_ascii=False)
print("extracted %d main pings; %d carry gfx histograms" % (len(rows), sum(1 for r in rows if r["hist"])))
print("\n%-20s %-20s %-34s %s" % ("time(local)","reason","gpu","gfx histograms present"))
for r in rows:
    names=sorted({k.split('@')[0] for k in r["hist"]})
    print("%-20s %-20s %-34s %s" % (r["time"], r["reason"], r["gpu"], ",".join(names)[:110]))
# CSV of sum/count/count-per-ping for the key mirrors
with open("legacy-gfx-timeline.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["time","reason","gpu","metric","scope","sum","count","bucket_count","histogram_type","range"])
    for r in rows:
        for key,h in sorted(r["hist"].items()):
            name,scope=key.split("@")
            w.writerow([r["time"],r["reason"],r["gpu"],name,scope,h.get("sum"),h.get("sum") and None,
                        h.get("bucket_count"),h.get("histogram_type"),h.get("range")])
print("\nwrote legacy-gfx-perping.json and legacy-gfx-timeline.csv")
