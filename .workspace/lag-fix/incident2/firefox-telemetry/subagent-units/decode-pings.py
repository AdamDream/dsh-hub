#!/usr/bin/env python3
"""Read-only decoder for Firefox mozLz4 payloads.
Extracts the graphics environment (about:support equivalent) from telemetry pings.
Writes to ./raw/ only. Never touches the profile.
"""
import json, lz4.block, os, glob, sys, datetime

PROF = os.path.expanduser("~/snap/firefox/common/.mozilla/firefox/g05ps3km.default")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(OUT, exist_ok=True)

def demozlz4(path):
    with open(path, "rb") as f:
        magic = f.read(8)
        if magic[:8] != b"mozLz40\0":
            raise ValueError("not mozLz4: %r" % magic)
        size = int.from_bytes(f.read(4), "little")
        return lz4.block.decompress(f.read(), uncompressed_size=size)

def ts(ms):
    try:
        return datetime.datetime.fromtimestamp(int(ms)/1000).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "?"

results = []
targets = []
for pat, kind in [
    (os.path.join(PROF, "datareporting/archived/*/*.main.jsonlz4"), "main"),
    (os.path.join(PROF, "datareporting/archived/*/*.health.jsonlz4"), "health"),
    (os.path.join(PROF, "datareporting/archived/*/*.crash.jsonlz4"), "crash"),
    (os.path.join(PROF, "datareporting/aborted-session-ping"), "aborted"),
]:
    for p in sorted(glob.glob(pat)):
        targets.append((p, kind))

print("=== %d payloads found ===" % len(targets))
for p, kind in targets:
    rec = {"file": os.path.basename(p), "kind": kind}
    try:
        d = json.loads(demozlz4(p))
    except Exception as e:
        rec["error"] = str(e)
        results.append(rec)
        print("ERR", os.path.basename(p), e)
        continue
    rec["creationDate"] = d.get("creationDate")
    rec["time"] = ts(d.get("creationDate"))
    rec["reason"] = d.get("payload", {}).get("info", {}).get("reason")
    env = d.get("environment", {})
    gfx = env.get("system", {}).get("gfx")
    if gfx:
        rec["gfx"] = gfx
    # health ping graphics
    pl = d.get("payload", {})
    if kind == "health" and "gfx" in pl:
        rec["payload_gfx"] = pl["gfx"]
    if kind == "crash":
        rec["crash_payload_keys"] = sorted(pl.keys())
        for k in ("crashDate", "hasCrashEnvironment"):
            if k in pl:
                rec["crash_" + k] = pl[k]
    # user prefs that matter
    up = env.get("settings", {}).get("userPrefs", {})
    gfxprefs = {k: v for k, v in up.items()
                if k.startswith(("gfx.", "layers.", "webgl.", "widget.", "layout.css",
                                 "browser.display", "apz.", "accessibility."))}
    if gfxprefs:
        rec["gfx_userPrefs"] = gfxprefs
    results.append(rec)
    print("%-8s %s reason=%s gfx=%s" % (kind, rec["time"], rec.get("reason"), "YES" if gfx else "no"))

with open(os.path.join(OUT, "telemetry-gfx-extract.json"), "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print("\nwrote raw/telemetry-gfx-extract.json")

# ---- focused dump of the newest main ping ----
mains = [r for r in results if r["kind"] == "main" and "gfx" in r]
mains.sort(key=lambda r: r.get("creationDate") or 0)
if mains:
    newest = mains[-1]
    print("\n" + "=" * 72)
    print("NEWEST MAIN PING WITH GFX: %s  (%s)" % (newest["file"], newest["time"]))
    print("=" * 72)
    print(json.dumps(newest["gfx"], indent=2, ensure_ascii=False))
    with open(os.path.join(OUT, "newest-main-ping-gfx.json"), "w") as f:
        json.dump(newest, f, indent=2, ensure_ascii=False)

    print("\n=== FEATURES timeline across main pings ===")
    for r in mains:
        feat = r["gfx"].get("features", {})
        print("%s | compositor=%-18s webrender=%-10s hwComp=%-10s wrComp=%s" % (
            r["time"],
            feat.get("compositor"),
            (feat.get("webrender") or {}).get("status"),
            (feat.get("hwCompositing") or {}).get("status"),
            (feat.get("wrCompositor") or {}).get("status")))
        for a in r["gfx"].get("adapters", []) or []:
            print("      adapter vendor=%s dev=%s active=%s driverVendor=%s desc=%s" % (
                a.get("vendorID"), a.get("deviceID"), a.get("GPUActive"),
                a.get("driverVendor"), (a.get("description") or "")[:90]))
        for m in r["gfx"].get("monitors", []) or []:
            print("      monitor %sx%s cssScale=%s contentsScale=%s" % (
                m.get("screenWidth"), m.get("screenHeight"),
                m.get("defaultCSSScaleFactor"), m.get("contentsScaleFactor")))

print("\n=== health pings: graphics crash guard ===")
for r in results:
    if r["kind"] == "health":
        print(r["time"], json.dumps(r.get("payload_gfx"), ensure_ascii=False)[:600])
