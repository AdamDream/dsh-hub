#!/usr/bin/env python3
# 2026-09-12 heatmap redesign v2 — preview renderer.
# Renders the v2 heatmap design from dev/grid.json (REAL heatmapGrid output
# over REAL queryHeatmap aggregation): theme-aware blue ramps via --du-heat-*
# custom properties, filled+stroked no-data cells, 2px peak-cell ring, month
# labels aligned to their first-week column, legend + unit/peak note line with
# label-secondary text. Geometry mirrors the client (cell=11, gap=3, rx=2,
# monthRow=16).
import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(ROOT, "grid.json"), "r", encoding="utf-8") as fh:
    data = json.load(fh)
cells = data["cells"]
months = data["months"]
peak = data["peak"]
peak_day = data["peakDay"]
summary = data["summary"]
grid_w = max(summary["gridWidth"], 200)  # client: Math.max(grid.width, 200)
grid_h = summary["gridHeight"]  # monthRow + 7*(cell+3) - 3 = 111
month_row = 16
cell, gap, rx = 11, 3, 2

# Values of the usage-injected custom properties (lib/client.js CSS).
# Light theme: --du-heat-1..6 near-white→deep blue (lightness decreases).
# Dark theme:  --du-heat-1..6 deep→bright blue, "越多越亮" (lightness increases).
THEMES = {
    "light": {
        "bg": "#ffffff",
        "heat0_fill": "#f3f4f6",             # --du-heat-0 (near-bg fill)
        "heat0_stroke": "#9ca3af",           # --du-heat-0-stroke
        "heat0_stroke_width": 1,           # --du-heat-0-stroke-width
        "ramp": ["#dbeafe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1e3a8a"],
        "peak_stroke": "#ffffff",            # --du-heat-peak-stroke (opposite of navy peak cell)
        "month_fill": (173, 178, 184),       # --du-heat-month-fill = label-caption #adb2b8
        "text_fill": (97, 102, 107),         # label-secondary #61666b (legend/note)
        "out": "preview-light.png",
    },
    "dark": {
        "bg": "#151517",                      # --dsw-alias-bg-base neutral-bluish-950
        "heat0_fill": "#2f3540",              # --du-heat-0 (brighter than bg, ≥3:1 target)
        "heat0_stroke": "#8b93a1",            # --du-heat-0-stroke
        "heat0_stroke_width": 1.5,         # --du-heat-0-stroke-width
        "ramp": ["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"],
        "peak_stroke": "#0f1115",             # --du-heat-peak-stroke (opposite of pale-blue peak cell)
        "month_fill": (207, 211, 214),        # --du-heat-month-fill = label-secondary #cfd3d6
        "text_fill": (207, 211, 214),         # label-secondary #cfd3d6
        "out": "preview-dark.png",
    },
}


def fmt_tokens(v):  # replica of formatTokens (charts.js / client.js)
    n = float(v or 0)
    if abs(n) >= 1e9:
        return "%.2fb" % (n / 1e9)
    if abs(n) >= 1e6:
        return "%.2fm" % (n / 1e6)
    if abs(n) >= 1e3:
        return "%.1fk" % (n / 1e3)
    return str(int(round(n)))


def load_font(size):
    cjk = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
    for index in (2, 0):  # 2=SC, 0=JP fallback
        try:
            return ImageFont.truetype(cjk, size, index=index)
        except Exception:
            continue
    return ImageFont.load_default()


for theme_name, t in THEMES.items():
    f_lbl = load_font(12)
    f_note = load_font(12)
    f_legend = load_font(12)
    bg_hex = Image.new("RGB", (1, 1), t["bg"]).getpixel((0, 0))

    legend_label_w = max(
        f_legend.getbbox("少")[2], f_legend.getbbox("多")[2]
    ) + f_legend.getbbox("  ")[2]
    legend_swatches = 6 * (10 + 4) - 4
    legend_w = legend_label_w + legend_swatches + legend_label_w
    note_text = "单位 tokens/日 · 灰格 = 无数据 · 峰值 %s tokens/日（%s）" % (fmt_tokens(peak), peak_day)
    note_w = f_note.getbbox(note_text)[2]

    margin = 16
    inner = 10
    legend_h = 16
    note_h = 16
    note_gap = 6
    canvas_w = max(grid_w, legend_w, note_w) + 2 * margin
    canvas_h = margin + grid_h + inner + legend_h + note_gap + note_h + margin
    scale = 2  # 2x supersample for easier visual inspection
    img = Image.new("RGBA", (canvas_w * scale, canvas_h * scale), t["bg"])
    d = ImageDraw.Draw(img)

    def S(v):
        return v * scale

    # month labels (SVG <text> at y=11, fill --du-heat-month-fill)
    for m in months:
        tw = f_lbl.getbbox(m["label"])[2]
        d.text((S(margin + m["x"] - tw / 2), S(margin + 12)), m["label"], font=f_lbl, fill=t["month_fill"], anchor="ls")
    # cells (client renders rects inside <g transform=translate(0,monthRow)>)
    for c in cells:
        x0 = margin + c["x"]
        y0 = margin + month_row + c["y"]
        x1 = x0 + cell
        y1 = y0 + cell
        if c["level"] == 0:
            d.rounded_rectangle((S(x0), S(y0), S(x1), S(y1)), radius=S(rx), fill=t["heat0_fill"], outline=t["heat0_stroke"], width=int(S(t["heat0_stroke_width"])))
        else:
            d.rounded_rectangle((S(x0), S(y0), S(x1), S(y1)), radius=S(rx), fill=t["ramp"][c["level"] - 1])
    # peak-cell ring (client: stroke var(--du-heat-peak-stroke), strokeWidth 2)
    for c in cells:
        if c["day"] == peak_day:
            x0 = margin + c["x"]
            y0 = margin + month_row + c["y"]
            d.rounded_rectangle((S(x0), S(y0), S(x0 + cell), S(y0 + cell)), radius=S(rx), outline=t["peak_stroke"], width=int(S(2)))
    # legend: 少 + 6 blue swatches + 多 (client: FILLS.slice(1), label-secondary 12px)
    ly = margin + grid_h + inner
    d.text((S(margin), S(ly)), "少", font=f_legend, fill=t["text_fill"])
    sx = margin + legend_label_w
    for level in range(1, 7):
        d.rounded_rectangle((S(sx), S(ly), S(sx + 10), S(ly + 10)), radius=S(2), fill=t["ramp"][level - 1])
        sx += 14
    d.text((S(sx + 2), S(ly)), "多", font=f_legend, fill=t["text_fill"])
    # note line (client: du_heatNote, label-secondary 12px)
    ny = ly + legend_h + note_gap
    d.text((S(margin), S(ny)), note_text, font=f_note, fill=t["text_fill"])

    flat = Image.new("RGB", img.size, bg_hex)
    flat.paste(img, mask=img.split()[3])
    out = os.path.join(os.path.dirname(ROOT), t["out"])
    flat.save(out)
    print("wrote %s (%dx%d)" % (out, flat.width, flat.height))
    print("  months=%s note=%s peakDay=%s" % (months, note_text, peak_day))
