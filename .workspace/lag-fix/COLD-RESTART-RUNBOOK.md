# 冷面批次重启 · 一页 Runbook（2026-09-22）

> 状态：**已落盘待激活**。所有候选件已写入磁盘且逐字节校验通过；**宿主进程内仍是旧代码**，
> 因此在你确认重启前，`session.list` 等路径**依旧是慢/超时的**。

## 0. 这次重启会激活什么

| 单元 | 文件 | 落点 sha256-12 | 预期效果（离线/部署源实测） |
|---|---|---|---|
| **U-HR1** header 扫描 memo | `dsh-session-persistence-jsonl/lib/index.js` | `4c7059e7b1b4` | awaits **10 868 → 20（543×）**、`list()` p50 **137.4 → 2.41 ms**、memo 命中 **0 per-session IO** |
| **U-HR4** 冷扫描有界并发 | 同上 | 同上 | 冷扫描 **197.0 → 69.2 ms（2.85×）**；跳数 **8.94 → 2.25/目录**；工作量不变（awaits/syscall 两臂相等） |
| **U-HR2** signal 传递（2 处） | `dsh-host-apiproxy/lib/index.js` | `a6fe1ae90e8e` | 止住"客户端放弃后仍跑完 8 490 跳"的积压自我放大 |
| **U-HR3** 单次折叠快照 | 同上 | 同上 | 重会话每请求省 **16.75 ms**；行值 10/10 逐字节不变 |
| **U-CB1** `lastIngest` 回写 | `@local/dsh-usage/lib/index.js` | `eae532a7…`(组合) | `/usage/refresh` 后 `lastIngest` **会前进**（缺陷只存在于 worker 路径） |
| **U-CB2** 开启 45s ingest timer | 同上 | 同上 | 周期 ingest 自动跑（G1 活体 PASS：7 835 ms pass 期间心跳 max 148.5 ms、0 拍 >200 ms） |
| **CB3b** deploy-side 闸门 | `.workspace/workstreams/side-deploy/deploy-side.sh` | `b0c22b32…` | 默认 dry-run + 事前/事后指纹闸门 |

**不在本批激活**（另批）：`U-BOOT1` 压缩（候选就绪，为避免与本批效果混淆而暂缓）、`U-BOOT2` 启动两段式断言（执行中）。

## 1. 前置检查（重启前，只读）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-cold-batch
node scripts/verify-deployed-manifest-v1.mjs --phase pre-deploy-baseline      # 期望 MATCH / exit 0
node scripts/verify-deployed-manifest-v1.mjs --phase expected-after-cold-batch # 期望 MISMATCH / exit 1（= 已改待生效）
cd ../exec-hostrpc && node apply-HostRPC-v1.mjs                               # 期望 ALREADY-PATCHED、0 写入
```

## 1.5 客户端补丁落地（**在重启之前**，只为把"必须刷新"的代价合并掉）

⚠️ **背景（已活体实测）**：**写任一客户端插件的 `lib/client.js` 都会经 HMR 热刷新打断用户已打开的页面**（实测：仅追加一个注释即推 `rebuilt` 帧；若该插件有"被其它槽消费的服务"，消费者会在服务重建窗口内抛
`ui-conversation: conversation service unavailable` ⇒ 会话区**当场空白直到强刷**）。
⇒ 因此**客户端写入要与重启合批**：先落客户端（用户界面可能短暂异常），随即重启（用户本来就要刷新/重连），
**不额外多一次刷新代价**。

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix
# ① a11y 三单元（六臂渲染级二分已证明字节渲染中性；含 §5.7 裁决 B 的 Shift+F10 版）
cd exec-a11y && for u in 1 2 4; do node scripts/apply-A11y$u-v1.mjs --apply; done && cd ..
# ② 投影 rAF + 键闸门（同批；白名单保留 subagentTiming；既有标记必须原样）
cd exec-proj && node scripts/apply-ProjGate-v1.mjs --apply && node scripts/apply-ProjGate-v1.mjs --verify && cd ..
# ③ btw 调宽高 R2（41/41 真机 PASS；必须落 profile 挂载位并核响应体 sha256 = ca6cc0ec…）
cd exec-btw-resize && node scripts/apply-BtwResize-v1.mjs --apply --confirm-apply && node scripts/apply-BtwResize-v1.mjs --verify && cd ..
# ④ U-BOOT2 启动解绑（壳层 dist 资产；**失败模式是白屏 ⇒ 落地后必须先自检**）
cd exec-boot2 && node scripts/apply-Boot2-v1.mjs --apply && cd ..
```

### 1.6 ⚠️ U-BOOT2 落地后的**强制自检**（不过就回滚，绝不让用户看到白屏）

`U-BOOT2` 改的是壳层 `dist/assets/index-ClqxG24t.js`（候选 409,299 B / sha1-12 `29e6dacfe2c4`），
其**失败模式就是整屏只剩壁纸**（`tier="wire12"` 已复现过该事故类别）。因此：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix
# 复用 a11y 线已建好的"整屏可渲染"探针（无真实会话也能验外壳）
node exec-a11y/probes/verify-render.mjs --arms=none --dpr=1
# 期望：关键 data-slot（sidebar / conversation.session / conversation.composer / details）存在且可见面积 >0、
#       正文非空、pageerror=0、console.error=0、插件失败界面不出现
# 不通过 ⇒ 立即回滚：
node exec-boot2/scripts/apply-Boot2-v1.mjs --rollback
```

**U-BOOT2 的裁决与口径（2026-09-22 协调者裁定）**：
- 审计写的"首屏闭包 = **12 条 / 1.30 MB**"**实测不可用**（`tier="wire12"` 下 50 包全 active 但 shell 抛
  `'root' has no registration` ⇒ **只剩壁纸**）。根因：那 12 条只覆盖 wire `inject` 的**服务依赖**，
  漏掉**槽位注册**（`ui-layout` 的 `root@520` 在 wire 图里不可见；审计自己的 inventory 已把它标为
  `shell_essential` ⇒ **审计内部两处口径不一致**）。
- ⇒ **采纳执行档的保守切分**：**必需 = 30 条**（含 `ui-layout`/`ui-sidebar`/`ui-conversation`/`ui-workspace`
  及全部 `shell_essential`/`partial`），**延后 = `deferrable=yes` − `immediately` = 20 条 / 5,431,021 B**；
  **未知 id 一律按必需**；`tier="wire12"` 保留为**诊断模式**（保留证伪能力）。
- **收益口径更正**：延后集 **5.43 MB**（与 `w08` 的"可延迟 5.43 MB = 45.7%"一致）⇒ 收益未缩水。
- **实测**：扣住 4.1 MB 非首屏包 +1.5 s ⇒ 挂载位移 **基线 +1481 ms → 补丁 −56 ms**；**阴性对照**（扣首屏必需包）
  **仍 +1341 ms**；`tier="all"` 回到 **+1376 ms**；整屏可渲染 **12/12**；50 包零回归。
- ⚠️ **维护代价**：**只能改 dist**（无源码树 ⇒ `dsh` 升级会静默覆盖，重跑 dry-run 会以 `ANCHOR_FAIL` 拦住）；
  该资源**无 `cache-control`/`ETag` 且补丁改内容不改名** ⇒ **部署后必须硬刷新**。
**回滚**：各自 `--rollback`（逐单元字节级还原）；btw 用 `preimage-profile-1655/` 快照。

## 2. 重启（**会终结当前宿主进程** → 本会话进程内记忆丢失，浏览器自动重连、会话自动 resume）

```bash
# 分离执行，确保重启器不受宿主退出影响
setsid nohup bash -c '
  sleep 2
  bash /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh --yes
' > /tmp/dsh-restart-run.log 2>&1 &
```

- 干跑预览（不杀不启）：把 `--yes` 换成 `--dry-run`
- 脚本行为：SIGTERM（有界 15s dispose）→ 等退出与端口释放 → `setsid` 分离启动 → 冒烟轮询 HTTP 200（上限 30s）
- **重启后**：浏览器重新连接即自动恢复本会话；重新进入后**说一句"继续"**，我接着跑第 3 节。

## 3. 重启后验收链（按序执行）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix

# 3.1 部署态指纹（应为 expected-after-cold-batch ⇒ MATCH / exit 0）
node exec-cold-batch/scripts/verify-deployed-manifest-v1.mjs --phase expected-after-cold-batch

# 3.2 lastIngest 是否前进（期望 advanced=true）
node exec-ingest/tools/g1-live.mjs

# 3.3 45s timer 验收（3 窗 ×120s；期望 ACCEPT；硬回滚线 = 单拍 >1000ms）
node exec-cold-batch/scripts/accept-U-CB2-timer.mjs

# 3.4 host RPC 冒烟（先冒烟再全量）
cd exec-hostrpc
node scripts/verify-postdeploy.mjs --singles 3 --waves 1
node scripts/verify-postdeploy.mjs --singles 20 --waves 5     # 完整并发矩阵

# 3.5 用户可见的关键判据（绝对量为主，比值仅作解释）
for i in 1 2 3; do curl -s -m 40 -o /dev/null \
  -w "  single#$i HTTP=%{http_code} time=%{time_total}s\n" \
  -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"v'$i'","method":"session.list","payload":{}}'; done
# 并发 4 路
for i in 1 2 3 4; do curl -s -m 60 -o /dev/null \
  -w "  lane$i HTTP=%{http_code} time=%{time_total}s\n" \
  -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"c'$i'","method":"session.list","payload":{}}' & done; wait
```

**判据（重启前实测基线：单发 32.6 s / 超时 / 35.3 s；4 路全部 60 s 超时）**

| 判据 | 目标 |
|---|---|
| 单发 p50 | **≤150 ms**（×20 次） |
| **4 路并发 p50** | **≤150 ms**、**max ≤300 ms**（**绝对量为主**） |
| 比值（4 路 ÷ 单发） | 仅作解释上报（**修复后该比值会天然趋近 ~2，不具判别力**） |
| memo 命中时 per-session IO | **0**（跳数断言） |
| abort 反事实 | 200 ms abort 后 1 s 内 `host.describe` p50 回 ≤5 ms |

## 4. 逐单元回滚

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix
node exec-hostrpc/apply-HostRPC-v1.mjs --rollback all --from-preimage   # 两个宿主文件（我的写入未经其工具登记 ⇒ 必须 --from-preimage）
node exec-cold-batch/scripts/apply-CB2-v1.mjs --rollback                # 先回 CB2（常量）
node exec-cold-batch/scripts/apply-CB1-v1.mjs --rollback                # 再回 CB1
```
回滚后同样需要一次重启才生效。

## 5. 已知限制（不改口径）

1. **字面 `<100 ms` 心跳阈值在本机不可判定**（静默噪声地板 336–446 ms）⇒ timer 验收按**量级判据**，硬回滚线 = 单拍 **>1000 ms**。
2. `verify-postdeploy.mjs` 的 live 路径**未经端到端验证**（探针锁长期被兄弟线占用）⇒ 先跑 `--singles 3 --waves 1` 冒烟。
3. **U-HR3** 有一处已声明语义变更：subagent 行的 `updatedAt/blank/lastPromptAt` 改为"请求开始时刻"的快照（排序键与显示值现取自同一时刻）；冻结输入下 10/10 行值逐字节不变。若要完全等价，`--rollback all --from-preimage` 后 `--apply --skip U-HR3`。
4. 本批**不含** `U-BOOT1`（压缩）与 `U-BOOT2`（启动解绑），避免效果归因混淆。
