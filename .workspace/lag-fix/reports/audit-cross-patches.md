# 独立审计：五单元补丁的完整性 / 幂等性 / 回滚可还原性 / 回滚所有权（交叉审计）

- **审计员**：独立审计档（未参与任何补丁的设计与落地）
- **审计时间窗**：2026-09-20 16:03 → 16:12 CST
- **宿主**：PID **20806** `node .../bin/dsh web`，启动时间 11:47:23，审计期间 etime 04:19 —— **全程未重启、未发信号、未发压测**
- **写入纪律**：唯一写入 = `/tmp/patch-audit/`（已在结束前清理）+ 本报告文件。**未触碰任何真实 live**；所有 live 目标在审计首尾的 sha256 逐位一致（见 §7）
- **审计范围**：`patches/{usage-plugin.sh, server-session-filter.sh, workspace-ui-runsubagent-count.sh, client-runtime-perf.sh, workspace-enhancement-perf.sh}`

---

## 0. 结论摘要

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 落地完整性 | ✅ **五单元全部完整落地，无半应用**；四个单元可由 pre-image 逐字节复现 live（§1.3） |
| Q2 | 幂等性 | ✅ 五个单元重复 apply 均 SKIP/拒绝（§2）；⚠️ `client-runtime-perf.sh --dry-run` 在 live 现状下 **exit 1 且输出自相矛盾**（D4） |
| Q3 | 回滚可还原性 | ✅ 6 个 live 目标全部**逐字节还原**（§3） |
| Q4 | 回滚所有权校验 | ✅ C1/usage/C2 fail-closed（8/8 拒绝）；❌ **B1/B1C1 两脚本只校验路径不校验内容 → fail-open**（D3） |
| Q5 | 误伤无关文件 | ⚠️ 无越界写入；但 `dsh-client-runtime/lib/client.js` 被两单元共享，**C1 回滚会连带抹掉 B1/C1 的改动**（D1，已实测） |
| Q6 | 遗漏的 live 改动 | ✅ `~/.npm-global` 今日改动 = 4 个目标文件，全部属于五单元；`~/.dsh` 有 8 类非单元改动，逐条登记（§6） |

**总体裁决：完整性 ✅ 通过；回滚可还原性 ✅ 通过（沙箱实测）；但存在 1 项高危跨单元回滚缺陷（D1）、1 项高危 fail-open 回滚缺陷（D3）、1 项中危可用性缺陷（D2）。裁决 = 「存在真实缺陷，需处置」。**

---

## 1. Q1 落地完整性

### 1.1 逐 live 目标实测（sha256 / size / lines / 标记）

```
$ for f in <9 targets>; do printf '%s %s %s %s\n' $(sha256sum $f|cut -c1-16) $(stat -c%s $f) $(wc -l <$f) $f; done
```
（命令实为逐目标 `sha256sum` + `stat -c%s` + `wc -l`；下同）

| live 目标 | sha256(16) | size | lines | 单元标记 / 锚点 | 判定 |
|---|---|---|---|---|---|
| `@local/dsh-usage/lib/db.js`（deployed） | `77ab2e8ec489024f` | 34766 | 783 | `usage_daily`×17、`maxDayNextExclusive`×2、`tailHasRows`×3 | ✅ = `backup-usage/deployed/.../POST_SHA256SUMS` 的 db.js |
| `@local/dsh-usage/lib/client.js`（deployed） | `c267687b62de6f71` | 71194 | 1224 | `IntersectionObserver`×3、`localDayEnd`×4、`pollVisible`×3、`"30s 刷新"`×1 | ✅ = POST 的 client.js |
| `dsh-usage/lib/db.js`（source） | `48ea5758fd792494` | 34220 | 776 | 同上（`usage_daily`×17 / `maxDayNextExclusive`×2 / `tailHasRows`×3） | ✅ = `backup-usage/source/.../POST_SHA256SUMS` |
| `dsh-usage/lib/client.js`（source） | `5bb727ffc044bdbb` | 33537 | 564 | `IntersectionObserver`×3、`localDayEnd`×4、`pollVisible`×3 | ✅ = source POST |
| `dsh-host-apiproxy/lib/index.js` | `f568f8a9e67ef123` | 216797 | 5651 | `dsh-lag-fix B1`×4、`runningSubagentCount`×4、`__DSH_SUBAGENT_LIST_MAX`×2 | ✅ `cmp` 与 `backup/B1/20260920-154039/b1-index.patched.js` **IDENTICAL** |
| `dsh-host-apiproxy/lib/types/api-proxy.js` | `3003d4d114c36c74` | 175398 | 3428 | `dsh-lag-fix B1`×4 … | ✅ = `b1-api-proxy.patched.js` **IDENTICAL** |
| `dsh-client-ui-workspace/lib/client.js` | `7dc84e56092d2e29` | 114359 | 2464 | `dsh-lag-fix B1/C1`×2、`descendants.get(`×2 | ✅ = `b1-ui-workspace.patched.js` **IDENTICAL** |
| `dsh-client-runtime/lib/client.js` | `d71a8ca524307aa3` | 397957 | 10661 | `dsh-perf-fix P1 v1`×1、`P2 v1`×2、`P4`×0 + B1/C1 单行 ×1 | ✅ P1+P2 落地、P4 按裁决缺席 |
| `dsh-workspace-enhancement/lib/client.js` | `7df7a655ee660eb2` | 267026 | 5453 | `NEW_TOKEN_1`×1、`NEW_TOKEN_2`×1、旧 token 1/0 | ✅ = 脚本常量 `PATCHED_SHA` |

补充（C2 元数据易误读，非缺陷）：`patches/backup/C2/backup-20260920-153959/meta.txt` 记 `client_js_lines=5442`，而 live 为 5453 行 —— 5442 是**补丁前**行数（`wc -l` 在 `install` 之前记录），备份里的 pre 文件实测正是 5442 行，post 文件 5453 行（+11）。`diff_hunks=2` 与实测一致。

### 1.2 半应用判定（逐单元）

| 单元 | 涉及 live 文件 | 各文件标记现状 | 半应用？ |
|---|---|---|---|
| A（usage-plugin） | 2 文件 × 2 目标 = 4 | deployed 2/2 = POST；source 2/2 = POST | **否**（4/4 全中） |
| B1（server-session-filter） | index.js + types/api-proxy.js | 两文件均 `dsh-lag-fix B1`×4 | **否** |
| B1/C1（workspace-ui-…） | ui-workspace/client.js + client-runtime/client.js | ui=`dsh-lag-fix B1/C1`×2（阈值 ≥2 ✔）；rt=`runningSubagentCount === entry.runningSubagentCount`×1（阈值 ==1 ✔）→ `unit_state=done` | **否** |
| C1（client-runtime-perf） | client-runtime/client.js | P1 ✔ P2 ✔ P4 ✘（用户裁决弃用） | **否**（按 `--only P1,P2` 的合法子集） |
| C2（workspace-enhancement） | 1 文件 | sha256 == `PATCHED_SHA` | **否** |

### 1.3 复现性（额外强证据）：由 pre-image 重放 == live，逐字节

在 `/tmp` 沙箱中，把各单元备份里的 **pre-image** 作为输入重跑 `--apply`，与真实 live 比对：

| 单元 | 重放结果 | live | 结论 |
|---|---|---|---|
| A（deployed，4 处替换全部 `APPLIED`） | db `77ab2e8ec489024f` / client `c267687b62de6f71` | 同 | **REPRODUCED-BYTE-EXACT** |
| B1（server） | index `f568f8a9e67ef123` / types `3003d4d114c36c74` | 同 | **REPRODUCED-BYTE-EXACT** |
| B1/C1（client） | ui `7dc84e56092d2e29` / rt `d71a8ca524307aa3` | 同 | **REPRODUCED-BYTE-EXACT** |
| C1（baseline + `--only P1,P2`） | sha1 `867207a9f495` | B1 的 pre-image `867207a9f495`；live `a0fb4bb225d3` = 该镜像 + B1/C1 单行 | **REPRODUCED-BYTE-EXACT** |
| C2（patcher on pre-image） | sha256 `7df7a655ee660eb2` | 同 | **REPRODUCED-BYTE-EXACT**（注：脚本 exit=1，见 §8 D5-d，为沙箱路径旁证问题，非字节问题） |

**关键推论（D1 的物证链）**：
```
C1 baseline aba836a0  --(--only P1,P2)-->  867207a9f495  == B1 备份的 pre-image(15:39:48)
867207a9f495          --(B1/C1 变换)-->   a0fb4bb225d3  == 当前 live
C1 --rollback 还原的是  aba836a0   ← 跳过 867207a9f495，连带抹掉 B1/C1 的那一行
```

---

## 2. Q2 幂等性（重复 apply 必须 SKIP/拒绝，不得二次打补丁）

命令与实测（全部在 `/tmp` 沙箱副本上执行，真实 live 只读）：

| 单元 | 命令 | 输出 | exit | 判定 |
|---|---|---|---|---|
| A/deployed | `usage-plugin.sh --apply --target deployed`（沙箱 pkg=已应用态） | `[SKIP] 四个单元（A1/A2/A0/B2）均已应用，无操作` | 0 | ✅ 幂等；字节未变（db/client 均 yes）；**未新建任何备份目录** |
| A/source | 同上 `--target source` | `[SKIP] …均已应用，无操作` | 0 | ✅ |
| B1 server | `server-session-filter.sh --dry-run` | `[SKIP] 已应用（两个文件均命中 'dsh-lag-fix B1'），无操作。` | 0 | ✅ |
| B1/C1 | `workspace-ui-runsubagent-count.sh --dry-run` | `[SKIP] 已应用（两个文件均命中），无操作。` | 0 | ✅ |
| C1 | `client-runtime-perf.sh --apply --only P1,P2` | `[SKIP] 目标已含全部补丁标记（already-applied），无需重复应用。` | 0 | ✅ 幂等 |
| C1 | `client-runtime-perf.sh --apply`（未加 `--only`） | `[FAIL] 目标状态未知（unknown:missing=P4a,P4b,P4c,P4d,P4e,P4f:sha=a0fb4bb225d3）——拒绝应用。请先 --rollback 还原到基线。` | **1** | ✅ **设计行为**（合法子集已应用时拒绝按超集继续）；目标 sha1 未变 |
| C2 | `workspace-enhancement-perf.sh --dry-run` | `live 状态：applied` → `[SKIP] live sha256 已等于补丁后基线（7df7…），已应用，无操作。` | 0 | ✅ |

**唯一异常（D4，非幂等性破坏，但输出误导）**：
```
$ client-runtime-perf.sh --dry-run --only P1,P2      # 与 live 现状完全匹配的调用
[PASS] 幂等复核：对改后副本重跑补丁器 → already-applied（且未改动字节）
  [!! ] P1  基线唯一命中=false  改后含标记=true
  [!! ] P2  基线唯一命中=false  改后含标记=true
[FAIL] 逐单元复核失败
[FAIL] 结论：存在问题，请见上方 [FAIL] 行                    → exit 1
  已应用补丁：                                   ← 该行为空（静默）
```
`--dry-run`（默认模式）同样 exit 1。原因：`do_dry_run` 的"逐单元复核"断言 **补丁前锚点在基线副本里唯一命中**，而一旦已应用，锚点必然消失 → 该断言没有 already-applied 分支。**这不是"合法子集 exit 1"的设计行为**（那一条是 `--apply`），而是 dry-run 自身的判别缺口。目标文件字节未被触碰（sha1 仍 `a0fb4bb225d3`）。

---

## 3. Q3 回滚可还原性（/tmp 沙箱演练，逐字节比对）

沙箱做法：复制各单元备份根 → 沙箱；把沙箱内目标文件置为 **复制自 live 的改后态**；用脚本支持的覆盖变量（`DSH_ROOT` / `B1_DIR` / `C1_DIR`+`C1_TARGET` / `USAGE_PKG_DIR`+`BACKUP_DIR` / `LAGFIX_DIR`+`DSW_PLUGIN_DIR`）把目标指向沙箱；执行 `--rollback`；`sha256sum`/`sha1sum` 与备份记录比对。**真实 live 全程只读。**

| # | 单元 / 目标 | 回滚 exit | 还原 vs 备份 | 标记消失 |
|---|---|---|---|---|
| 1 | A / deployed（db.js + client.js） | 0 | `802834b56ab3ff40` / `a4f5a529f391a6d8` → **BYTE-EXACT** | A1/A2/A0/B2 哨兵全消 |
| 2 | A / source（db.js + client.js） | 0 | `f8f7518073fcb5a6` / `2275965aeb16d584` → **BYTE-EXACT** | 同上 |
| 3 | B1 / server（index.js + api-proxy.js） | 0 | `142aac84e462173a` / `7f56fb805fe4d8af` → **BYTE-EXACT** | `dsh-lag-fix B1` 0/0 |
| 4 | B1/C1 / client（ui + rt，备份根隔离后） | 0 | `baac19136b5154bf` / `458c0898a3b29859` → **BYTE-EXACT** | ui 0 / rt 0 |
| 5 | C1 / client-runtime | 0 | sha1 `aba836a0c42dfb45f98a625854f777b19260d7dd` → **BYTE-EXACT**；脚本自判 `还原后状态判定：baseline` | P1/P2 0/0（**但连带**，见 D1） |
| 6 | C2 / dsh-workspace-enhancement | 0 | `aef0a3e663af487a` == `pre.sha256` → **BYTE-EXACT**；`node --check` 通过 | NEW 1/0 |

**高保真补充（用真实备份根 + 沙箱写目标）**：对 `server-session-filter.sh --rollback` 不覆盖 `B1_DIR`（读真实 `backup/B1`），仅把 `DSH_ROOT` 指向沙箱 → 命中真实备份 `backup/B1/20260920-154039/`，两文件还原与真实备份 **BYTE-EXACT-vs-real-backup**，exit 0；同时只读复核真实 live `f568f8a9e67ef123` 未变。
同一手法对 `workspace-ui-runsubagent-count.sh --rollback` → **exit 1 拒绝**（见 D2），真实 live `5596cec54007` 未变。

---

## 4. Q4 回滚所有权校验（fail-closed 实测，共 9 例，覆盖 5 个单元）

| # | 单元 | 注入的"他档 / 伪造" | 脚本行为 | exit |
|---|---|---|---|---|
| 1 | C1 | 最新备份目录 META 声明 `unit=C2` | `[FAIL] 备份 META 声明 unit='C2'（应为 C1）…拒绝回滚以免误覆 live` | 1 |
| 2 | C1 | 备份内容被篡改（尾部追加一行） | `[FAIL] 备份自校验失败：META pre_sha1=aba836a0…，备份文件实际 sha1=fe103109…` | 1 |
| 3 | A/deployed | 最新备份 MANIFEST `unit=workspace-enhancement/C2` | `[FAIL] 备份不属于本单元（MANIFEST unit=…，期望 usage-plugin/A0+A1+A2+B2）` | 1 |
| 4 | A/deployed | 备份 db.js 被篡改 | `[FAIL] 备份内容与其 SHA256SUMS 不符` + `MANIFEST 记的 db.js pre-sha 与备份文件不符` | 1 |
| 5 | A/deployed | live 处于第三态（既非 pre 也非 post） | `[FAIL] live db.js 既非本单元的改前也非改后状态（live=65bb6407e34e pre=8028… post=77ab…）` | 1 |
| 6 | A | 跨 target：用 deployed 备份执行 `--target source` | `[FAIL] 备份 target 不符（MANIFEST target=deployed，本次 --target source）` + live 归属不符 | 1 |
| 7 | C2 | 最新备份 `pre.sha256` = C1 基线 | `[FAIL] 备份不属于本单元（pre.sha256=aba836a0… ≠ 本单元基线 aef0a3e6…）——拒绝回滚以免误覆 live` | 1 |
| 8 | B1/server | 合成一个更晚时间戳、只含 client 单元文件的目录 | `[WARN] …/20991231-235959/ 不是本单元（B1）的完整备份（缺少 lib/index.js 或 lib/types/api-proxy.js），拒绝回滚以免误覆 live` | 1 |
| 9 | B1/C1/client | 同 #8（更晚目录 = server 单元的 154039） | `[WARN] …/20260920-154039/ 不是本单元（B1）的完整备份（缺少 dsh-client-ui-workspace/lib/client.js 或 dsh-client-runtime/lib/client.js），拒绝回滚以免误覆 live` | 1 |

九例全部 **拒绝且未写任何文件**（逐例复核目标 sha 未变）。C1 / A / C2 的所有权校验（身份 + 自洽 + 基线 + live 归属四重）**实测 fail-closed，通过**。

❌ **但 #10 例（伪造内容，路径齐备）失败** —— 见 D3：
```
$ mkdir -p <backup>/B1/20991231-235959/dsh-client-ui-workspace/lib  .../dsh-client-runtime/lib
$ printf '/* FORGED: not a real backup … */\nexport const x = 1;\n' > .../dsh-client-ui-workspace/lib/client.js
$ printf '/* FORGED runtime */\nexport const y = 2;\n' > .../dsh-client-runtime/lib/client.js
$ workspace-ui-runsubagent-count.sh --rollback
使用本单元最新备份：…/20991231-235959/
已还原 dsh-client-ui-workspace/lib/client.js
已还原 dsh-client-runtime/lib/client.js
[PASS] 回滚完成：标记已消失                       ← 报"成功"
exit=0
  → 沙箱内 live 变成 84 字节的垃圾（原 114359 字节 / 5596cec54007）
```
`server-session-filter.sh --rollback` 是同样的**仅存在性**闸门（`[ ! -f "$latest/lib/index.js" ] || …`），结构上同样 fail-open。

---

## 5. Q5 写入路径集合与"误伤无关文件"分析（静态 + 动态）

### 5.1 每脚本可能触碰的全部文件

**`usage-plugin.sh`**（`WORK=LAGFIX_DIR`）
- `$WORK/tmp/dryrun-<target>-<stamp>/{db.js,client.js,SHA256SUMS.orig,db.js.pre,client.js.pre}`（dry-run）
- `$BACKUP_ROOT/backup-<stamp>/{db.js,client.js,SHA256SUMS,MANIFEST,POST_SHA256SUMS}`（apply，默认 `$LAGFIX_DIR/backup-usage/<target>`）
- **`$PKG/lib/{db.js,client.js}`**（apply：python `open(target,"w")`；rollback：`cp -f`）
- `$WORK/reports/copy-drift.md`（仅 `--compare`）
- `/tmp/lagfix-rb.XXXXXX/`（rollback 暂存，用后 `rm -rf`）
- 死变量 `STATE_FILE`（L120 定义，全文无读写）→ 无写入

**`server-session-filter.sh`**
- `$BACKUP_ROOT/<stamp>/{lib/index.js,lib/types/api-proxy.js,b1-index.patched.js,b1-api-proxy.patched.js}`（默认 `$B1_DIR/backup/B1`）
- `$WORK_ROOT/dryrun-<stamp>/{lib/index.js,lib/types/api-proxy.js,b1-*.patched.js}`（默认 `$B1_DIR/tmp/B1`）
- **`$LIVE_INDEX`、`$LIVE_MODULE`**
- `/tmp/b1check.XXXXXX`（mktemp，用后删）

**`workspace-ui-runsubagent-count.sh`**
- `$BACKUP_ROOT/<stamp>/{dsh-client-ui-workspace/lib/client.js, dsh-client-runtime/lib/client.js, b1-ui-workspace.patched.js, b1-client-runtime.patched.js}`（默认 `$B1_DIR/backup/B1` ← **与上一条同根**）
- `$WORK_ROOT/dryrun-client-<stamp>/…`
- **`$UI`、`$RT`**（同属 `DSH_ROOT`）
- `/tmp/b1c.XXXXXX`

**`client-runtime-perf.sh`**
- `$C1_DIR/sandbox/C1/.c1-state.mjs`（**含 `--rollback` 在内的所有模式都会写**）
- `$C1_DIR/sandbox/C1/{client.baseline-*.js, client.replay-check-*.js, .replay.json, .check.err}`
- `$C1_DIR/patched/<client-runtime.client.js | …-only-P1-P2.js>`
- `$C1_DIR/reports/C1.fixer-{dryrun,apply}.json`、`$C1_DIR/evidence/unit-C1[-only-*].diff`
- `$BACKUP_ROOT/<stamp>/{client-runtime.client.js,.sha1,META.txt}`（`$C1_DIR/backup/C1`）
- **`$TARGET`**（`C1_TARGET`）
- 1 次 HTTP GET `127.0.0.1:3080/plugins/…?rev=`（仅 apply，`C1_SKIP_HTTP=1` 可跳；本次审计全程 `C1_SKIP_HTTP=1`，**0 次真实 HTTP 探针**）

**`workspace-enhancement-perf.sh`**
- `/tmp/lagfix-c2.XXXXXX/`（mktemp + `trap cleanup EXIT`）
- `$PATCHED_COPY.tmp-probe`（**precheck 期间写入工作区 `patched/`**；紧随 `rm -f`）
- `$BACKUP_ROOT/backup-<stamp>/{client.js,pre.sha256,meta.txt,c2.diff}`（`$LAGFIX_DIR/patches/backup/C2`）
- **`$CLIENT_JS`**（`install -m <原 mode>`）

### 5.2 判定

- ✅ **没有**任何脚本写 `~/.dsh/settings.yaml`、`sessions/`、`storages/`、`usage.db`、其它 npm 包或用户文件；usage-plugin 明确"不建索引、不 VACUUM/ANALYZE、不写 usage.db"，实测也未发生。
- ⚠️ **唯一的 live 文件共享 = `dsh-client-runtime/lib/client.js`（D1）**。且注意**路径别名**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime` 是指向 `~/.npm-global/.../dsh/node_modules/@deepseek-ai/dsh-client-runtime` 的**符号链接**（两路径 inode 均 `31355018`），所以两脚本"不同的默认 `DSH_ROOT`"其实是**同一个文件**。`dsh-client-ui-workspace`（inode 31354218）、`dsh-host-apiproxy`（31327386）同理。
- ⚠️ **备份根共享 = `backup/B1`（D2）**：`server-session-filter.sh:59` 与 `workspace-ui-runsubagent-count.sh:51` 同用 `$B1_DIR/backup/B1`。RUNBOOK §3.4 宣称"每个单元的备份根互相隔离（backup/C1、backup/B1、backup/B2、patches/backup/C2、backup-usage/<target>）"—— 5 个根对应 **6 个脚本**，`backup/B1` 实际承载 2 个单元（与 `backup/B2` 无关：后者属于会话缩容那一档）。
- ✅ 共享目录内的**文件名**不冲突：`patched/`（C1 `client-runtime.client.js` vs C2 `workspace-enhancement.client.js`，DECISIONS G1 已加固并加注释）、`reports/`（C1 json / usage copy-drift.md / 其它档 md）。
- ✅ 遗留物 inert：`backup/20260920-153800/client.js`（C1 旧版共用根备份，META 记 `migrated_from`）、`backup/B2/…`、`backup/settings.yaml.pre-image-decl-…` —— 现役 5 个脚本**都不读** `backup/` 根（分别读 `backup/C1`、`backup/B1`、`patches/backup/C2`、`backup-usage/<target>`；`backup/B2` 只在 RUNBOOK 里由 `--backup-dir` 显式传入）。
- ⚠️ `workspace-enhancement-perf.sh` precheck 无条件尝试写 `$PATCHED_COPY.tmp-probe`（共享 `patched/` 目录内）；只有在 patcher 意外成功时才真正落盘，且立即 `rm -f`，实测 0 次残留。
- ⚠️ `client-runtime-perf.sh` 在 `--rollback` 路径也会 `mkdir -p $SANDBOX_DIR` 并重写 `.c1-state.mjs` 探针（"只读回滚"不成立，但只在自身沙箱目录内）。

---

## 6. Q6 是否有被遗漏的 live 改动

### 6.1 git

```
$ cd /home/CNS2026495165/dsh && git status --porcelain     # 16:03 快照
?? .workspace/lag-fix/probes/host-latency-with-usage-card.mjs
$ git status -sb
## main...origin/main [领先 5]
$ git diff --stat HEAD -- dsh-usage/      # 空 → 源码侧补丁已提交
$ git log --oneline -3 -- dsh-usage/      7cfa1369 "…卡顿修复工作区侧改动" / 88c68288 …
```
- `.workspace/lag-fix` **之外**（`dsh-usage/` 外）的未提交改动：**无**。源码 `dsh-usage/lib/{db.js,client.js}` 的补丁**已提交**（工作区干净 = 已登记）。
- 唯一未跟踪文件：`.workspace/lag-fix/probes/host-latency-with-usage-card.mjs`（16:02 创建）→ **未登记产物**（探针类，非 live 改动，优先级低）。
- ⚠️ **注意**：审计期间工作区正被**并发档**写入。16:11 复核同一命令时，未跟踪列表已变为 `M .workspace/lag-fix/probes/measure-after-C1.mjs`、`?? .workspace/lag-fix/probes/measure-after-C1.mjs.bak`、`?? .workspace/lag-fix/reports/audit-cross-acceptance.md`，且上述探针已被提交。故"git status 干净"只在某一时刻成立；本审计对 live 目标的 sha256 在首尾完全一致（见 §7），结论不受影响。

### 6.2 `~/.npm-global`（find -newermt 今天）

```
$ find ~/.npm-global -newermt "2026-09-20 00:00:00" -type f     # 共 4 个
…/@deepseek-ai/dsh-host-apiproxy/lib/index.js                 → B1（server）✅ 属于五单元
…/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js       → B1（server）✅
…/@deepseek-ai/dsh-client-runtime/lib/client.js               → C1 perf + B1/C1 ✅
…/@deepseek-ai/dsh-client-ui-workspace/lib/client.js          → B1/C1 ✅
```
**无未登记改动**（注意：这 4 个文件与 `~/.dsh/profiles/node_modules/@deepseek-ai/*` 是同一批 inode，故两处列举不构成双重计数）。

### 6.3 `~/.dsh`（find -newermt 今天，共 73 个文件）

| 类别 | 文件 | 是否属于五单元 |
|---|---|---|
| 单元目标 | `profiles/node_modules/@local/dsh-usage/lib/{db.js,client.js}` | ✅ A（deployed 半） |
| 单元目标 | `profiles/node_modules/dsh-workspace-enhancement/lib/client.js` | ✅ C2 |
| 配置（**非单元**） | `settings.yaml`（15:11:56） | ❌ **不属于五单元** —— diff 为 `deepseek-v4-pro` 增加 `input: [text, image]`，有专属备份 `backup/settings.yaml.pre-image-decl-20260920-151144`，RUNBOOK §六.3 已登记为另一条线 |
| 配置（**非单元**） | `profiles/web/cordis.yml`（11:47:23 = 宿主启动同一秒） | ❌ 内容为注释 + `[]`（空 profile 根），启动期 touch，非单元改动 |
| 运行日志 | `backups/dsh-restart.log`（15:47:42） | ❌ 重启脚本 **dry-run 预览**；日志内 5 处 `未发送任何信号`；PID 20806 仍是 11:47:23 那个进程 → **未发生重启** |
| 数据/运行态 | `storages/usage/usage.db`(+`-wal`,`-shm`)、`storages/session_projcache.json`（16:04 仍在写）、`storages/workspace.json`（15:32） | ❌ 宿主运行期写入 + 会话缩容档（B2/cleanup 线）；五单元脚本均不写这些 |
| 会话 | `sessions/*/session.jsonl.zstd`（~60 个） | ❌ 活跃会话日志 + 缩容档删除动作，非单元改动 |
| 协调 | `session-board/peers/*.json`（3）、`btw/index.json` | ❌ 运行期协调数据 |

**逐条判断结果**：五单元之外**没有发现任何"未被任何记录覆盖"的代码类 live 改动**；上表 ❌ 行可分为两类 —— (a) 已由其它线登记的有意改动（`settings.yaml` 图片声明、`storages/*` 会话缩容），(b) 纯运行期数据/日志（无审计意义）。**无"影子补丁"**。

---

## 7. 未触碰真实 live 的证明

审计开始（16:03）与结束（16:12）对 9 个 live 目标各做一次 sha256，**逐位一致**：

```
77ab2e8ec489024f  ~/.dsh/.../@local/dsh-usage/lib/db.js
c267687b62de6f71  ~/.dsh/.../@local/dsh-usage/lib/client.js
48ea5758fd792494  ~/dsh/dsh-usage/lib/db.js
5bb727ffc044bdbb  ~/dsh/dsh-usage/lib/client.js
f568f8a9e67ef123  ~/.dsh/.../dsh-host-apiproxy/lib/index.js
3003d4d114c36c74  ~/.dsh/.../dsh-host-apiproxy/lib/types/api-proxy.js
7dc84e56092d2e29  ~/.dsh/.../dsh-client-ui-workspace/lib/client.js
d71a8ca524307aa3  ~/.dsh/.../dsh-client-runtime/lib/client.js
7df7a655ee660eb2  ~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js
```
`ps -o pid,lstart,etime -p 20806` → `20806 日 9月 20 11:47:23 2026 04:19:21`（未被重启/发信号）。HTTP 探针：**0 次**（全部 `C1_SKIP_HTTP=1`）。沙箱 `/tmp/patch-audit/` 已于审计结束前清理。

---

## 8. 真实缺陷与风险（区分"设计行为" vs "缺陷"）

### D1 ——【高危 · 跨单元回滚连带抹除】C1 回滚会静默撤销 B1/C1 已落地的改动
- **事实**：`dsh-client-runtime/lib/client.js` 被 `client-runtime-perf.sh`（C1）与 `workspace-ui-runsubagent-count.sh`（B1/C1）共同写入；两者默认 `DSH_ROOT` 指向同一 inode（符链别名）。
- **实测**：沙箱 `C1 --rollback` 全部所有权校验通过（`[PASS] 回滚所有权校验通过`），把文件还原为 `aba836a0`；还原后 `P1=0 P2=0`，且 **B1/C1 的 `runningSubagentCount === entry.runningSubagentCount` 一并消失**（live vs C1 备份实测 108 行差异）。
- **连带后果**：B1/C1 单元随即进入 **partial**（ui 标记 2 / rt 标记 0）。实测其在 partial 下 `--apply` 拒绝：`[WARN] 检测到半应用状态（只有其中一个文件带标记）——请先 --rollback 再重跑。` exit 1；而在真实树上它的 `--rollback` 又不可用（见 D2）→ **恢复需要人工介入**。
- **为何校验拦不住**：C1 的护栏只问"live 是否处于本单元 pre/post 态"——从 C1 视角 live 确实是 post，校验必然通过。DECISIONS.md **G5** 只处置了"应用期叠放顺序"，**回滚期纠缠未覆盖**。
- **正确回滚顺序（本次审计推论，已由 §1.3 物证支撑）**：**先回滚 B1/C1（client），再回滚 C1（perf）**；反向会让 B1/C1 卡在 partial。
- **建议**：① 在 `client-runtime-perf.sh --rollback` 增加"还原后检测本文件是否还含其它单元的标记，若有则拒绝或警告并要求联动回滚"；② 或在 RUNBOOK §3.4 明确写死顺序并加护栏脚本。

### D2 ——【中危 · 可用性（非安全）】共享 `backup/B1` + `ls|sort|tail -1` 让先落地的单元永久无法回滚
- **实测（真实备份根 + 沙箱写目标）**：`workspace-ui-runsubagent-count.sh --rollback` 今天**根本跑不起来** —— 最新目录是兄弟单元的 `20260920-154039`：
  `[WARN] …/backup/B1/20260920-154039/ 不是本单元（B1）的完整备份（缺少 dsh-client-ui-workspace/lib/client.js 或 dsh-client-runtime/lib/client.js），拒绝回滚以免误覆 live` exit 1。
  相反方向的 `server-session-filter.sh --rollback` 正常（exit 0，逐字节还原）。
- **性质**：fail-closed（安全），但**功能性缺陷** —— 只要两单元中"时间戳较晚"的那个存在，较早的那个就不可回滚；且与 RUNBOOK §3.4"备份根互相隔离"的说法不符，会给运维造成"可随时回滚"的错觉。与 D1 叠加后成为恢复路径的硬阻塞。
- **建议**：`backup/B1` 下按单元再分子目录（如 `backup/B1/server/<stamp>`、`backup/B1/client/<stamp>`），或回滚时遍历全部备份目录挑选"含本单元双文件的最新目录"，而不是只取 `tail -1`。

### D3 ——【高危 · fail-open】B1/B1C1 的 `--rollback` 只校验路径不校验内容
- **实测（第 10 例）**：伪造目录（正确的两个相对路径 + 84 字节垃圾内容）被接受、原样覆盖 live、并打印 `[PASS] 回滚完成：标记已消失`，exit 0。
- **根因**：这两脚本的备份**完全不记录 hash/META/基线**（对比：C1 有 `.sha1` + `META.pre_sha1` + `BASELINE_SHA1`；usage 有 `SHA256SUMS`+`MANIFEST`+`POST_SHA256SUMS`；C2 有 `pre.sha256` vs `LIVE_PRE_SHA`）；回滚闸门仅 `[ -f … ]` 存在性判断。
- **影响面**：与"备份根混入伪造/他档目录"的威胁模型完全重合；也削弱了 RUNBOOK"所有 --rollback 均已带所有权校验（备份不属于本单元即拒绝执行）"这句承诺（校验了"归属"，未校验"真伪/完整性"）。
- **建议**：为这两脚本的备份补 `sha256` 记录文件 + 补丁后 sha 记录，回滚前校验"备份自洽 + live ∈ {pre,post}"（照抄 usage-plugin 的三重护栏）。

### D4 ——【中低 · 误导】`client-runtime-perf.sh --dry-run` 在 live 现状下 exit 1 且输出自相矛盾
- 见 §2。同一轮里既 `[PASS] 幂等复核 … already-applied`，又 `[!! ] P1/P2 基线唯一命中=false` + `[FAIL] 逐单元复核失败` + `[FAIL] 结论：存在问题`，且"已应用补丁："行为空。
- **性质**：**缺陷**（不是题目所述"合法子集 exit 1"的设计行为——那一条对应 `--apply`）。对已应用目标缺少 already-applied 短路分支。
- **影响**：运维按 RUNBOOK 跑 dry-run 做健康检查时会看到红色 FAIL，造成假警报 / 对真实回归脱敏。**数据面无害**（目标字节未变）。

### D5 ——【低 · 健壮性/一致性】
- (a) `usage-plugin.sh:109` `REPO_ROOT="$(cd "$WORK/../.." && pwd)"`：当 `LAGFIX_DIR` 覆盖到无祖父目录的位置时打印 `cd: 没有那个文件或目录` 并留空 `REPO_ROOT`（实测）。无 `set -e` 故不中断；仅当只覆盖 `LAGFIX_DIR` 而不覆盖 `USAGE_SRC_DIR` 时才影响行为（此时 `USAGE_SRC_DIR` 退化为 `/dsh-usage`）。
- (b) `usage-plugin.sh:120` `STATE_FILE` 死变量（全文无读写）。
- (c) `usage-plugin.sh --rollback` 会走 `mktemp -d /tmp/lagfix-rb.*` 暂存，属预期；但脚本 CLAUDE 头部未提及该 /tmp 写入。
- (d) `workspace-enhancement-perf.sh`：`tools/equiv-c2.mjs:24` 硬编码 `LIVE=/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js`，脚本未把 `DSW_PLUGIN_DIR` 传给它。后果：① 文档化的 `DSW_PLUGIN_DIR` 覆盖**不能**把校验链一起重定向（沙箱复现时 exit 1 / `[FAIL] C1 锚点计数异常：live=1 patched=1` 等，而字节其实逐位正确）；② 校验结论反映的是硬编码路径而非脚本实际目标。**真实部署下两者同为默认路径，等价，无实际危害**；但"可覆盖性"是部分的，且不能端到端沙箱验证。
- (e) `workspace-enhancement-perf.sh` precheck 无条件尝试写 `$PATCHED_COPY.tmp-probe`（共享 `patched/` 目录）；实测无残留。
- (f) `server-session-filter.sh` / `workspace-ui-runsubagent-count.sh` 的 `--rollback` 只 `cp` 内容、不保留原文件 mode（对比 C2 用 `install -m`）。回滚后若 live 权限不是 644 会被改写为 `cp` 的默认结果（保留目标既有 inode 则 mode 不变；本次实测未观察到 mode 变化）。

### 明确判定为"设计行为"、不算缺陷的项
1. `client-runtime-perf.sh --apply`（未加 `--only`）在"合法子集 P1,P2 已应用"时 **exit 1 + `unknown:missing=P4a..P4f`** —— 拒绝按超集继续，符合规格。
2. P4 缺席 —— 用户裁决弃用；`--only P1,P2` 为已落地的合法子集。
3. `workspace-enhancement-perf.sh --apply` 对 `patches/backup/C2/` 独占、对 `patched/` 用专属文件名 —— 已按 DECISIONS G1 加固。
4. usage-plugin 的 dry-run 在"live 已是改后态"时用最近备份的 pre 重建基线以展示非空 diff —— 有文档、有意为之。
5. C2 `meta.txt` 的 `client_js_lines` 记的是**补丁前**行数 —— 记录时点决定，实测自洽。

---

## 9. 未验证项 / 局限（如实声明）

1. **未对真实 live 执行任何 apply/rollback**（纪律要求）。所有回滚结论来自 `/tmp` 沙箱副本；其中 B1 两单元与 C1 的高保真演练使用**真实备份根**（只读）与真实脚本、真实变换器。
2. **未做端到端压测 / 未验证生效后的运行时行为**（无 HTTP 探针、无浏览器、未重启宿主）。B1/C1 与 C1 的效果验证不在本次范围（REBOOT-RUNBOOK 另有安排）。
3. `workspace-enhancement-perf.sh` 的等价性工具 `equiv-c2.mjs` 因硬编码路径**无法在沙箱完整重放**（D5-d）；C2 的"patcher 输出 == live"已逐字节证明，但其"对拍 6 PASS/0 FAIL"未由我独立重跑（真实树上才能跑）。
4. `settings.yaml` 的图片声明仅做 diff 比对，未验证热载状态（RUNBOOK §六.3 亦列为待验）。
5. 未审计会话缩容档（`scripts/cleanup-*.mjs`、`backup/B2`）与文档整理档（Track D）—— 超出五单元范围，仅在 Q6 中作归类。
6. 沙箱清理后，本报告中的命令片段为唯一可复现依据（所有命令均已按上文字面给出）。

---

## 附录 A. 审计期间观察到的并发写入（非本档所为，仅登记）

审计期间工作区存在**其它在跑的档**同时写入，两个可复核痕迹：

1. **`/home/CNS2026495165/dsh/.workspace/lag-fix/backup-usage/deployed/node_modules`**
   —— 一条**软链接**：`node_modules -> /home/CNS2026495165/.dsh/profiles/node_modules`，创建时间 **16:04:34**（在本审计开始之后），来源不是本档（本档所有 usage 备份/包目录覆盖均显式指向 `/tmp/patch-audit/**`）。
   风险提示：该路径**指向真实的 `~/.dsh/profiles/node_modules`**，任何在其父目录递归执行的包管理/清理/`rm -rf node_modules` 类操作都会穿透到真实宿主依赖树。建议主 agent 确认其来源与必要性，确认无用后**由本人删除**（本档按纪律不做非本档产物的删除）。
2. **git 未跟踪清单在 16:03 → 16:11 之间发生变化**（`host-latency-with-usage-card.mjs` 变为已提交；新增 `M probes/measure-after-C1.mjs`、`?? probes/measure-after-C1.mjs.bak`、`?? reports/audit-cross-acceptance.md`）。这是并发档的正常工作产物，登记以备交叉对照，**不构成五单元缺陷**。

本档在整轮审计中对**真实 live 的 9 个目标文件 sha256 首尾逐位一致**（§7），上述并发写入未触及这些目标。
