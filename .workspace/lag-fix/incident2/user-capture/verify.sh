#!/usr/bin/env bash
# verify.sh —— 对「取证套件」跑一遍可复现的验证，并把结果打到 stdout。
# 纪律：只读；不重启任何进程；不修改产品文件。
#
# 用法：  bash verify.sh
# 退出码：0 全部通过 · 非 0 有失败项
set -uo pipefail
cd "$(dirname "$0")"

FIXTURE="fixtures/real-settings-trace.json"
TOOL="dsh-jank-capture.html"
PARSER="parse-trace.mjs"
FAIL=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }

echo "════════════════════════════════════════════════════════════"
echo " 取证套件验证（$(date '+%Y-%m-%d %H:%M:%S')）"
echo "════════════════════════════════════════════════════════════"

echo
echo "[1] 交付物存在性"
for f in "$PARSER" "$TOOL" "RUNBOOK-USER-CAPTURE.md" "$FIXTURE"; do
  if [ -s "$f" ]; then pass "$f ($(stat -c%s "$f") bytes)"; else fail "$f 缺失或为空"; fi
done

echo
echo "[2] parse-trace.mjs 内部自检（30 项：分桶/分位/task 解析/分项归类/形态判别/两条端到端链路）"
if node "$PARSER" --self-test > /tmp/_st.txt 2>&1; then
  pass "$(tail -1 /tmp/_st.txt | tr -d ' ')"; else fail "自检未通过"; sed -n '1,40p' /tmp/_st.txt; fi

echo
echo "[3] 真实 trace 可解析（形态判别 + 事件计数）"
node -e '
const fs=require("fs"),zlib=require("zlib");
let b=fs.readFileSync(process.argv[1]);
if(b[0]===0x1f&&b[1]===0x8b)b=zlib.gunzipSync(b);
const d=JSON.parse(b.toString("utf8"));
if(!Array.isArray(d.traceEvents)){console.error("no traceEvents");process.exit(1)}
console.log("events="+d.traceEvents.length);
' "$FIXTURE" > /tmp/_ev.txt 2>&1 && pass "trace 有效 JSON：$(cat /tmp/_ev.txt)" || fail "trace 不可解析：$(cat /tmp/_ev.txt)"

echo
echo "[4] 解析真实 trace 并产出报告（--rev 投喂当前已落地 rev）"
if node "$PARSER" "$FIXTURE" \
     --rev 'ui-layout=82cca1a6178a,runtime=5559de4ce28c,usage=4536b91ed282,wallpaper=826d9217a8fc' \
     --json /tmp/_rep.json > /tmp/_out.txt 2>&1; then
  pass "退出码 0，报告 $(wc -c < /tmp/_out.txt) 字节"
else
  fail "解析失败"; sed -n '1,20p' /tmp/_out.txt
fi

echo
echo "[5] 报告必含四个关键小节"
for sec in "点击前后" "最长任务 top 10" "Script / RecalcStyle / Layout / Paint 分项" "已知修复项命中判定"; do
  if grep -q "$sec" /tmp/_out.txt; then pass "含「$sec」"; else fail "缺「$sec」"; fi
done

echo
echo "[6] 锚点判定为 high 置信度（点击证据被抓到）"
if grep -qE '置信度 +: high' /tmp/_out.txt; then pass "$(grep -E '判定依据' /tmp/_out.txt | head -1 | sed 's/^ *//')"; else fail "锚点置信度不是 high"; fi

echo
echo "[7] 帧分布 6 档齐全"
n=$(grep -cE '(<16\.7|16\.7–33|33–50|50–100|100–250|>250)' /tmp/_out.txt)
if [ "$n" -ge 6 ]; then pass "6 档分桶齐（命中 $n 行）"; else fail "分桶不全（$n 行）"; fi

echo
echo "[8] 分项四项都有数值（Script/RecalcStyle/Layout/Paint）"
n=$(grep -cE '(Script（JS 执行）|RecalcStyle（样式重算）|Layout（布局）|Paint/Raster/Composite)' /tmp/_out.txt)
if [ "$n" -ge 4 ]; then pass "四项齐（命中 $n 行）"; else fail "分项不全（$n 行）"; fi

echo
echo "[9] 函数级归属可用（FunctionCall 口径）"
if grep -q "窗口内函数级占用" /tmp/_out.txt; then
  pass "$(grep -A3 '窗口内函数级占用' /tmp/_out.txt | sed -n '3p' | sed 's/^ *//')"; else fail "无函数级归属表"; fi

echo
echo "[10] CPU profile 采样占比可用（前提：录制勾了 JS 采样）"
if grep -q "CPU profile 函数级自耗时" /tmp/_out.txt && grep -q "采样总数" /tmp/_out.txt; then
  pass "$(grep '采样总数' /tmp/_out.txt | sed 's/^ *//' | cut -c1-70)"; else fail "无 CPU profile 段落"; fi

echo
echo "[11] 已知修复项判定：当前已落地 rev 应全部命中"
for k in ui-layout runtime usage wallpaper; do
  if grep -A2 "^  \[$k\]" /tmp/_out.txt | grep -q "命中（已修复构建）"; then pass "$k = PRESENT"; else fail "$k 未命中"; fi
done

echo
echo "[12] 反向对照：喂旧 rev 必须判为「未命中」并以退出码 3 结束（--require-rev）"
node "$PARSER" "$FIXTURE" \
  --rev 'ui-layout=af19ea709a1556b8c48bedfa8b31e785,runtime=000000000000,usage=000000000000' \
  --require-rev ui-layout=82cca1a6178a > /dev/null 2>/tmp/_neg.txt
rc=$?
if [ "$rc" -eq 3 ]; then pass "按预期拒绝（退出码 3）：$(tail -1 /tmp/_neg.txt | sed 's/^ *//')"; else fail "退出码应为 3，实际 $rc"; fi

echo
echo "[13] 形态判别：user-capture JSON 也能被同一解析器吃下"
node -e '
const fs=require("fs");
const doc={schema:"dsh-user-capture/v1",source:"inpage",sessionId:"verify",durationMs:8000,
 frames:Array.from({length:40},(_,i)=>({t:i*100,gap:i===20?180:16.7})),
 longTasks:[{name:"self",startTime:2000,duration:120,attribution:[{name:"x"}]}],
 loaf:[{startTime:2050,duration:240,blockingDuration:190,scripts:[{duration:200,sourceFunctionName:"refreshThemeColor",sourceURL:"http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layout/client.js?rev=82cca1a6178a",forcedStyleAndLayoutDuration:150}]}],
 events:[{name:"click",duration:30,startTime:2100}],
 interactions:[{t:1980,type:"click",isSettings:true,label:"设置",selector:"button"}],
 anchor:{t:1980,how:"click-on-settings-like-control"},
 targetRev:{all:{"dsh-client-ui-layout":"82cca1a6178a","dsh-client-runtime":"5559de4ce28c"}}};
fs.writeFileSync("/tmp/_uc.json",JSON.stringify(doc));
'
if node "$PARSER" /tmp/_uc.json > /tmp/_uc.txt 2>&1; then
  if grep -q "强制同步样式/布局\|forcedStyleAndLayout" /tmp/_uc.txt; then
    pass "识别为 dsh-jank-capture.html (inpage) 并给出 forcedStyleAndLayout 证据"
  else fail "识别成功但缺 forcedStyleAndLayout 证据"; fi
else fail "user-capture JSON 解析失败"; sed -n '1,10p' /tmp/_uc.txt; fi

echo
echo "[14] 坏输入必须友好报错、不得崩溃栈外泄"
echo 'NOT JSON AT ALL {{{' > /tmp/_bad.json
if node "$PARSER" /tmp/_bad.json > /tmp/_bad.txt 2>&1; then
  fail "坏输入竟然退出码 0"
else
  if grep -q "常见原因" /tmp/_bad.txt && ! grep -q "at Object.<anonymous>" /tmp/_bad.txt; then
    pass "友好报错（含排查提示、无栈）"
  else fail "报错信息不够友好"; fi
fi

echo
echo "[15] 单位铁律回归：帧分布不得恒为 0（曾因 µs/ms 混用导致窗口全空）"
frames=$(grep -oE '帧数 +: [0-9]+' /tmp/_out.txt | head -1 | grep -oE '[0-9]+')
if [ "${frames:-0}" -gt 0 ]; then pass "窗口内帧样本 = $frames（>0）"; else fail "窗口内帧样本为 0（单位混用回归）"; fi

echo
echo "[16] 单文件 HTML 工具：零外部依赖"
ext=$(grep -oE '(src|href)="https?://[^"]+' "$TOOL" | wc -l)
if [ "$ext" -eq 0 ]; then pass "无任何外部 http(s) 资源引用（自包含）"; else fail "存在 $ext 处外部资源引用"; fi
if grep -q "PerformanceObserver" "$TOOL" && grep -q "long-animation-frame" "$TOOL" && grep -q "longtask" "$TOOL"; then
  pass "含 PerformanceObserver / longtask / long-animation-frame 采集逻辑"
else fail "缺少必要的采集逻辑"; fi

echo
echo "════════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  printf ' 全部通过 \033[32m(0 failures)\033[0m\n'
else
  printf ' \033[31m%s 项失败\033[0m\n' "$FAIL"
fi
echo "════════════════════════════════════════════════════════════"
exit "$FAIL"
