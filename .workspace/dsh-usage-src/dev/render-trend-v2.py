#!/usr/bin/env python3
import sys
# 2026-09-18 hourly-trend preview renderer (v2).
#
# Paints dev/trend-v2.json — geometry produced by the REAL implementation
# (host queryTimeseries + charts.js fillBuckets/scaleArea/smoothAreaPath/
# scaleBars/barRects/mixHex/bucketLabel) — as light-theme sheets:
#   trend-v2-area-light.png : 旧直连折线（含标签退化）+ 3 组蓝色候选（平滑）
#   trend-v2-bars-light.png : 3 组黄→橙端点候选（按日，与现状同粒度）
# Cubic segments are sampled straight out of the SVG path string the plugin
# emits, so the review targets the geometry that will actually ship.
import json
import os
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(ROOT, "trend-v2.json"), "r", encoding="utf-8") as fh:
    DATA = json.load(fh)

AREA = DATA["area"]
W, H = AREA["w"], AREA["h"]
SCALE = 2
BG = (255, 255, 255)
TICK_FILL = (173, 178, 184)     # --dsw-alias-label-caption (light theme)
TITLE_FILL = (33, 36, 41)       # --dsw-alias-label-primary
SUB_FILL = (97, 102, 107)       # --dsw-alias-label-secondary
BASE_LINE = (230, 233, 237)

CMD_RE = re.compile(r"([MLCZ])([^MLCZ]*)")


def load_font(size, bold=False):
    path = "/usr/share/fonts/opentype/noto/NotoSansCJK-%s.ttc" % ("Bold" if bold else "Regular")
    for index in (2, 0):
        try:
            return ImageFont.truetype(path, size, index=index)
        except Exception:
            continue
    return ImageFont.load_default()


F_TITLE = load_font(15, bold=True)
F_LABEL = load_font(13)
F_TICK = load_font(10)
F_NOTE = load_font(12)


def parse_path(d):
    """SVG path (absolute M/L/C/Z) → list of point lists (curves sampled)."""
    subpaths, current, last = [], [], (0.0, 0.0)
    for cmd, args in CMD_RE.findall(d):
        nums = [float(n) for n in re.findall(r"-?\d*\.?\d+", args)]
        if cmd == "M":
            if current:
                subpaths.append(current)
            current = [(nums[0], nums[1])]
            last = (nums[0], nums[1])
        elif cmd == "L":
            for i in range(0, len(nums) - 1, 2):
                last = (nums[i], nums[i + 1])
                current.append(last)
        elif cmd == "C":
            for i in range(0, len(nums) - 5, 6):
                c1 = (nums[i], nums[i + 1])
                c2 = (nums[i + 2], nums[i + 3])
                p3 = (nums[i + 4], nums[i + 5])
                x0, y0 = last
                for step in range(1, 25):
                    t = step / 24.0
                    mt = 1 - t
                    bx = mt**3 * x0 + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * p3[0]
                    by = mt**3 * y0 + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * p3[1]
                    current.append((bx, by))
                last = p3
        elif cmd == "Z":
            if current:
                subpaths.append(current)
                current = []
    if current:
        subpaths.append(current)
    return subpaths


def hex_to_rgb(value):
    text = value.lstrip("#")
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))


def fmt_tokens(value):
    """Replica of formatTokens (charts.js / client.js) for header annotations."""
    n = float(value or 0)
    if abs(n) >= 1e9:
        return "%.2fb" % (n / 1e9)
    if abs(n) >= 1e6:
        return "%.2fm" % (n / 1e6)
    if abs(n) >= 1e3:
        return "%.1fk" % (n / 1e3)
    return str(int(round(n)))


def dashed_line(d, pts, fill, width, dash=5, gap=4):
    """Draw a dashed polyline (PIL has no dash support) — mirrors the client's
    strokeDasharray on the still-running final segment."""
    on = True
    budget = dash * SCALE
    for a, b in zip(pts, pts[1:]):
        length = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        if length <= 0:
            continue
        steps = max(1, int(length / SCALE))
        for k in range(steps):
            t0, t1 = k / steps, (k + 1) / steps
            p0 = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0)
            p1 = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
            if on:
                d.line([p0, p1], fill=fill, width=width)
            budget -= ((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5
            if budget <= 0:
                on = not on
                budget = (dash if on else gap) * SCALE


def fade(hex_color, alpha, bg=(255, 255, 255)):
    """flatten a colour onto the background at `alpha` (PIL has no per-shape alpha)."""
    r, g, b = hex_to_rgb(hex_color)
    return tuple(int(bg[i] + (c - bg[i]) * alpha) for i, c in enumerate((r, g, b)))


def tick_anchor(x, w):
    """Mirror the client's tickAnchor(): the first/last label anchors to the edge."""
    if x <= 0.5:
        return "ls"
    if x >= w - 0.5:
        return "rs"
    return "ms"


def paint_area(img, ox, oy, line_hex, fill_hex, alpha, path_line, path_area, ticks, path_tail=None):
    d = ImageDraw.Draw(img)
    d.line([(ox * SCALE, (oy + H) * SCALE), ((ox + W) * SCALE, (oy + H) * SCALE)], fill=BASE_LINE, width=SCALE)
    mask = Image.new("L", ((W + 2) * SCALE, (H + 2) * SCALE), 0)
    md = ImageDraw.Draw(mask)
    for sub in parse_path(path_area):
        md.polygon([((x + 1) * SCALE, (y + 1) * SCALE) for x, y in sub], fill=int(255 * alpha))
    overlay = Image.new("RGBA", mask.size, hex_to_rgb(fill_hex) + (0,))
    overlay.putalpha(mask)
    img.paste(overlay, (int((ox - 1) * SCALE), int((oy - 1) * SCALE)), overlay)
    d = ImageDraw.Draw(img)
    for sub in parse_path(path_line):
        pts = [((x + ox) * SCALE, (y + oy) * SCALE) for x, y in sub]
        if len(pts) > 1:
            d.line(pts, fill=hex_to_rgb(line_hex), width=2 * SCALE, joint="curve")
    if path_tail:
        # the still-running bucket: dashed overlay, exactly like the client
        for sub in parse_path(path_tail):
            pts = [((x + ox) * SCALE, (y + oy) * SCALE) for x, y in sub]
            if len(pts) > 1:
                dashed_line(d, pts, hex_to_rgb(line_hex), 2 * SCALE)
    for tick in ticks:
        d.text(((ox + tick["x"]) * SCALE, (oy + H + 3) * SCALE), tick["label"], font=F_TICK, fill=TICK_FILL, anchor=tick_anchor(tick["x"], W))


def paint_bars(img, ox, oy, rects, ticks):
    d = ImageDraw.Draw(img)
    d.line([(ox * SCALE, (oy + H) * SCALE), ((ox + W) * SCALE, (oy + H) * SCALE)], fill=BASE_LINE, width=SCALE)
    for r in rects:
        if r["height"] <= 0:
            continue
        box = [(ox + r["x"]) * SCALE, (oy + r["y"]) * SCALE, (ox + r["x"] + r["width"]) * SCALE, (oy + r["y"] + r["height"]) * SCALE]
        # `partialBar` = the still-running bucket → client draws it at fillOpacity .45
        color = fade(r["fill"], 0.45) if r.get("partialBar") else hex_to_rgb(r["fill"])
        d.rounded_rectangle(box, radius=SCALE, fill=color)
    for tick in ticks:
        d.text(((ox + tick["x"]) * SCALE, (oy + H + 3) * SCALE), tick["label"], font=F_TICK, fill=TICK_FILL, anchor=tick_anchor(tick["x"], W))


MARGIN, TITLE_H, NOTE_H, GAP = 20, 26, 20, 18
S = DATA["summary"]


def build_sheet(panes, header_lines, out_name):
    pane_h = TITLE_H + H + NOTE_H
    sheet_w = W + 2 * MARGIN
    sheet_h = MARGIN + len(header_lines) * 20 + 10 + sum(pane_h for _ in panes) + GAP * (len(panes) - 1) + MARGIN
    img = Image.new("RGB", (sheet_w * SCALE, sheet_h * SCALE), BG)
    d = ImageDraw.Draw(img)
    y = MARGIN
    for i, line in enumerate(header_lines):
        d.text((MARGIN * SCALE, y * SCALE), line, font=F_TITLE if i == 0 else F_NOTE, fill=TITLE_FILL if i == 0 else SUB_FILL)
        y += 20
    y += 10
    for title, kind, payload in panes:
        d.text((MARGIN * SCALE, y * SCALE), title, font=F_LABEL, fill=TITLE_FILL)
        oy = y + TITLE_H
        if kind == "area":
            paint_area(img, MARGIN, oy, payload["line"], payload["fill"], payload["alpha"], payload["path_line"], payload["path_area"], payload["ticks"], payload.get("path_tail"))
        else:
            paint_bars(img, MARGIN, oy, payload["rects"], payload["ticks"])
        y += pane_h + GAP
    out = os.path.join(ROOT, out_name)
    img.save(out)
    print("wrote %s (%dx%d)" % (out, img.width, img.height))


old_ticks = [dict(t, label=t["label"].split(" ")[0]) for t in AREA["ticks"]]
area_panes = [("① 旧：直连折线 + 标签退化（小时键被 slice(5) 截断 → 同一屏 9 个相同标签）", "area",
               {"line": "#3b82f6", "fill": "#1e3a8a", "alpha": 0.35,
                "path_line": AREA["straightLine"], "path_area": AREA["straightArea"], "ticks": old_ticks})]
for v in DATA["areaVariants"]:
    area_panes.append(("② 新 A/%s：%s" % (v["id"], v["label"]), "area",
                       {"line": v["line"], "fill": v["fill"], "alpha": v["alpha"],
                        "path_line": AREA["smoothLine"], "path_area": AREA["smoothArea"], "ticks": AREA["ticks"]}))
ROLLUP = DATA["rollup"]
ROLLUP3 = DATA["rollup3"]
area_panes.append(("③ 可选：客户端 3 小时合并（%d 点，不用改宿主）· 蓝 D 档（60%%）" % ROLLUP3["count"], "area",
                   {"line": "#60a5fa", "fill": "#1e3a8a", "alpha": 0.6,
                    "path_line": ROLLUP3["smoothLine"], "path_area": ROLLUP3["smoothArea"], "ticks": ROLLUP3["ticks"]}))
area_panes.append(("④ 可选：客户端 6 小时合并（%d 点，不用改宿主）· 蓝 D 档（60%%）" % ROLLUP["count"], "area",
                   {"line": "#60a5fa", "fill": "#1e3a8a", "alpha": 0.6,
                    "path_line": ROLLUP["smoothLine"], "path_area": ROLLUP["smoothArea"], "ticks": ROLLUP["ticks"]}))
build_sheet(area_panes, [
    "dsh-usage 趋势图（面积）改造预览 · 浅色主题 · 真实 usage.db，窗口 7 天",
    "host 日桶 %d / 小时桶 %d → 客户端补零后 %d 点（空小时 %d 个补 0）｜峰值小时 %s = %s tokens｜平滑为 monotone cubic（%d 段，不过冲）"
    % (S["dayBucketsFromHost"], S["hourBucketsFromHost"], S["hourBucketsFilled"], S["hourEmptyBuckets"],
       S["peakHour"]["label"], S["peakHour"]["formatted"], S["smoothPathSegments"]),
], "trend-v2-area-light.png")

bar_panes = []
for b in DATA["barVariants"]:
    bar_panes.append(("新 B/%s：%s（按日 8 根，按值线性取色）" % (b["id"], b["label"]), "bar",
                      {"rects": b["rects"], "ticks": DATA["bars"]["ticks"]}))
build_sheet(bar_panes, [
    "dsh-usage 柱状图改造预览 · 浅色主题 · 粒度保持「按日」（与现状一致，只换配色）",
    "每根柱按自身值在该窗口内的归一化位置取色：少 → 低端色，多 → 高端端色（线性）｜峰值日 %s = %s tokens"
    % (S["peakDay"]["label"], S["peakDay"]["formatted"]),
], "trend-v2-bars-light.png")

# --- 2026-09-18b: the shipped 24h gear (04:00 → 04:00, one bucket per hour) ---
H24 = DATA["hour24"]
h24_panes = []
for key, head in (("live", "① 今日窗口 · 04:00 → 现在（曲线画到当前小时）"), ("past", "② 完整窗口 · 昨日 04:00 → 今日 04:00")):
    v = H24[key]
    h24_panes.append((head + " · 面积图（逐小时 + 蓝 D 档" + ("，末段虚线=进行中" if v["partial"] else "") + "）", "area",
                      {"line": "#60a5fa", "fill": "#1e3a8a", "alpha": 0.6,
                       "path_line": v["smoothLine"], "path_area": v["smoothArea"], "ticks": v["ticks"],
                       "path_tail": v["tailLine"] if v["partial"] else None}))
    h24_panes.append((head + " · 柱状图（逐小时 + 黄→橙 P2）", "bar",
                      {"rects": v["bars"], "ticks": v["ticks"]}))
build_sheet(h24_panes, [
    "dsh-usage 趋势图 · 24h 逐小时档位预览 · 浅色主题 · 真实 usage.db",
    "窗口 04:00→次日 04:00（本地时区）｜今日 %d 桶（非空 %d）峰值 %s = %s｜昨日 %d 桶（非空 %d）峰值 %s = %s｜每格一个双位小时标签"
    % (H24["live"]["buckets"], H24["live"]["nonEmpty"], H24["live"]["peak"]["day"], fmt_tokens(H24["live"]["peak"]["value"]),
       H24["past"]["buckets"], H24["past"]["nonEmpty"], H24["past"]["peak"]["day"], fmt_tokens(H24["past"]["peak"]["value"])),
], "trend-24h-light.png")

# `python3 render-trend-v2.py zoom <id>` → one pane at 3x, for label legibility
# checks (the full sheets are tall and get downscaled in review).
if len(sys.argv) > 2 and sys.argv[1] == "zoom":
    want = sys.argv[2]
    SCALE = 3
    picked = ([(t, k, p) for (t, k, p) in area_panes if want in t]
              or [(t, k, p) for (t, k, p) in bar_panes if want in t]
              or [(t, k, p) for (t, k, p) in h24_panes if want in t])
    if not picked:
        raise SystemExit("no pane matches %r" % want)
    build_sheet(picked[:1], ["zoom · %s" % want], "trend-v2-zoom-%s.png" % want.replace("/", "-"))
