# 重启后验收 Runbook（冷面批次：dsh-usage + B1）

> 本批冷面内容：`dsh-usage`（U-IG1 worker/runner + U-IG3 重复键 + rpc 去重 + index 接线、**timer 关闭**）+ `ingest-cc`（U-CC1）+ apiproxy（U-B1）。
> 热面已生效且已验收：主题批（rev 一致 + A/B）、U-P2AC、U-R4 client 半。

## 0) 前置（应看到新 PID 与 HTTP 200）

```bash
cd /home/CNS2026495165/dsh
pgrep -af 'bin/dsh web'
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3080/
```

## 1) 插件是否正常加载（worker/runner 若加载失败会立刻暴露）

```bash
curl -s -X POST http://127.0.0.1:3080/usage/status -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"v1","method":"status","payload":{}}' | head -c 400
```
期望：`ok:true`、`dbPath` 非空、`lastIngest` ≈ 启动时刻（首扫）。

## 2) 会话列表回归哨兵（B1）

```bash
curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"v2","method":"session.list","payload":{}}' \
  | python3 -c "import sys,json;v=json.load(sys.stdin)['result']['value']['items'];top=[i for i in v if i.get('origin')!='subagent'];print('items',len(v),'顶层',len(top),'带 runningSubagentCount 的顶层',sum(1 for i in top if isinstance(i.get('runningSubagentCount'),int)))"
```
期望：HTTP 200、`ok:true`、顶层条目数与 90 左右相符、**顶层行全部带 `runningSubagentCount`（number）**。

## 3) B1 的 A6 活体硬断言（重启前必然不成立，重启后才是硬判据）

```bash
cd .workspace/lag-fix/exec-b1 && node run-all.mjs --post
```
期望：A6-live PASS（冷路径入选集合 == 按键降序前 200）。

## 4) G1 活体：一次完整 ingest pass 期间宿主是否仍可响应

```bash
cd .workspace/lag-fix/exec-ingest && node tools/g1-live.mjs
```
判据：**心跳 max < 100 ms**（同时打印 `lastIngest 推进`）。对照：未 worker 化时该 pass 为 2.68 s（冷 36.1 s）。
> ⚠️ 不要改用 `perf_hooks.monitorEventLoopDelay`：它会丢弃 `reset()` 后的第一个样本（3 s 阻塞报 10 ms）。

## 5) U-IG3：真实规模下 UNIQUE 归零

```bash
cd .workspace/lag-fix/exec-ingest && node tests/run-ig3-acceptance.mjs 2>/dev/null || ls tests/ out/ | head
```
期望：`failedDsh/failedCc` 不再因子聚合重复键增长；`usage_daily` 与 events 逐键 `mismatched=orphan=0`。

## 6) U-CC1：CC 游标修复在 deployed 上复验

```bash
cd .workspace/lag-fix/research-v2/cc-cursor
node repro-cc-cursor.mjs --lib /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib --tag deployed-after
```
期望：**NO_LOSS**（`events=2`、`last_offset=size`）；修复前同脚本为 `LOSS_CONFIRMED`。

## 7) G5：等价套件（端到端回归）

```bash
cd .workspace/lag-fix/research-v2/ingest-equiv && bash run-suite.sh 2>&1 | tail -20
```

## 8) timer 是否启用（本批**必须仍为关闭**）

```bash
grep -n "INGEST_TIMER_ENABLED" /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js | head -3
```
期望：常量值为 `false`。**只有 §4 的 G1 通过后**才允许改 `true` 并再重启一次（这是本批遗留的唯一"待启用"项）。

## 9) 热面复验（无需重启）

```bash
cd .workspace/lag-fix/r4-delivery && node client-stale-probe.mjs --label after-restart   # 期望 PASS
cd .workspace/lag-fix/exec-theme && node experiments/verify-functional.mjs               # 主题功能回归
```

## 回滚（按铁律，逐单元）

```bash
# B1（冷面）
cd .workspace/lag-fix/exec-b1 && bash ../backup/B1/server/b1fix2-*/rollback.sh   # 或按 LANDING-LOG §1 手工
# 主题批（热面）
cd .workspace/lag-fix/exec-theme && node apply-Theme-v1.mjs --restore 20260921092148.
# ingest 批次（冷面）
cd .workspace/lag-fix/exec-ingest && node apply-Ingest-v1.mjs --rollback        # 或按 pre-image 目录手工
# CC（冷面）
cp .workspace/lag-fix/backup/CC-cursor-20260921-091207/pre-ingest-cc.js /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/ingest-cc.js
# P2AC（热面，次序铁律 P2AC → B1/C1 → C1）
cd .workspace/lag-fix/exec-p2 && node apply-P2AC.mjs --rollback
```
