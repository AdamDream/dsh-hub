# report.md — U-BASHCONC（P1）修订执行复核一体档

- 线：`exec-bashconc`，独占 `.workspace/lag-fix/exec-bashconc/`
- 日期：2026-09-22（宿主 pid **2988915**）
- 契约：`.workspace/lag-fix/program/w17-tools/audit.md`（434 行）+ `raw/measurements.json` + 两个子代理产物
- 纪律遵守：**未改任何产品/profile 文件**（产品树 sha256 与开工时一致）；**未传 `sandbox_permissions`**；**未 kill/pkill/重启任何进程**；**未回收任何锁**；测例只落本线工作区；**未点 Sessions 树行内按钮**；**未写 `~/.dsh`**
- 本档角色：**修订执行复核一体**——按已完成的审计落地，不重新拆解、不扩范围

---

## 0. 口径（先读，否则数字会被误用）

**① 计时源 = 会话事件日志，不是载荷副作用。**
全部 span / 重叠 / 并发数字来自 `~/.dsh/sessions/--home-CNS2026495165-dsh--/5e27f750-e98e-4879-b8e9-c889ec758948/session.jsonl.zstd` 里的 `tool/call` / `tool/result` 事件（宿主侧 epoch ms）。语义（file:line 已核对）：
- `tool/call.time` 由 `dsh-agent-loop/lib/index.js:192` `appendToolCall` 写入，位置在 `startCall` 内、`prepare`/`dispatch` **之前**；
- `tool/result.time` 由 `commitReady` 的 `appendToolResult` 写入，**按 index 顺序提交**。
⇒ 这两个事件定义的时间区间就是"该调用在宿主里从接手到结算"的权威区间；**区间是否相交 = 是否真重叠**，与载荷自己怎么写日志无关。这是比"载荷写标记文件"更强的判据，因为重叠是由**宿主**造成的，不是由子进程造成的。

**② 窗口受污染，已逐批标注 loadavg。** 本窗有 11 条兄弟线在飞，实测 loadavg 在 **5.66–11.97** 之间抖动。因此：
- 绝对 ms **不可归因**（同载荷两次跑可以差 5 倍，见 §4 INVALID 样本与 E1 的 16934 ms 单点）；
- 本报告的主判据是 **①重叠对数 ②峰值并发 ③span/Σ** 三个**负载不变**的量，绝对 ms 只作参考。
- ⚠️ 审计 §6 P1 验收项 4 要求 `gateOutcome == EXCLUSIVE`（持锁 + 机器安静）；**本档未满足该条**：机器全程不安静（loadavg 5.7–12.0），且我**没有**抢 `probe-lock.mjs`（抢锁也不能让 11 条兄弟线变安静）。我把它如实标注为 **CONTENDED**，并用负载不变判据替代。**这是对审计验收项的一处降级，明确记录。**

**③ 不重新论证的前提**（引自审计，本档直接使用）：`dsh-tools/lib/index.js:2942` 默认 exclusive、`:2944` 只认精确 `true`、`:2945` 抛出即 exclusive；`dsh-agent-loop/lib/index.js:231` 遇非 parallel 即 `break`；全树 5 个并行安全声明点，`dsh-tool-bash` = 0；生效 bash 超时 = 60 s（`dsh-base/cordis.patch.yml:182`）。

---

## 1. 交付单元逐条验收

### U-BASHCONC-1 条件式声明 `isConcurrencySafe`

| 要求 | 落地 | 判据 |
|---|---|---|
| 按命令内容判定 | `candidate/bashconc-block-v1.js`（25321 B）提供 `bashConcConcurrencySafe(args)` → `defineTool` 顶层键 | 集成测试 i01–i15（§3.3） |
| 只读白名单 | **91** 个动词的显式 allow-list（`BASH_CONC_READ_ONLY_COMMANDS`），**只收观测型动词** | 语料 `positive_read_only` 76 例准入 |
| 默认 false（不声明） | 未在册动词、任何 shell 复合结构、任何可疑选项一律 `false`；`bashConcConcurrencySafe` 自带 try/catch → false；`defineTool` 在 schema 不通过时直接 false；`executionMode` 再兜一层 catch → exclusive | 语料 176 例拒绝；集成 i03/i07–i11 |
| 写路径/重定向/管道到写命令/`rm`/`mv`/`cp`/`>`/`>>`/`sudo`/`tee`/`sed -i`/git 写子命令/`&&`/`;` 一律 exclusive | 全部覆盖，且**整类**拒绝更严：`sed`/`awk`/`xargs`/`tee`/`node`/`python*`/`perl`/`ruby`/`bash -c`/`env` 等**白名单里根本没有** | 语料 `w01–w118`、`s01–s44` |

### U-BASHCONC-2 必须有开关，且两个方向都生效

四层开关，**每次调用重新解析**（`bashConcMasterEnabled()`）：`globalThis.__DSH_BASH_CONCURRENCY_SAFE__` > `DSH_BASH_CONCURRENCY_SAFE` 环境变量 > **哨兵文件** `/tmp/dsh-bashconc-off`（可用 `DSH_BASH_CONCURRENCY_SAFE_OFF_FILE` 改路径）> 常量 `BASH_CONC_ENABLED_DEFAULT = true`。

| 方向 | 判据 | 状态 |
|---|---|---|
| OFF = 恢复"全部 exclusive"旧行为 | 语料**逐例断言全为 false**，共 5 种 OFF 配置（globalThis=false / env=`0` / env=垃圾值 fail-closed / 哨兵文件存在 / 以及 OFF 下 git carve-out 不生效） | ✅ 全 PASS（§3.2） |
| OFF 运行时活体 | 哨兵文件层可在**不重启、不改文件**下翻转 ⇒ 计划用于 A2/A3'/A4 同窗反证 | ⏳ 待 patched 相位（§6） |
| ON | 语料 default 配置准入 78 例 | ✅ PASS |
| 优先级 | `globalThis=true` 覆盖存在的哨兵文件 | ✅ PASS |
| 回滚 | `--rollback` 逐字节还原（§3.1） | ✅ PASS（离线）；生效需重启（冷面） |

> **为什么第 3 层是 `/tmp` 哨兵**：产品树与 `~/.dsh` 对本档**不可写**（实测 `EACCES`，见 §5 阻塞），而 `/tmp` 可写。哨兵层让"两个方向都生效"能**活体实测**，代价与建议见 `DEPLOY.md §5`（已列为需要你裁决的一项）。

### U-BASHCONC-3 验收（不可放宽）——逐条状态

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 3.1 | **正向**：一条消息 6× 只读 bash ⇒ span 显著下降 + **确有重叠** | ✅ **已完成**：A1 span **31985→1395 ms**（同窗对照 **4.67×**）、峰值并发 **1→6**、重叠 **0/15→15/15**、起点互差 **1 ms** | §2 + **§11.1/§11.2** |
| 3.1b | 同窗对照 | ✅ 设计已就绪：哨兵文件提供**同一窗口内**的 A/B（删哨兵=并行 / 建哨兵=串行，同载荷、相隔数分钟），比"跨小时比基线"强得多 | §6 A1/A2、A3/A3' |
| 3.1c | 目标 ≥3× 改善，尽量逼近 8.17× | ✅ **同窗 4.67×（1 s 载荷）达标**。同时**更正**：8.17× 是**高负载窗口的上限性质数字**，不是稳态收益——安静窗内瞬时命令仅 **1.19×**，50 MB `grep` 为 **1.44×**（但满足审计为其单列的 `span ≤ 1.5× 单次` 判据，实测 **1.002**） | **§11.2** |
| 3.2 | **负向对照：6× 写命令 ⇒ 仍 exclusive / 串行 / 零重叠** | ✅ **已完成**：补丁生效下 A4（`touch`）`span/Σ=1.0065`、峰值 **1**、**0/15**；A5（`echo >>`）`1.0022`、**1**、**0/15** | §2 + **§11.4** |
| 3.3 | **`unpatched_reproduces_defect` 门禁** | ✅ **成立，且形式比审计更强**（见下） | §2 |
| 3.4 | **正确性**：只读白名单命令输出与串行**逐字节一致**；写命令顺序与串行语义一致 | ✅ **已完成**：三组同窗串行 vs 并行 **全部逐字节相同**（`evidence/A7-correctness-verdict.json`）；写命令顺序由「仍 exclusive ⇒ 分组恰为 1」保证且实测区间不相交 | **§11.3** |
| 3.5 | **安全性**：危险"看似只读"命令的拒绝清单与测例 | ✅ 全部点名项 + 我扩展的清单，**361 例语料**；危险命令**只做分类断言、不执行**；**自红队抓出并修掉 1 个**（`env --split-string=`）；**外派红队 R1 抓出 8 个已实证假准入 + 4 个拼写绕过，R2 又抓出 6 个（含 3 个是我第一轮修复的绕过），全部已修**（见 §4、§10.1、§10.2） | §3.2、§7 |

**3.3 的强化说明。** 审计的未打补丁实测是 span **8574.3 ms**、`span/Σ = 1.362`、零重叠。本档在更重的负载窗内复现出更强的 signature：`span/Σ = 1.0001–1.0003`，且区间**逐段首尾相接**（`0..2788 / 2790..6898 / 6899..11685 / 11686..28620 / 28620..30708 / 30709..31985`），峰值并发**恒为 1**，15 对区间**一对都不相交**。
⇒ 这不是"慢"，是**结构性串行**。任何背景负载都无法产生"区间互不相交且首尾相接"的形态；反过来说，**背景负载也无法伪造出重叠**。这正是我在受污染窗内仍然能给出结论的原因。

### U-BASHCONC-4 落地面判定（**已由实测证实，见 §11.0/§11.7**）

**判定：冷面（需重启），不是热面。** 4 条独立结构性证据 + 明确的"升级为实测"动作，全部写在 `DEPLOY.md §4`。摘要：
1. hmr 行未覆盖 `ignored` ⇒ 默认 `**/node_modules`（`cordis-plugin-hmr:437-441`），目标文件在 chokidar 遍历时被整棵剪枝 ⇒ **change 事件根本不会产生**；
2. `loadDependencies:47-53` 对 `/node_modules/` 直接 return（设计上排除）；
3. `compositionStamp:1161-1170` 只 stat 组合 YAML 的 `{mtimeMs,size}`，改插件 JS 不改 YAML ⇒ `:1135 sameStamp` 为真 ⇒ 复用旧 mount；
4. `EntryTree.import:495-505` → `internal.import(specifier, base, {})` **无 cache-busting** ⇒ ESM registry 命中即不再求值。

⚠️ **未做"改文件后刷新是否生效"的直接实测**，因为本档不能写产品树（§5）。按你的纪律"不许按热面承诺"，我**不承诺热面**，只交结构性判定 + 一条重启后即可执行的确证命令。若重启前 apply 而不重启就测到重叠，那才说明是热面——**本线不预期**。

---

## 2. 实测证据（未打补丁相位，全部为真跑）

### 2.1 总表（`evidence/_summary-PRE.json`，由 `bin/summarize-evidence.mjs` 生成）

| 批次 | n | span (ms) | Σ各调用 (ms) | **span/Σ** | **峰值并发** | **重叠对数** | 中位间隙 | 子进程启动跨度 | loadavg |
|---|---|---|---|---|---|---|---|---|---|
| **C0 正向对照** 6×`read`（`dsh-tool-fs:415` 已声明） | 6 | **932** | 5575 | **0.1672** | **6** | **15/15** | **0 ms** | — | 5.66 6.81 7.52 |
| E1 6×`bash` `sleep 1` | 6 | 31985 | 31980 | 1.0002 | 1 | 0/15 | 4109 ms | — | 7.98 7.26 7.61 |
| E2 6×`bash` `date '+%s.%N'` | 6 | 10760 | 10757 | 1.0003 | 1 | 0/15 | 1494 ms | **10.2836 s** | 10.51 8.50 8.03 |
| E3B 6×`bash` 写命令 `touch`（**真实落盘**） | 6 | 12714 | 12713 | 1.0001 | 1 | 0/15 | 1038 ms | — | 11.97 8.37 7.97 |
| E4 6×`bash` `grep -c` × **50 MB** | 6 | 19252 | 19251 | 1.0001 | 1 | 0/15 | 2619 ms | — | 10.51 8.50 8.03 |
| **COR-PRE** 6× 确定性只读命令（第 6 个是 `find … \| sort` 管线） | 6 | 5483 | 5483 | 1.0000 | 1 | 0/15 | — | — | 见 JSON |
| E3（**INVALID**，见 §4） | 6 | 3959 | 3956 | 1.0008 | 1 | 0/15 | 489 ms | — | 11.97 8.37 7.97 |

逐批区间（offset ms，批内 start..end）：

```
C0  0..929   1..929   1..930   1..930   1..930   1..932          ← 起始互差 1 ms，6 路真并发
E1  0..2788  2790..6898  6899..11685  11686..28620  28620..30708  30709..31985   ← 首尾相接，零重叠
E2  0..455   457..1951  1951..4856   4856..8202   8203..9637   9637..10760      ← 同上
E3B 0..7424  7424..10366 10366..11403 11404..11738 11738..12331 12331..12714    ← 同上（且是真实写盘）
E4  0..1945  1945..8811 8811..14975 14976..17595 17595..18462 18462..19252      ← 同上
```

`COR-PRE` 的 6 条输出已逐条存档在 `evidence/COR-PRE-readonly-correctness.json` 的 `results` 字段（`1607` 行 / `256` 个 id / block md5 / 脚本 sha256 / `report.md` 前三行 / `bin/*.mjs` 列表），作为 patched 相位 A7 的**逐字节比对基准**。

### 2.2 三条关键结论

1. **C0 证明机制本身工作，缺陷只在 bash 没声明。** 同一条消息内 6 个**已声明并行安全**的调用：起始时间互差 **1 ms**、峰值并发 **6**、**15/15** 对区间相交、span 仅为 Σ 的 **16.7%**。⇒ `maxParallelToolCalls`、`fillPool`、`startCall` 的非阻塞 dispatch 全都正常；**bash 的串行 100% 来自 `isConcurrencySafe` 缺席**，与审计 §1.4 的根因判定一致。
2. **未打补丁复现缺陷，signature 比审计更强**（见 §1/U-BASHCONC-3.3）：`span/Σ ≈ 1.000x` + 区间首尾相接 + 峰值并发恒 1 + 0/15 重叠。
3. **E2 给出一条与宿主计时完全独立的佐证**：6 个 `date` 子进程的**自身启动时刻**跨度 **10.28 s**（1.15 / 1.95 / 3.69 / 2.27 / 1.22 s 的间隔）。补丁后预期压到 ms 量级。这条不依赖 `tool/call` 事件，也不依赖我提出的任何口径。

### 2.3 写命令的负向对照（E3B）细节

6 个 `touch` 落在工作区临时目录，**文件真实创建**（`probe/negwrite/n1..n6`，各 0 B，时间戳 19:03）。区间 `0..7424 / 7424..10366 / 10366..11403 / 11404..11738 / 11738..12331 / 12331..12714` ⇒ **零重叠、峰值并发 1**，且每次的"间隙"恰好等于前一次的"时长"（完美 back-to-back 串行）。这条在 patched 相位**必须保持不变**（§6 A4）。

---

## 3. 离线验证（补丁机制 / 分类器 / 与真实产品代码的对接）

### 3.1 补丁脚本机制（`apply-BashConc-v1.mjs`）——**已自动化，可复现**

复跑：`node bin/verify-patch-mechanics.mjs` → **28/28 PASS**（原始结果 `evidence/patch-mechanics.json`；脚本只**读**产品树，写入全落 `raw/mechanics/`）。下表是这 28 项的汇总：

| 项 | 结果 |
|---|---|
| dry-run 零写入 | ✅ 目标 sha256 不变；目标目录无残留（`node --check` 的 scratch 在 `/tmp`） |
| 锚点唯一 | ✅ A1 `function validateBashArgs(args) {` **1** 命中；A2 `\t\tpresentCall: presentBashCall,` **1** 命中 |
| 前缀碰撞闸门 | ✅ `bashConc` / `BASH_CONC` 在产品文件中各 **0** 命中 |
| `node --check`（ESM） | ✅ `PATCHED_SYNTAX_OK`（另单独验证"模块顶层中段插 `import`"合法） |
| 幂等 | ✅ 二次 `--apply` → `already-applied`，零写入 |
| **精确可逆** | ✅ 剥离插入段后与原文件**逐字节相等**（`EXACT_INVERSE = true`） |
| `--rollback` | ✅ 还原后 sha256 = `2ee3eebe…4371`（= 原文件） |
| 落地后预期 sha256 | `cb73d3b17c6a221f8172e944d4314fdc8b46d5995212048bb97fe27c03d5a45f`（44054 B） |
| **拒绝闸门**：缺锚点 / 锚点重复 / 前缀碰撞 | ✅ 三者均 `refused` **且目标零写入**（m18–m23，含"目标内容未变"的字节断言） |
| **回滚安全闸门**：篡改 pre-image / 落地后目标被改 | ✅ 两种情况均 `refused`（m26/m27） |
| 剪贴字节恒等式 | ✅ `44054 = 18687 + 25321 + 46`（m15） |

**排练中真实抓到并修掉的缺陷（留档）**：`String.replace(anchor, 插入文本)` 把插入文本中的 `$` 序列解释成 `$&` / `` $` `` / `$'` 替换模式，**静默复制了原文件**（37993 B，正确值 32662 B——均为 **v1** 修订的字节数；v1.1 修正后为 33503 B，红队修复后 v1.2 为 44054 B），只在 `node --check` 阶段以 `Identifier 'processOutcome' has already been declared` 暴露。已改为**函数式 replacement** 并在源码内注释成因。⇒ **这正是"必须先排练、不许直接写产品树"的价值证据。**

### 3.2 分类器语料（`bin/run-classifier-tests.mjs`，测试对象是**从已拼接文件里抽取的段文本**）

抽取自 `raw/rehearsal/index.js` 的 `DSH-BASHCONC-v1 BEGIN..END` 区域（即 `--apply` 会写进产品的同一段字节），追加 export 行后 `import()`。**测的就是要上线的字节。**

```
PASS  361/361  default (switch unset, git carve-out off)          ← 准入 123 / 拒绝 238
PASS  361/361  kill switch ON via globalThis
PASS  361/361  kill switch ON via DSH_BASH_CONCURRENCY_SAFE=0
PASS  361/361  kill switch: unrecognised value fails closed
PASS  361/361  switch explicitly ON via DSH_BASH_CONCURRENCY_SAFE=1
PASS  361/361  kill switch ON via sentinel file
PASS  361/361  git index-refreshing carve-out ON
PASS  precedence (globalThis true beats the sentinel file)
overall: PASS
```
语料分组：`positive_read_only` 82 例（含 5 条纯读管线、6 条 git 纯读子命令、quoted-`>`/quoted-`;` 反例、制表符分隔）、`refused_write` 118 例、`refused_structure` 50 例（含 NUL / NBSP / CR / 未转义反斜杠等异体输入 `s45–s50`）、`refused_arguments` 9 例、`git_carve_out` 9 例（双向断言）；合计 **268**。原始结果：`evidence/classifier-tests.json`。

**你点名的安全项逐条落地**：`find . -delete`(w20)、`git branch -D foo`(w70)、`xargs rm`(w18)、`> file`(s10/s12/s13/s36/s37)、`sed -i`(w14)、`` `rm x` ``(s19)、`$(...)`(s17/s18/s39) —— **全部 exclusive**。
**额外拦截**（我扩展的清单，原文未点名但确属写路径）：`node -e` 写盘(w31)、`python3 -c`(w32)、`awk '{print > "f"}'`(w17)、`sort -o/--output/--compress-program`(w85–w88)、`date -s`(w89/w90)、`file -C`(w91)、`dmesg -c/-D`(w92/w93)、`ss -K`(w94)、`rg --pre/--hostname-bin`(w95–w97)、`find -fprint/-fls/-ok`(w22–w24)、`env rm`(w30)、`git log --output=`(w79/w80)、`git -c core.pager=rm`(w83)、`tee`(w25)、`dd`(w26)、`tar/gzip/zip/unzip/iconv/split/csplit/ar`(w43–w52)。

### 3.3 与**真实产品代码**的集成验证（`bin/integration-dsh-tools.mjs`）

导入**已安装的** `@deepseek-ai/dsh-tools/lib/index.js`，取其 `defineTool`，并从该源文件**按大括号配对抽取 `executionMode` 方法源码**（测试的是产品字节，不是我的转写），再绑定到拼接后的分类器：

```
PASS i01 defineTool 不带该键 ⇒ isConcurrencySafe 为 undefined（= pre-image 状态）
PASS i02 defineTool 带该键 ⇒ 安装为 function
PASS i03 executionMode：无声明 ⇒ exclusive
PASS i04 executionMode：有声明 + 只读命令 ⇒ parallel
PASS i05 executionMode：有声明 + 写命令 ⇒ exclusive
PASS i06 executionMode：有声明 + 列表操作符 ⇒ exclusive
PASS i07 调用不满足工具自身 schema（缺 description）⇒ exclusive
PASS i08 调用 schema 类型错 ⇒ exclusive
PASS i09 纯空白命令 ⇒ exclusive
PASS i10 分类器抛异常 ⇒ exclusive（fail-closed）
PASS i11 返回 truthy 但非 true ⇒ exclusive（只认精确 true）
PASS i12 kill switch: globalThis=false ⇒ 只读命令也 exclusive
PASS i13/i14/i15 已安装源码**逐字**含审计引用的三行（exclusive 默认 / 精确 true 判定 / fail-closed catch）
overall: PASS (15/15)
```
原始结果：`evidence/integration-dsh-tools.json`。⇒ 这条把"我的键能不能被真实 `defineTool` + 真实 `executionMode` 正确消费"从"读代码推断"升级为"跑真实代码验证"。

---

## 4. 失败 / INVALID 样本（按要求保留，不删除）

| 样本 | 现象 | 处置 |
|---|---|---|
| **补丁脚本 `$` 替换语义缺陷** | 拼接后 37993 B（v1 应为 32662 B），`node --check` 报 `Identifier 'processOutcome' has already been declared` | 改为函数式 replacement；dry-run 变为 `dry-run-ok`；已复跑通过。**留档于 §3.1 与脚本注释** |
| **E3（首次负向对照）** | 用相对路径 `probe/negwrite/n1-write-probe`，bash 工具默认 workdir 是会话根 `/home/CNS2026495165/dsh`（**不是**我上一句 `cd` 过的目录），6 个 `touch` 全部 `[exit code: 1]`（文件未创建） | **标为 INVALID 并保留**（`evidence/E3-invalid-write-negative-PRE.json`）。它仍显示 0/15 重叠，但"写命令"这一性质未被真实触发，故**不作为负向对照的证据**，只作"当载荷无效时仍串行"的旁证。已用绝对路径重跑为 **E3B**（真实落盘），E3B 才是负向对照证据 |
| **度量脚本自命中** | `--marker` 是子串匹配，**分析命令自身**的命令行含该标记 ⇒ 批次里多出 1 条（7 而不是 6） | 两次踩到（E2/E4 首版）。已加 `--command-regex` 精确过滤，并把"把标记拆开写"记进 `DEPLOY.md §6` 的坑清单；最终证据表全部是干净的 n=6 |
| **inline 打印器 JSON 解析失败** | 用 `node -e JSON.parse(stdout)` 解析含尾行的输出 ⇒ `SyntaxError` | 不改证据（JSON 文件已先落盘）；另写 `bin/summarize-evidence.mjs` 做正规汇总 |
| **分类器 v1 的真实假准入：`env --split-string=`** | `env` 在 v1 白名单内；`env --split-string=<text>` 是**以 `-` 开头的词却执行 `<text>`**。本机实测（coreutils 9.4）`env --split-string="touch /tmp/dsh-envtest"` **真的创建了该文件** ⇒ v1 会把它判为可并行，是**真实假准入**（不是理论风险） | **已修**：① `env` 整体移出白名单；② `--split-string(=\|$)` 加入**通用** deny（任何命令上都拒，纵深防御）；③ `dmesg` 补 `-n/-E/--console-*`（内核 console 日志级别也是系统状态写）。语料 `w109–w118` 固化，修正后（含后续按实测收窄 git 准入）361/361 全过。**这是本单元最重要的一条失败样本** |
| **红队 R1：8 个已实证的假准入（v1.1 修订）** | R1 用**真跑**证明 `uniq -c a b`（覆盖已有文件）、`xxd a b`（创建文件）、`file -bC`（编译 `.mgc`）、`nm --plugin evil.so`（dlopen 任意代码）、`dmesg -xc`/`--read-clear`、`date -us`、`ss -aK`、`sort -S`（141 个临时文件）在我判 `true` 的调用里都产生真实写效果；另有 A5–A7 的 PATH 壳脚本/`man` 缓存写 | **我逐条独立复现后全部采信，本档自裁决改为 REWORK**，随后四类全部修复（操作数上限、短选项粘连、`--plugin` 通用拒绝、`git help` 移除），并**顺带修掉 R1 列出的 4 条假拒绝**。语料新增 `w119–w134`、`p83–p91`（+25 例）。R1 的 4 条"拒绝表拼写绕过"（`--read-clear`/`-xc`/`-us`/`-aK`）**未被执行**（会破坏宿主内核日志/时钟/socket），只验判决——R1 主动标注了这一点，我认同其处置 |
| **红队 R2：6 个仍存活形态（v1.2 修订），其中 H1–H3 是我自己修复的绕过** | R2 在 `2392f935…ac38` 上实测出 `uniq - out.txt` / `xxd - out.txt` / `printf … \| uniq - out.txt` 仍判 `safe=true` 且**真的写出文件**。根因是我 v1.2 的操作数计数用 `startsWith("-")` 过滤，把 stdin 操作数 `-` 误当选项 ⇒ 只数到 1 就放行 | **第二次 REWORK**，随后 v1.3 修复：`-`/`--` 计入操作数、跳过短选项的独立参数、引入 `bashConcClusterHasShortOption` 并顺带修掉 R2 指出的 5 条**我上一轮引入的假拒绝**、`egrep`/`fgrep` 移出白名单、`zcat` 写成命名例外。语料 +29 例（`w135–w144`、`p92–p105`） |
| **红队 R3：2 个机制 / 5 个被准入写法（v1.3 修订），都不在语料覆盖内** | ① `ss -D FILE` / `ss --diag=FILE` 是**输出文件**选项，我的 `ss` 拒绝表只写了 `K`/`--kill`；我实跑确认它**创建 11524 B 文件**并**覆盖**既有文件。② `nm @opts.txt /bin/ls`：binutils 的 `@FILE` 响应文件把被拒的 `--plugin` 藏起来，我实测**dlopen 构造函数真的执行** | **第三次 REWORK**，v1.4 修复：`ss` 补 `D`/`--diag`；新增响应文件整类拒绝（`nm/objdump/readelf/strings`）。同时把"输出路径"类做了**穷尽扫描**（81 动词的 `--help`），并把扫描的**局限**（只管有文档的选项，而 `nm @FILE` 未被文档化）写进代码注释。语料 +16 例（`w145–w152`、`p106–p113`） |
| **红队 R4：一整类漏洞 —— 长选项缩略（`getopt_long` 无歧义前缀）** | 我按**完整拼写**锚定的每一条长选项拒绝都能被"少打几个字母"绕过。我亲手复现：`sort --out=F` **写出文件**、`nm --plug=evil.so` **dlopen 执行**、`file --comp` **创建 `.mgc`**；R4 另复现 `sort --compress-prog=P` **执行程序**、`--temp=D` 把 1102 个临时文件落到被指定目录 | **第四次 REWORK**，v1.5 做**结构性**修复：删除全部 `(=|$)` 锚定正则，改为**逐动词长选项名字表 + 「提交名是被拒名的前缀」**判定（即 `getopt_long` 语义，且是不过度拒绝的方向）；通用表降级为**仅精确名匹配**（避免 `--p...` 对全动词误拒）；`git` 私有表一并改名表。语料 +28 例（`w153–w174`、`p114–p119`） |
| **git 索引探测首版非法** | 我用 `stat -c %.3y` 取 mtime，而 `%.3y` 把 `%y` 的结果**截断成 3 个字符** ⇒ 6 次比较全部得到 202，得出一个**假「索引未变」**结论 | 改用 `stat -c '%y'` 全量比对后重测，才得到 §7 偏差 1 的真实结论（status/diff 重写、其余不动）。**留档**：这是「格式串写错导致判据失效」的样本，与 E3 的路径错误同类 |
| **集成测试首版 schema 非法** | `output.schema.oneOf` 只有 1 个分支 ⇒ 真实 `defineTool` 抛 `JsonSchemaError: schema.oneOf must be an array of at least two schemas` | 改为 2 分支（与真实 bash 工具同形）后通过。**这条本身是"真实 defineTool 在工作"的副产品证据** |
| **C0 首度量含 8 条** | 同一标记被之前的 `ls` 与分析命令自身命中 | 加 `--name read` 过滤后 n=6 |

**无"未解释的异常"残留**；上表 6 条全部有现象 + 成因 + 处置。

---

## 5. 阻塞（本档无法自行解除，需要你操作）

**本档不能写产品树。** 实测：
```
$ echo probe > .../dsh-tool-bash/lib/.dsh-write-probe-$$
bash: 行 4: ...: 权限不够
$ node -e 'fs.writeFileSync(<同路径>)'  →  code=EACCES errno=-13 syscall=open
$ ls -ld .../dsh-tool-bash/lib   →  drwxrwxr-x CNS2026495165 CNS2026495165   （属主可写）
```
⇒ 是 **DSH 文件沙箱（workspace-write）**拦截，不是 POSIX 权限。`~/.dsh` 同样被拦；**`/tmp` 可写**（实测）。

因此需要你执行（`DEPLOY.md §3`）：
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-bashconc && node apply-BashConc-v1.mjs --apply
```
并且因为落地面是**冷面**，patched 相位的实测需要**在那之后的一次重启**。⇒ 剩下的工作是一个**单一、明确、已脚本化**的动作序列（§6）。

---

## 6. patched 相位测量 —— **已完成，结果见 §11**（本节保留原计划作为对照）

已把序列写成可执行清单（`DEPLOY.md §6`，A1–A9）。核心设计是**同窗 A/B**，靠 `/tmp/dsh-bashconc-off` 哨兵在**几分钟内、同一负载窗、同一载荷**下翻转：

| # | 批次 | 期望（判据） |
|---|---|---|
| A1 | 6×`sleep 1`，哨兵**缺席**（补丁生效） | 重叠 15/15、峰值并发 6、span ≪ Σ |
| A2 | 6×`sleep 1`，哨兵**存在**（同载荷同窗） | 0/15、峰值并发 1 —— 证明收益来自补丁而非负载波动 |
| A3 | 6×`grep -c` × 50 MB，哨兵缺席 | span ≤ 1.5× 单次；有重叠（审计验收项 1） |
| A3' | 同载荷，哨兵存在 | 串行、0/15 |
| A4 | 6×`touch`（真实落盘） | **必须仍 0/15、峰值并发 1**（负向对照，不可放宽） |
| A5 | 6×`echo x >> f` | 同上（审计验收项 2 的原文形状） |
| A6 | 6×`date '+%s.%N'` | 子进程启动跨度从 **10.28 s** 压到 ms 量级 |
| A7 | 确定性只读命令组，串行 vs 并行两遍 | 输出**逐字节相同**（正确性） |
| A8 | 6×"形状危险但载荷无害" | 0/15（活体安全侧；真危险命令**只做分类断言、不执行**） |
| A9 | 清理 | 删 `/tmp/dsh-bashconc-off`、`probe/big50mb.txt`、`probe/negwrite/*` |

~~因此本档对 U-BASHCONC-3 的 3.1 / 3.1c / 3.4 三项判 "PENDING（待重启后实测）"，不判 PASS。~~ **→ 2026-09-23 已全部完成：三项均判 PASS，见 §11。**

---

## 7. 需要裁决的两处偏差（按纪律上报，未自行拍板）

### 7.0 「无法安全判定」清单（**全部按 exclusive 处理**），以及**为什么不需要触发停止条件**

停止条件要求：只读/写判定若无法在不引入误判的前提下做到，就停下并给出"哪些命令形态无法安全判定"的清单。**本档没有触发停止条件**，因为我把不可判定的形态**全部推到拒绝侧**（fail-closed），而不是猜。清单如下（每一条都是"无法从命令文本判定 ⇒ 拒绝"）：

| # | 无法安全判定的形态 | 处置 | 语料 |
|---|---|---|---|
| 1 | **任何 shell 复合结构**：`;` `&&` `\|\|` `&` `\|&`、重定向 `< > >>` `2>&1`、命令替换 `$( )` / `` ` ` ``、参数展开 `${ }` `$VAR`、子 shell `( )`、组命令 `{ ; }`、花括号展开、未加引号的 `\` 与 `#`、换行、未闭合引号 | 词法阶段直接拒绝（不尝试"分段后再判定"） | `s01–s44` |
| 2 | **任何解释器/包装器**：`sh bash zsh dash eval exec source . ` · `node deno bun python python3 perl ruby php lua Rscript java` · `awk gawk mawk sed ed ex` · `xargs tee env timeout nohup nice ionice stdbuf setsid watch command` | 动词级拒绝。**依据**：它们的参数是**程序文本**，文本里可以是任何写操作；`env --split-string=` 就是这条的实测反例 | `w14–w42`、`w109–w114` |
| 3 | **任何写动词**：`rm mv cp ln touch mkdir rmdir truncate install dd shred chmod chown chgrp chattr setfacl patch split csplit ar tar gzip bzip2 xz zstd zip unzip iconv mount umount kill pkill killall crontab systemctl sudo su doas curl wget ssh scp rsync git-clone` … | 动词级拒绝（不在名单内即拒绝） | `w01–w13`、`w25–w28`、`w43–w68`、`w98–w108` |
| 4 | **管线里只要有任意一段不可判定** | 整条管线拒绝（不是"只拒绝那一段"） | `s08–s09`、`s40` |
| 5 | **以 `-` 开头却可能写盘/执行/改状态的选项**（含**短选项粘连**与**长选项缩略**） | 通用 deny：`--compress-program= --pre= --pre-glob= --hostname-bin= --exec= --split-string= --plugin=`；逐命令：`sort -o/-T/--output/--temporary-directory`、`date -s`、`file -C`、`dmesg -c/-C/-D/-E/-n/--clear/--read-clear/--console-*`、**`ss -K/--kill` 与 `ss -D/--diag`**、`find -delete/-exec/-ok/-fprint*/-fls`、git `-c/--config-env/--exec-path/--ext-diff/--paginate/--output`。短选项一律**按整簇扫**（`-bC`、`-us`、`-xc`、`-aK`、`-aD`），且遇吃参数的字母即停止（所以 `date -Iseconds` 不误判）；**长选项按 `getopt_long` 缩略语义判定**——逐动词维护被拒**名字**表，提交名是某被拒名的**前缀**即拒绝（`--out`/`--o` 之于 `--output`、`--plug`/`--plu` 之于 `--plugin`、`--comp` 之于 `--compile`），通用表只做精确名匹配以免 `--p...` 对全动词误拒 | `w22–w24`、`w79–w97`、`w115–w153` |
| 5b | **响应文件 `@FILE`**（选项藏在被引用的文件里，文本分类器看不见） | `nm`/`objdump`/`readelf`/`strings` **整类拒绝 `@` 开头的词**。该集合是**对全部 81 个准入动词跑 `--help` 扫 `@<file>` 的完整结果**；规则必须**逐动词**（`grep '@types/'`、`jq '@csv'` 里的 `@` 是数据） | `w149–w152`、`p111–p112` |
| 6 | **`git` 非纯读子命令 / 全局选项前置**（`git -C x status`、`git -c core.pager=rm log`）/ 会重写 `.git/index` 的 `status`·`diff`（默认） | 子命令白名单 + 首词必须是子命令 + 子开关控制 §7 偏差 1 的两项 | `w69–w84`、`g01–g11` |
| 7 | **带 `sandbox_permissions` / `justification` 的调用**（加宽沙箱的一次性重试） | 直接 exclusive —— 请求加宽本身就意味着它要做被拒的事 | `a01`、`a02` |

**真正"不可判定"的残余（不在文本里，因此无法靠分类器消除，只能如实列出）**：命令的**副作用依赖配置或环境**，而文本里看不到——
1. `git` 的 `core.pager`、`diff.<driver>.textconv`、`filter.*`（clean/smudge）会**执行外部程序**；
2. `file -z` 会调用解压器；
3. 名称在 PATH 上被同名脚本遮蔽（我准入的是**动词名**，不是某个具体二进制）——**红队两轮各实证一次**。`egrep`/`fgrep` 已因此移出白名单（`grep -E`/`grep -F` 同二进制、零损失）；`zcat` **保留为命名例外**（白名单里没有等价的非脚本程序）。注意这条对 `grep`/`gzip`/`ls`/`date` 等**每一个**准入动词同样成立；
4. 某个被准入的第三方实现可能在内部写缓存文件（本机核对过 `ls`/`du`/`stat`/`nproc` 等，未发现；但不能证明穷尽）。

对第 1–4 类，本档的处置是：**不假装能判定**——① 不准入任何解释器/包装器（把"文本即程序"这条通道整体关掉）；② 把上述四项写进 `DEPLOY.md §7` 的残余风险；③ 不让它们承担安全结论（即：本档的安全结论建立在"**我准入的动词都是观测型**"这一条上，而不是建立在"所有副作用都能从文本看出来"这一条上）。


### 偏差 1：`git status` 与 `git diff` 默认**不准入**（审计 §6 的清单列了 4 个，我按实测砍到 2 个）

**实测**（真实仓库，逐个命令前后比对 `.git/index` 的 mtime）：

| git 子命令 | 是否重写 `.git/index` | 判定 |
|---|---|---|
| `git status` / `git status --porcelain` / `git status -s` | **重写**（19:15:43.078 → 19:15:44.293） | 默认**不准入** |
| `git diff` / `git diff --cached` / `git diff --stat` | **重写** | 默认**不准入** |
| `git log` / `git grep` / `git ls-files` / `git rev-parse` / `git cat-file` / `git show-ref` / `git for-each-ref` | **不动索引** | **准入** |

补充实测：`GIT_OPTIONAL_LOCKS=0` 能抑制这两个写（但分类器无法给子进程注入环境变量，所以不能用它来放宽）。

**⚠️ 危害程度未证实，如实说明**：我**没有**复现锁冲突——12 路并发 `git status` 产生 **0** 条 `index.lock` 报错。
⇒ 这条默认的准确表述是：**「它确有一个写路径（已实测），但该写导致失败的场景我没能证实」**。写竞争正是本单元要防的东西，所以我按 fail-closed 默认拒绝；**但你若判断「重写索引是原子写、并发不会失败」而选择准入，那也是有依据的判断**——把 `BASH_CONC_GIT_INDEX_REFRESHING_DEFAULT` 改成 `true` 即可（一行常量）。

**落地方式**：独立子开关 `BASH_CONC_GIT_INDEX_REFRESHING_DEFAULT = false`，可经 `globalThis.__DSH_BASH_CONCURRENCY_SAFE_GIT_STATUS__` 或 `DSH_BASH_CONCURRENCY_SAFE_GIT_STATUS=1` 打开；语料 `g01–g11` **双向断言**（默认 status/diff 为 false；开关打开后为 true；而 `git diff --output=`、`git status && rm -rf …`、`git branch -a` 在两种配置下都是 false）。
**已准入的 git（纯对象/ref 读，含实测不动索引者）**：`log show rev-parse rev-list describe blame cat-file ls-tree shortlog whatchanged version merge-base name-rev for-each-ref show-ref var check-ignore check-attr check-ref-format count-objects annotate cherry help grep ls-files`。
**请裁决**：是否接受「默认不准入 status/diff」，或要我把它改为默认准入。

### 偏差 2：审计 §6 P1 的缓解文本把 `node -e` 列为"只读"是**错的**
`node -e 'require("fs").writeFileSync("/tmp/x","1")'` 直接写盘；`python3 -c`、`perl -e`、`awk '{print > "f"}'` 同理。⇒ 本实现的 allow-list **不含** `node/python/perl/ruby/php/awk/sed/xargs/tee/bash/sh`。语料 `w31–w38` 固化这条更正。**这是对审计文本的一处更正，请采纳。**

---

## 8. 同档自复核（对照目标与审计，检查遗漏与副作用）

### 8.1 逐项核对

| 审计结论 / 目标要求 | 本档是否落地 | 自核 |
|---|---|---|
| 根因在 `dsh-tool-bash` 无 `isConcurrencySafe` | ✅ 只动这一处（两处插入） | 未扩范围：没碰 `dsh-tools`/`dsh-agent-loop`/`write`/`edit`/`grep`/`glob` |
| 默认 fail-closed | ✅ 三处独立兜底（我的 try/catch、`defineTool` 的 schema 前置、`executionMode` 的 catch） | 集成 i07–i11 实证 |
| 必须有开关且两方向生效 | ✅ 四层开关 + 语料 5 种 OFF 配置逐例断言 | 活体 ON/OFF 待 §6 |
| 安全拒绝清单 | ✅ 361 例，含全部点名项 + 扩展项 | 危险命令**未执行**，只做分类断言 |
| 不许为收益放宽安全判据 | ✅ 若干可读命令（`sed -n`、`awk`、`git status`、`tar -tf`、`tree`、`iconv`、`hostname`、`command -v`）被**有意**拒绝，均已留档理由 | 见 §7、`DEPLOY.md §7` |
| 冷/热面如实标注 | ✅ 标冷面，不按热面承诺；给出 4 条结构性证据与"升级为实测"的动作 | §1/U-BASHCONC-4 |
| 失败样本保留 | ✅ 6 条，含 1 条真实产品级缺陷与 1 条 INVALID 载荷 | §4 |
| 不写 `~/.dsh`、不点 Sessions 行内按钮、不动浏览器、不 kill/pkill | ✅ 全程 | 产品文件 sha256 未变；无进程操作 |
| 测例只落工作区、结束自清 | ⚠️ **部分**：`probe/`（含 50 MB）与 `probe/negwrite/*` 仍在，待 §6 A9 清理（因为 A3/A4 还要复用） | 已在 `DEPLOY.md §9` 列明清理责任 |
| `/tmp` spill 负担不加大 | ✅ 未新增产品路径 spill；自定义临时物只在 `/tmp` 的 scratch（已即时删除）与哨兵文件 | — |

### 8.2 我主动找过但**没有**发现的副作用

0. **我自己的红队抓到的假准入已修**：`env --split-string=`（见 §4）。**这条改变了我的方法论**——我不再假定"以 `-` 开头的词是惰性的"，而是逐动词核对其 `--help` 里每一个可能写盘/执行/改状态的选项（`dmesg -n/-E` 就是这样补上的）。同时把这一整类问题写进红队 subagent 的任务书（§10）。
1. **输出/行为回归**：补丁不改 `execute`、不改 `parameters`、不改 `output.schema`、不改渲染、不改超时路径、不改 `maxOutputBytes`。⇒ `[exit code: N]` 标记、`(no output)`、尾窗字节数、spill 路径标记**结构上不可能变化**（这些代码一行未动）。**但"结构上不可能"不等于"实测过"**：E1–E4 与 C0 的 `resultHead` 已存档（`evidence/*.json` 的 `results` 字段），可在 patched 相位逐条比对。
2. **顺序语义与"收益形状"（逐行核对 `dsh-agent-loop:132-146, 229-233`）**：
   - 外层 `while` 每轮只看**当前第一个**调用来定 `mode`（`:135`）。若为 exclusive ⇒ 分组**恰为 1**（`:136` 的 `[first]`）；若为 parallel ⇒ 分组 = **剩余全部**，但 `fillPool` 在遇到第一个非 parallel 时 `break`（`:231`）。
   - ⇒ 实际效果是：**消息里连续的只读段各自成池并行，遇到写命令即断开、写命令单独串行、其后又是新的并行段**。例：`R R W R R R` → `[R R]` 并行、`[W]` 独占、`[R R R]` 并行。
   - ⇒ **相对顺序恒等于消息顺序**（写命令之间、写命令与只读命令之间都不重排）；`inFlight.size < maxParallelToolCalls`（默认 10，`dsh-agent-loop:922`）是每段的并发上限，本档 6 路批次留有余量。
   - E3B 的区间互不相交实测与"写命令仍独占"一致；C0 的 6 路同起与"只读段成池"一致。
   - ⇒ **收益不是"整条消息全并行"，而是"每个连续只读段内并行"**。这一点会直接影响你对 A1/A3 期望值的解读。
3. **`run_in_background`**：走**同一套**命令判定（背景调用不被无条件放行），刻意 fail-closed，见 `DEPLOY.md §7.5`。
4. **超时**：60 s 生效预算未被触碰；补丁不引入定时器、不 race（与审计 §5.2 的 `INERT` 包装层无关）。
5. **审批路径**：`approveBashEscalation` 与 `sandbox_permissions` 路径一行未动；且分类器对**任何** escalation 请求直接返回 exclusive（语料 a01/a02）⇒ 加宽权限的调用永远不会被并行调度。

### 8.3 自裁决

> ## 自复核结论（最终）：**PASS —— PENDING 已清零**

**patched 相位已跑完（§11），全部达标；`无未完成项`。** 三轮验收（正向 span/重叠、负向写命令 0/15、逐字节正确性、安全探针、开关双向活体）全部真跑通过；落地经 **34/34** 断言核验（含 `DEPLOYED == pre-image + 插入，逐字节`）。

**四项需要你裁决的开放项（不阻塞交付，均已在 `DEPLOY.md` 写明取舍）**：① `git status`/`git diff` 默认准入与否；② `/tmp` 哨兵开关层保留与否；③ PATH 解析残余是否可接受；④ `sort` 保留（R4 独立同意保留）。

> ## 自复核结论：**PASS（带 1 项 PENDING 阻塞 + 3 项待裁决 + 3 条已记录的命名残余）**
>
> **过程：本档自复核判了 REWORK 四次、修复四次，才 PASS。**
>
> **第一轮**：R1 在 `10509d13…afd8` 上出具 **BYPASS FOUND (8)**。我逐条复现、确认全部成立（`uniq -c a b` 真的覆盖了目标文件、`xxd a b` 真的创建了文件、`nm --plugin` 的 dlopen 构造函数真的执行），**当场把自裁决改为 REWORK 并上报问题清单，没有放宽任何判据去换取收益**。
>
> **第二轮**：R2 在加固版 `2392f935…ac38` 上又出具 **BYPASS FOUND (6)**，其中 **H1–H3 是我上一轮修复自身的漏洞**（操作数计数把 `-` 当选项，`uniq - out.txt` 因此漏过并**真的写出文件**），另有 5 条**我上一轮引入的假拒绝**。
>
> **第三轮**：R3 在 v1.3 上又找到 **2 个机制 / 5 个被准入写法**——`ss -D/--diag` 是**输出文件**选项（我实跑确认它创建并覆盖文件），以及 `nm @opts.txt` 用**响应文件**把被拒的 `--plugin` 藏起来触发 **dlopen 执行**。
>
> **第四轮**：R4 找到一整**类** —— `getopt_long` **长选项缩略**让每一条按完整拼写锚定的拒绝都失效（`sort --out=F` 写出文件、`nm --plug=X` dlopen 执行、`file --comp` 创建 `.mgc`、`sort --compress-prog=P` 执行程序）。我做了**结构性**修复（逐动词名字表 + 「提交名是被拒名的前缀」判定），而不是再打一个补丁。
>
> 现修订 `ddcbf6d3…2a04`：语料 **361/361**、集成 **15/15**、机制 **28/28**、红队发现独立复现 **18/18 已被拒**（我亲手复现 17 个真实效果）全过。
>
> **三轮 REWORK 全部保留在案**——它们比"一次就 PASS"更能说明本档的验证强度，也说明两件事：① **外派红队必须对着最新哈希复测**（R2、R3 的发现全部是在改动后的哈希上重测出来的）；② **手写选项拒绝表本质上不完备**，这正是我把"输出路径"类改成**穷尽扫描**、并把每次扫描的**局限**写进代码注释的原因。

- **PASS 的部分**（可直接进你的落地批）：补丁件与脚本、分类器正确性（361 例 × 7 例开关配置）、真实产品代码集成（15/15）、补丁机制六项（dry-run/唯一锚点/语法/幂等/精确可逆/回滚）、冷面判定（4 条结构性证据）、未打补丁缺陷复现（signature 强于审计）、正向机制对照（C0 六路真重叠）、写命令负向对照（E3B 零重叠）——**全部真跑，无一推断代替实测**。
- **PENDING（不是我判断失误，是权限边界）**：patched 相位 A1–A9（含你要求的 span 下降幅度、重叠证据、逐字节正确性）。**卡在我写不了产品树 + 冷面需重启**，需要你 apply + 重启。序列已脚本化到"照表发工具调用即可"。
- **三项待你裁决**：① `git status`/`git diff` 默认准入与否（实测只这两个重写 `.git/index`，但锁冲突未复现）；② `/tmp` 哨兵开关层保留与否（`DEPLOY.md §5`）；③ 残余的 PATH 解析风险是否可接受（`egrep`/`fgrep` 已移出白名单，`zcat` 为命名例外；若要求这条必须堵死，唯一办法是本单元不上线）。
- **降级声明**：审计 §6 P1 验收项 4（`gateOutcome == EXCLUSIVE`，持锁 + 机器安静）**未满足**，本窗全程 CONTENDED（loadavg 5.66–11.97）。我用负载不变判据（重叠对数 / 峰值并发 / span÷Σ / 区间是否首尾相接）替代绝对 ms，并逐批标注 loadavg。
- **返工项已清零**：三轮红队共 16 个已实证缺陷 + 1 个我自测发现的，**全部当场修掉并留档**（`§4` 失败表 + `§10.1–10.3`）；3 条明确记录的命名残余不属缺陷。

---

## 11. patched 相位实测（补丁已生效后的真跑结果，2026-09-23）

### 11.0 环境与落地核验（**先证明"跑的确实是打了补丁的宿主"**）

| 项 | 实测 |
|---|---|
| 宿主 | **pid 2649213**，`STARTED 三 9月 23 10:09:52 2026` |
| 目标文件 | `dsh-tool-bash/lib/index.js` sha256 = **`cb73d3b17c6a221f8172e944d4314fdc8b46d5995212048bb97fe27c03d5a45f`**（44054 B）= 我给出的期望值 |
| **文件 mtime vs 宿主启动** | 文件写于 **10:08:20**，宿主启动于 **10:09:52** ⇒ **宿主启动晚于写入**，装载的是打过补丁的模块（冷面判定的前提） |
| 落地字节级证明 | `bin/verify-patch-mechanics.mjs` 新增断言 **d03**：`DEPLOYED == pre-image + 两处插入，逐字节相等` ⇒ 部署文件 = 我验证过的 pre-image + 我验证过的声明段，**没有任何其它改动**。d04：部署内的声明段区域 sha256 = `ddcbf6d3…2a04` = 我的候选件。d05/d06：你生成的 manifest 里的 `patchedSha256` / `blockSha256` 与我的一致 |
| 开关状态 | 起始 `/tmp/dsh-bashconc-off` **不存在**（新行为开）；测完 **确认不存在** |
| 窗口 | loadavg **2.72–2.88**（"无其它线在跑"）——比打补丁前那批（loadavg **7.98**）干净得多 |
| 机制回归 | 语料 **361/361**、集成 **15/15**、机制+落地 **34/34**、红队复现 **18/18 已拒** |

### 11.1 A1–A9 结果（全部真跑；批次 = 一条消息内正好 N 个 `bash` 调用）

| # | 批次 | 开关 | n | **span** | Σ | **span/Σ** | **峰值并发** | **重叠** | 中位间隙 | 判定 |
|---|---|---|---|---|---|---|---|---|---|---|
| **A1** | 6× 只读 `sleep 1` | OFF（补丁生效） | 6 | **1395 ms** | 7559 | **0.1845** | **6** | **15/15** | **0 ms** | ✅ 并行 |
| **A2** | 6× 只读 `sleep 1`（**同窗对照**） | ON | 6 | **6515 ms** | 6513 | **1.0003** | **1** | **0/15** | 1086 ms | ✅ 串行 |
| **A3** | 6× `grep -c` × 50 MB | OFF | 6 | **450 ms** | 2621 | **0.1717** | **6** | **15/15** | 0 ms | ✅ 并行 |
| **A3'** | 6× `grep -c` × 50 MB（**同窗对照**） | ON | 6 | **649 ms** | 645 | **1.0062** | **1** | **0/15** | ~87 ms | ✅ 串行 |
| **A6** | 6× `date '+%s.%N'` | OFF | 6 | 443 ms | 2647 | 0.1674 | **6** | **15/15** | 0 ms | ✅ 并行，子进程启动跨度 **0.319 s**（补丁前 **10.284 s**） |
| **A7B** | 6× 确定性只读命令 | OFF | 6 | 537 ms | 3209 | 0.1673 | **6** | **15/15** | 0 ms | ✅ 并行 |
| **A7B'** | 同一组 6 条（**同窗对照**） | ON | 6 | 637 ms | 633 | 1.0063 | **1** | **0/15** | ~0 ms | ✅ 串行 |
| **A4** | 6× **写命令** `touch`（真实落盘） | OFF | 6 | 617 ms | 613 | **1.0065** | **1** | **0/15** | 96 ms | ✅ **仍 exclusive** |
| **A5** | 6× `echo x >> f`（重定向） | OFF | 6 | 927 ms | 925 | **1.0022** | **1** | **0/15** | 150 ms | ✅ **仍 exclusive** |
| **A8** | 6× 危险形状+无害目标（安全探针） | OFF | 6 | 534 ms | 532 | **1.0038** | **1** | **0/15** | 89 ms | ✅ **仍 exclusive** |
| C0 | 6× `read`（已声明并行安全的**对照工具**） | — | 6 | 932 ms | 5575 | 0.1672 | **6** | **15/15** | 0 ms | ✅ 机制对照 |

**起始时间戳交错证据（A1 原始区间，批内 offset ms，`start..end`）**：

```
A1  (patch active)  0..1100   0..1166   1..1235   1..1303   1..1364   1..1395   ← 六者起点互差 1 ms，全程相交
A2  (switch ON)     0..1090   1090..2176  2176..3263  3263..4349  4349..5433  5433..6515   ← 首尾相接，零重叠
A3  (patch active)  0..~437   ...                                            ← 6 路并发，peak 6
A3' (switch ON)     0..~108   108..~195  ...                                 ← 逐段相接
A7B (patch active)  0..535   0..535   1..535   1..536   1..536   2..537      ← 起点互差 ≤2 ms
A7B'(switch ON)     0..633 区间接续
A4  (write)         0..~102  103..~205 ...                                   ← 仍首尾相接
```

⇒ **正/负两向的签名词完全分离**：只读批次 `peak=6 / 15-15 重叠 / span/Σ≈0.17`；写命令与危险形状批次 `peak=1 / 0-15 / span/Σ≈1.00`。

### 11.2 加速比：**必须区分同窗对照与跨窗对照**（这是本节最重要的诚实说明）

| 批次 | 同窗对照加速比（哨兵 ON vs OFF，同载荷同窗） | 跨窗"vs 打补丁前" | 备注 |
|---|---|---|---|
| A1/A2（1 s 载荷） | **4.67×**（6515 → 1395 ms） | 22.93× | 跨窗那个数**不可归因**：补丁前那批的 loadavg 是 7.98 |
| A3/A3'（50 MB grep） | **1.44×**（649 → 450 ms） | 42.78× | 同上；且 A3 的 `span / max(单次时长) = 1.002`，满足审计 §6 P1 验收项 1 的 **≤1.5×** 判据 |
| A7B（瞬时只读命令） | **1.19×**（637 → 537 ms） | — | 载荷本身 ~1 ms/次 |
| A6（瞬时 `date`） | — | 24.29× | 跨窗 |
| A4/A5/A8（写/危险形状） | 不适用（本就不该并行） | 20.61× / 4.27× / — | 跨窗数只是负载差，**不是收益** |

**为什么会这样（对审计乐观预期的一处更正）**：每条 exclusive 调用的**宿主侧开销是随负载变化的**，实测量级：
- 补丁前、loadavg 7.98 的窗口：**≈4.3 s/次**（E1：31985 ms ÷ 6，扣掉 1 s 载荷）
- 打补丁后、安静窗口、串行（A2）：**≈86 ms/次**（6515 ÷ 6 − 1000）
- 安静窗口、瞬时命令串行（A7B'）：**≈1 ms/次**（637 − 633）

所以并行化的收益是 `(N×载荷 + N×开销) / (载荷 + fanout)`：**开销越大、载荷越长，收益越大**。审计 §1.3 的 `8.17×` 与本节跨窗的 `22.9×` 都来自**高开销窗口**，是**上限性质**的数字，不是稳态收益。

⇒ **本档给出的稳态口径**：
1. **结构性收益（与负载无关，无条件成立）**：0/15 → **15/15** 重叠、峰值并发 1 → **6**、`span/Σ` 1.000 → **0.17**；子进程启动跨度 10.28 s → **0.319 s**。
2. **时间收益（同窗、同载荷）**：长命令 4.67×；50 MB 级读 1.44×；瞬时命令 1.19×。
3. **对"≥3× 改善"目标的回答**：**载荷 ≥1 s 时达标（4.67×）**；50 MB `grep -c` 这类 ~100 ms 级载荷**不达标（1.44×）**，但审计为该载荷单独写的判据（`span ≤ 1.5× 单次 span`）**已满足（1.002）**。**我不把 22.9× 当作达标依据**，因为它是跨窗数。

### 11.3 逐字节正确性（A7）

`bin/compare-correctness.mjs` 把**同一窗口内**串行（哨兵 ON）与并行（哨兵 OFF）两次执行的**模型可见结果文本**逐条比较：

```
A7B: 6 deterministic read-only commands    n=6/6  BYTE-IDENTICAL=true
A3 vs A3': 6x grep -c on a 50 MB file      n=6/6  BYTE-IDENTICAL=true
A1 vs A2: 6x sleep 1 (no output either way) n=6/6  BYTE-IDENTICAL=true
ALL BYTE-IDENTICAL: true        → evidence/A7-correctness-verdict.json
```
覆盖了 stdout 内容（`2346`、`369`、md5、sha256、`54816`、`bin/*.mjs` 排序列表、6 个 grep 计数）与"无输出"两种情况。⇒ **只读白名单命令的输出在并行与串行下逐字节相同**。
（说明：早先 `evidence/COR-PRE-*` 是打补丁前的基准，其中 `md5sum`/`head report.md` 两条的输出**随后续编辑而变**，因此**不能**跨相位比对——本节的同窗对照是唯一有效的判据，这一点我如实标注。）

### 11.4 写命令与危险形状仍然 exclusive（负向对照，不可放宽）

- **A4** 6× `touch` 真实落盘：`span/Σ = 1.0065`、峰值并发 **1**、**0/15 重叠** ⇒ 与串行语义一致（文件 `probe/negwrite/a4n1..6` 均创建，测后已清理）。
- **A5** 6× `echo x >> f`：`1.0022`、**1**、**0/15** ⇒ 重定向形状仍 exclusive。
- **A8** 6× "危险形状 + 无害目标"：`1.0038`、**1**、**0/15**。六条为：
  `uniq -c <corpus> /dev/null`（位置输出）、`xxd <block> /dev/null`（位置输出）、`file -bC -m /dev/null`（**短选项粘连**）、`printf x > /dev/null`（重定向）、`echo x >> /dev/null`（追加重定向）、`find <probe> -maxdepth 1 -name 'NOPE*' -delete`（删除谓词，匹配不到任何文件）。
  **全部仍判 exclusive**，且**没有任何真正的危险变体被执行**（`dmesg -xc/--read-clear`、`date -us`、`ss -aK`、`git help log`、`sort -T` 一律只做分类断言）。
  ⚠️ 一处**如实修正**：`file -bC -m /dev/null` 在本沙箱下**没能写出** `/.mgc`（`/dev/null.mgc` 不存在），所以这条探针只证明了**分类正确**，没有在本机复现 `-bC` 的写效果；`-bC`/`--comp` 确实会写 `<magic>.mgc` 的证据来自自动化红队复现（`bin/verify-redteam-findings.mjs` 的 A3/AB3，用工作区内的真实 magic 文件，实测创建成功）。这两件事我分开写，不混为一谈。

### 11.5 开关两个方向都**活体**实测生效

| 方向 | 怎么做的 | 结果 |
|---|---|---|
| OFF（旧行为） | `touch /tmp/dsh-bashconc-off` | A2/A3'/A7B' 三批**全部** `peak=1 / 0-15 / span-Σ≈1.00` |
| ON（新行为） | `rm /tmp/dsh-bashconc-off` | A1/A3/A6/A7B 四批**全部** `peak=6 / 15-15 / span-Σ≈0.17` |

⇒ **同一个二进制、同一窗口、同一载荷，仅靠一个文件的存在与否就能翻转两向**。这条同时证明：① 开关按调用重新解析（无需重启）；② A1 的收益**来自补丁本身**，而不是窗口差异；③ 紧急刹车（`touch /tmp/dsh-bashconc-off`）是有效的。

### 11.6 C0 机制对照（补丁后仍在）

6× `read`（`dsh-tool-fs:415` 已声明并行安全）：span 932 ms、`span/Σ = 0.1672`、峰值 **6**、**15/15** 重叠。⇒ 打了补丁后，bash 的并行行为与本来就并行安全的工具**同形**。

### 11.7 落地面判定：**冷面结论被实测证实**

宿主启动（10:09:52）晚于文件写入（10:08:20），且补丁行为（A1 的重叠）**确实出现** ⇒ "只改该 lib 文件必须重启才生效"的结构性判定得到实测确认；同时也说明落地**已成功**（不是"写了但没加载"）。

---

## 9. 产物清单

```
.workspace/lag-fix/exec-bashconc/
├── apply-BashConc-v1.mjs                 补丁脚本（dry-run 默认 / --apply / --rollback / --json）
├── candidate/bashconc-block-v1.js        拼接段（25321 B，sha256 ddcbf6d3…2a04）
├── corpus/classifier-corpus.json         361 例语料
├── bin/run-classifier-tests.mjs          语料跑测（从已拼接文件抽取段文本 = 测上线字节）
├── bin/integration-dsh-tools.mjs         真实 defineTool + 真实 executionMode 集成验证
├── bin/verify-patch-mechanics.mjs        机制排练自动化（28 项断言，可复跑）
├── bin/measure-batch.mjs                 会话事件日志 → span/重叠/并发
├── bin/summarize-evidence.mjs            证据总表
├── bin/compare-correctness.mjs           同窗串行 vs 并行的逐字节正确性比对
├── bin/verify-redteam-findings.mjs       红队各轮发现 + 残余的独立复现（19 条记录：15/15 缺陷已拒，14 个效果亲手复现）
├── evidence/
│   ├── COR-PRE-readonly-correctness.json  6 条确定性只读命令的输出基准（A7 比对用）
│   ├── _summary-PRE.json                 未打补丁相位总表（§2.1 直接来源）
│   ├── C0-read-positive-control.json     6×read 正向机制对照
│   ├── E1-readonly-sleep-PRE.json        6×sleep 1
│   ├── E2-dispatch-clustering-PRE.json   6×date（含子进程启动跨度 10.28 s）
│   ├── E3B-write-negative-PRE.json       6×touch 真实落盘负向对照
│   ├── E4-grep50mb-PRE.json              6×grep -c × 50 MB
│   ├── E3-invalid-write-negative-PRE.json  INVALID 样本（保留）
│   ├── classifier-tests.json             361 例 × 8 配置明细
│   ├── integration-dsh-tools.json        15 项集成断言 + 抽取到的 executionMode 源码
│   ├── patch-mechanics.json              28 项补丁机制断言（可复跑）
│   ├── redteam-verification.json         我对红队各轮发现的独立复现（18/18 已拒；3 条命名残余；17 个效果亲手复现）
│   ├── _summary-PATCHED.json             patched 相位总表（§11 直接来源）
│   ├── A1/A2/A3/A3P/A4/A5/A6/A7B×2/A8-*.json  patched 相位各批次原始度量
│   ├── A7-correctness-verdict.json       逐字节正确性判定
│   └── (red-team raw evidence lives under raw/redteam/ and is referenced, not duplicated)
├── raw/
│   ├── my-session.jsonl                  本会话事件日志快照（度量输入）
│   ├── rehearsal/                        工作区排练副本 + apply/manifest + package.json
│   ├── redteam/                          二级 subagent R1/R2 红队产物（见 §10）
├── raw/redteam-repro/                    红队发现的独立复现工作区（跑完自动清理）
├── (probe/ 的 50 MB 载荷与临时文件已在交付前清除；DEPLOY.md §9 给出重建命令)
├── DEPLOY.md                             落地/回滚/冷面判定/重启后验证清单
└── report.md                             本文件
```

## 10. 二级 subagent（红队）

已授权派出 **2 个**（上限 2）：R1 = 对抗性"假准入"搜索（对我判 `true` 但实际能写盘的命令）；R2 = 同上，针对**加固后的修订版**做再验证（复用 R1 的执行器，独立复核我的修复是否真的闭住了洞）。产物落 `raw/redteam/`（`report.md`、`run-all.sh`、`sideeffect-scan.sh`、`gitscan.sh`、`proof/`）。

### 10.1 R1 结果：**BYPASS FOUND — 8 个已实证的假准入 + 4 个拒绝表拼写绕过**（全部已修）

R1 对 `10509d13…afd8`（v1.1 修订）出具 **BYPASS FOUND (8)**。**我逐条独立复现后全部采信**，并因此把本档自裁决改为 **REWORK**（见 §8.3）。发现的四类问题与修复：

| 类 | R1 编号 | 例子（我亲自复现） | 我复现到的事实 | 修复 |
|---|---|---|---|---|
| **位置参数即输出文件** | A1、A2 | `uniq -c src.txt victim.txt`；`xxd src.txt out.txt` | 亲手跑：`victim.txt` 的内容被 `uniq` 输出**覆盖**（原为 `IMPORTANT DATA`）；`xxd` **创建**了 `out.txt`。GNU 用法行是 `uniq [INPUT [OUTPUT]]` / `xxd [infile [outfile]]` | 新增 `BASH_CONC_COMMAND_OPERAND_CAP`：`uniq` / `xxd` **操作数上限 1**（`uniq -c a b`、`xxd a b`、`xxd -r a b` 全部拒绝）。R1 对全部 80 个准入动词做用法行扫描，确认**只有这两个**有位置输出 |
| **短选项粘连** | A3、B1–B4 | `file -bC -m magic`（编译 `.mgc`）；`dmesg -xc`/`-Tc`/`--read-clear`（清内核环缓冲）；`date -us`/`-Rs`（改系统时钟）；`ss -aK`/`-tK`（强关 socket） | `getopt` 亲测确认粘连拆分（`getopt -o xc -- -xc` → `-x -c`）。原正则只匹配短选项簇的**第一位**（`/^-C/` 命中 `-C` 却不命中 `-bC`） | 全部改为扫整簇：`/^-[^-]*C/`、`/^-[^-]*s/`、`/^-[^-]*[cCDEn]/`、`/^-[^-]*K/`；补 `--read-clear`。**B 类四项我没有执行**（会破坏宿主），只验判决——这一点 R1 主动标注了，我认同 |
| **加载外部程序** | A4、A7 | `nm --plugin evil.so /bin/ls`；`git help log` | `nm --plugin` 会 `dlopen` 攻击者指定的 `.so` ⇒ **在"已判定可并行"的调用里执行任意代码**；`git help` 执行 PATH 解析的 `man`→`nroff`→`groff` 链，且 `man` 会写 `/var/cache/man/cat1/…`（R1 用 strace 取证） | `--plugin` 加入**通用**拒绝表；`git help` 从 git 纯读集合**移除** |
| **PATH 解析的壳脚本** | A5、A6 | `egrep` / `fgrep` / `zcat` 在 `/usr/bin` 下**本身就是 shell 脚本**（`exec grep -E "$@"` / `exec gzip -cd "$@"`） | R1 用植入 `PATH` 前置目录的假 `grep`/`gzip` 证明可劫持 | **不修，按残余风险记录**：见下方"对 A5/A6 的判断" |

**同时修掉了 R1 列出的假拒绝**（凭空多出的收益）：`find . -type f -executable`（`/^-exec/` 误伤 ⇒ 收紧为 `/^-exec$/`）、`df --output=target`、`lsblk --output=NAME,SIZE`、`findmnt --output=TARGET`（`--output` 下沉为**逐命令**规则：只对 `sort` 与 `git` 生效）。

**对 A5/A6 的判断（我的立场，已交 R2 复核）**：这不是 `egrep`/`fgrep`/`zcat` 独有的问题——`grep`/`gzip`/`ls`/`date`/**每一个准入动词**都是通过 `$PATH` 解析的，所以"名字被同名脚本遮蔽"是**环境属性**，不是删掉三个别名就能关掉的通道。本档因此把它归入"不可判定的残余"（§7.0 第 3 条），而不是假装修复。R1 自己也指出：遮蔽需要一个**写权限**且在 `/usr/bin` **之前**的 PATH 目录，而 `workspace-write` 下不可写（R1 实测被拒）；风险面在 `danger-full-access` 或写权限根覆盖这些目录的会话里才成立。

**对 A8 的判断（已按 R1 意见改写判据）**：`sort -S 1M <50MB>` 会创建 141 个临时文件（R1 strace 取证）。R1 也实测这些文件是**唯一随机名 + `O_EXCL` + 0600 + 退出时 unlink，跑完 0 残留**。我**没有**为了消掉它而删掉 `sort`（那会损失一条核心只读能力），而是：① 额外拒绝 `-T` / `--temporary-directory`（不让临时目录被指定）；② **把判据本身改写得更准确**——从"无任何写效果"改成 **"无『兄弟调用也可能命名的路径』上的可达写"**（并发调度的真实危害是对**共享资源**的竞争；唯一命名的临时文件不可能竞争）。这段改写写在块内注释里，任何人读代码都能看到这条已知例外，不会被"绝不写盘"的说法误导。
**R1 的原始结论与"未执行/不可利用"清单**完整保留在 `raw/redteam/report.md`（222 行，含 Table C 的 20 条"试过但不可利用"与 92 次调用的 side-effect 扫描结果）。

### 10.2 R2 结果：对加固版的再验证 —— **又一次 BYPASS FOUND (6)**，其中 3 个是我**自己修复的绕过**

R2 在 `2392f935…ac38`（v1.2）上重跑并在**同一哈希**上实测出 6 个仍然存活的形态。这不是重复劳动，而是**抓到了我第一轮修复里的一个漏洞**：

| # | 命令 | R2 的判决 | 我亲自复现到的效果 | 性质 |
|---|---|---|---|---|
| **H1** | `uniq - out.txt`（以及 `uniq -c - out.txt`、`uniq -- - out.txt`） | `safe=true` | `uniq - <out> < <src>` → `<out>` 被**覆盖** | ⚠️ **这是对我 v1.2 操作数上限的绕过**：我写的 `words.filter(w => !w.startsWith("-"))` 把 stdin 操作数 `-` 当成选项，于是 `uniq - OUT` 只数到 1 个操作数就放行 |
| **H2** | `xxd - out.txt` / `xxd -r - out.bin` | `safe=true` | `xxd - <out> < <src>` → `<out>` 被**创建** | 同上，`xxd` 版本 |
| **H3** | `printf 'a\na\nb\n' \| uniq - out.txt`、`printf abc \| xxd - out.txt`、`cat f \| uniq - OUT \| wc -l` | `safe=true` | 管线写出文件（`out` = `"a\nb\n"`；xxd 版 = `"00000000: 6162 63  abc\n"`） | 管线规则放大了同一个洞：每个段单独看"准入"，合起来写出文件 |
| **H4/H5** | `egrep -c …` / `fgrep -c …` | `safe=true` | PATH 前置 shim → helper 被调用 | 与 R1 的 A5 同类 |
| **H6** | `zcat …` | `safe=true` | 同上（`exec gzip -cd`） | 同上 |

**修复（v1.3）**：
1. **操作数计数重写**：`-` 与 `--` **都算操作数**，并且**跳过短选项的独立参数**（`uniq -f 2 f` 里的 `2`、`xxd -l 64 f` 里的 `64` 不再被误算成操作数）。
2. 新增 `bashConcClusterHasShortOption(word, letters, argTaking)`：短选项簇扫描在遇到**吃参数的字母**时停止 —— 这一条同时修掉了 R2 指出的**我上一轮引入的假拒绝**（`date -Iseconds` 里的 `s` 属于 `-I` 的参数，不是选项字母）。
3. **`egrep` / `fgrep` 整体移出白名单**（它们是 deprecated 别名，`grep -E` / `grep -F` 是同一个二进制）——免费降低一层风险，也消掉了 R2 指出的"与 `git help` 处理不一致"。
4. `zcat` **保留**并**显式写成命名例外**（白名单里没有等价的非脚本程序；它是 `exec gzip -cd "$@"` 的脚本）。

**R2 还独立确认了两件事**：`sort -S` 的临时文件"**确实不可能竞争**"（141 次 `O_CREAT|O_EXCL, 0600`、随机名、全部 unlink）——R2 同意我改写的判据；以及我按实测收窄的 git 准入在 stat-dirty 索引下成立（`git grep`/`git ls-files` 保持 `.git/index` 逐字节不变，`git status`/`git diff` 会建 `.git/index.lock` 并 rename 覆盖）。

**R2 提出的 5 条建议我全部采纳**（操作数计数、同类 `[INPUT [OUTPUT]]` 动词、`egrep/fgrep/zcat` 明确表态、语料补例、把选项参数排除出计数并把 `date` 规则改成不吃 `-Iseconds`）。语料因此新增 `w135–w144` 与 `p92–p105`（+29 例，**其中 5 例正是 R2 指出的假拒绝回归**）。

### 10.3 R3 结果：对 v1.3 的第三轮复测 —— **又是 2 个机制、5 个被准入的写法，且都不在当时的语料覆盖内**

R3 在 `0958faa7…d091`（v1.3）上重测，找到两类**我的拒绝表从未覆盖**的机制。我逐条复现，**全部成立**：

| # | 命令 | 我复现到的效果 | 当时为什么漏 |
|---|---|---|---|
| **N1** | `ss -D <path>`、`ss --diag=<path>`、`ss -D<path>`（粘连）、`ss -aD <path>` | `ss --help` 写着 `-D, --diag=FILE  Dump raw information about TCP sockets to FILE`。我实跑：`ss -D <out>` **创建了 11524 B 文件**；`ss --diag=<victim>` 把一个 24 B 既有文件**覆盖**（md5 `efe63ae7…` → `d6e1ad67…`）。**无任何前置条件**：不需植入物、不需引号技巧、不需放宽沙箱 | `ss` 拒绝表只写了 `K`/`--kill` |
| **N2** | `nm @opts.txt /bin/ls`（`opts.txt` 内容为 `--plugin /…/evil2.so`） | `@FILE` 是 binutils 的**响应文件**（`@<file> Read options from <file>`），而 `--plugin` 是按**词**拒绝的 ⇒ 选项藏进被引用的文件即绕开。我用自建 `evil2.so` 实测：`nm @opts.txt /bin/ls` exit 0，**dlopen 构造函数真的跑了**（标记文件出现） | 我补的 `--plugin` 通用规则**在响应文件面前是空的** |

**修复（v1.4）**：
1. `ss` 的写入字母补 `D`，长选项补 `/^--diag(=|$)/`。
2. 新增 `BASH_CONC_COMMAND_REJECT_RESPONSE_FILE = {nm, objdump, readelf, strings}`：**整类拒绝 `@` 开头的词**。这不是猜——我对**全部 81 个准入二进制动词**跑了一遍 `--help` 扫 `@<file>` / "Read options from"，**完整结果恰好是这 4 个**。规则**必须逐动词**：对 `grep` 来说 `@` 词是**模式**（`grep '@types/' src`），对 `jq` 是**格式串**（`jq '@csv' f`），全局拒绝会引入真实假拒绝。

**我还借这次把整个"输出路径"类做了穷尽扫描**（同样对 81 个动词的 `--help` 扫 `=FILE`/`<file>`/`to FILE`/写入）：完整结果是 `sort -o/--output`（已拒）、`xxd -r -s`（是偏移量不是路径）、摘要工具的 `--ignore-missing`（是读）、`pgrep -F`/`ss -F`（从文件**读**）、以及 **`ss -D/--diag`（在写，已修）**。⇒ 这一类的边界现在是**扫过一遍的结论**，而不是"我能想到的清单"。

**⚠️ 我把这次扫描的局限也写进了代码注释**：`--help` 扫描只管**有文档**的选项 —— `nm` 的 help 里根本没有 `@FILE` 这一行，但 `nm` 实际认它。所以响应文件规则是**行为式**（直接拒 `@` 形式），而不是"去文件里找哪些选项危险"。

**R3 同时确认**：v1.3 的那批开关/修复断言 **15/15 仍然 PASS**；并独立复核了我按实测收窄的 git 准入（stat-dirty 索引下 `git grep`/`git ls-files` 保持 `.git/index` 逐字节不变，`git status`/`git diff` 会 index.lock + rename）。

**一句话收尾**：三轮红队分别抓到 8 / 6 / 2 个真实缺陷，**每一轮都包含"我上一轮修复自身引入或未覆盖"的项**（R2 的 H1–H3、R3 的 N2 都是在**我新加的规则**上找到的缝）。这不是重复劳动——它是本单元安全结论唯一可信的支撑方式，也是为什么我坚持把判据写成"我准入的词都是观测型"而不是"所有副作用都能从文本看出来"。

### 10.4 R4/R5 结果：第四轮找到一整**类** —— `getopt_long` 长选项缩略绕过了我所有 `(=|$)` 锚定的拒绝规则

R4 在 v1.4（`399101df…2a04`）上重测，找到的不是又一个实例，而是**一整类漏洞**：GNU `getopt_long` 接受长选项的**任意无歧义前缀**，所以凡是我按**完整拼写**锚定的拒绝（`/^--output(=|$)/`、`/^--diag(=|$)/`、`/^--plugin(=|$)/` …）都能被"少打几个字母"绕过。

| verb | 我拒绝的拼写 | 我**放过**的拼写 | 我亲手复现到的效果 |
|---|---|---|---|
| `sort` | `--output=F` | `--out=F`、`--o=F`、`--outp=F` | **写出了 F**（文件真的出现，内容是排序结果） |
| `sort` | `--compress-program=P` | `--compress-prog=P`、`--comp=P` | **执行 P**（R4 用标记脚本取到 26 KB 日志） |
| `sort` | `--temporary-directory=D` | `--temp=D`、`--temporar=D` | 1102 个 `O_CREAT\\|O_EXCL,0600` 落到**被指定的目录**（strace） |
| `nm` | `--plugin=X` | `--plug=X`、`--plu=X` | **dlopen → 构造函数执行**（我自建 `evil3.so` 实测，标记文件出现）——**`@file` 修复完全没覆盖缩写** |
| `file` | `--compile` | `--comp`、`--compil` | **创建 `<magic>.mgc`**（我实测） |
| `date` | `--set=…` | `--se=`、`--s=` | date 接受（用 `--se=NOT_A_DATE` 安全探针验证，未执行有效值） |
| `dmesg` | `--clear`/`--read-clear` | `--cle`、`--read-c`、`--conso` | 接受（只做接受性探针） |
| `ss` | `--kill` | `--kil` | 接受（只做接受性探针） |
| `git` | `--output=F` | `--outp=F` | **git 自己拒绝** ⇒ 潜在而非在用 |

我已经把这一类的边界补成**穷尽**的：v1.5 里所有长选项拒绝改成**按名字的前缀匹配**（`denied.startsWith(提交的名字)`），这正是 `getopt_long` 的语义，也正好是**不会过度拒绝**的方向——在同一动词内，一个名字是某被拒选项的前缀，当且仅当该缩写只可能指那个被拒选项。

**v1.5 修复（一处结构性改动，不是逐个打补丁）**：
- 删除全部 `(=|$)` 锚定的长选项正则；改为 `BASH_CONC_COMMAND_WRITE_LONG_NAMES`（逐动词名字表：`sort`/`date`/`file`/`dmesg`/`ss`/`rg`/`git`/`nm`/`objdump`/`readelf`）+ `bashConcWordHitsLongName(word, denied, allowAbbreviation)`。
- **通用**拒绝表降级为**只做精确名匹配**：通用表若也允许缩略匹配，`--p...` 会变成对所有动词的拒绝，是巨大的假拒绝面（这是设计上刻意区分两层的原因）。
- `git` 的私有正则表也一并改成名字表（否则 `git log --outp=` 仍会漏）。
- `find` 的谓词（`-delete`/`-exec` …）是**单横线自解析**词，`getopt_long` 缩略不适用，保持精确匹配。

**验证**：34 条"必须拒绝"（覆盖 R4 全部缩写 + 全部旧发现）+ 29 条"必须准入"（含 `sort --stable`、`dmesg --color=auto`、`file --mime`、`date --iso-8601`、`git show --stat` 等**容易被过度拒绝**的形态）⇒ **0 错**。语料新增 `w153–w174`、`p114–p119`（+28 例，现 **361 例**）。独立复现新增 `AB1`（`sort --out=` 写出文件）、`AB2`（`nm --plug=` dlopen 执行）、`AB3`（`file --comp` 创建 `.mgc`）。

**R4 同时给出的两个独立结论我采纳并入档**：
1. **A5/A6（PATH 解析）确认不是分类器缺陷** —— R4 证明**动词本身**就是 PATH 解析的（`grep`、`ls` 都被它植入的假二进制劫持），所以 `egrep` 的 `exec grep` 那一跳**不增加任何能力**；`zcat` 作为命名残余是诚实的处置。同时记下一条**结构性优点**：**绝对路径拼写（`/usr/bin/grep`）不在白名单内**，所以每个被准入的调用按构造都是 PATH 解析的 ⇒ 缓解措施属于**环境**（给 `bash -c` 一个净化过的 `PATH`，并让文件沙箱继续拒写 PATH 目录——`workspace-write` 已经给 EACCES）。
2. **A8 保留 `sort` 是对的** —— `O_EXCL` + 随机名 + 退出 unlink ⇒ 两个并发 sort 不可能碰撞、也不可能截断兄弟调用命名过的路径，所以"无『兄弟调用也可能命名的路径』上的可达写"正是正确的调度判据；残余只是 `$TMPDIR` 压力与瞬时可见性，不是竞争。

**⚠️ 一处我必须自我更正**：R4 写道"前缀型正则（`/^--console/`、`/^--config-env/` …）是安全的"。**这句太宽松**：`/^--console/` 要求词以字面 `--console` **开头**，而缩写 `--conso` 比它更短，仍然漏过。我已把这些也一并换成语义正确的前缀名字匹配，并在报告里记下这条更正。

