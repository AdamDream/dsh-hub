#!/usr/bin/env bash
# ============================================================================
# apply-restore.sh — 插件恢复应用脚本（web profile 0.1.1-rc.2）
#
# 作用范围（唯一写点）：~/.dsh/profiles/web/cordis.patch.yml
#   删除 4 条 0.1.5 尝试期残留的 dsh-fix disabled 条目：
#     wallpaper / vision-adam / subagent-model-selection-settings / taste
#   保留全部基线 insert（vision-adam / taste / btw / wallpaper）与
#   agent-presets.default=standard-glm；btw 条目原样不动。
#
# 模式：
#   ./apply-restore.sh            = --dry-run（预览改动 + 模拟结果校验，不落盘）
#   ./apply-restore.sh --dry-run
#   ./apply-restore.sh --apply    备份 → 应用 → 校验（幂等：已恢复则 no-op）
#   ./apply-restore.sh --verify   只校验当前盘面（不落盘）
#
# 幂等：目标已无 4 条 disabled 锚点 → --apply 直接判"已恢复"，不做备份/改写，
#       仅跑校验；可反复执行。
#
# 测试支持：RESTORE_TARGET 环境变量可把目标指到工作区副本（测试用）；
#   默认（部署）目标 = $HOME/.dsh/profiles/web/cordis.patch.yml。
#
# 边界（本脚本强约束）：
#   * 拒绝任何 ~/.dsh/profiles/web2/** 路径 —— web2（0.1.5 残留）零改动；
#   * 只写 cordis.patch.yml（及其 .bak 备份），不写 settings.yaml、
#     不写全局树（~/.npm-global/...）、不写 @local/@deepseek-ai 任何包目录；
#   * 不引入新机制：删除动作是"精确锚点删除"，不新增 insert/config。
#
# 依赖：python3（PyYAML，校验用；缺失时校验降级为锚点/文本级并明确告警）、
#       node（包解析校验用；缺失时跳过并告警）。
# ============================================================================
set -euo pipefail

MODE="${1:---dry-run}"
case "$MODE" in
  --dry-run|--apply|--verify) ;;
  *) echo "usage: $0 [--dry-run|--apply|--verify]" >&2; exit 2 ;;
esac

TARGET="${RESTORE_TARGET:-$HOME/.dsh/profiles/web/cordis.patch.yml}"
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REF_FILE="$PKG_DIR/cordis.patch.yml"

# ---- 边界守卫 --------------------------------------------------------------
# web2（0.1.5 残留）冻结：任何模式下都拒绝指向 web2。
case "$TARGET" in
  "$HOME/.dsh/profiles/web2/"*|"$HOME/.dsh/profiles/web2"*)
    echo "REFUSE: target 落在 web2（0.1.5 残留，冻结）: $TARGET" >&2; exit 2 ;;
esac
# 默认部署目标必须落在 web profile 下；RESTORE_TARGET 显式覆盖 = 测试/开发用，
# 由调用方负责（本仓库测试即用它指到工作区副本）。
if [ -z "${RESTORE_TARGET:-}" ]; then
  case "$TARGET" in
    "$HOME/.dsh/profiles/web/"*) : ;;
    *) echo "REFUSE: target 不在 web profile 下（$HOME/.dsh/profiles/web/）: $TARGET" >&2; exit 2 ;;
  esac
fi

[ -f "$TARGET" ] || { echo "FATAL: 目标不存在: $TARGET" >&2; exit 1; }
[ -f "$REF_FILE" ] || { echo "FATAL: 参照修正版缺失: $REF_FILE" >&2; exit 1; }

python3 - "$MODE" "$TARGET" "$REF_FILE" <<'PY'
import os, re, sys, shutil, datetime, difflib, io, subprocess

mode, target, ref = sys.argv[1], sys.argv[2], sys.argv[3]

IDS = ["wallpaper", "vision-adam", "subagent-model-selection-settings", "taste"]
ANCHOR = re.compile(
    r'\n*# dsh-fix: disabled entry "([^"]+)" at [^\n]*\n'
    r'- id: "\1"\n  disabled: true\n*'
)

def load_yaml_text(text):
    import yaml
    return yaml.safe_load(io.StringIO(text))

def collect_entries(doc):
    """entries = {插件 id: 条目}（含 insert 载体条目与 disabled 条目）；
    inserts = {插件 id: name}（来自各 insert 列表）。"""
    entries, inserts = {}, {}
    if not isinstance(doc, list):
        return entries, inserts
    for item in doc:
        if not isinstance(item, dict):
            continue
        ins = item.get("insert")
        if isinstance(ins, list):
            for s in ins:
                if isinstance(s, dict) and s.get("id"):
                    inserts[str(s["id"])] = str(s.get("name", ""))
        if item.get("id") is not None:
            entries[str(item["id"])] = item
    return entries, inserts

def verify_text(text, ref, announce=True):
    problems = []
    try:
        doc = load_yaml_text(text)
    except Exception as e:
        return False, [f"YAML 解析失败: {e}"]
    entries, inserts = collect_entries(doc)
    for iid in IDS:
        e = entries.get(iid)
        if e is not None and e.get("disabled") is True:
            problems.append(f"仍存在 disabled 条目: {iid}")
    for iid, name in [("vision-adam", "@deepseek-ai/dsh-vision-adam"),
                      ("taste", "@deepseek-ai/dsh-taste"),
                      ("btw", "@local/dsh-btw"),
                      ("wallpaper", "@local/dsh-wallpaper")]:
        if iid not in inserts:
            problems.append(f"缺少基线 insert: {iid}")
        elif inserts[iid] != name:
            problems.append(f"insert {iid} 的 name 被改: {inserts[iid]!r} != {name!r}")
    if entries.get("btw", {}).get("disabled") is True:
        problems.append("btw 被 disabled（不允许）")
    ap = entries.get("agent-presets", {}).get("config", {})
    if ap.get("default") != "standard-glm":
        problems.append(f"agent-presets.default != standard-glm: {ap.get('default')!r}")
    try:
        rentries, rinserts = collect_entries(load_yaml_text(open(ref, encoding="utf-8").read()))
        if entries != rentries or inserts != rinserts:
            problems.append("与修正参照版条目结构不一致")
    except Exception as e:
        problems.append(f"参照版解析失败: {e}")
    if problems and announce:
        print("VERIFY FAIL:")
        for p in problems:
            print("  -", p)
    return not problems, problems

with open(target, encoding="utf-8") as f:
    content = f.read()
found = [m.group(1) for m in ANCHOR.finditer(content)]

if mode == "--dry-run":
    print(f"[dry-run] target: {target}")
    print(f"[dry-run] 命中的 disabled 锚点: {found if found else '无（已恢复）'}")
    new_content = ANCHOR.sub("", content)
    if found:
        print("[dry-run] 预览 diff（- = 删除）:")
        for line in difflib.unified_diff(
                content.splitlines(), new_content.splitlines(),
                fromfile="before", tofile="after", lineterm=""):
            print("   " + line)
    else:
        print("[dry-run] 无改动（已恢复）。")
    ok, _ = verify_text(new_content, ref)   # 校验模拟结果
    sys.exit(0 if ok else 1)

if mode == "--verify":
    print(f"[verify] target: {target}")
    ok, _ = verify_text(content, ref)
    sys.exit(0 if ok else 1)

# ---- --apply --------------------------------------------------------------
if not found:
    print("[apply] 4 条 disabled 锚点均不存在 → 已恢复（no-op，幂等）。")
    ok, _ = verify_text(content, ref)
    sys.exit(0 if ok else 1)

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
bak = f"{target}.bak-plugin-restore-{stamp}"
shutil.copy2(target, bak)
print(f"[apply] 备份 → {bak}")

new_content = ANCHOR.sub("", content)
with open(target, "w", encoding="utf-8") as f:
    f.write(new_content)
print(f"[apply] 已删除 {len(found)} 条 disabled 锚点: {found}")

ok, problems = verify_text(new_content, ref)
if not ok:
    print(f"[apply] 校验失败，备份保留在 {bak}（可手动还原）。")
    sys.exit(1)

# 包解析校验（node；从真实 web profile 目录解析，失败仅告警不阻断）
home = os.environ.get("HOME", "")
webdir = os.path.join(home, ".dsh", "profiles", "web")
if os.path.isdir(webdir):
    code = (
        "const {createRequire}=require('module');"
        "const r=createRequire(process.cwd()+'/x.js');"
        "const ps=['@deepseek-ai/dsh-vision-adam','@deepseek-ai/dsh-taste',"
        "'@local/dsh-btw','@local/dsh-wallpaper'];"
        "const bad=ps.filter(p=>{try{r.resolve(p+'/package.json');return false}"
        "catch{return true}});"
        "if(bad.length){console.error('MISSING '+bad.join(','));process.exit(1)}"
        "console.log('packages resolve OK: '+ps.join(', '));"
    )
    try:
        r = subprocess.run(["node", "-e", code], cwd=webdir,
                           capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            print(f"[apply] {r.stdout.strip()}")
        else:
            print(f"[apply][warn] 包解析校验异常: {r.stderr.strip()}")
    except Exception as e:
        print(f"[apply][warn] node 包解析校验跳过: {e}")
else:
    print(f"[apply][warn] 未找到真实 web profile 目录 {webdir}，跳过包解析校验")

print("[apply] done.")
PY
