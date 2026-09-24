# DEPLOY.md — U-BASHCONC (P1) 落地与回滚

- 单元：**U-BASHCONC**（`bash` 工具的条件式 `isConcurrencySafe`）
- 线：`exec-bashconc`（`.workspace/lag-fix/exec-bashconc/`）
- 日期：2026-09-22；宿主 **pid 2988915**（18:11:49 重启后）
- 交付件（全部在本目录内，**产品树未被本线改动过**）：

| 文件 | 作用 | sha256 |
|---|---|---|
| `apply-BashConc-v1.mjs` | 补丁脚本（dry-run 默认 / `--apply` / `--rollback`） | — |
| `candidate/bashconc-block-v1.js` | 被拼接的声明段（25321 B） | `ddcbf6d35b186019cd3adf8ea3db782c083f0a92c5a29cf7e458d1f9699f2a04` |
| `corpus/classifier-corpus.json` | 361 例分类语料 | — |
| `bin/run-classifier-tests.mjs` | 语料跑测（从**已拼接文件**里抽取段文本，测的就是要上线的字节） | — |
| `bin/integration-dsh-tools.mjs` | 用**真实** `defineTool` + **真实** `executionMode` 字节做的集成验证 | — |
| `bin/measure-batch.mjs` | 会话事件日志 → span/重叠/并发度量 | — |
| `bin/summarize-evidence.mjs` | 全部 `evidence/*.json` 一张总表 | — |
| `bin/verify-patch-mechanics.mjs` | **可复现的**机制排练：`node bin/verify-patch-mechanics.mjs` → 28 项断言 | — |

## 1. 目标文件与指纹

```
target  = /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js
pre-image sha256 = 2ee3eebe0e22ba0bab055edafea0e8907b7ce63b6b8d803d0853a60375a04371   (18687 B, mode 664)
expected patched sha256 = cb73d3b17c6a221f8172e944d4314fdc8b46d5995212048bb97fe27c03d5a45f   (44054 B)
```

`expected patched sha256` 是在一份**与产品文件逐字节相同**的工作区副本上实测得到的（`raw/rehearsal/index.js`，并可经 `node bin/verify-patch-mechanics.mjs` 复现）。落地后请核对它，一致即证明拼接结果与本档验证过的字节完全相同。

另有三组**拒绝闸门**已断言：缺锚点 / 锚点重复 / 前缀碰撞 ⇒ 三者均 `refused` 且目标零写入；以及两条**回滚安全闸门**：篡改 pre-image、落地后目标被改 ⇒ 均 `refused`（见 `evidence/patch-mechanics.json` 的 m18–m27）。
剪贴字节恒等式：`44054 = 18687（原文件） + 25321（声明段） + 46（新增一行 + 换行）`。

## 2. 补丁形状（仅两处插入，无一行被修改或删除）

| # | 锚点（必须**恰好命中 1 次**） | 动作 |
|---|---|---|
| A1 | `function validateBashArgs(args) {` | 在其**之前**插入整个声明段（含 `import { existsSync } from "node:fs";`——ESM 的 import 声明可提升、允许出现在模块顶层任意位置，已 `node --check` 验证） |
| A2 | `\t\tpresentCall: presentBashCall,` | 在其**之前**插入一行 `\t\tisConcurrencySafe: bashConcConcurrencySafe,` |

任一枚不能唯一命中 ⇒ **一个文件都不写**（脚本直接 `refused` 退出 1）。另有一条前缀碰撞闸门：若文件中已出现 `bashConc` / `BASH_CONC` 亦拒绝。

## 3. 命令

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-bashconc

node apply-BashConc-v1.mjs                 # dry-run（默认，零写入）：打印锚点命中数、字节数、patched sha256、node --check 结果
node apply-BashConc-v1.mjs --apply         # 落地：写 pre-image + manifest，原子 rename 覆盖目标
node apply-BashConc-v1.mjs --rollback      # 回滚：校验 pre-image sha256 与 manifest，再原子还原
node apply-BashConc-v1.mjs --json out.json # 任何模式都可另存结果对象
```
- `--apply` 会先写 pre-image（`dsh-tool-bash-index.pre-bashconc-v1.js`）与 manifest（含 pre-image/patched 双 sha256、block sha256、`rollbackCommand`），默认与目标同目录；可用 `--pre-image-dir <dir>` 改到别处。
- **幂等**：已拼接时二次 `--apply` 返回 `already-applied`，不写任何东西。
- `--rollback` 会拒绝两种不安全情形：pre-image 与 manifest sha 不符、或目标自落地后被改过（patched sha 不符）。
- 全部写操作都不在目标目录留临时文件（`node --check` 的 scratch 落在 `/tmp`）。

### 已实测的机制验证 —— **可复现**：`node bin/verify-patch-mechanics.mjs`（**28/28 PASS**）

在逐字节相同的工作区副本上自动跑完全部断言（原始结果 `evidence/patch-mechanics.json`；脚本只**读**产品树，写入全落 `raw/mechanics/`）。**你可以在自己的会话里原样复跑。**
| 项 | 结果 |
|---|---|
| dry-run 零写入 | ✔ 目标 sha 不变，目录无残留 |
| 锚点唯一 | ✔ A1 1 次、A2 1 次 |
| 前缀无碰撞 | ✔ 0 次 |
| `node --check`（ESM） | ✔ `PATCHED_SYNTAX_OK` |
| 幂等 | ✔ 二次 `--apply` → `already-applied` |
| **精确可逆** | ✔ 剥离插入段后与原文件**逐字节相等**（`EXACT_INVERSE = true`） |
| `--rollback` | ✔ 还原后 sha256 = `2ee3eebe…4371`（与原文件一致） |

### v1 → v1.1 修正：我自己的红队找到的一个**真实假准入**（留档）

`env` 原本在白名单里。`env --split-string=<text>` 是一个**以 `-` 开头的词，却会执行 `<text>`**：本机实测（coreutils 9.4）
`env --split-string="touch /tmp/dsh-envtest"` **确实创建了该文件**。⇒ v1 会把这个调用判为并行安全，是**真实的假准入**。

修正（三处，全部落在当前件里）：
1. `env` 从白名单**整体移除**（`printenv` 是安全的读取替代）；
2. `--split-string(=|$)` 加入**通用**拒绝规则 ⇒ 该选项在**任何**命令上都被拒（纵深防御，即使日后有人把 `env` 加回来）；
3. `dmesg` 增补 `-n` / `-E` / `--console-level` / `--console-on` / `--console-off` 拒绝规则——它们改写**内核 console 日志级别**，同属系统状态写（原先只拒了 `-c/-C/-D/--clear`）。

语料新增 `w109–w118`（含 `env`、`env -0`、`env --split-string=…`、`env -S …`、`env -i touch …`、`dmesg -n 1`、`dmesg --console-off`、`dmesg -E`，以及"通用 deny 在 `ls` 上也生效"的 `ls --split-string=…`），并补三条正例（`printenv`、`dmesg --level=err`、`dmesg -T`）。后续每轮红队都把新形态固化成语料，现为 **361 例**，全部通过。

> **教训**：**"以 `-` 开头"不等于"惰性"**。这条是本单元最危险的一类盲区，也是红队 subagent 被要求重点覆盖的方向（见 `report.md §10`）。

### v1.4 → v1.5 修正：第四轮红队抓出 **一整类漏洞 —— 长选项缩略**（留档）

GNU `getopt_long` 接受长选项的**任意无歧义前缀**，所以凡是按**完整拼写**锚定的拒绝都能被绕过。我亲手复现：

| 我拒绝的 | 我放过的 | 我复现到的效果 |
|---|---|---|
| `sort --output=F` | `--out=F`、`--o=F` | **写出 F** |
| `sort --compress-program=P` | `--compress-prog=P`、`--comp=P` | **执行 P** |
| `nm --plugin=X` | `--plug=X`、`--plu=X` | **dlopen → 构造函数执行**（自建 `.so` 实测；`@file` 那轮修复完全没覆盖缩写） |
| `file --compile` | `--comp`、`--compil` | **创建 `<magic>.mgc`** |
| `sort --temporary-directory=D` | `--temp=D` | 1102 个临时文件落到**被指定目录** |
| `date --set` / `dmesg --clear` / `ss --kill` | `--se=`、`--cle`、`--kil` | 被接受（仅接受性探针，未执行） |

**结构性修复（v1.5，不是又一个补丁）**：删除全部 `(=|$)` 锚定的长选项正则，改成**逐动词的"被拒名字"表** + 判定「提交的名字是某被拒名字的**前缀**」——这正是 `getopt_long` 的语义，也正好是**不会过度拒绝**的方向。**通用**拒绝表刻意降级为**只做精确名匹配**：若通用表也允许缩略，`--p...` 会变成对所有动词的拒绝。`git` 私有正则表同样改成名字表（否则 `git log --outp=` 仍会漏）。`find` 的谓词是单横线自解析词，缩略不适用，保持精确匹配。

**⚠️ 更正红队一句话**：R4 写道"前缀型正则（`/^--console/`、`/^--config-env/`）是安全的"——**这句太宽松**：`/^--console/` 要求词以字面 `--console` 开头，而缩写 `--conso` 更短、仍然漏过。这些也一并用前缀名字匹配替换了。

### v1.3 → v1.4 修正：第三轮红队抓出 **2 个机制 / 5 个被准入写法**（留档）

| # | 例子 | 我复现到的事实 | 修复 |
|---|---|---|---|
| **N1** | `ss -D FILE`、`ss --diag=FILE`（含粘连 `-DFILE`、簇内 `-aD`） | `ss --help`: `-D, --diag=FILE  Dump raw information about TCP sockets to FILE`。实跑：**创建 11524 B 文件**，并把既有文件**覆盖**。我的 `ss` 表只写了 `K`/`--kill` | `ss` 写入字母补 `D`，长选项补 `/^--diag(=|$)/` |
| **N2** | `nm @opts.txt /bin/ls`（文件内是 `--plugin evil.so`） | binutils 的 `@FILE` 是**响应文件**；`--plugin` 是按词拒绝的 ⇒ 藏进文件即绕开。实测 **dlopen 构造函数真的执行** | 新增 `BASH_CONC_COMMAND_REJECT_RESPONSE_FILE = {nm, objdump, readelf, strings}`，**整类拒绝 `@` 词**（集合来自对全部 81 个准入动词的 `--help` 扫描，完整结果恰好这 4 个） |

**同轮还做了"输出路径"类的穷尽扫描**（81 个动词的 `--help` 扫 `=FILE`/`<file>`/`to FILE`/写入）：完整结果是 `sort -o/--output`（已拒）、`xxd -r -s`（偏移量非路径）、摘要工具 `--ignore-missing`（读）、`pgrep -F`/`ss -F`（从文件读）、**`ss -D/--diag`（在写 ⇒ 已修）**。
⚠️ **扫描的局限已写进块内注释**：`--help` 只管**有文档**的选项，而 `nm` 的 help 根本没写 `@FILE` 却实际认它 ⇒ 所以响应文件规则是**行为式**拒绝，不是"去文件里找危险选项"。

### v1.2 → v1.3 修正：第二轮红队抓出 **6 个仍存活形态**，其中 3 个是**我第一轮修复自身的绕过**（留档）

| # | 例子 | 我复现到的事实 | 修复 |
|---|---|---|---|
| **H1/H2/H3** | `uniq - out.txt`、`xxd - out.txt`、`printf … \| uniq - out.txt` | 文件**真的被写出**。根因：v1.2 的操作数计数用 `startsWith("-")` 过滤，把 stdin 操作数 `-` 误当选项 ⇒ 只数到 1 就放行 | `-` 与 `--` **计入操作数**；并**跳过短选项的独立参数**（顺带修掉 5 条我上一轮引入的假拒绝：`xxd -l 64 f`、`uniq -f 2 f`、`date -Iseconds` …） |
| H4/H5 | `egrep` / `fgrep` | `/usr/bin/*` 是 exec PATH 解析 `grep` 的壳脚本 | **移出白名单**（deprecated 别名，`grep -E`/`grep -F` 同二进制，零损失） |
| H6 | `zcat` | 同上（`exec gzip -cd`） | **保留为命名例外**（白名单无等价的非脚本程序）；块内注释明确写出 |

新增 `bashConcClusterHasShortOption(word, letters, argTaking)`：短选项簇扫描遇到**吃参数的字母**即停止（这就是 `date -Iseconds` 不被误判为含 `-s` 的原因）。语料 +29 例。

### v1.1 → v1.2 修正：外派红队抓出的 **8 个已实证假准入 + 4 个拒绝表拼写绕过**（留档）

红队对 v1.1（`10509d13…`）出具 **BYPASS FOUND (8)**，我逐条独立复现后全部采信并修复：

| 类 | 例子 | 修复 |
|---|---|---|
| **位置参数即输出文件** | `uniq -c a b`（**覆盖 b**）、`xxd a b`（**创建 b**） | `BASH_CONC_COMMAND_OPERAND_CAP`：这两个动词**操作数上限 1** |
| **短选项粘连** | `file -bC`（编译 `.mgc`）、`dmesg -xc`/`--read-clear`、`date -us`、`ss -aK` | 短选项正则扫**整簇**（`/^-[^-]*C/` 等），原实现只匹配第一位 |
| **加载外部程序** | `nm --plugin evil.so`（`dlopen` 任意代码）、`git help log`（PATH 解析的 man 链 + 写 `/var/cache/man`） | `--plugin` 进通用拒绝表；`git help` 移出 git 纯读集合 |
| **PATH 解析的壳脚本** | `egrep`/`fgrep`/`zcat` 本身是脚本 | **不修**，记为残余风险（`grep`/`gzip`/`ls`… 同样受 PATH 影响 ⇒ 是环境属性，非删别名可解） |

顺带修掉红队列出的 4 条**假拒绝**：`find -executable`、`df --output=`、`lsblk --output=`、`findmnt --output=`（`--output` 下沉为只对 `sort`/`git` 生效）。
另：`sort` 的临时文件（`-S` 大输入时 141 个）**保留**，并把块内判据改写为"无『兄弟调用也可能命名的路径』上的可达写"；额外拒绝 `-T`/`--temporary-directory`。

### 排练中真实抓到的缺陷（留档，不再复现）
`built.spliced = original.replace(ANCHOR, 插入文本)` 中，`String.replace` 把插入文本里的 `$` 序列当成 `$&` / `` $` `` / `$'` 替换模式，**静默地把原文件复制了一份**（得到 37993 B，而 v1 的正确值是 32662 B），`node --check` 因此报 `Identifier 'processOutcome' has already been declared`。已改为**函数式 replacement**（`replace(anchor, () => text)`），并在脚本源码里留下注释说明原因。若没有这一步排练，这个缺陷会以"看起来成功落地"的形态上线。

## 4. 落地面判定：**冷面（需重启），不是热面**

**结论：只改 `dsh-tool-bash/lib/index.js` 之后刷新页面，不会生效。必须重启宿主。**

本线**无法**做"改文件后刷新是否生效"的直接实测（不能写产品树），因此这里给的是**四条互相独立的结构性证据**，每一条都单独足以判定"冷"，并且它们彼此印证：

1. **watcher 看不到目标文件。** `dsh-base/cordis.patch.yml:19-22` 的 hmr 行只写了 `config: { root: ['.'] }`，**没有覆盖 `ignored`** ⇒ 采用默认值 `ignored: ["**/node_modules", "**/.*", "cache", "data"]`（`cordis-plugin-hmr/lib/index.js:437-441`）。目标路径含 `.../node_modules/@deepseek-ai/...` 段，chokidar 在遍历时对目录名求 `ignored`，命中 `**/node_modules` 即**整棵剪枝** ⇒ 该文件的 change 事件**根本不会产生**。`onChange`（`:203-222`）因此永远不会执行到 stash / partialReload 分支。
2. **设计上就把 node_modules 排除在热刷新范围外。** `cordis-plugin-hmr/lib/index.js:47-53` `loadDependencies` 对 `job.url.includes("/node_modules/")` 直接 `return`；依赖集合只收非 node_modules 的模块。
3. **重挂判定只看组合 YAML 的 mtime/size。** `dsh-agent-presets/lib/index.js:1161-1170` `compositionStamp(path)` 只 `stat` **组合文件本身**并返回 `{mtimeMs,size}`；`:1135` `sameStamp(mounted.stamp, current)` 为真即**复用已有 mount**。改插件 JS 不改组合 YAML ⇒ stamp 不变 ⇒ 不重挂。
4. **ESM registry 无 cache-busting。** `dsh-agent-presets/lib/index.js:495-505` `EntryTree.import` 最终 `internal.import(specifier, base, {})`，specifier 是裸包名（→ 解析到具体文件 URL），**不带 `?v=` 之类查询串** ⇒ 一旦求值过，进程内同一个 URL 不会再求值。宿主侧组合行（`dsh-base/cordis.patch.yml:210-211` `tool-bash`）同样在启动期就已完成 import。

⇒ **本单元按冷面交付。** 这也意味着：**patched 相位的 span/重叠实测必须在一次重启之后**。

### 把"结构性判定"升级为"实测判定"的唯一动作（重启后一条命令即可）
重启后执行：
```bash
grep -c "DSH-BASHCONC-v1 BEGIN" /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js   # 期望 1
```
再按 §6 跑 A1/A2 两批（同窗 A/B）。若 A1 出现重叠而 A2 不出现，即证明"文件里的补丁**确实被宿主加载了**"，冷面判定与落地成功同时得到实测确认。
**反面判据**：若重启前 apply、且不重启就测到 A1 出现重叠，那才说明是热面——本线不预期出现这种结果。

## 5. 开关（回滚到"全部 exclusive"的旧行为）

四层，**每次 bash 调用都重新解析**（无需 reload）：

| 优先级 | 层 | 取值 |
|---|---|---|
| 1 | `globalThis.__DSH_BASH_CONCURRENCY_SAFE__` | `true` / `false` |
| 2 | 环境变量 `DSH_BASH_CONCURRENCY_SAFE` | `1/true/on/yes` → true；**其余任何值（含空串、垃圾值）→ false（fail-closed）** |
| 3 | **哨兵文件**，路径来自 `DSH_BASH_CONCURRENCY_SAFE_OFF_FILE`，**默认 `/tmp/dsh-bashconc-off`** | **文件存在 ⇒ false（全部 exclusive）** |
| 4 | 常量 `BASH_CONC_ENABLED_DEFAULT`（`= true`） | 兜底 |

另有独立子开关 `BASH_CONC_GIT_INDEX_REFRESHING_DEFAULT`（`= false`），可经 `globalThis.__DSH_BASH_CONCURRENCY_SAFE_GIT_STATUS__` / `DSH_BASH_CONCURRENCY_SAFE_GIT_STATUS=1` 打开，见 §7。

### ⚠️ 关于第 3 层（哨兵文件）的取舍，落地前请裁决
- **要它的理由**：`/tmp` 在本会话可写，而产品树不可写。哨兵让我能在**同一负载窗内、无需重启、无需改文件**地做两个方向的 A/B（`删哨兵→并行` / `建哨兵→串行`），这正是"实测两个方向都生效"唯一可行的做法；同时它是一条**只按一个文件就能拉的紧急刹车**（off 方向 fail-safe）。
- **代价**：产品代码里出现一个硬编码的 `/tmp` 路径不优雅；且本机任何用户建同名文件即可关掉这个优化（是"可用性降级"，不是提权；方向是回退到旧行为）。`/tmp` 重启即清空，风险窗口有界。
- **建议**：正式落地前把第 3 层换成 **settings 段 / 插件 config 行**（该行是冷面但不是硬编码路径），或直接删掉第 3 层（此时两个方向仍有 globalThis 与 env 两层，只是翻转需要重启/宿主插件）。
- **验收后必须做的事**：确认 `/tmp/dsh-bashconc-off` **不存在**（测完我会删；本档写就时它不存在）。生产环境若保留第 3 层，请在 runbook 里加一条"该文件必须缺席"的巡检。

## 6. 重启后的验证清单（patched 相位）—— **已于 2026-09-23 全部执行完毕，结果见 `report.md §11`**

> 执行结果速览（宿主 2649213，loadavg 2.7–2.9，`/tmp/dsh-bashconc-off` 起始缺席、测后确认缺席）：
>
> | 项 | 结果 |
> |---|---|
> | 落地核验 | 部署文件 sha `cb73d3b1…` = 期望值；机制脚本 **34/34**，其中 d03 = "部署文件 = pre-image + 两处插入，逐字节相等" |
> | A1 正向（6×只读） | span 31985→**1395 ms**、峰值并发 1→**6**、重叠 0/15→**15/15**、起点互差 **1 ms** |
> | A2 同窗对照（哨兵 ON） | **6515 ms**、峰值 1、**0/15** ⇒ 同窗加速 **4.67×** |
> | A3 / A3'（50 MB grep） | 450 ms / 649 ms ⇒ 1.44×；`span/max(单次)=1.002` 满足 ≤1.5× 判据 |
> | A6 子进程启动跨度 | **10.284 s → 0.319 s** |
> | A4/A5/A8 负向 | 全部 `span/Σ≈1.00`、峰值 **1**、**0/15**（写命令、重定向、危险形状**仍 exclusive**） |
> | A7 正确性 | 三组同窗串行 vs 并行 **逐字节相同** |
> | 开关双向 | 建/删哨兵即翻转两向，**活体实测** |
>
> 下方的原始清单保留作为方法与口径记录。



前置：`grep` 确认标记存在（§4）；确认 `/tmp/dsh-bashconc-off` 不存在。

| # | 批次 | 夹具（**必须是同一条助手消息内的 6 个 bash 调用**） | 期望 |
|---|---|---|---|
| A1 | 正向（同窗） | 6 × `sleep 1`，description 带唯一标记 | span 显著下降、峰值并发 6、重叠对数 15/15 |
| A2 | **负向·同窗反证** | **先 `touch /tmp/dsh-bashconc-off`**，再 6 × `sleep 1`（同一载荷、同一窗口） | **仍串行、峰值并发 1、0/15 重叠** ⇒ 证明"开关 off 方向生效"且 A1 的收益来自补丁而非负载 |
| A3 | 正向（审计验收项1） | 6 × `grep -c <pat> probe/big50mb.txt` | span ≤ 1.5 × 单次 span；有重叠 |
| A3' | 负向·同窗反证 | 哨兵存在，6 × `grep -c …`（同载荷） | 串行、0/15 |
| A4 | **负向对照（写命令）** | 6 × `touch <工作区临时文件>`（真实落盘） | **必须仍 exclusive：串行、峰值并发 1、0/15**；且顺序与串行语义一致 |
| A5 | 形状负向 | 6 × `echo x >> <工作区临时文件>` | 同上 |
| A6 | 子进程启动跨度 | 6 × `date '+%s.%N'` | 跨度从 10.28 s 压到 ms 量级 |
| A7 | **正确性** | 同一组确定性只读命令，先串行（哨兵开）跑一遍、再并行（哨兵关）跑一遍 | 两次输出**逐字节相同** |
| A8 | 安全拒绝（活体，全部**载荷无害**） | 6 × 危险**形状** + 无害**目标**：
    ① `uniq -c <corpus> /dev/null`
    ② `xxd <block> /dev/null`
    ③ `file -bC -m probe/livemagic`（会在工作区生成 `probe/livemagic.mgc`，无害且**正好证明 `-bC` 粘连确实会写**）
    ④ `printf x > /dev/null`
    ⑤ `echo x >> /dev/null`
    ⑥ `find probe -maxdepth 1 -name 'NOPE*' -delete`（删不到任何东西）
| **必须 exclusive：0/15 重叠、峰值并发 1**。真正的危险变体（`dmesg -xc`/`--read-clear`、`date -us`、`ss -aK`、`git help log`、`sort -T`）**一律不执行**，只做分类断言（语料 `w119–w134` 已覆盖） |
| A9 | 收尾 | 删除 `/tmp/dsh-bashconc-off`、`probe/big50mb.txt`、临时文件 | 复原 |

度量一律用 `bin/measure-batch.mjs`（会话事件日志的宿主侧时间戳），不用载荷副作用：
```bash
F=/home/CNS2026495165/.dsh/sessions/--home-CNS2026495165-dsh--/<session-id>/session.jsonl.zstd
zstd -dc $F > raw/my-session.jsonl     # （交付时 raw/my-session.jsonl.gz 已压缩留档；解压即用）
node bin/measure-batch.mjs --session raw/my-session.jsonl --name bash \
  --marker "唯一标记" --command-regex '^sleep 1$' --note "..." --loadavg "$(cat /proc/loadavg)" \
  --json evidence/A1-....json
node bin/summarize-evidence.mjs
```
> 坑：`--marker` 是子串匹配，**分析命令自身会命中**。写分析命令时把标记拆开（如 `--marker "A1 ""PATCHED"`）或配 `--command-regex`。已实测踩过两次。

## 7. 准入边界（明确写死的不准入项）与残余风险

**明确不准入（默认）**
- **全部写动词**：`rm mv cp ln touch mkdir rmdir truncate install dd tee sed awk xargs split csplit tar gzip zip unzip iconv ar chmod chown chattr setfacl patch` …，以及 `sudo su doas`、`kill pkill killall`、`nohup timeout watch nice setsid`、`curl wget ssh scp rsync`、`bash sh zsh eval exec source .`、`node python3 perl ruby php`、`crontab mount umount systemctl`。
- **全部 shell 复合结构**：`;` `&&` `||` `&` `|&` `|` 之外的重定向 `< > >>`、`$(...)`、反引号、`${}`、`(...)`、`{...}`、未加引号的 `\` 与 `#`、换行、括号、未闭合引号。管线**只有**每个段都独立准入时才准入。
- **`env`**（整类）：`env --split-string=<text>` 会执行 `<text>`（已实测复现）⇒ 动词级拒绝，非选项级。
- **`git status` / `git diff`**：**实测**会重写 `.git/index`（前后 mtime 比对）⇒ 默认不准入，由 `BASH_CONC_GIT_INDEX_REFRESHING` 子开关控制。⚠️ 同一实测表明 `git log`/`grep`/`ls-files`/`rev-parse`/`cat-file`/`show-ref`/`for-each-ref` **不动索引**，故它们**已准入**；且**锁冲突未能复现**（12 路并发 `git status` → 0 条 index.lock 错误），所以这条默认挡的是「已实测的写」，不是「已证实的失败」。详见 `report.md §7 偏差 1`。
- **`git` 全局选项**：子命令必须是 `git` 后的第一个词；`git -C x status`、`git -c core.pager=rm log`、`git --exec-path=…` 一律不准入。`git log/show/diff --output=…` 被通用 `--output` 拒绝规则拦下。
- **`env`**：⚠️ 见上方 v1→v1.1 修正——`env --split-string=` 会执行其载荷，`env` 已整体移除。
- **`node -e`**：⚠️ **审计 §6 P1 的缓解文本把 `node -e` 列为只读是错的**（`node -e 'require("fs").writeFileSync(...)'` 直接写盘）。本实现在白名单中**不含** `node/python/perl/ruby/awk/sed/xargs/tee`，语料 `w31` 固化了这条更正。
- **选项级写陷阱**（即便动词在册，且**短选项按整簇扫**）：`sort -o/--output/--compress-program/-T/--temporary-directory`、`date -s/--set`、`file -C/--compile`、`dmesg -c/-C/-D/-E/-n/--clear/--read-clear/--console-*`、**`ss -K/--kill`、`ss -D/--diag`**、`find -delete/-exec/-execdir/-ok/-okdir/-fprint*/-fls`、以及**所有命令**上的 `--compress-program= --pre= --pre-glob= --hostname-bin= --exec= --split-string= --plugin=`；git 另有 `-c/--config-env/--exec-path/--ext-diff/--paginate/--output`。
- **长选项缩略**：GNU `getopt_long` 接受任意无歧义前缀 ⇒ 按名字前缀匹配拒绝（见上）。
- **响应文件 `@FILE`**：`nm`/`objdump`/`readelf`/`strings` 会**从文件里读选项**，因此**整类拒绝 `@` 开头的词**——拒绝清单看不见被引用文件的内容，`nm @opts.txt`（内含 `--plugin evil.so`）就绕过了按词拒绝的 `--plugin`（已实测 dlopen 执行）。

**残余风险（如实列出，不隐藏）**
1. **PATH 解析（两轮红队各实证一次，无法由分类器消除）**：白名单准入的是**动词名**，实际执行的是 `$PATH` 里第一个同名程序。**处置已收紧**：`egrep`/`fgrep` 移出白名单（`grep -E`/`grep -F` 同二进制）；`zcat` 保留为**命名例外**（`exec gzip -cd` 的壳脚本，白名单里没有等价的非脚本程序）。**这条对 `grep`/`gzip`/`ls`/`date` 等每一个准入动词同样成立** ⇒ 是**环境属性**，不是删几个别名能关掉的通道。前提是一个**可写且排在 `/usr/bin` 之前**的 PATH 目录：本机 `$PATH` 里确有这类目录（`~/.local/bin`、`~/.npm-global/bin`），但 `workspace-write` 下不可写（红队实测被拒）；`danger-full-access` 会话或写权限根覆盖这些目录时风险成立。**若你要求这条必须堵住，唯一办法是本单元不上线**——请裁决。
2. **`sort` 的临时文件**：大输入会创建唯一随机名临时文件（`O_EXCL` 0600，退出 unlink，0 残留）。保留并改写了判据（见上），另拒 `-T`/`--temporary-directory`。
3. **`git help` 的 man 缓存写** 与 **`git` 的 textconv/pager 配置驱动外部程序**：前者已通过移除 `git help` 关闭；后者仍是配置驱动的残余（需先有写权限改 `.git/config`）。
4. **`sleep` 在册**：它的唯一效果是消耗自身进程的时间（无文件/进程/网络副作用）。这是经过权衡的决定——它让"同窗 span 对照"可以在不写盘的前提下成立。若你希望白名单严格限定为"观测型动词"，删掉 `sleep` 一行即可（不影响任何验收项；A1 可改用 A3 的 `grep` 载荷）。
5. **git 纯读子命令**（`log/show/rev-parse/cat-file/…`）已准入，但它们**可能经由配置执行外部程序**：`core.pager`（非 tty 一般不触发）、`diff.<driver>.textconv`（二进制 blob 的 `git show` 默认会用）。这些外部程序按契约是只读的，且并发只读不构成写竞争；但这是**本补丁未消除的既存属性**（今天它们也是串行跑的，风险类别相同）。
6. **只读命令并发抢锁的行为差异**：两个并发只读命令若都触发某个内部锁（如未来某工具写缓存），其中一个可能拿到非零退出并被渲染成 `[exit code: N]`（本产品**不把它当 `isError`**，见 `dsh-tool-bash:16-17,20-30`）。本实现已通过"排除会 refresh 索引的 git 子命令"消掉了已知的一例，但不能证明穷尽。
7. **越界范围声明**：本补丁**只**声明 `bash` 的并发安全；`write`/`edit`/`grep`/`glob` 仍为 0 声明（保持 exclusive），不在本单元范围内。
8. **`run_in_background` 走同一套命令判定**（背景调用不被无条件放行）。这是刻意的 fail-closed 选择。

## 8. 回滚

```bash
node apply-BashConc-v1.mjs --rollback        # 校验 pre-image sha 与 manifest 后原子还原
sha256sum <target>                            # 期望 2ee3eebe0e22ba0bab055edafea0e8907b7ce63b6b8d803d0853a60375a04371
```
回滚需要**一次重启**才在运行中的宿主里生效（同 §4 冷面判定）。
**比回滚更快的一键关闭**：`touch /tmp/dsh-bashconc-off` —— 下一次 bash 调用起即恢复"全部 exclusive"，无需改文件、无需重启（第 3 层开关）。**测完/上线后请确保该文件不存在。**

## 9. 清理责任

本线产生的所有临时物：
- `probe/`（A3 的 50 MB 载荷 + 负向对照临时文件）——**本档已在交付前清除**（`rm -rf probe`，避免留下 50 MB）。A1–A9 需要时用这一条重建（A9 再删一次）：
  ```bash
  mkdir -p probe && yes 'the quick brown fox jumps over the lazy dog 0123456789 ABCDEFGHIJKLMNOP' | head -c 50000000 > probe/big50mb.txt && wc -c probe/big50mb.txt   # 期望 50000000
  ```
- `/tmp/dsh-bashconc-off`——**必须缺席**
- 本线**未**新增任何 `/tmp/dsh-subprocess-*` 之外的 spill 负担（已知宿主 spill 从不清理，本线未加大该负担；产品的 spill 目录不在本单元范围内）。
