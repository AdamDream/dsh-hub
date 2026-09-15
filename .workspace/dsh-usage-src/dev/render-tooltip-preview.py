#!/usr/bin/env python3
# 2026-09-14 tooltip iteration 2 — preview renderer.
# Renders the self-drawn tooltip feature preview from REAL geometry output:
#   dev/trend.json  — real queryTimeseries aggregation + real charts.js
#                     scaleBars/barRects/scaleArea (coordinates + ticks)
#   dev/grid.json   — real heatmapGrid output (cells/months/peak)
# Outputs (light + dark) into .workspace/usage-tooltip-previews/:
#   preview-area-*.png      — area chart, no-hover state
#   preview-bar-*.png       — bar chart, no-hover state
#   preview-heatmap-*.png   — heatmap, no-hover state (legend + note kept)
#   preview-hover-*.png     — bar chart + cursor + iteration-2 tooltip layer:
#                             MM-DD date / compact uppercase value with
#                             weakened " tokens" unit, same-bg arrow pointing
#                             at the data point, tighter padding
#   preview-hover-flip-*.png— cursor in the chart's bottom-right corner:
#                             tooltip horizontally+vertically flipped
#                             (fx+fy), arrow still aligned to the cursor —
#                             proves all four quadrants work
# Theme colors approximate the --dsw-* tokens the client references; the
# tooltip layer colors mirror lib/client.js CSS (.du_tip incl. the
# body[data-ds-dark-theme] variant with the brighter border).
import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = "/home/CNS2026495165/dsh/.workspace/usage-tooltip-previews"
os.makedirs(OUT, exist_ok=True)

with open(os.path.join(ROOT, "trend.json"), "r", encoding="utf-8") as fh:
    trend = json.load(fh)
with open(os.path.join(ROOT, "grid.json"), "r", encoding="utf-8") as fh:
    grid = json.load(fh)

THEMES = {
    "light": {
        "bg": "#ffffff",
        "panel": "#f7f8fa",
        "primary": "#4176e6",        # ~ --dsw-state-business-primary
        "area_fill": "#dfe9fc",      # ~ secondary @ .35 opacity over white
        "tick": (173, 178, 184),     # label-caption #adb2b8
        "tip_bg": "#ffffff",         # .du_tip background (light)
        "tip_shadow": (228, 231, 236),  # soft gray shadow (light)
        "tip_border": "#d8dce2",     # .du_tip border (light)
        "tip_day": (97, 102, 107),   # label-secondary #61666b (≥4.5:1 on white)
        "tip_value": (46, 50, 56),   # ~ label-primary
        "tip_unit": (173, 178, 184), # label-caption (weakened unit)
        "heat0_fill": "#f3f4f6",
        "heat0_stroke": "#9ca3af",
        "heat0_stroke_width": 1,
        "ramp": ["#dbeafe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1e3a8a"],
        "peak_stroke": "#ffffff",
        "month_fill": (173, 178, 184),
        "text_fill": (97, 102, 107),
    },
    "dark": {
        "bg": "#151517",
        "panel": "#1c1f26",
        "primary": "#5b8def",        # ~ --dsw-state-business-primary (dark)
        "area_fill": "#22304e",      # ~ secondary @ .35 over dark bg
        "tick": (139, 147, 161),
        "tip_bg": "#2b303b",         # body[data-ds-dark-theme] .du_tip bg
        "tip_shadow": (11, 13, 16),  # simulated drop shadow (CSS box-shadow)
        "tip_border": "#8b93a1",     # brighter border → ≥3:1 vs page bg
        "tip_day": (207, 211, 214),  # label-secondary dark #cfd3d6
        "tip_value": (235, 237, 240),
        "tip_unit": (139, 147, 161),
        "heat0_fill": "#2f3540",
        "heat0_stroke": "#8b93a1",
        "heat0_stroke_width": 1.5,
        "ramp": ["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"],
        "peak_stroke": "#0f1115",
        "month_fill": (207, 211, 214),
        "text_fill": (207, 211, 214),
    },
}


def fmt_tokens(v):  # global formatter (tables/hero/heatmap note) — unchanged
    n = float(v or 0)
    if abs(n) >= 1e9:
        return "%.2fb" % (n / 1e9)
    if abs(n) >= 1e6:
        return "%.2fm" % (n / 1e6)
    if abs(n) >= 1e3:
        return "%.1fk" % (n / 1e3)
    return str(int(round(n)))


def fmt_tokens_tip(v):  # tooltip-only formatter: 1 decimal, uppercase unit
    n = float(v or 0)
    if abs(n) >= 1e9:
        return "%.1fB" % (n / 1e9)
    if abs(n) >= 1e6:
        return "%.1fM" % (n / 1e6)
    if abs(n) >= 1e3:
        return "%.0fK" % (n / 1e3)
    return str(int(round(n)))


def load_font(size):
    cjk = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
    for index in (2, 0):  # 2=SC, 0=JP fallback
        try:
            return ImageFont.truetype(cjk, size, index=index)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_trend_chart(d, theme, geom, ticks, chart_kind, ox, oy):
    """Draw the 560×150 viewBox area/bar chart at (ox, oy); every coordinate is
    scaled to the 2x supersample canvas (S())."""
    if chart_kind == "area":
        pts = [(S(ox + p["x"]), S(oy + p["y"])) for p in geom["points"]]
        if len(pts) >= 2:
            base_y = S(oy + 150)
            poly = pts + [(pts[-1][0], base_y), (pts[0][0], base_y)]
            d.polygon(poly, fill=theme["area_fill"])
            d.line(pts, fill=theme["primary"], width=max(2, int(S(2))), joint="curve")
    else:  # bar
        for r in geom["rects"]:
            d.rectangle(
                (S(ox + r["x"]), S(oy + r["y"]), S(ox + r["x"] + r["width"]), S(oy + r["y"] + r["height"])),
                fill=theme["primary"],
            )
    for tick in ticks:
        d.text((S(ox + tick["x"]), S(oy + 150 + 3)), tick["label"], font=load_font(18), fill=theme["tick"], anchor="ma")


def draw_arrow(d, t, tip):
    """Iteration-2 arrow: same background as the card (no color seam), two
    border-colored edges; the apex pivot sits at the pointer's position
    (ax/ay, clamped inside the card) and points L/R/U/D by tip["dir"], so it
    stays aligned with the data point in all four quadrants."""
    x0, y0, x1, y1 = tip["rect"]
    ax, ay = tip["ax"], tip["ay"]
    dct = {
        "l": ((x0 - 5, y0 + ay), (x0 + 3, y0 + ay - 4), (x0 + 3, y0 + ay + 4)),
        "r": ((x1 + 5, y0 + ay), (x1 - 3, y0 + ay - 4), (x1 - 3, y0 + ay + 4)),
        "d": ((x0 + ax, y1 + 5), (x0 + ax - 4, y1 - 3), (x0 + ax + 4, y1 - 3)),
        "u": ((x0 + ax, y0 - 5), (x0 + ax - 4, y0 + 3), (x0 + ax + 4, y0 + 3)),
    }
    (px, py), (bx, by), (ex, ey) = dct[tip["dir"]]
    d.polygon([(S(px), S(py)), (S(bx), S(by)), (S(ex), S(ey))], fill=t["tip_bg"])
    d.line([(S(px), S(py)), (S(bx), S(by))], fill=t["tip_border"], width=2)
    d.line([(S(px), S(py)), (S(ex), S(ey))], fill=t["tip_border"], width=2)


def draw_tooltip_layer(d, t, tip, day_text, value_text, unit_text, cursor_xy):
    """Iteration-2 tooltip layer: tighter padding, MM-DD date (label-secondary),
    compact uppercase value (tabular-nums) + weakened unit, flip-aware arrow."""
    x0, y0, x1, y1 = (S(v) for v in tip["rect"])
    # drop-shadow hint (CSS box-shadow): offset dark blob behind the card
    sh = t.get("tip_shadow")
    if sh:
        d.rounded_rectangle((x0 + S(3), y0 + S(4), x1 + S(3), y1 + S(4)), radius=S(8), fill=sh)
    d.rounded_rectangle((x0, y0, x1, y1), radius=S(8), fill=t["tip_bg"], outline=t["tip_border"], width=1)
    f_day = load_font(20)
    f_val = load_font(24)
    f_unit = load_font(20)
    d.text((x0 + S(7), y0 + S(4)), day_text, font=f_day, fill=t["tip_day"])
    val_w = f_val.getbbox(value_text)[2]
    d.text((x0 + S(7), y0 + S(4) + S(12) + S(1)), value_text, font=f_val, fill=t["tip_value"])
    if unit_text:
        d.text((x0 + S(7) + S(val_w), y0 + S(4) + S(12) + S(1) + S(2)), unit_text, font=f_unit, fill=t["tip_unit"])
    draw_arrow(d, t, tip)
    if cursor_xy:
        cx, cy = cursor_xy
        d.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=t["primary"])


def tip_rect_for(cx, cy, day_text, value_text, unit_text, cv_w, cv_h):
    """Replicate tipAtEvent(): +14 right of the pointer, vertically centered,
    flip when overflowing; returns rect + arrow direction/pivot."""
    f_day = load_font(20)
    f_val = load_font(24)
    f_unit = load_font(20)
    day_w = f_day.getbbox(day_text)[2] / 2.0  # font is 2x; reduce to 1x units
    val_w = f_val.getbbox(value_text)[2] / 2.0
    unit_w = f_unit.getbbox(unit_text)[2] / 2.0 if unit_text else 0
    est_w = max(day_w, val_w + unit_w) + 14 + 2
    est_h = 4 + 12 + 1 + 16 + 4 + 2  # padding+day+gap+value+padding+border
    fx = cx + 14 + est_w > cv_w - 8
    left = max(8, cx - est_w - 14 if fx else cx + 14)
    top0 = cy - est_h / 2
    if top0 + est_h > cv_h - 8:
        top = cv_h - 8 - est_h
        dir_ = "d"
    elif top0 < 8:
        top = 8
        dir_ = "u"
    else:
        top = top0
        dir_ = "r" if fx else "l"
    ax = max(10, min(est_w - 18, cx - left))
    ay = max(10, min(est_h - 18, cy - top))
    return {"rect": (left, top, left + est_w, top + est_h), "fx": fx, "fy": dir_ == "d", "dir": dir_, "ax": ax, "ay": ay}


for theme_name, t in THEMES.items():
    scale = 2
    margin = 12
    caption_top = 30

    def S(v):
        return v * scale

    def draw_caption(d, text, at_xy):
        d.text((S(at_xy[0]), S(at_xy[1])), text, font=load_font(12), fill=t["text_fill"])

    # ---- area (no-hover) ----
    canvas_w = 560 + 2 * margin
    canvas_h = margin + 150 + caption_top + 24 + margin
    img = Image.new("RGB", (S(canvas_w), S(canvas_h)), t["bg"])
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((S(margin), S(margin), S(margin + 560), S(margin + 150)), radius=10, fill=t["panel"])
    draw_trend_chart(d, t, trend["area"], trend["area"]["ticks"], "area", margin, margin)
    draw_caption(d, "面积图 · 无悬停态（悬停折线/顶点附近出现跟随浮层）", (margin + 4, margin + 150 + caption_top))
    img.save(os.path.join(OUT, "preview-area-%s.png" % theme_name))
    print("wrote preview-area-%s.png" % theme_name)

    # ---- bar (no-hover) ----
    img = Image.new("RGB", (S(canvas_w), S(canvas_h)), t["bg"])
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((S(margin), S(margin), S(margin + 560), S(margin + 150)), radius=10, fill=t["panel"])
    draw_trend_chart(d, t, trend["bars"], trend["bars"]["ticks"], "bar", margin, margin)
    draw_caption(d, "柱状图 · 无悬停态（悬停柱身出现跟随浮层）", (margin + 4, margin + 150 + caption_top))
    img.save(os.path.join(OUT, "preview-bar-%s.png" % theme_name))
    print("wrote preview-bar-%s.png" % theme_name)

    # ---- heatmap (no-hover) ----
    cells = grid["cells"]
    months = grid["months"]
    peak_day = grid["peakDay"]
    peak = grid["peak"]
    summary = grid["summary"]
    grid_w = max(summary["gridWidth"], 200)
    grid_h = summary["gridHeight"]
    month_row = 16
    cell, gap, rx = 11, 3, 2
    legend_label_w = max(load_font(12).getbbox("少")[2], load_font(12).getbbox("多")[2]) + load_font(12).getbbox("  ")[2]
    legend_w = legend_label_w + 6 * 14 - 4 + legend_label_w
    note_text = "单位 tokens/日 · 灰格 = 无数据 · 峰值 %s tokens/日（%s）" % (fmt_tokens(peak), peak_day)
    note_w = load_font(12).getbbox(note_text)[2]
    hm_margin = 16
    inner = 10
    legend_h = 16
    note_gap = 6
    canvas_w = max(grid_w, legend_w, note_w) + 2 * hm_margin
    canvas_h = hm_margin + grid_h + inner + legend_h + note_gap + 16 + hm_margin
    img = Image.new("RGB", (S(canvas_w), S(canvas_h)), t["bg"])
    d = ImageDraw.Draw(img)
    for m in months:
        tw = load_font(12).getbbox(m["label"])[2]
        d.text((S(hm_margin + m["x"] - tw / 2), S(hm_margin + 12)), m["label"], font=load_font(12), fill=t["month_fill"], anchor="ls")
    for c in cells:
        x0 = hm_margin + c["x"]
        y0 = hm_margin + month_row + c["y"]
        if c["level"] == 0:
            d.rounded_rectangle((S(x0), S(y0), S(x0 + cell), S(y0 + cell)), radius=S(rx), fill=t["heat0_fill"], outline=t["heat0_stroke"], width=int(S(t["heat0_stroke_width"])))
        else:
            d.rounded_rectangle((S(x0), S(y0), S(x0 + cell), S(y0 + cell)), radius=S(rx), fill=t["ramp"][c["level"] - 1])
    for c in cells:
        if c["day"] == peak_day:
            d.rounded_rectangle((S(hm_margin + c["x"]), S(hm_margin + month_row + c["y"]), S(hm_margin + c["x"] + cell), S(hm_margin + month_row + c["y"] + cell)), radius=S(rx), outline=t["peak_stroke"], width=int(S(2)))
    ly = hm_margin + grid_h + inner
    d.text((S(hm_margin), S(ly)), "少", font=load_font(12), fill=t["text_fill"])
    sx = hm_margin + legend_label_w
    for level in range(1, 7):
        d.rounded_rectangle((S(sx), S(ly), S(sx + 10), S(ly + 10)), radius=S(2), fill=t["ramp"][level - 1])
        sx += 14
    d.text((S(sx + 2), S(ly)), "多", font=load_font(12), fill=t["text_fill"])
    ny = ly + legend_h + note_gap
    d.text((S(hm_margin), S(ny)), note_text, font=load_font(12), fill=t["text_fill"])
    img.save(os.path.join(OUT, "preview-heatmap-%s.png" % theme_name))
    print("wrote preview-heatmap-%s.png" % theme_name)

    # ---- hover (示意悬停态: bar chart + cursor + iteration-2 tooltip) ----
    # the heatmap block above redefined canvas_w/canvas_h — restore the trend
    # chart canvas size for the hover renders
    canvas_w = 560 + 2 * margin
    canvas_h = margin + 150 + caption_top + 24 + margin
    rects = trend["bars"]["rects"]
    mid = sorted(rects, key=lambda r: r["value"])[len(rects) // 2]
    cx = mid["x"] + mid["width"] / 2
    cy = mid["y"] - 12  # cursor just above the bar top
    day_text = mid["day"][5:]  # MM-DD, same form as axis labels
    value_text = fmt_tokens_tip(mid["value"])
    unit_text = " tokens"
    img = Image.new("RGB", (S(canvas_w), S(canvas_h)), t["bg"])
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((S(margin), S(margin), S(margin + 560), S(margin + 150)), radius=10, fill=t["panel"])
    draw_trend_chart(d, t, trend["bars"], trend["bars"]["ticks"], "bar", margin, margin)
    cursor_screen = (S(margin + cx), S(margin + cy))
    tip = tip_rect_for(margin + cx, margin + cy, day_text, value_text, unit_text, canvas_w, canvas_h)
    draw_tooltip_layer(d, t, tip, day_text, value_text, unit_text, cursor_screen)
    draw_caption(d, "示意悬停态：浮层 = .du_tip（MM-DD + %s + 弱化 tokens，同底色箭头正对点位，跟随鼠标防溢出）" % value_text, (margin + 4, margin + 150 + caption_top))
    img.save(os.path.join(OUT, "preview-hover-%s.png" % theme_name))
    print("wrote preview-hover-%s.png (tip_rect=%s)" % (theme_name, tip["rect"]))

    # ---- hover-flip (右下角点位 → 水平+垂直双翻转，箭头仍对齐) ----
    fx_pt, fy_pt = 540, 140  # chart bottom-right corner (viewBox coords)
    day_text = "09-14"       # last data day, the bottom-right point
    value_text = fmt_tokens_tip(trend["series"][-1]["value"])
    img = Image.new("RGB", (S(canvas_w), S(canvas_h)), t["bg"])
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((S(margin), S(margin), S(margin + 560), S(margin + 150)), radius=10, fill=t["panel"])
    draw_trend_chart(d, t, trend["bars"], trend["bars"]["ticks"], "bar", margin, margin)
    cursor_screen = (S(margin + fx_pt), S(margin + fy_pt))
    tip = tip_rect_for(margin + fx_pt, margin + fy_pt, day_text, value_text, unit_text, canvas_w, canvas_h)
    draw_tooltip_layer(d, t, tip, day_text, value_text, unit_text, cursor_screen)
    draw_caption(d, "边界翻转示意：点位在图表右下角 → 浮层水平翻转避让（箭头 R 正对点位）；垂直溢出（箭头 D/U）由 verify-hit 四象限断言覆盖", (margin + 4, margin + 150 + caption_top))
    img.save(os.path.join(OUT, "preview-hover-flip-%s.png" % theme_name))
    print("wrote preview-hover-flip-%s.png (tip_rect=%s fx=%s fy=%s)" % (theme_name, tip["rect"], tip["fx"], tip["fy"]))

print("all previews written to " + OUT)
