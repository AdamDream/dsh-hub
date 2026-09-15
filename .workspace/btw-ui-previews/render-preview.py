#!/usr/bin/env python3
"""btw UI 批渲染预览（2026-09-14 btw-ui）— PIL 复刻：① 绿色运行横幅 ② 含序号徽标缩略图 ③ 打开的 lightbox。
几何/配色对齐 side-chat.module.css 与 SideChatSurface.tsx 的真实样式值。"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1240, 880
CANVAS = Image.new("RGB", (W, H), "#0c0f13")
D = ImageDraw.Draw(CANVAS)
d = D  # module-level shorthand (helpers receive their own draw param)

FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
f10 = ImageFont.truetype(FONT_REG, 10)
f11 = ImageFont.truetype(FONT_REG, 11)
f12 = ImageFont.truetype(FONT_REG, 12)
f13 = ImageFont.truetype(FONT_REG, 13)
f14 = ImageFont.truetype(FONT_REG, 14)
f12b = ImageFont.truetype(FONT_BOLD, 12)
f14b = ImageFont.truetype(FONT_BOLD, 14)

LIME = "#b7e85b"
LIME_LIGHT = "#d9f39a"
BG_BASE = "#171b21"
BORDER_L1 = "#2a3038"
BORDER_L2 = "#22262d"
LABEL_PRI = "#eef1f4"
LABEL_SEC = "#aab2bd"
LABEL_TER = "#7d8794"
LABEL_Q = "#565f6b"
FILL_TSP = "#232932"

def rounded_rect(d, box, radius, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def thumb(d, x, y, seed):
    """84x84 缩略图（渐变 + 简单图形），返回右上角坐标供 badge 用。"""
    def hexrgb(h):
        return tuple(int(h[j:j + 2], 16) for j in (1, 3, 5))
    for i in range(84):
        t = i / 83
        c1, c2 = (hexrgb("#4a7bd4"), hexrgb("#1d3a70")) if seed == 1 else (hexrgb("#845ec2"), hexrgb("#381e63"))
        col = tuple(int(c1[j] + (c2[j] - c1[j]) * t) for j in range(3))
        d.line([(x, y + i), (x + 83, y + i)], fill=col)
    if seed == 1:
        d.ellipse([x + 58 - 10, y + 30 - 10, x + 58 + 10, y + 30 + 10], fill="#e8b04b")
        d.polygon([(x, y + 64), (x + 30, y + 44), (x + 52, y + 60), (x + 70, y + 48), (x + 84, y + 62), (x + 84, y + 84), (x, y + 84)], fill="#306433")
        d.text((x + 8, y + 14), "Shot A", font=f10, fill="#ffffff")
    else:
        d.rounded_rectangle([x + 18, y + 20, x + 64, y + 54], radius=4, fill="#f0c75e")
        d.rectangle([x + 24, y + 28, x + 36, y + 32], fill="#5a3d00")
        d.text((x + 8, y + 60), "Shot B", font=f10, fill="#ffffff")

def badge(d, x, y, num):
    """左上角序号徽标：白底黑字、top/left 4px、圆角 6px、10px 等宽。"""
    w = 14
    rounded_rect(d, [x + 4, y + 4, x + 4 + w, y + 4 + 14], radius=6, fill="#ffffff")
    d.text((x + 4 + 3, y + 4 + 1), str(num), font=f10, fill="#000000")

# ============ 抽屉面板 ============
PX, PY, PW, PH = 36, 40, 400, 660
rounded_rect(D, [PX, PY, PX + PW, PY + PH], radius=16, fill=BG_BASE, outline=BORDER_L1, width=1)

# 头部
d.line([(PX, PY + 56), (PX + PW, PY + 56)], fill=BORDER_L2, width=1)
D.text((PX + 16, PY + 18), "btw 侧聊", font=f14b, fill=LABEL_PRI)
rounded_rect(D, [PX + 92, PY + 18, PX + 92 + 34, PY + 18 + 14], radius=7, fill=LIME)
D.text((PX + 96, PY + 18), "只读", font=f10, fill="#161a13")
D.text((PX + PW - 26, PY + 18), "×", font=f14, fill=LABEL_Q)

# 父任务状态行
d.line([(PX, PY + 90), (PX + PW, PY + 90)], fill=BORDER_L2, width=1)
D.ellipse([PX + 16, PY + 66, PX + 22, PY + 72], fill=LIME)
D.text((PX + 30, PY + 62), "主任务运行中", font=f11, fill=LABEL_SEC)
D.text((PX + 240, PY + 62), "继承内容仅作参考", font=f11, fill=LABEL_Q)

# ============ ① 绿色运行横幅（sticky 顶部） ============
BX, BY, BW, BH = PX + 16, PY + 110, 220, 26
rounded_rect(D, [BX, BY, BX + BW, BY + BH], radius=13,
             fill=BG_BASE, outline=BORDER_L1, width=1)
# 边框做 b7e85b 24% 混入的近似：再叠一条绿边
rounded_rect(D, [BX + 1, BY + 1, BX + BW - 1, BY + BH - 1], radius=12, outline=LIME, width=1)
banner_text = "输出中… · 当前动作: read"
# shimmer 模拟：整体绿字 + 中部窄光带（不重绘字形，避免重影；光带只盖中段、
# 不盖前导“输出中…”，透明度调低避免把绿字洗白）
D.text((BX + 10, BY + 5), banner_text, font=f14, fill=LIME)
band = Image.new("RGBA", (BW, BH), (0, 0, 0, 0))
bd = ImageDraw.Draw(band)
bd.rounded_rectangle([78, 3, 112, BH - 3], radius=10, fill=(217, 243, 154, 110))
CANVAS.paste(band, (BX, BY), band)

# ============ 消息区 ============
# 用户消息：文字 + 两张带徽标缩略图
UBX, UBY = PX + 120, PY + 156
d.rounded_rectangle([UBX, UBY, UBX + 246, UBY + 96], radius=12, fill="#262e2a")
d.text((UBX + 12, UBY + 8), "你", font=f10, fill=LABEL_Q)
d.text((UBX + 12, UBY + 22), "这张图里有什么文字？", font=f13, fill=LABEL_PRI)
thumb(D, UBX + 12, UBY + 50, 1)
badge(D, UBX + 12, UBY + 50, 1)
thumb(D, UBX + 103, UBY + 50, 2)
badge(D, UBX + 103, UBY + 50, 2)

# 助手消息
AX, AY = PX + 16, PY + 278
d.rounded_rectangle([AX + 10, AY, AX + 10 + 3, AY + 96], radius=2, fill=LIME)
D.text((AX + 22, AY), "侧边助手", font=f10, fill=LABEL_Q)
d.multiline_text((AX + 22, AY + 14),
                 "图 1 是蓝色渐变界面截图（Shot A），图 2 是紫色\n卡片示意图（Shot B）。缩略图左上角均显示序号\n徽标，点击任一张会打开放大预览。",
                 font=f12, fill=LABEL_PRI, spacing=4)

# 输入区
d.rounded_rectangle([PX + 14, PY + PH - 64, PX + PW - 14, PY + PH - 14], radius=12, fill="#1a1f26", outline=BORDER_L1, width=1)
D.text((PX + 28, PY + PH - 46), "输入一个临时问题…", font=f12, fill=LABEL_TER)
d.ellipse([PX + PW - 46, PY + PH - 46, PX + PW - 16, PY + PH - 16], fill=LIME)
D.text((PX + PW - 38, PY + PH - 39), "→", font=f14b, fill="#151912")

# ============ ③ 打开的 lightbox（全屏遮罩 + 大图 + 关闭钮） ============
MASK = Image.new("RGBA", (W, H), (3, 4, 6, 215))
CANVAS.paste(MASK, (0, 0), MASK)

# 大图 640x420（缩放到 520x342 居中于画布；遮罩压暗全屏 = 真实 modal 行为）
LX, LY = (W - 520) // 2, (H - 342) // 2 - 20
# 投影（先画在渐变下方）
SHADOW = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(SHADOW)
sd.rounded_rectangle([LX + 6, LY + 8, LX + 526, LY + 350], radius=10, fill=(0, 0, 0, 140))
CANVAS.paste(SHADOW, (0, 0), SHADOW)
lc1, lc2 = (int("#4a7bd4"[j:j + 2], 16) for j in (1, 3, 5)), (int("#1d3a70"[j:j + 2], 16) for j in (1, 3, 5))
lc1, lc2 = tuple(lc1), tuple(lc2)
for i in range(342):
    t = i / 341
    col = tuple(int(lc1[j] + (lc2[j] - lc1[j]) * t) for j in range(3))
    d.line([(LX, LY + i), (LX + 519, LY + i)], fill=col)
d.ellipse([LX + 320, LY + 80, LX + 436, LY + 196], fill="#e8b04b")
d.polygon([(LX, LY + 250), (LX + 180, LY + 150), (LX + 310, LY + 230), (LX + 420, LY + 180), (LX + 520, LY + 240), (LX + 520, LY + 342), (LX, LY + 342)], fill="#306433")
D.text((LX + 28, LY + 30), "Shot A - original", font=f14b, fill="#ffffff")
D.text((LX + 28, LY + 56), "max-width:min(1600px,94vw) · max-height:calc(100vh-80px)", font=f11, fill="#cfe0ff")
# 细边框（避免圆角描边在四角产生小块伪影，改用直角细线 + 圆角遮罩省略）
d.rectangle([LX, LY, LX + 520, LY + 342], outline="#0a0d11", width=1)

# 关闭钮：叠在大图右上角（视觉等效 dialog 相对定位的右上关闭钮）
CX, CY, CR = LX + 520 - 6, LY - 6, 16
d.ellipse([CX - CR, CY - CR, CX + CR, CY + CR], fill="#262d37", outline="#3a4250", width=1)
d.text((CX - 6, CY - 9), "✕", font=f14b, fill="#dfe4ea")

# ============ 说明文字 ============
cap_x = PX
D.text((cap_x, PY + PH + 30), "① 运行横幅：绿系（#b7e85b 边框 + #b7e85b→#d9f39a shimmer 文字），替代原 DeepSeek 蓝。", font=f12, fill="#c6ccd4")
D.text((cap_x, PY + PH + 52), "② 缩略图左上角序号徽标：白底黑字、top/left 4px、圆角 6px（1 / 2）。", font=f12, fill="#c6ccd4")
D.text((cap_x, PY + PH + 74), "③ lightbox：遮罩点击关闭 + Esc 关闭（不触发抽屉最小化）+ 右上关闭钮 + 大图 + 焦点还原。", font=f12, fill="#c6ccd4")

CANVAS.save("/home/CNS2026495165/dsh/.workspace/btw-ui-previews/preview.png")
print("saved preview.png", CANVAS.size)
