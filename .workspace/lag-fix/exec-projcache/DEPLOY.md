# DEPLOY.md — U-PC1 / U-PC2 落地与回滚说明

> 依据：`.workspace/lag-fix/program/w21-storage/audit.md` §5 候选 2 / 候选 3。
> 候选件、脚本、原始证据全部在本目录：`.workspace/lag-fix/exec-projcache/`。
> **本档没有写任何工作区之外的文件**；部署写入由主 agent 执行（见下）。

---

## 1. 落地对象（3 个文件，均在宿主的 `@deepseek-ai` 部署位）

```
ROOT = /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
  $ROOT/dsh-storage-json/lib/index.js                  (10568 B 原始)
  $ROOT/dsh-storage-domain/lib/index.js                (15808 B 原始)
  $ROOT/dsh-session-projection-cache/lib/index.js      (12194 B 原始)
```

两个交付单元**各自独立可回滚**，且都是**热面改动**（无磁盘布局迁移、无 `version` bump）：

| 单元 | 内容 | 变更文件 | 落盘后字节（实测） |
|---|---|---|---|
| **U-PC1** | per-unit 紧凑序列化：`serialize(name, state, pretty = true)`；`descriptorOf()` 透传 `spec.pretty`；`session_projcache` spec 加 `pretty: false` | 3 个 | 10914 / 16135 / 12594 |
| **U-PC2** | 同一 interval 内所有脏会话**合并为一次发布**：`JsonKvUnit.putRecords` + `KvTableImpl.putMany`（支持 **thunk**：切点在域链链节内求值）+ projcache 共享 `batchTimer` / `batchStopped` / `flushBatch` / `hasPending` / `markClean` / `markDirty` + 半补丁能力探测退化 | 3 个 | 12170 / 18076 / 19369（U-PC1 之上） |

**明确不做（与审计一致）**：不动 `version`；不做介质迁移；不碰 `workspace` / `message_feedback` 的
介质格式（U-PC1 的开关默认仍是 pretty ⇒ 这两个权威件的盘上字节**逐字节不变**，E3/E5 已硬断言）；
不删 `_pristine`/pre-image；不改 `writeEveryEvents` / `writeIntervalMs` 配置；不改 `.d.ts`
（类型层未同步 `pretty` / `putRecords` / `putMany`，属纯类型缺口，**运行时零影响**）。

---

## 2. 落地命令（主 agent 执行）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-projcache

# ① 干跑（默认；一个字节都不写）：先看 13 条锚点是否**唯一命中**
node apply-ProjCache-v1.mjs --json=raw/apply-dryrun.json

# ② 落地 U-PC1（自动写 pre-image + node --check + 幂等自证）
node apply-ProjCache-v1.mjs --apply --unit=U-PC1 --json=raw/apply-upc1.json

# ③ 落地 U-PC2（必须**在 U-PC1 之后**；其 pre-image 以 U-PC1 已应用为前提）
node apply-ProjCache-v1.mjs --apply --unit=U-PC2 --json=raw/apply-upc2.json

# 也可一次落地（脚本内部按 U-PC1 → U-PC2 顺序**累积**解析，结果与分两次逐字节相同，已自证 T4b）
node apply-ProjCache-v1.mjs --apply --unit=U-PC1,U-PC2

# ④ 核对盘面状态
node apply-ProjCache-v1.mjs --verify
```

落地**之前**（在镜像上）请先确认下列自证仍是全绿（本档最后一次运行的结果就在这些 JSON 里）：

```bash
node tools/selftest-apply.mjs   raw/selftest-apply.json     # 期望 ALL PASS 11/11
node tools/upc1-equiv.mjs       raw/upc1-equiv.json         # 期望 ALL PASS 6/6
node tools/upc2-regressions.mjs raw/upc2-regressions.json   # 期望 ALL PASS 5/5
```

**脚本的四条硬保证（均已在 `mirror/deploy` 这个**逐字节镜像**上自证，见 `raw/selftest-apply.json` 11/11 PASS）**：

1. **锚点唯一命中否则零写入**：13 条编辑先全部解析；任何一条 `MISSING`/`AMBIGUOUS` 就整体放弃（`write.performed=false`）。
2. **自动 pre-image**：`preimage/_pristine/<pkg>/lib/index.js`（真正的原始件）+ `preimage/U-PC1/…` + `preimage/U-PC2/…`；已存在则不覆盖（保证可幂等重跑）。
3. **`node --check` 门禁**：写完后立刻语法检查，失败即从该文件 pre-image 还原并退出非零。
4. **幂等**：重复 `--apply` 内容逐字节不变（T4）；**累积门禁**：`--unit=U-PC1,U-PC2` 与分两次的结果逐字节相同（T4b）。

---

## 3. 生效路径（⚠️ 需主 agent 确认）

- 本次改动落在**宿主侧** `dsh-storage-json` / `dsh-storage-domain` / `dsh-session-projection-cache` 的 `lib/`，
  **不是客户端插件 ⇒ 不触发 HMR**，**刷新页面不够**。
- 审计 §5 候选 2 的热/冷面判定为：**热面**，"`dsh-storage-json` 是宿主插件，需**重载该插件**即可生效，不必全量重启"。
  **本档未实测生效路径**（无法在不重启/不重载宿主的前提下验证新 lib 被加载）⇒ 请由主 agent 按自己的重启纪律裁决。
- 无论走哪种重载方式，**介质层没有任何需要搬迁的东西**：旧代码能直接读新写的紧凑介质（E4 逐条硬断言）。

---

## 4. 部署后自检（不需要注入仪器，三条廉价硬指标）

```bash
# ① projcache 介质应在一个 interval 内从 ~11.5 MB 掉到 ~5.35 MB（U-PC1 生效）
stat -c '%s %y %n' ~/.dsh/storages/session_projcache.json
#   期望: ~5349251（±5%）；仍是 11520185 ⇒ U-PC1 未生效（未重载成功）

# ② 权威件必须保持 pretty / 字节不变（per-unit 开关生效）
head -c 60 ~/.dsh/storages/workspace.json ; echo
stat -c '%s' ~/.dsh/storages/workspace.json          # 期望: 11382 ±（工作区增删会变，量级不变）
stat -c '%s' ~/.dsh/storages/message_feedback.json   # 期望: 639

# ③ 发布率（U-PC2 生效）：复用审计的仪器，事件式 inotify + 阳性对照
node .workspace/lag-fix/program/w21-storage/tools/w21-freq.mjs raw/post-freq.json 240
#   期望: rename 速率从 1.8417 次/s 降到 ≤ 0.25 次/s（本档同窗复现：−90% / −91.5%）
```

⚠️ 判据纪律（审计 §6.3）：任何时候都**只比同窗比值**；"机器安静"门禁已被证伪（空闲 20 s 内仍有 24 事件），
所以部署前后的绝对值必须标注并发条件，且 `w21-freq.mjs` 自身带 1:1 阳性对照才算有效。

---

## 5. 回滚

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-projcache

# 退 U-PC2（回到"仅 U-PC1"态；逐字节还原到 U-PC2 pre-image）
node apply-ProjCache-v1.mjs --rollback=U-PC2 --json=raw/rollback-upc2.json

# 退 U-PC1（回到 pristine）
node apply-ProjCache-v1.mjs --rollback=U-PC1 --json=raw/rollback-upc1.json

# 或者一次全退（从 _pristine 还原三个文件）
node apply-ProjCache-v1.mjs --rollback=all
```

**回滚语义（已自证 T5–T8）**：

- 每个单元的回滚都做**逐字节 sha256 校验**（`rollback.byteExact` 必须为空数组）；
- **顺序门禁**：U-PC2 仍应用时拒绝 `--rollback=U-PC1`（非零退出、零写入），因为 U-PC1 的 pre-image 里没有 U-PC2 的改动 —— 请先退 U-PC2 或直接用 `--rollback=all`；
- **介质不需要回滚**：紧凑 JSON 与 pretty JSON 对 `JSON.parse` 完全等价。硬证据 E4：**未打补丁的旧代码**重开新代码写的紧凑介质，3,109 条记录**逐条 `deepStrictEqual`** 通过。双向可读 ⇒ 代码回滚后介质原样可用。

---

## 6. 风险与注意事项

| 项 | 说明 |
|---|---|
| U-PC1 的唯一取舍 | 破坏 `dsh-storage-json:56-61` 自述的"人类可读"设计意图 —— 但**只对 `session_projcache` 生效**；`workspace`/`message_feedback` 仍 pretty（E3/E5 证明字节不变）。若想彻底保留可读性，把 `pretty: false` 从 spec 里去掉即回到全 pretty。 |
| U-PC2 的失败语义变化 | 批写失败会**同时**影响该批所有会话（原本只影响一个）。已用"重新标脏 + 重排 timer"收窄为**一次 interval 后重试**（原始代码**失败后根本不重试**，要等下一个事件）⇒ 失败路径严格更好。已注入一次失败实测：`retriedAfterFailure=true`、`recordsMismatchedAfterRetry=0`。 |
| U-PC2 的强制点 | `turn/end` 与 `session/disposed` **仍是同 tick 立即写**，不被批处理（实测 publish 发起延迟 33–76 ms，全部 < 100 ms 阈值；延迟来自 11.5 MB 全量重写本身）。公开 `write(session)` 也**未被批处理**。 |
| ⚠️ U-PC2 的三个文件请**尽量一次性落地** | 中间态（新 projcache + 旧 `dsh-storage-domain`）已被**实测覆盖**：`flushBatch` 探测到 `table.putMany` 缺失时会**退化为逐会话 `put`**（= 补丁前行为），不会抛错、不会饿死写路径（回归 R4 用真实混合装配树验证）。即便如此，仍建议同批写入以免中间态降级运行。 |
| ⚠️ 对抗性复核发现已被修复 | 独立复核（`raw/review-U-PC2.md`）在 U-PC2 **初版**上证实了 3 条缺陷（陈旧 cut 覆盖新 cut / 单会话 flush 失败饿死全批 / 卸载后无限重试）。**当前候选已全部修复**，并用 `tools/upc2-regressions.mjs` 的 R1–R5 定向回归（含检测器阳性对照）复验 5/5 PASS。落地前请确认 `raw/upc2-regressions.json` 的 `pass=true`。 |
| U-PC2 的崩溃窗口 | 同窗实测：每会话未落盘事件数 / 陈旧度的 p50/p95/max 与旧实现**统计上不可区分**（见 `report.md` §U-PC2 ③）。 |
| 观测手段 | 宿主的 `log.warn` 是黑洞（w20 实测），**不要**指望用日志做观测；本档所有证据走文件 + 自己的探针。 |
| 探针锁 | 本档**未持探针锁**（`w23-nav` 持锁且 ALIVE，未回收）⇒ 所有窗口标 `CONTENDED`，只用比值。 |

---

## 7. 交付物清单

```
exec-projcache/
  apply-ProjCache-v1.mjs          锚点制补丁脚本（dry-run 默认 / --apply / --rollback / --verify）
  report.md                       逐单元验证报告（含同档自复核 PASS/REWORK、失败与 invalid 保留）
  DEPLOY.md                       本文件
  tools/selftest-apply.mjs        脚本在逐字节镜像上的 11 项自证（T0–T8）
  tools/upc1-bench.mjs            U-PC1 同窗 A/B 耗时与字节
  tools/upc1-equiv.mjs            U-PC1 语义等价 6 组硬断言（E1–E6）
  tools/upc2-harness.mjs          U-PC2 同窗 A/B：发布数 / 全量记录核对 / 崩溃窗口 / 强制度
  tools/upc2-regressions.mjs      U-PC2 定向回归 R1–R5（复核 F1–F5 的断言化 + 检测器阳性对照）
  raw/review-U-PC2.md             独立对抗性复核报告（F1–F8，156 行）
  mirror/                         逐字节镜像 + old/pc1/pc2/both 四个代码变体（可重建）
  mirror/node_modules ->          真实 dsh node_modules（只读）
  preimage/                       自动 pre-image（_pristine / U-PC1 / U-PC2）
  media/                          真实介质只读快照（session_projcache / workspace / message_feedback）
  raw/                            全部原始 JSON 证据
```
