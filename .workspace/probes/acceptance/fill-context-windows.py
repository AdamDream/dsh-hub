#!/usr/bin/env python3
"""按「证据优先保守档」给 ~/.dsh/settings.yaml 的 adam provider 补齐 contextWindow，
并把 agent-default-model 恢复为 deepseek-v4.1-flash。

取值原则（用户 2026-09-17 裁决：能确证的按证据值，确证不了的按 1000000 兜底）：
  - E1（同文件 opencode-go 同名条目）：用同文件值
  - E2-cat（随本部署安装的 pi-ai 目录规格数据）：用**同名精确命中**的低值（保守，宁可早压缩不越界）
  - E3（无任何证据）：按裁决兜底 1000000（显式标注非实测）
  - N/A（视频生成 / 图像生成）：**不填**
只改 adam 块；opencode-go 块一律不动。
"""
import re
import shutil
import sys
import time

SETTINGS = "/home/CNS2026495165/.dsh/settings.yaml"
BACKUP = f"/home/CNS2026495165/.dsh/backups/settings.yaml.cwfill-{time.strftime('%Y%m%d-%H%M%S')}.bak"

# 证据优先保守档：40 条（45 条缺值 - 5 条 N/A）
VALUES = {
    # --- E1：同文件 opencode-go 同名条目 ---
    "deepseek-v4-pro": 1000000,
    "glm-5.1": 202752,
    "glm-5.2": 1000000,
    "kimi-k3": 1048576,
    "qwen3.7-max": 1000000,
    "qwen3.7-plus": 1000000,
    "kimi-k2.7-code": 262144,
    # --- E2-cat：同名精确命中，取值向低（保守档，10 条）---
    "glm-4.7": 204800,                      # zai.json 同名 cw=204800（原名同族外推 1000000 已弃）
    "glm-5": 204800,                        # opencode.json 同名 cw=204800
    "claude-haiku-4-5-20251001": 200000,    # anthropic.json 同名 cw=200000
    "claude-opus-4-5-20251101": 200000,     # anthropic.json 同名 cw=200000
    "gpt-5.4": 272000,                      # openai.json 同名 272000（azure/copilot 报 1050000，取低）
    "gpt-5.4-mini": 400000,                 # openai.json 同名 cw=400000
    "gpt-5.6-sol": 272000,                  # openai.json 同名 272000（他源 1050000，取低）
    "gpt-5.6-terra": 272000,
    "gpt-5.5": 272000,
    "gpt-5.6-luna": 272000,
    # --- E2-cat：同名精确命中且无冲突 ---
    "claude-opus-4-6": 1000000,
    "claude-opus-4-7": 1000000,
    "claude-opus-4-8": 1000000,
    "claude-opus-5": 1000000,
    "claude-sonnet-4-5-20250929": 1000000,
    "claude-sonnet-4-6": 1000000,
    "claude-sonnet-5": 1000000,
    "gemini-3.1-flash-lite": 1048576,
    "gemini-3.1-pro-preview": 1048576,
    "gemini-3.5-flash": 1048576,
    "gemini-3.5-flash-lite": 1048576,
    "gemini-3.6-flash": 1048576,
    "gemini-3-flash-preview": 1048576,
    "gemini-3-flash": 1048576,
    "gemini-3-pro-image-preview": 1048576,      # 同族外推（图像预览档）
    "gemini-3-pro-image-preview-2k": 1048576,
    "gemini-3-pro-image-preview-4k": 1048576,
    "kimi-k2.7-code-highspeed": 262144,
    # --- E3：无证据，按裁决兜底 1000000（非实测）---
    "qwen3.8-flash": 1000000,
    "qwen3.8-max": 1000000,
    "gpt-5.4-openai-compact": 1000000,
    "gpt-5.5-openai-compact": 1000000,
    "deepseek-v4-flash-vision-exp": 1000000,
}
# N/A（非对话模型，不填）：gemini-3.1-flash-image-preview(-2k/-4k)、veo3.1-fast、veo3.1-pro

shutil.copy2(SETTINGS, BACKUP)
text = open(SETTINGS, encoding="utf-8").read()
lines = text.split("\n")

# 定位 adam 块（providers 下 6 空格缩进的 adam:）
adam_start = next(i for i, l in enumerate(lines) if l == "    adam:")
# adam 块的 models: 起始
models_start = next(i for i in range(adam_start, len(lines)) if lines[i].strip() == "models:")
# 下一个同级 provider（4 空格缩进）或顶层键即块结束
block_end = len(lines)
for i in range(models_start + 1, len(lines)):
    l = lines[i]
    if l and not l.startswith(" " * 10) and not l.startswith(" " * 8):
        block_end = i
        break
print(f"adam models 区段 = 行 {models_start + 1}..{block_end}（1-based）")

inserted, already, missing = [], [], []
out = []
i = 0
while i < len(lines):
    line = lines[i]
    out.append(line)
    m = re.match(r"^(\s+)- id: (.+)$", line)
    if m and models_start <= i < block_end:
        indent, mid = m.group(1), m.group(2).strip()
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if "contextWindow:" in nxt:
            already.append(mid)
        elif mid in VALUES:
            out.append(f"{' ' * 10}contextWindow: {VALUES[mid]}")
            inserted.append((mid, VALUES[mid]))
        elif mid not in ("gemini-3.1-flash-image-preview", "gemini-3.1-flash-image-preview-2k",
                         "gemini-3.1-flash-image-preview-4k", "veo3.1-fast", "veo3.1-pro"):
            missing.append(mid)
    i += 1
text = "\n".join(out)
print(f"新插入 {len(inserted)} 条 / 原本已声明 {len(already)} 条 / 未覆盖 {len(missing)} 条")
if missing:
    print("未覆盖条目：", missing)
    sys.exit("存在未覆盖条目，中止")

# 恢复主默认模型为 v4.1-flash（用户 18:06 的 v4-flash 是应急切换；窗口已实测修好）
before = text
text = text.replace("agent-default-model:\n  provider: adam\n  model: deepseek-v4-flash\n",
                    "agent-default-model:\n  provider: adam\n  model: deepseek-v4.1-flash\n")
print("agent-default-model 恢复为 v4.1-flash:", "是" if text != before else "否（未命中，需人工检查）")

open(SETTINGS, "w", encoding="utf-8").write(text)
print(f"已写入（备份 {BACKUP}）")
