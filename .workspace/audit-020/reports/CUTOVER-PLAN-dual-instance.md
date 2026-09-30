# 切换预案：双实例并存（选项 (c)）

> **0.1.1（现役 3080）继续作为历史会话读取入口，0.2.0（新端口 3098）承载新会话**
>
> - 文档性质：**这条路径的正式预案**（协调者插播：**用户已裁决选 (c)**）。本档仍是**预案**，不是执行记录；**不得**被当作「已授权切换」（见 §7）。
> - 裁决状态：**选项 (c) 已由用户裁决**——双实例并存、**零数据改写**。本档据此定稿；待裁决项单列于 **§0.5**。
> - 目标制品：`@deepseek-ai/dsh@0.2.0-rc.1`（npm `next`；**不存在稳定 0.2.0**）。
> - 现役（**全程不动**）：`3080` = DSH `0.1.1-rc.2`；隔离旧目标：`3097` = `0.1.7-rc.2`。
> - 编写轮次：2026-09-29。本档所有数字与哈希均为**当轮实测**，活值（端口/会话计数/settings 哈希）必须在使用时重取。
> - 本档不含任何会话正文、密钥、原始会话 id；涉及 token 的日志一律以 `<REDACTED>` 形式引用。
> - 行尾 `\` 续行**后面不得有空格**；所有命令块可直接复制。

---

## 0. 文档定位与授权边界

### 0.1 本档做什么、不做什么

| 项 | 本档 |
|---|---|
| 写出「双实例并存」的完整形态设计、前置闸门、数据面方案、切换步骤、回滚、验收、禁止项、代价 | ✅ 已完成 |
| 承载用户裁决 (c) 的正式预案 | ✅ 本档（裁决已下，见 §0.5） |
| 实际执行切换 / 启动或停止任何服务 / 改动任何配置 | ❌ **不做**（本档全程只读，除在 `.workspace/**` 内落盘本文件） |
| 触碰 `~/.dsh/**`、`~/.dsh-017/**` | ❌ 未写入、未停止、未重启（仅只读探测） |
| 作为「已授权切换」被引用 | ❌ **禁止**（见 §7） |

### 0.2 为什么是这个形态（**立论实证**，不再是推断）

**决定性新证据（协调者实测）——同一份真实会话文件上的双向对照**：

| 侧 | 同一份真实文件（**22.8 MB / 82 430 行**会话日志）上的结果 |
|---|---|
| **0.1.1** | ✅ **完全可读**：`decodeStorageRecord` **零错误**展开 **65 145 个打包行 → 1 364 372 个事件**（`reasoning-chunks` **53 042** / `tool-call-chunks` **7 593** / `text-chunks` **4 510**），另 **17 285** 行普通事件 |
| **0.2.0** | ❌ 抽样 200 份**仅 3% 通过**；修 `subagent/descriptor` 的 `2→3` 后 **60%**；余 **40%** 卡在这三种打包行 |

⇒ **这就是 (c) 的立论实证**：让 0.1.1 继续读历史**不是「保守选择」，而是唯一能让历史 100% 可读的路径**。
⇒ 本档此前只能写「0.1.1 结构上必然能读本代 v0 会话」——**现在是实测结论**：同一文件在 0.1.1 侧零错误展开、在 0.2.0 侧落在 40% 拒绝集内。

**0.2.0 侧为什么不行（机制，不变）**：`text-chunks` / `reasoning-chunks` / `tool-call-chunks` 既不在 0.2.0 v0 迁移的 **51 项**封闭清单（`RELEASED_V0_EVENT_TYPES`）内，也无法用正规化映射；根因是 **packing 实现从 `dsh-session` 顶层行迁移到 `dsh-llm` 的 `event.data.stream`，且旧位置解码器被移除**（`dsh-session-persistence-jsonl` 从 `decodeStorageRecord(JSON.parse(line))` 改为裸 `JSON.parse(line)`）。

关于 3097 的同构性（决定「改锚是否有用」）：**0.1.7 会撞上完全相同的墙，比例也一样** —— `descriptor` 由 2 变 3 发生在 **0.1.7**，而硬闸 `data.version !== 3` 自 0.1.3-alpha.2 起各版本都带。⇒ 把目标从 0.1.7 改锚到 0.2.0 **既没引入也没缓解**这条风险。

### 0.3 选项对照（评估报告 N17 裁定表的复述）

| 方案 | 实际效果 | 是否改写数据 |
|---|---|---|
| (a) 接受不可读 | 仅 **3%** 会话可用 | 否 |
| (b) `descriptor` `2→3` 离线正规化 | 升到 **60%**，**仍 40% 打不开** | **是**（产品级改写） |
| (b1) 再加 chunk 类型映射器 | 可再解约 27%，前提是确认语义等价 | **是** |
| **(c) 保留 0.1.1 作为历史读取入口** | ✅ **唯一无需改数据即可 100% 保住历史** —— **✅ 用户已裁决选此项** | **否** |
| (b2) 向官方提 issue 补 3 个类型进 `RELEASED_V0_EVENT_TYPES` | 正确的**长期**修复；周期不可控 | 否 |

**本档 = (c) 的执行形态（已裁决）；同时建议并行推进 (b2)**——它是**真正的缺陷修复**（0.1.1 合法写入的事件类型未被 v0 迁移清单登记），也是让**未来任意版本**都读得懂历史的唯一根治路径；提 issue 属对外动作，**是否提交仍待用户裁决**（见 §0.5）。

### 0.4 关于 `3097`（`0.1.7-rc.2`）的定位建议

**建议：留作「有期限的过渡对照」，明确定义为不承载任何数据面；到期废弃。**

理由（每条都有对应证据）：

1. **它不能当历史读取入口**：0.1.7 与 0.2.0 在会话格式层实现逐字节相同，读 0.1.1 会话得到**同一个** `SessionFormatUnsupportedMigrationError`（descriptor v2）。它救不了历史，只有 0.1.1 能。
2. **它有唯一不可替代的对照价值**：本机**只有** `~/.dsh-017` 存在真实跑通的 v3→v4 写打开迁移产物（8 个 v4 代，其中 2 个会话目录同时含 v3 与 v4 两代，源代 mtime 09-12 < 继任代 09-28，`session.lock` 恰 8 个）。这是「源代字节不变 + 继任代已发布」这条 V12 式断言的**现成阳性对照**，0.2.0 侧尚无等价实测产物。
3. **它也是 patch/settings 迁移的参照树**：`~/.dsh-017/profiles/web/cordis.patch.yml` 已是「新条目 id」版本（如 `agent-preset-registry`），可用于比对现役旧 id 的差异面。
4. **但它同时是持续的假阳性来源**：`~/.dsh-017` **没有 `settings.yaml`**（只有 0 字节 `settings.yaml.imported`），且其 patch 引用的 `dsh-vision-adam` 在现役 `@local` 中已不存在 ⇒ **任何「两个 home 同构」的脚本假设都会在它身上出错**。
5. **成本**：每多一个常驻实例就多一套进程/端口/日志/根目录的运维面。本档已把 0.2.0 侧的运维面翻倍（见 §8），不宜再长期背第三套。

**建议期限**：至 **(b2) 上游修复发布** 或 **切换日 + 14 天**（先到者），之后按 T19 场景 R7 的「摘除但不删除」纪律处理（`mv` 留证，不 `rm`）。

**对 3097 的纪律**：只读观测；**禁止**把它的 `sessions/` 复制进现役根或新根（它是第三个写入方，复制即制造第四条数据血缘）。

### 0.5 裁决状态：已裁决 / 待裁决（**执行档必须逐条对齐**）

| 项 | 状态 | 内容与影响 |
|---|---|---|
| **切换路径** | ✅ **已裁决：(c) 双实例并存、零数据改写** | 本档即为该路径的正式预案；**执行仍需用户对「执行切换」单独授权**（§7-11） |
| **历史数据面** | ✅ 已定纪律 | 现役 `~/.dsh/sessions` + `~/.dsh/attachments` **原地不动**（§3.1）；**0.2.0 新根不得承载历史语料**（§3.2） |
| **`remoteHosts` 回归**（侧栏「分布式节点」树） | ⏳ **待用户裁决是否找回** | 实测：官方 `dsh-client-ui-workspace` 槽位契约在 **0.1.1 有 2 hits / 0.2.0 有 0 hits**（`lib/types/client/contract/slots.d.ts`、`lib/client.js`）；现役本地插件 `@local/dsh-ssh-gui` 另有 2 处引用（`lib/client.js`、`README.md`）。⇒ 该树在 0.2.0 侧**静默消失**，且**不会**在启动日志上报错（属 E1/E2 型静默失效） |
| **插件侧改造** | ⏳ 待办（阻塞级） | settings 断层阻塞 **3 个**插件：`dsh-subagent-model`、`dsh-session-board`、`dsh-vision-adam`（启动实测 2 条未激活） |
| **办公入口 Route A** | ⏳ **待裁决：A/B/C/D 四选一** | Route A 在 0.2.0 上失效；具体选项与证据见 `reports/T15-office-feature-020.md` 与 N11 |
| **(b2) 上游 issue** | ⏳ 待用户裁决是否提交 | 请求把 `text-chunks` / `reasoning-chunks` / `tool-call-chunks` 补进 `RELEASED_V0_EVENT_TYPES`（协议层遗漏，官方修补成本低） |
| **N10 丢岛** | ✅ 已裁定（不得重开） | 采纳方案 B：丢弃钉死 `0.1.1-rc.2` 的私有依赖岛（RUNBOOK 附三.1） |

> **待裁决项不阻塞切换本身**（它们是新实例的**功能面**缺口，不是数据安全缺口），但**必须逐条告知用户**（V21），且**不得**被当作已闭。

### 0.6 本形态的冷启动验收：**已由协调者轨道独立执行**（本档引用，非本档执行）

协调者轨道已在**空历史根**上完成一次 (c) 形态冷启动验收（记录：`reports/OPTION-C-VERIFICATION.md`）。**结果与本档 §2/C5/C6 的预期值逐项一致**：

| 判据 | 实测结果 | 对应本档预期 |
|---|---|---|
| peer-gate 静默禁用 | **0** | G6/C5（无豁免时为 6）✅ |
| URL 发放 | `http://127.0.0.1:3098` | C5/C6 ✅ |
| 未激活条目 | **2**（`dsh-vision-adam`、`dsh-session-board`） | C5/C6 = N1 两项 ✅ |
| 会话目录 | **未建 `sessions/`** —— **首条新会话时才惰性创建** | G9/V20（因此断言须写「为空**或不存在**」）✅ |
| 停栈 | 端口 **FREE** | C5 收尾 / V6 ✅ |
| 现役未污染 | patch `513413e7…` / settings 与开工逐位一致；**3080/3097 在线** | G3 / C6 / P1–P3 ✅ |

**同期已修复的四项缺陷（协调者实测确认，本档 G11/V16 据此更新）**：

| # | 缺陷 | 修复 |
|---|---|---|
| 1 | **`zod` 软链跨版本泄漏**（原指向 **0.1.1 前缀 4.6.2**，而 0.2.0 自带 **4.6.5**） | 改指向 `prefix-cli` 内的 **4.6.5**（**本档 §4-C2 已按此写死**） |
| 2 | **新根缺 `.agent-presets/`** ⇒ `default: standard-glm` 静默回落 | 已从现役迁入 `standard-glm`（2 文件） |
| 3 | **preset 内 `persona.config.text` 非法**（`dsh-persona` schema 只认 `prefix`/`suffix`/`complete`/`includeRuntimeContext`）⇒ **激活失败** | 改为 `prefix:`（备份在 `preset-fix-backup/`） |
| 4 | **preset 引用已停发的包**（`dsh-workflow-worker-thread` 在 0.2.0 闭包内不存在） | 移除该行，能力由官方 bundle 自带 `workflow-ptc` 提供 |

**修复后复核**：`--dump-config` **rc=0 / 199 条目**；preset 内非法键计数 **`text:0 / prefix:1`**；YAML 经 DSH 自身（支持 `!!js`）解析通过。
⇒ 即 **N3 的四层里前三层已在配置层修好**；**仍未验证的是运行时激活**（V16 仍是唯一判据）。

> **本档的引用边界**：以上来自协调者轨道记录，**本档未独立复跑**；且**本次冷启动不等价于正式切换**（根/端口/凭据面在正式切换时需按 §4 重做一遍）。

---

## 1. 形态说明：双实例并存

### 1.1 两个实例的职责与数据面

| | **实例 A（历史档案室）** | **实例 B（新工作台）** |
|---|---|---|
| 版本 | DSH `0.1.1-rc.2` | DSH `0.2.0-rc.1` |
| 端口 | **3080**（现状，不动） | **3098**（候选实测空闲） |
| 根 | `~/.dsh`（现状，不动） | `<CUT>/root020/home`（**新根，工作区内**） |
| CLI 前缀 | `~/.npm-global`（不动） | 复用 `assembly-020/prefix-cli`（**只读**） |
| 会话数据面 | **历史语料（唯一权威副本，原地不动）** | **新会话（v4）** |
| 语料规模（**活值，必须重取**） | **2 466 日志 / 21 工作区 / 991 附件（205 MB）** | 初始 **0**（新写） |
| 写入面 | **仍在活跃写入**（实测日志数在会话期间由 **2 460 增至 2 466**）⇒ **不要对现役会话目录做任何快照性假设**；纪律上停止开新会话 | 全部新写入 |
| 读取面 | 历史：**100%**（本代原生，§0.2 实测） | 历史：**不承载**（新根无历史语料，见 §3.2） |

**数据面的划分原则：一个会话的权威副本只存在于一侧。**

- 历史侧：`~/.dsh/sessions/**` **字节不变**，由 0.1.1 继续服务；抄本仅用于「需要一致快照」的备份场景（T19/T21 的 `cp -a` + 基线比对）。
- 新侧：0.2.0 自有 `sessions/` 根，**初始为空**，只写 v4 新会话。
- **两侧不做双向同步**（理由见 §3.2）。

### 1.2 为什么「各自一个根」是唯一自洽的划分（机制层）

| 事实（均源码级/实测） | 若两实例共用一个 `sessions/` 根会怎样 |
|---|---|
| 0.1.1 的 `findLog` **只按固定文件名** `session.jsonl.zstd` 定位，既不枚举代际也不认 `session.vN.*` | 0.2.0 写出的 `session.v4.jsonl.zstd` 对 0.1.1 **完全不可见** ⇒ 「共用根」并不会得到合并列表，只得到「一侧半可见」 |
| 0.2.0 取**目录内最高代**、且**不校验高代是否为低代的超集** | 同一会话目录一旦出现两代，0.2.0 会静默按陈旧的高代呈现（真实库已发生 1 例：v0 比 v3 晚 5 天、内容约 10 倍不可达） |
| `open(id,'write')` 才会取 `session.lock`（flock）并**排他发布** v4 继任代；`open(id,'read')` 不落盘 | 两个写入方共用一个根 ⇒ 同一会话可能被两侧各自追加，形成**永久分叉** |
| 真实库 3 个双代目录中已有 1 例静默数据丢失 | 共用根会把该风险从 3 个目录**放大到约 2460 个会话目录** |
| T05 明确结论：「**不建议**在没有针对 descriptor v2 的转换器之前，让 0.2.0 以写方式打开 0.1.1 会话」 | 共用根 = 直接违反该结论 |

⇒ **两侧各一个 `DSH_HOME`、各自一个 `sessions/` 根，是本形态零数据改写的结构性保证**（不是纪律，是机制）。

### 1.3 用户如何区分「该去哪一侧」

**用户可见的一句话职责边界（可直接转述给用户）**：

> **历史会话 → 3080（DSH 0.1.1）；新会话 → 新端口 3098（DSH 0.2.0）。不要把新会话开在 3080 里。**

补充纪律：**历史去 3080，新活儿去 3098；新会话不要在 3080 里开。**

| 判据 | 说明 |
|---|---|
| **地址栏端口** | `http://127.0.0.1:3080/` = 历史；`http://127.0.0.1:3098/` = 新工作台。这是唯一可靠的外部判据 |
| 书签命名 | 建议把书签改名为「DSH-历史(3080)」「DSH-新(3098)」，不要依赖页面外观（两侧 UI 版本不同，但外观差异不足以作为操作判据） |
| 会话列表内容 | 3080 的列表 = 全部历史（含 0.9% 的 v3 会话）；3098 的列表 = 只含**新会话**（初始为空）。**看到长列表就是 3080** |
| token | 3080 的 URL 是既有书签；3098 的 token **每次启动重新发放**，需从新根日志取（`grep -o 'http://127.0.0.1:3098[^ ]*'`）。⚠️ 该 token 属敏感值，**不得写进任何报告/文档/截图** |
| 判据**不可用**的项 | 页面标题、主题/壁纸（两侧配置不同步，且用户可能分别调整）、进程名（沙箱内 `ps` 不可用，且端口占用是 per-netns 的） |

**跨侧不可见的两个方向（必须在用户告知里显式说明）**：

1. 3098 **不承载任何历史语料**（新根无 `sessions/`、无 `attachments/`）⇒ 看不到任何历史会话——想看历史就切到 3080 标签页；
2. 3080 **看不到**任何 3098 新会话——0.1.1 的定位逻辑只认固定文件名 `session.jsonl.zstd`，新侧写的是 v4 名；且两侧根本就不同。

⇒ 两侧**没有统一会话列表、没有跨实例检索、没有跨实例引用/交接**。这是本形态的结构性代价（§8），不是缺陷修复项。

---

## 2. 前置闸门（G1–G16）

**全部只读**（唯一例外是 G6/G7 在新根内落盘基线文件，不触及现役）。**任一条不符先停**，不要带着已失败的闸门继续。

### 2.0 一次性变量（后续所有片段都依赖它）

```bash
cd /home/CNS2026495165/dsh
export WS=/home/CNS2026495165/dsh
export CUT="$WS/.workspace/audit-020/cutover-dual"
export ASM="$WS/.workspace/audit-020/assembly-020"
export CLI="$ASM/prefix-cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
export NATIVE="$ASM/prefix-cli/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
export PORT_011=3080
export PORT_017=3097
export PORT_NEW=3098
export ROOT_020="$CUT/root020"
export NEWHOME="$ROOT_020/home"
export ART="$WS/.workspace/dsh-020-pkg/deepseek-ai-dsh-0.2.0-rc.1.tgz"
export T19="$WS/.workspace/audit-020/t19"
export T21="$WS/.workspace/audit-020/t21"
export NPM_CACHE="$WS/.workspace/npm-cache"
export NPM_LOGS="$WS/.workspace/npm-logs"
mkdir -p "$CUT/logs" "$CUT/backup" "$NPM_CACHE" "$NPM_LOGS"
```

> **为什么隔离根必须在工作区内**：本沙箱每个命令都在 `bwrap --ro-bind / / --bind <workspace> <workspace> --unshare-pid` 内，`/` 只读挂载，
> **家目录不可写**（`mkdir ~/.dsh-020` 返回 `EROFS`，是挂载只读而非权限问题）。`/tmp` 实测可写但**易失，不得作为数据根**。
> 若在真实宿主 shell 中执行同形布局，把 `CUT`/`ROOT_020` 换成家目录前缀即可，其余步骤不变。

### 2.1 G1 — 现役实例仍在（只读）

```bash
ss -ltn | grep -E ':(3080|3097) '
```

**预期**：恰好两行 LISTEN（`127.0.0.1:3080`、`127.0.0.1:3097`）。（当轮实测值：两行均在。）
**不符 ⇒ 停**：缺 3080 说明现役已不在，先查现役，不得进入切换流程。

### 2.2 G2 — 目标端口空闲（**bind-only 探针**，比 `ss` 更强）

```bash
for p in 3098 3099 3102 3103 9224 9225; do node -e 'const net=require("net");const s=net.createServer();s.once("error",e=>{console.log("PORT "+process.argv[1]+" => "+e.code);process.exit(0)});s.listen(Number(process.argv[1]),"127.0.0.1",()=>{console.log("PORT "+process.argv[1]+" => FREE");s.close()})' "$p"; done
```

**预期**：六行 `=> FREE`（当轮实测：3098/3099/3102/3103/9224/9225 全部空闲）。
**不符 ⇒ 停**：任一 `=> EADDRINUSE` 时，若为 3098 则改用列表中的下一个作为 `PORT_NEW` 并重跑本轮全部命令。

> ⚠️ **端口占用是 per-netns 的**：同一端口号可在不同 netns 同时绑定且互不可见。因此
> ① 本探针**必须**在「将来实际运行 3098 的那个 netns」中执行（= 普通 bash 调用，**不要**在 `unshare -rn` 里跑）；
> ② `unshare -rn` 内 `=> FREE` **不能**证明宿主 netns 空闲。生产形态（§4.6）**不加 `unshare`**，所以本探针有效。

### 2.3 G3 — 现役配置指纹基线（**权威版**：T19 `manifest.sh`）

```bash
bash "$T19/manifest.sh" gen "$CUT/backup/min-set-baseline.txt"
wc -l "$CUT/backup/min-set-baseline.txt"
```

**预期**：生成成功，`fail=0 missing=0` 语义的清单（当轮实测该最小集合为 **118 行级**判据、`pass=118 fail=0 missing=0`）。
该文件是**唯一权威的「未污染」基准**（它内置**易变路径排除表**：`~/.dsh/logs/**`、`storages/usage/**`、`storages/session_projcache.json`、`session-board/peers/**`、两处 `sessions/**`、`btw/**`、`**/session.lock`）。

```bash
sha256sum ~/.dsh/profiles/web/cordis.patch.yml
```

**预期**：稳定值（当轮实测 `513413e7cffb319149a7be2bbab829e898e59c9d626909e33869429794487471`）。**这是「现役配置未被改写」的判据之一**。

```bash
sha256sum ~/.dsh/settings.yaml
stat -c '%s %Y %n' ~/.dsh/settings.yaml
```

**预期**：有输出，但 ⚠️ **只记录、不作判据** —— `settings.yaml` 是**活值**（现役会自行改写）。任何拿它的整文件哈希做「未污染」断言的写法都会误报。

### 2.4 G4 — 目标制品完整性

```bash
sha256sum "$ART"
```

**预期**：`ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216`（与 registry 声明一致，当轮实测相同）。
**不符/缺失 ⇒ 停**，重新取得：

```bash
npm pack @deepseek-ai/dsh@0.2.0-rc.1 --pack-destination "$WS/.workspace/dsh-020-pkg" --cache "$NPM_CACHE"
```

### 2.5 G5 — 0.2.0 CLI 与组合自检（离线、不起服务、零模型请求）

```bash
env -i HOME="$ASM/home" DSH_HOME="$ASM/home" PATH=/usr/bin:/bin node "$CLI" --version
```

**预期**：`0.2.0-rc.1`

```bash
env -i HOME="$ASM/home" DSH_HOME="$ASM/home" PATH=/usr/bin:/bin node "$CLI" --profile web --dump-config | grep -c '^- id:'
```

**预期**：**199**（0.1.7 为 198）。若为 0 或报错 ⇒ 组合未闭合，回到 RUNBOOK §4 修复。
⚠️ **`--dump-config-schema` 两版都恒 `exit 1`**（`complete=false` + 6 条 diagnostic）——**不得**把它的退出码当作配置校验/启动失败判据。

### 2.6 G6 — peer 豁免文件就位（**不做这步会静默禁用 6 个插件**）

```bash
cat "$ASM/home/profiles/web/compatibility.json"
stat -c '%a %s %n' "$ASM/home/profiles/web/compatibility.json"
```

**预期**：**恰好 6 条**精确版本豁免（`@deepseek-ai/dsh-taste@0.1.0`、`@deepseek-ai/dsh-vision-adam@0.2.0`、`dsh-workspace-enhancement@0.1.2`、`@local/dsh-pptmaster@0.1.0`、`@local/dsh-web-search-sse@0.1.0`、`@local/dsh-workerspace@0.1.0`），权限 `600`。
**格式规则**：key = `精确包名@精确版本`，value = `精确 DSH 版本数组`；**不接受范围**，不合法条目会被忽略并 warning。

### 2.7 G7 — 会话/附件冻结基线（只读，不抄内容）

```bash
find ~/.dsh/sessions -name '*.zstd' | wc -l
find ~/.dsh/sessions -maxdepth 1 -mindepth 1 -type d | wc -l
find ~/.dsh/attachments -type f | wc -l
du -sh ~/.dsh/attachments
find ~/.dsh/attachments/v1/objects -type f | wc -l
du -sb ~/.dsh/attachments/v1/objects
```

**预期（**活值，每次必须重取；下列为定稿时点实测**）**：日志 **2 466–2 467**、工作区目录 **21**、附件 **991 文件 / 205 MB**（其中 `objects` **982 文件 / ≈209 384 193 B**）。
⚠️ **现役仍在活跃写入**（实测日志数在会话期间由 **2 460 增至 2 466**）⇒ **不要对这些数字做快照性假设**，也不要引用历史值；任何计数都带「采样时刻」语义。

```bash
( cd ~/.dsh && find sessions -type f -exec sha256sum {} \; | sort -k2 ) > "$CUT/logs/sessions-baseline.txt"
wc -l "$CUT/logs/sessions-baseline.txt"
```

**预期**：行数 = G7 的「文件总数」。⚠️ **基线边界（必须写进结论）**：该指纹只保证**采集时刻之后**的字节未变，**不保证采集前未缺失**。

> **会话存储形态**：**纯 JSONL / 多帧 zstd 追加流，没有 SQLite / WAL / 索引**（`session-query-sqlite` 在两代 base 都是 `path: :memory:` + `openAt: never`）。
> ⇒ 会话直接 `tar`/`cp -a` **安全**；T19 的 `{readOnly:true}` + `VACUUM INTO` 纪律**只适用于** `~/.dsh/storages/usage/usage.db` 等非会话存储。
> ⇒ **读会话必须按 zstd 帧逐帧解码**：`zstdDecompressSync(整文件)` **只解第一帧**（表头约 200 B），对 12 MB 日志会**静默给出 190 B**。

### 2.8 G8 — 附件↔会话自洽（现役侧，关闭「附件门禁」的前提）

```bash
node "$T21/attach-probe.mjs" ~/.dsh/sessions ~/.dsh/attachments/v1
```

**预期**：`logsWithAttachmentId = 47`、`distinctAttachmentIds = 971`、`storeMissing = 0`（源侧当轮基线）。
**`storeMissing > 0` ⇒ 停**：说明现役根自身已不自洽，先查因（可能是活跃写入的中间态），不得把这个状态复制进新根。

### 2.9 G9 — 隔离新根的状态断言（**防止 DSH_HOME 回退真 home**）

```bash
case "$NEWHOME" in
  "$WS"/.workspace/*) echo "OK: 新根在工作区内" ;;
  *) echo "ABORT: 新根不在工作区内"; exit 1 ;;
esac
[ -n "$NEWHOME" ] || { echo "ABORT: NEWHOME 为空"; exit 1; }
[ "${NEWHOME#/}" != "$NEWHOME" ] || { echo "ABORT: NEWHOME 必须是绝对路径"; exit 1; }
if [ -e "$NEWHOME" ]; then echo "WARN: 新根已存在，逐项复核其内容后再决定复用或重建："; ls -a "$NEWHOME"; else echo "OK: 新根尚不存在（全新根）"; fi
find "$NEWHOME/sessions" -mindepth 1 -print 2>/dev/null | head
ls -d "$NEWHOME/attachments" 2>/dev/null || echo "OK: 无 attachments/"
```

**预期**：`OK: 新根在工作区内` + 一条新根存在性判定（首次执行应为 `OK: 新根尚不存在（全新根）`；若为 `WARN: 新根已存在` ⇒ 逐项复核后再决定复用或重建）。
**新根不含历史语料（用户裁决的数据面纪律，见 §3.2 / V20）**：`find "$NEWHOME/sessions"` **无输出**、`OK: 无 attachments/`。
**红线（RUNBOOK §13 实测）**：`DSH_HOME="   "`（**空白**）会**静默回退真 `~/.dsh`** —— 0.2.0 一旦对着现役 home 启动，就会在**现役会话根**上取 `session.lock`、发布 `session.v4.jsonl.zstd`，直接违反本形态的核心承诺。因此：
- 启动命令里的 `DSH_HOME` **必须写死为字面绝对路径**（本档的启动块已如此），**不得**用可能为空的变量；
- 启动后必须用 G15「现役未被触碰」见证复核（**这是唯一能事后发现该事故的手段**）。

### 2.10 G10 — sidecar 树基线（**不在 `sessions/` 内，最易漏**）

```bash
stat -c%s ~/.dsh/taste/taste.md
find ~/.dsh/taste -type f -printf '%s %p\n'
find ~/.dsh/btw -type f -printf '%s %p\n'
```

**预期**：`taste.md` = **17002** B（中文单轨，4482 CJK；英文 sidecar `display.zh.json` 已退役为 `{}`）；`btw/index.json` 存在（当轮实测 1636 B）。
⚠️ **`taste/` 与 `btw/` 不在会话日志内**（是 `<DSH_HOME>` 下的 sidecar）⇒ 与会话迁移**完全解耦**，但**不受任何会话备份覆盖** ⇒ §4 的搬运步骤**必须单独携带这两棵树**。

### 2.11 G11 — `agent-presets` 就位性（**就位 ≠ 生效**）

```bash
find ~/.dsh/.agent-presets -type f -printf '%s %p\n'
echo "assembly 根有 .agent-presets 吗：$(ls -d "$ASM/home/.agent-presets" 2>/dev/null || echo 无)"
grep -n -A3 'id: agent-preset-registry' "$ASM/home/profiles/web/cordis.patch.yml"
```

**预期（两条事实同时成立，都要记录）**：现役有 `standard-glm/agent.cordis.yml` + `standard-glm/preset.yml`；**装配根：本档初稿撰写时点「无」，定稿时点「已就位且已修」**（同期迁入，并按 §0.6 修掉 `persona.config.text → prefix`、移除已停发的 `dsh-workflow-worker-thread`；复核 `--dump-config` rc=0 / 199、`text:0 / prefix:1`）；assembly patch 的 `agent-preset-registry` 只有 `config: default: standard-glm`。

> **这条闸门为什么重要**：装配根曾在**没有** `.agent-presets/` 的情况下**照常启动**（启动日志只有 2 条未激活）⇒ **preset 缺失不阻断启动**；而现况虽已就位，**就位 ≠ 生效** ⇒ `default: standard-glm` 的**实际生效面仍未校验**（可能静默回落到官方 `standard`）。
> 这正是评估报告 E2 的现场实例：**「服务起来了」与「你的定制生效了」彻底脱钩**。
> ⇒ 该 preset 在 0.2.0 上的**激活与否**属**切换前必须显式验证**的项，唯一判据是 **V16**（读新会话头部 `agentPreset`）；未通过前**不得**宣称「两侧 agent 行为一致」。相关门禁见 N3（`config.text:` → `prefix`，`prefix` 为必填）。

### 2.12 G12 — 凭据面判定（决定「零外呼」是否成立）

```bash
awk '{line=$0; sub(/^[ ]*/,"",line); if (match(line,/^[^:]*:/)) {k=substr(line,1,RLENGTH); v=substr(line,RLENGTH+1); gsub(/"/,"",v); print "key=" k " vallen=" length(v)}}' "$ASM/home/.credentials.yaml"
```

**预期（当轮实测）**：只有 `version:` / `records:` / `client-connection/browser-session` / `secret`（长度 44）—— **不含任何模型 key**。
⇒ assembly 根**天然无模型凭据**，因此「干跑形态」（§4.5）的零外呼是**结构性的**，不依赖 netns。

```bash
awk '{line=$0; sub(/^[ ]*/,"",line); if (match(line,/^[^:]*:/)) {k=substr(line,1,RLENGTH); v=substr(line,RLENGTH+1); gsub(/"/,"",v); print "key=" k " vallen=" length(v)}}' ~/.dsh/.credentials.yaml
```

**预期**：现役含 `refs:` 下的 `DEEPSEEK_API_KEY`、`ADAM_API_KEY`（各 52 字符）。**输出只打印键名与长度，不打印值**。
⇒ **生产形态（§4.6）必须显式注入凭据**（见 §4.7 的两个选项与代价）。

> **零外呼的两条必须遵守的红线（T22 实测，源码级闭合）**
> 1. **必须清空模型 key ——「netns 隔离」本身不足以保证零外呼**：无 key 时 `resolveAuth` 在 `fetch` **之前**且在 `try{}` **之外**抛 `MISSING_CREDENTIAL`，而 `MISSING_CREDENTIAL`/`AUTH` **不在默认可重试码内** ⇒ 无静默重试；
>    **反之（有 key + netns 隔离）会走 `TRANSPORT` 重试最多 5 次**。
> 2. **启动目录的 `.env` 也会供 key** ⇒ 干跑前确认新根下无 `.env`。

### 2.13 G13 — 遥测关闭配置面复核（N4）

```bash
env -i HOME="$ASM/home" DSH_HOME="$ASM/home" PATH=/usr/bin:/bin node "$CLI" --profile web --dump-config | grep -A3 'session-telemetry-otel'
```

**预期**：可见 `exporter.url` 指向 `dsh-otel-collector.deepseeksvc.com`（默认值），运行时由 `DSH_TELEMETRY_MODE=DISABLED` 关闭。
> **N4 事实**：0.2.0 新增**默认远端遥测外呼**，**无 `enabled` 开关**，且**卸载时 drain**（停实例本身就是外呼时点）。接受值实测为 `DISABLED` / `FEEDBACK_ONLY`。
> ⇒ **零外呼验收必须另证「未发起」**，不能只靠 `unshare`。这是 §4.7 必须由用户裁决的一个开关。

### 2.14 G14 — 沙箱/工具面事实确认（影响判据设计）

```bash
ps -p 1 -o pid,cmd 2>&1 | head -3
node -e 'console.log("netns 路由数（普通调用）:", require("child_process").execSync("ip route | wc -l").toString().trim())'
```

**预期**：`ps` 只看到自身/`bwrap`——**`ps -p <宿主 pid>` 在库内恒不可用**（每个 bash 调用一个 PID namespace），**不是工具坏**；
路由数 ≥1（普通调用**在宿主 netns**，有路由 ⇒ 生产形态可被浏览器访问，但也意味着**必须靠凭据与遥测开关来保证零外呼**）。

> **判据设计结论**：存活/未污染一律用「**端口 + 配置哈希 + 日志世代 + 会话数**」，**禁止**用 `ps`；
> 并且**端口占用是 per-netns 的** ⇒ 只探测「将来运行该服务的那一个 netns」。

### 2.15 G15 — 「现役未受污染」基线见证（切换前一次性采集）

```bash
bash "$T19/witness.sh" | tee "$CUT/backup/witness-BASELINE.txt"
```

**预期**：七组见证全部有值（当轮实测基线示例：W1 inode `14152`/`15397376`；W2 HTTP `200/16611`、`401/68`；W4 宿主 pid 记录值；W6 会话数）。**该文件是后续每次判定的逐行基准**。
⚠️ `settings.yaml` 的哈希会随时间变化 ⇒ 判定必须用 `manifest.sh`（已排除易变路径），**不要**用整文件哈希。

### 2.16 G16 — 落盘面与 git 面确认

```bash
git -C "$WS" check-ignore -v "$CUT" ; echo "(空 = 未被忽略)"
git -C "$WS" status --porcelain | grep -c 'audit-020'
```

**预期（当轮实测）**：`check-ignore` **空**（`.workspace/audit-020` **未被 `.gitignore` 忽略**）；`audit-020` 在 `git status` 中折叠为 **1 行**。
> ⇒ 新根会落在一个**属于 git 工作树但未被忽略**的目录里（`.gitignore` 只忽略 `**/node_modules/` 与 `*.log`，**不忽略 `*.zstd`**）。
> ⇒ **纪律**：**禁止**对新根执行 `git add` / `git commit`；若要把该风险降到零，需由用户**显式**增加一条忽略规则（**属配置改动，本档不执行、也不建议在切换同期做**）。

---

## 3. 数据面方案

### 3.1 历史会话如何继续被 0.1.1 服务

**做法：`~/.dsh/sessions` 与 `~/.dsh/attachments` 原样保留、原地不动、零改写。** 不复制、不转换、不改名、不重建索引。

- **现役语料（活值，必须重取）**：**2 466 日志 / 21 工作区 / 991 附件（205 MB）**。
- **0.1.1 不需要任何动作，且可读性已实测（§0.2）**：`decodeStorageRecord` 对真实 22.8 MB / 82 430 行日志**零错误**展开 65 145 个打包行 → 1 364 372 个事件；按固定文件名 `session.jsonl.zstd` 读本代 v0 是它的原生路径。
- ⚠️ **现役仍在活跃写入**：实测日志数在会话期间由 **2 460 增至 2 466**。⇒ **不要对现役会话目录做任何快照性假设**：任何 `cp`/`tar`/`sha256sum` 采集都只是「某一时刻」，且基线只保证**采集时刻之后**字节未变（§2.7）；要「绝对原子快照」的唯一干净做法是让现役停写，而**本预案不含任何停写动作**。
- 本代**唯一**的多代风险点是「同一目录同时有 v0 与 v3」：0.1.1 只认固定文件名，因此它读的是 **v0（完整的那份）**；而 0.2.0 会取最高代 ⇒ **同一会话在两侧可能呈现不同内容**（真实库已发现 1 例：v0 比 v3 晚 5 天、约 10 倍内容）。
  ⇒ **这正是「历史只由 0.1.1 呈现」的额外理由**：不要向用户展示 0.2.0 侧的历史视图，以免给出陈旧快照。
- 纪律：切换期**禁止**在 3080 里继续开新会话（否则历史侧会持续长出必须留在 v0 侧的新数据，双实例的分裂无法收敛）。这属**用户操作纪律**，无机制强制 ⇒ 必须写进告知。

### 3.2 0.2.0 是否需要自己的 `sessions/` 根

**已定纪律（用户裁决 + 协调者已执行）：需要，且**初始为空**——即 0.2.0 新根不得承载历史语料。** 不指向 `~/.dsh/sessions`，也不预置历史副本。

**已执行先例（本轮实测）**：为验证而复制的 **2 460 份日志 + 205 MB 附件副本**已由协调者**移出**新根，落到 `.workspace/audit-020/n17-evidence/`（`sessions-copy/` + `attachments-copy/`，合计约 **1.4 GB**）；新根 `home/` 的**内容目录**只剩 `logs/ profiles/ storages/ wallpapers/`（另有点文件 `.agent-presets/`、`.credentials.yaml`，及 `settings.yaml.import-source` 设置暂存件）⇒ **`sessions/` 与 `attachments/` 已不在新根**。
⇒ 这条不只是建议：**它已经被执行过一次**，本预案沿用该形态，并把「新根不含历史语料」升级为**可判定断言**（G9 / V20）。

理由——**协调者给出的直接理由（本条即裁决依据）**：0.2.0 **读不了它们**（仅 **3%** 可读），留着会造成「**会话列表有条目但打不开**」的混乱，以及**新旧目录分叉**。以下为补充论证：

1. **结构性保证零改写**：只有「两个 `DSH_HOME` 各自一个 `sessions/` 根」，才能保证 0.2.0 的 `open(id,'write')` **永远不会**在现役根上取 `session.lock` 或发布 v4 继任代。纪律做不到这一点，机制可以。
2. **收益极低**：即便把历史复制进新根，0.2.0 也只能读 **3.0%**（`descriptor v2 → v3` 后 60%，余 40% 无解）。历史本来就能在 3080 侧 **100%** 读到（§0.2 协调者实测），**复制不增加任何可用信息**。
3. **成本很高**：
   - 1.1 GiB 复制 + 逾 2400 份会话进入新实例的列表 ⇒ 首屏/列表因**投影缓存跨格式代作废**而全量冷重放（**变慢，不是数据错误**）；
   - 新根会成为**第二个可写血缘**：一旦在新实例里 write-open 一个老会话，就发布一个 v4 继任代，而同一个会话在 3080 侧仍会继续追加 v0 ⇒ **永久分叉**；
   - 违反 T05 的明确结论（在无 descriptor v2 转换器前，不要以写方式打开 0.1.1 会话）。
4. **不承载历史 = 用户不会误以为「0.2.0 能读历史」**：这正是本形态最容易被误述的一点（「已迁移」的错觉）。

**可选变体（V-seed，需用户单独裁决，本档不推荐）**：只把 0.2.0 可读的那部分（按 T05/T21 的预检结果筛出）复制进新根，以在 3098 里也能看到少量历史。
**代价与硬约束**：① 需要先跑一次全库只读预检（`twice` 口径：`triage-current.mjs` / `baseline.mjs`）才能定集合；② 集合与「修 descriptor 后」的口径强耦合，未来还会变；③ **必须附加「永不 write-open 历史会话」的纪律**（无机制可强制）；④ 子代理目录必须**整根**复制，跨根拆分会让子关系降级为 unknown。⇒ **属可选优化，不进本预案基线。**

### 3.3 附件面（两代同形 ⇒ `cp -a` 即等价；**但本形态默认不复制**）

**机制**：两代的存储布局与寻址**完全相同**——`root = join(DSH_HOME,"attachments","v1")`；对象寻址 `join(root,"objects", sha256.slice(0,2), sha256)`；`attachmentId` 形状 `sha256:<64hex>`，解析只取 hash（`ID_PATTERN = /^sha256:([a-f0-9]{64})$/`）。且附件根**无配置覆盖项**，只能随 `DSH_HOME` 走。
⇒ 因此若要复制，`cp -a` **即等价**（不需要转换/重命名/重建索引/迁移 `request-images` 缓存/改写引用）；**布局两代相同这一点本身已由实测确认**。

**但在本形态下（新根不承载历史语料）的结论是：默认不要复制 `attachments/v1`。**
理由：附件只在**被会话引用**时才有意义（`readImageFile()` 按 `attachmentId` 寻址，缺失 ⇒ `AttachmentError("Attachment object is missing.","ATTACHMENT_NOT_FOUND")`）。新根没有历史会话 ⇒ **零引用** ⇒ 复制过来的 991 个对象就是 **991 个孤儿对象 / 205 MB 纯占用**；而历史会话的图片由 **0.1.1 从原地未动的现役 store** 继续服务。
⇒ 协调者已按同一方向执行（把附件副本连同日志副本一并移出到 `n17-evidence/`）。**默认场景的验收 = 断言新根下不存在 `attachments/`（见 V20）**。

**仅在以下场合才需要复制（可选，需用户裁决）**：

- ① 启用 §3.2 的 **V-seed 变体**（把部分历史会话复制进新根）——**此时必须连同 `attachments/v1` 一起复制**，否则分页/附件投影会报 `ATTACHMENT_NOT_FOUND`（T21 §7.2 的边界表）；
- ② 用户要求把 3080 侧带图内容「文件级搬运」到 3098（注意：**跨实例引用不存在**，正常做法是在新侧重新上传，走上传即在新根产生**新对象**）。

```bash
# （可选场景）布局等价复制
mkdir -p "$NEWHOME/attachments"
cp -a --no-target-directory ~/.dsh/attachments/v1 "$NEWHOME/attachments/v1"
stat -c '%a %n' "$NEWHOME/attachments" "$NEWHOME/attachments/v1"
```

**验收命令（三条，全部可判定）**：

```bash
find "$NEWHOME/attachments/v1/objects" -type f | wc -l
du -sb "$NEWHOME/attachments/v1/objects"
```

**预期**（可选复制场景）：`objects` **982** 文件 / **≈209 384 193 B**；`attachments/v1` 全树（含 `request-images`）**991** 文件；现役 `~/.dsh/attachments` 合计 **205 MB**。⚠️ 源侧**仍在活跃写入** ⇒ 数字只增不减，必须与**同一时刻**的源侧计数对照，不要引用历史值。

```bash
( cd ~/.dsh/attachments/v1 && find objects -type f -exec sha256sum {} \; | sort -k2 ) > "$CUT/logs/attach-src.txt"
( cd "$NEWHOME/attachments/v1" && find objects -type f -exec sha256sum {} \; | sort -k2 ) > "$CUT/logs/attach-dst.txt"
awk 'NR==FNR{d[$2]=$1;next}{ if(!($2 in d)) {print "ONLY-IN-DST "$2; next} if(d[$2]!=$1) print "MISMATCH "$2 }' "$CUT/logs/attach-src.txt" "$CUT/logs/attach-dst.txt" | head
awk 'NR==FNR{d[$2]=1;next}{ if(!($2 in d)) c++ } END{print "src-only(复制期间新增，属正常漂移): " c+0}' "$CUT/logs/attach-dst.txt" "$CUT/logs/attach-src.txt"
```

**预期**：第一条**无输出**（无 `ONLY-IN-DST`、无 `MISMATCH`）；第二条 `src-only` 通常为 `0`（>0 时逐个重取这些对象再校一次）。

```bash
( cd "$NEWHOME/attachments/v1/objects" && find . -type f | while IFS= read -r f; do b=${f##*/}; h=$(sha256sum "$f" | cut -c1-64); [ "$b" = "$h" ] || echo "NAME-HASH-MISMATCH $f"; done ) | head
```

**预期**：**无输出**（内容寻址自证：文件名 == 内容 sha256；零解码成本）。
> **口径诚实标注**：以上只证明「对象存在且内容自证」，**未**逐对象校验 `mediaType` 与像素自洽性（那需要解码图片，代价与风险都高）。若要更严的验收，可另加一条基于真实引用的覆盖检查。

### 3.4 sidecar 与会话根之外的必须搬运项（逐项：不搬会怎样）

| 项 | 源 | 不搬的后果 | 命令 |
|---|---|---|---|
| `taste/` | `~/.dsh/taste` | 新实例 taste 为空 ⇒ 用户偏好丢失（**不在会话日志内，任何会话备份都不覆盖它**） | `mkdir -p "$NEWHOME/taste" && cp -a ~/.dsh/taste/. "$NEWHOME/taste/"` |
| `btw/` | `~/.dsh/btw` | 同上（`btw/index.json`） | `mkdir -p "$NEWHOME/btw" && cp -a ~/.dsh/btw/. "$NEWHOME/btw/"` |
| `.agent-presets/` | `~/.dsh/.agent-presets` | patch 里 `default: standard-glm` **无对应物**（G11）⇒ 可能静默回落官方 `standard`（**静默，不报错**） | `mkdir -p "$NEWHOME/.agent-presets" && cp -a ~/.dsh/.agent-presets/. "$NEWHOME/.agent-presets/"` —— 注意：装配根**现已就位**（`standard-glm/agent.cordis.yml` 13431 B + `preset.yml` 179 B），可直接从 `$ASM/home/.agent-presets` 复制 |
| `wallpapers/`（可选） | `~/.dsh/wallpapers` | 新实例无壁纸（纯观感，可后补） | `mkdir -p "$NEWHOME/wallpapers" && cp -a ~/.dsh/wallpapers/. "$NEWHOME/wallpapers/" 2>/dev/null` |
| **不搬**：`sessions/` | — | 见 §3.2（**刻意不搬**：0.2.0 仅 3% 可读 ⇒ 只会造成「有条目打不开」+ 目录分叉） | — |
| **不搬**：`attachments/` | — | 见 §3.3（**默认不搬**：零引用 ⇒ 991 个孤儿对象 / 205 MB；历史图片由 0.1.1 从原地 store 服务） | — |
| **不搬**：`storages/` | — | 含 `usage.db`（WAL SQLite，72 MB）与 `session_projcache.json`。**新实例应自建**：跨实例共用会把两个写入方压进同一个 SQLite，且 `usage.db` 的一致性纪律（`{readOnly:true}` + `VACUUM INTO`）不适用于「两个写入方」 | — |

```bash
stat -c%s "$NEWHOME/taste/taste.md"
sha256sum ~/.dsh/taste/taste.md "$NEWHOME/taste/taste.md"
find "$NEWHOME/.agent-presets" -type f -printf '%s %p\n'
```

**预期**：`17002`；两条 sha256 **相同**；preset 两文件就位（13431 / 179）。

---

## 4. 切换步骤（C1–C8，每步含预期与失败即回滚分支）

> **本节是切换当日的执行序**。C1–C4 **不产生任何对外可见的服务**；C5 起才进入「生产形态」。
> **每一步失败都先停手、再按指示回滚**；不确定时一律走回滚（回滚成本 ≈ 一次 `mv`，见 §5）。

### C1 — 冻结基线（只读现役）

```bash
bash "$T19/manifest.sh" gen "$CUT/backup/min-set-baseline.txt"
bash "$T19/witness.sh" | tee "$CUT/backup/witness-BASELINE.txt"
sha256sum ~/.dsh/profiles/web/cordis.patch.yml | tee "$CUT/backup/patch-011.sha256"
( cd ~/.dsh && find sessions -type f -exec sha256sum {} \; | sort -k2 ) > "$CUT/logs/sessions-baseline.txt"
```

**预期**：四份基线落盘（`min-set-baseline.txt`、`witness-BASELINE.txt`、`patch-011.sha256`、`sessions-baseline.txt`）。
**失败 ⇒ RB-0**（基线不完整 ⇒ 不得进入后续任何步骤；重取）。

### C2 — 组装 0.2.0 生产根（**写入仅发生在新根**）

```bash
mkdir -p "$NEWHOME/profiles/web" "$NEWHOME/logs" "$NEWHOME/sessions" "$NEWHOME/taste" "$NEWHOME/btw" "$NEWHOME/.agent-presets"
for f in cordis.yml pnpm-workspace.yaml package.json cordis.patch.yml compatibility.json; do cp -a "$ASM/home/profiles/web/$f" "$NEWHOME/profiles/web/$f"; done
chmod 600 "$NEWHOME/profiles/web/compatibility.json"
mkdir -p "$NEWHOME/profiles/node_modules/@deepseek-ai" "$NEWHOME/profiles/node_modules/@local"
for d in "$NATIVE"/*; do [ -e "$d" ] || continue; ln -sfn "$d" "$NEWHOME/profiles/node_modules/@deepseek-ai/$(basename "$d")"; done
cp -a "$ASM/home/profiles/node_modules/@local/." "$NEWHOME/profiles/node_modules/@local/"
for p in dsh-taste dsh-session-board dsh-vision-adam; do cp -a "$ASM/home/profiles/node_modules/@deepseek-ai/$p" "$NEWHOME/profiles/node_modules/@deepseek-ai/$p"; done
cp -a "$ASM/home/profiles/node_modules/dsh-workspace-enhancement" "$NEWHOME/profiles/node_modules/"
rm -f "$NEWHOME/profiles/node_modules/zod"
ln -sfn "$ASM/prefix-cli/lib/node_modules/@deepseek-ai/dsh/node_modules/zod" "$NEWHOME/profiles/node_modules/zod"
```

**预期**：`$NEWHOME/profiles/web` 六个文件就位；农场条目数与 assembly 一致；`zod` 解析到 **0.2.0 前缀自带的 zod**。

```bash
ls "$NEWHOME/profiles/node_modules/@deepseek-ai" | wc -l
node -e 'console.log("zod ->", require(process.argv[1]+"/profiles/node_modules/zod/package.json").version)' "$NEWHOME"
```

**预期**：农场条目数 **291**（当轮实测 `assembly-020` 的 `@deepseek-ai` 目录条目数；含 3 个真实目录 + 其余为指向 0.2.0 前缀的符号链接），新根应与之一致；`zod -> 4.6.5`。
> **本轮实测依据（务必按上一条命令切断跨代依赖）**：assembly 根的 `zod` 是一条指向**现役 profile → 0.1.1 前缀**的符号链接（实测 `zod 4.6.2`），而 0.2.0 前缀**自带 `zod 4.6.5`**。若照抄该链接，新实例会**运行时依赖现役树**（现役一旦升级/回滚就跟着变），且版本与 0.2.0 自带的不同 ⇒ 生产根必须指向 0.2.0 前缀的 zod。

> ⚠️ **私有依赖岛会随 `cp -a` 一起被搬进新根（N10 = 已裁定方案 B，不得重开）**：`dsh-workspace-enhancement`（岛内 **66** 项）与 `dsh-pptmaster`（**23** 项）**随包分发**它们的私有 `node_modules`，其中 `dsh-fs` / `dsh-fs-local` / `dsh-fs-sandbox` / `dsh-subprocess` / `dsh-subprocess-local` **全部钉死 `0.1.1-rc.2`**（官方为 `0.2.0-rc.1`），且**安装期不会被重建**。
> ⇒ 保留旧岛 = **永久 0.1.1 语义 + 无法满足 0.2.0 新契约**（`readByteRange` / `terminalEnvironment` / `resize` / `inspectActivity`）。**复制后必须按方案 B 丢弃旧岛**（否则新实例的 fs/subprocess 面停留在上一代语义，且这不会在启动日志里报错）。

**失败 ⇒ RB-A**（新根组装不完整 ⇒ 废弃新根重来，不碰现役）。
✅ **从装配根「提升」是安全的**：协调者已把为验证而复制进装配根的 **2 460 份日志 + 205 MB 附件副本移出**到 `.workspace/audit-020/n17-evidence/`，装配根 `home/` 现已**不含 `sessions/` 与 `attachments/`** ⇒ 本步骤**不可能**把历史带进新根。
> ⚠️ **插件复制源必须是「已迁移件树」而不是现役根**：本步骤刻意从 `$ASM/home/profiles/node_modules/**` 复制（`@local`、`dsh-taste`、`dsh-session-board`、`dsh-vision-adam`、`dsh-workspace-enhancement`）。RUNBOOK §2.3/§4.2/§4.4 早期版本的复制源曾写 `~/.dsh/profiles/node_modules`（**0.1.1 现役根**，其插件仍 import `installSettingsSection` ⇒ 在 0.2.0 上 import 失败）；**该缺陷已由协调者独立复核并修正**（见 `reports/OPTION-C-VERIFICATION.md` §7）。本档按**修正后**的源执行。
> ⚠️ 农场是**绝对符号链接**，指向 `$ASM/prefix-cli/...`。⇒ **`$ASM/prefix-cli` 必须长期保留**（禁止 `mv`/删除/对其执行 `npm i`）。若要把新根做成完全自包含，可用 `cp -a --dereference` 物化这些条目（约 +540 MB），属可选优化。

### C3 — 搬运 sidecar 与预设（源**只读**；**不搬运历史语料**）

```bash
cp -a ~/.dsh/taste/. "$NEWHOME/taste/"
cp -a ~/.dsh/btw/.   "$NEWHOME/btw/"
cp -a ~/.dsh/.agent-presets/. "$NEWHOME/.agent-presets/"
cp -a ~/.dsh/wallpapers/. "$NEWHOME/wallpapers/" 2>/dev/null || true
find "$NEWHOME/sessions" -mindepth 1 -print
ls -d "$NEWHOME/attachments" 2>/dev/null && echo "WARN: 新根出现了 attachments/" || echo "OK: 新根无 attachments/"
```

**预期**：`taste.md` = 17002 B；preset 两文件就位（13431 / 179）；`sessions/` 为空（`find` 无输出）；`OK: 新根无 attachments/`。

**明确不做（本形态的核心纪律）**：**不复制** `~/.dsh/sessions`、**不复制** `~/.dsh/attachments`（理由见 §3.2/§3.3：0.2.0 仅 3% 可读 ⇒ 只会造成「有条目打不开」与目录分叉；附件零引用 ⇒ 991 个孤儿对象 / 205 MB）。
若用户单独裁决了 **V-seed** 或**附件文件级搬运**，按 §3.3 的可选命令另做，并跑 §3.3 的三条验收。

> ⚠️ **`settings.yaml` 的投放次序（机制级，顺序不能反）**：0.1.7+ 的机制是「**读一次即改名，且不重试**」⇒ **必须先备好 profile patch（含 RUNBOOK §9 的 12 段处置），再投放 `settings.yaml`**；否则该段只留在改名的结果里、`settings.yaml` 不会被再次读取，**新实例的对应设置永久缺失且不报错**。
> 装配根已按此纪律做了**保留式暂存**：`$ASM/home/settings.yaml.import-source`（**252 行，刻意不命名为 `settings.yaml`**）。本档 C2/C3 **不投放**它 —— 即**默认新实例使用默认设置**；若用户要求继承现役设置，须由执行档在 **C2 与 C6 之间**插入 RUNBOOK §9 的逐段处置**之后**再投放（**投放后不可回退**：原文件会被改名）。

**随后立即跑 §3.4 的 sidecar 验收。**

**失败 ⇒ RB-D**（sidecar/preset 不完整，**或新根意外出现历史语料** ⇒ 停手、废弃新根、按 §3 重取）。

### C4 — 组合层干跑（离线、零模型请求、**不产生对外服务**）

```bash
env -i HOME="$NEWHOME" DSH_HOME="$NEWHOME" PATH=/usr/bin:/bin node "$CLI" --version
env -i HOME="$NEWHOME" DSH_HOME="$NEWHOME" PATH=/usr/bin:/bin node "$CLI" --profile web --dump-config | grep -c '^- id:'
```

**预期**：`0.2.0-rc.1`；条目数 **199**。
**失败 ⇒ RB-A**（组合未闭合 ⇒ 不要尝试启动；回 RUNBOOK §4 修组合后重跑 C2–C4）。

### C5 — 干跑形态启动（P-drill：netns 隔离 + 零凭据；**对用户不可见，属自检**）

```bash
rm -rf "$NEWHOME/logs"; mkdir -p "$NEWHOME/logs"
setsid unshare -rn env -i HOME="$NEWHOME" DSH_HOME="$NEWHOME" PATH=/usr/bin:/bin DSH_TELEMETRY_DISABLED=1 DSH_TELEMETRY_MODE=DISABLED bash -c "ip link set lo up 2>/dev/null; exec node '$CLI' --profile web --port $PORT_NEW --no-open" > "$NEWHOME/logs/drill-$PORT_NEW.log" 2>&1 &
sleep 15
```

**预期（本步的全部判据，逐条对照）**：

```bash
grep -c 'disabling profile plugin row' "$NEWHOME/logs/drill-$PORT_NEW.log"
grep -A3 'did not activate' "$NEWHOME/logs/drill-$PORT_NEW.log"
grep -o 'http://127.0.0.1:[0-9]*' "$NEWHOME/logs/drill-$PORT_NEW.log" | head -1
unshare -rn bash -c 'ip link set lo up 2>/dev/null; echo "routes: $(ip route | wc -l)"'
```

| 判据 | 预期 | 含义 |
|---|---|---|
| `disabling` 计数 | **0** | peer 闸门豁免生效（无豁免时为 6） |
| 未激活条目 | **恰好 2 条**：`vision-adam`、`session-status-board`（均 `failed to import`） | 属已知门禁 **N1**，不是本形态新引入 |
| URL | `http://127.0.0.1:3098` | 实例起来了（0.2.0 启动约 1–2 s） |
| netns 路由数 | **0** | 成功外呼在物理上不可能 |

```bash
TOKEN=$(grep -o 'token=[A-Za-z0-9_-]*' "$NEWHOME/logs/drill-$PORT_NEW.log" | head -1 | cut -d= -f2)
unshare -rn bash -c 'ip link set lo up 2>/dev/null; curl -s -o /dev/null -w "no-token: HTTP %{http_code}\n" "http://127.0.0.1:'"$PORT_NEW"'/"; curl -s -o /dev/null -w "with-token: HTTP %{http_code}\n" "http://127.0.0.1:'"$PORT_NEW"'/?token='"$TOKEN"'"'
```

**预期**：`no-token: HTTP 401`、`with-token: HTTP 303`（303 = 通过鉴权跳转）。
> **本步必须在与服务同一个 netns 内探活**（P-drill 用的是新 netns，宿主侧 `curl` 到 3098 会连接失败——这是**预期**，不是故障）。
> ⚠️ 上面取出的 `TOKEN` 是敏感值：**不得**写进文档、报告、截图或提交记录。

```bash
pkill -f "bin.js --profile web --port $PORT_NEW" ; sleep 3
node -e 'const net=require("net");const s=net.createServer();s.once("error",e=>{console.log("port "+process.argv[1]+" => "+e.code);process.exit(0)});s.listen(Number(process.argv[1]),"127.0.0.1",()=>{console.log("port "+process.argv[1]+" => FREE (停栈干净)");s.close()})' "$PORT_NEW"
```

**预期**：`port 3098 => FREE (停栈干净)`。
> **必须用 `setsid`**：只杀包装进程会留下**仍在 LISTEN 的孤儿**；`setsid` + 进程组 kill 才能干净停栈。

**失败 ⇒ RB-B**（干跑不通过 ⇒ 停栈 + 废弃新根；**绝不允许**带着未通过的干跑进入 C6 生产形态）。

### C6 — 生产形态启动（P-prod：**无 netns 隔离**，浏览器可达）

> **关键形态差异（本档的核心运行设计）**：`unshare -rn` 会新建 netns ⇒ 该 netns 里的服务**用户浏览器访问不到**（这正是干跑形态的设计目的）。
> 要让用户在 `http://127.0.0.1:3098/` 真正使用新实例，**必须去掉 `unshare`**（与 3080 同处宿主 netns）。
> 去掉 netns 后，**零外呼不再由网络层保证** ⇒ 由 **`env -i`（无环境凭据）+ 遥测 `DISABLED` + §4.7 的凭据面裁决**共同保证；这也是为什么 G12/G13 是硬闸门。

```bash
rm -rf "$NEWHOME/logs"; mkdir -p "$NEWHOME/logs"
setsid env -i HOME="$NEWHOME" DSH_HOME="$NEWHOME" PATH=/usr/bin:/bin DSH_TELEMETRY_DISABLED=1 DSH_TELEMETRY_MODE=DISABLED node "$CLI" --profile web --port "$PORT_NEW" --no-open > "$NEWHOME/logs/web-$PORT_NEW.log" 2>&1 &
sleep 20
```

**预期**：`$NEWHOME/logs/web-$PORT_NEW.log` 出现 URL 行 `http://127.0.0.1:3098/?token=<REDACTED>`；`disabling` 计数 0；未激活恰好 2 条。

```bash
grep -c 'disabling profile plugin row' "$NEWHOME/logs/web-$PORT_NEW.log"
grep -A3 'did not activate' "$NEWHOME/logs/web-$PORT_NEW.log"
grep -o 'http://127.0.0.1:[0-9]*' "$NEWHOME/logs/web-$PORT_NEW.log" | head -1
ls -la "$NEWHOME/logs/" | head
```

**正向证据（证明实例用的是新根，而不是回退真 home）**：`$NEWHOME/logs/` 下**必须有本次新生成的文件**（`dsh-host.jsonl` 等）。
**立即复核现役未被触碰**：

```bash
bash "$T19/witness.sh" | tee "$CUT/backup/witness-C6.txt"
diff "$CUT/backup/witness-BASELINE.txt" "$CUT/backup/witness-C6.txt"
sha256sum ~/.dsh/profiles/web/cordis.patch.yml
bash "$T19/manifest.sh" check "$CUT/backup/min-set-baseline.txt"
find ~/.dsh/sessions -name '*.zstd' | wc -l
find ~/.dsh/sessions -name 'session.v4.jsonl.zstd' | wc -l
```

**预期**：
- witness diff **只允许** W3/W3b（`sn`/`ts`/`bytes`）与 W6（会话计数）**单向增长**；**W1 inode、W2 HTTP 指纹、W4 pid 必须逐字符相同**；
- patch sha256 与 C1 记录**一致**；
- `manifest.sh check`：**`fail=0 missing=0`**；
- 会话数**非递减**；
- **`session.v4.jsonl.zstd` 命中数 = 0**（现役根内**不得出现任何 v4 文件**；出现即说明 0.2.0 曾对现役根执行 write-open）。

**失败 ⇒ RB-2（最严重）**：任何 W1/W2/W4 变化、或现役根出现 v4 文件 ⇒ **立刻停新实例**（`pkill -f "bin.js --profile web --port $PORT_NEW"`），**先取证后处置**，按 §5 的 RB-2 执行，并**中止**本次切换。

### C7 — 用户侧切流闸门（**需用户显式确认，才可跨越**）

```bash
echo "① 3080 与 3098 的 URL 分别是什么？② 新会话今后只在 3098 开，是否知悉？③ 3098 看不到历史、3080 看不到新会话，是否知悉？④ 遥测开关是否确认（§4.7）？⑤ 凭据面是否确认（§4.7）？⑥ §8 的代价清单与 §0.5 的待裁决项是否已读并知悉（功能减配、remoteHosts 消失、办公入口待裁决）？"
```

**跨越条件（六问全部「是」才可继续）**：用户在 3098 建**第一个真实新会话**。此前 0.2.0 侧没有任何真实数据，回滚成本 ≈ 一次 `mv`。
**在此之前不得对外宣称「已切换」**；本让步点就是本形态最大的可控性来源，不要提前跨过。

### C8 — 切换后短期观察（建议 T+30 分钟 / T+1 天各一次）

```bash
bash "$T19/witness.sh" | tee "$CUT/backup/witness-T+1d.txt"
diff "$CUT/backup/witness-BASELINE.txt" "$CUT/backup/witness-T+1d.txt"
find "$NEWHOME/sessions" -name '*.zstd' | wc -l
find ~/.dsh/sessions -name '*.zstd' | wc -l
find ~/.dsh/sessions -name 'session.v4.jsonl.zstd' | wc -l
```

**预期**：新根 `.zstd` 数随用户使用**增长**；现役根计数**非递减**；现役根 v4 命中仍为 **0**。
**失败 ⇒ RB-2 / RB-3**。

### 4.7 两个必须由用户裁决的开关（不得由 agent 默认代决）

| 开关 | 选项 | 影响 |
|---|---|---|
| **遥测**（N4） | `DSH_TELEMETRY_MODE=DISABLED`（本档默认） / `FEEDBACK_ONLY` / 接受默认外呼 | 0.2.0 新增**默认远端遥测外呼**、无 `enabled` 开关、**卸载/停实例时 drain**。选 `DISABLED` 保持零外呼纪律，代价是失去上游诊断面 |
| **模型凭据** | ① `cp -a ~/.dsh/.credentials.yaml "$NEWHOME/.credentials.yaml"`（`chmod 600`）——两处副本，需配套轮换纪律；② 启动时用环境变量注入 key——不出副本，但 key 出现在进程环境里；③ 在新实例 GUI 里重新录入 | 不注入 ⇒ 新实例**无模型能力**（只能看界面）。**两者都不产生对现役的写入** |

**裁决前不得启动 C6。**

---

## 5. 回滚

### 5.1 一键废弃新根（默认回滚动作）

```bash
pkill -f "bin.js --profile web --port $PORT_NEW" ; sleep 2
[ -d "$ROOT_020" ] && mv "$ROOT_020" "$ROOT_020.abandoned-$(date +%Y%m%d-%H%M%S)"
ls -d "$ROOT_020".abandoned-* 2>/dev/null
```

**为什么「一键」就够**：新根是**独立前缀 + 独立 home** 的产物，现役从未被写入 ⇒ **回滚不需要任何恢复动作**（这正是独立前缀的硬性理由：`npm i` 若装进同一前缀，会**就地覆盖 85 个不可手改重建的 patch 层文件**，且 `~/.dsh/profiles/node_modules` 的 496 条绝对符号链接会把两代文件混着解析）。
**纪律**：用 `mv` 不用 `rm`（留作取证）；废弃根**不得**再被启动。

### 5.2 回滚分支表（RB-0 … RB-K，**共 9 条**）

| 分支 | 触发条件（可判定） | 动作 | 验证 |
|---|---|---|---|
| **RB-0** | C1 基线不完整（任一基线文件缺失/为空） | 停手；禁止进入 C2 | 四份基线文件均非空 |
| **RB-A** | C2/C4 组合作废（条目数 ≠ 199、`--version` ≠ `0.2.0-rc.1`、农场/zod 缺失） | 停手；`mv` 废弃新根；按 RUNBOOK §4 重建组合后重跑 C2–C4 | `--dump-config` = 199 |
| **RB-B** | C5 干跑失败（`disabling`>0 / 未激活≠2 / 无 URL / HTTP 非 401·303 / 停栈后端口非 FREE） | 停栈（`pkill -f` + 端口 FREE 复核）；`mv` 废弃新根 | 端口 FREE；`witness` 与基线 diff 仅 W3/W6 |
| **RB-1** | C6 启动即 `EADDRINUSE` | **不改现役**；换 §2.2 备用端口重跑 C6 | 新端口能 bind；现役两行 LISTEN 仍在 |
| **RB-2**（最严重） | 「现役未受污染」判据被破：W1/W2/W4 任一变化、`manifest.sh check` 非 `fail=0 missing=0`、或 **现役根出现 `session.v4.jsonl.zstd`** | **立刻停新实例**；先取证（`cp -av` 现场到 `$CUT/backup/forensic-RB2/`）；若现役根确有 v4 文件或 patch 被改写 ⇒ 转 T19 场景 R2/R3/R5 序列；**中止**本次切换 | witness 逐行回到基线；`manifest.sh check` = `fail=0 missing=0`；patch sha256 == C1 记录 |
| **RB-D** | C3 搬运不完整（`taste.md` ≠ 17002、preset 缺失、**或新根意外出现历史语料**：`sessions/` 非空 / 存在 `attachments/`） | 停手；`mv` 废弃新根；按 §3.3/§3.4 重取 | §3.4 验收通过 + `sessions/` 为空 + 无 `attachments/` |
| **RB-P** | 插件面不达标（`disabling` > 0，或未激活 > 2 条，或出现 N1 之外的新失败插件） | 停新实例；回 C2 修 `compatibility.json`（**不改制品**）；重启复核 | `disabling` = 0 且未激活恰为 N1 两项 |
| **RB-3** | 端口面异常（3080 不再 LISTEN，或 3097 意外消失） | 停新实例；**不改现役**；按 T19 §7.5「W1/W2/W4 变化 ⇒ 立即中止并按 R7 回滚取证」 | 3080/3097 均 LISTEN；W1/W2 回到基线 |
| **RB-K** | 用户已在新实例写入真实新会话后要求**整体**回退到「单一实例」 | ① 停新实例；② **保留**废弃根为只读归档（**不删**）；③ 不得把新会话搬进 `~/.dsh/sessions`（见 §7）；④ 明确告知 **v4-only 新会话对 0.1.1 不可见** | 3080 仍 LISTEN；现役根 v4 命中 = 0；新会话归档可读 |

**回滚分支条数：RB-0 / RB-A / RB-B / RB-1 / RB-2 / RB-D / RB-P / RB-3 / RB-K = 9 条。**

### 5.3 「现役未受污染」判据（**三条判据 + 逐项命令**）

| # | 判据 | 命令 | 通过条件 |
|---|---|---|---|
| **P1** | **配置哈希** | `sha256sum ~/.dsh/profiles/web/cordis.patch.yml` | 与 C1 记录的 `patch-011.sha256` **逐字符相同**（当轮实测基线 `513413e7…`）。⚠️ `settings.yaml` 是活值，**只记录不作判据**，整根判定走 `manifest.sh check`（`fail=0 missing=0`） |
| **P2** | **端口** | `ss -ltn \| grep -E ':(3080\|3097) '` | 两行 LISTEN 仍在；且 W1 socket inode、W2 HTTP 指纹（status/bytes/sha256）**逐字符相同** |
| **P3** | **会话数非递减** | `find ~/.dsh/sessions -name '*.zstd' \| wc -l` | **非递减**（下降 ⇒ 有会话被删 ⇒ 立即转 R7）。**附加**：`find ~/.dsh/sessions -name 'session.v4.jsonl.zstd' \| wc -l` 必须 = **0**（现役根内不得出现任何 0.2.0 发布的后继代） |

**补充判据（同样可判定）**：
- **P4 无越界写入**：`bash "$T19/manifest.sh" check "$CUT/backup/min-set-baseline.txt"` ⇒ `fail=0 missing=0`；
- **P5 日志世代**：W3/W3b 的 `sn` **只涨不降**（出现更小的 `sn` ⇒ 宿主进程换代 ⇒ 说明现役被重启过）；
- **P6 会话树字节**：`sessions-baseline.txt` 与当前 `sha256sum` 清单 **diff 仅允许「新增文件」**（活跃写入的期望行为），**不允许出现「内容改变」或「删除」**。

> **`ps` 一律不可用**：本沙箱以 `bwrap --unshare-pid` 启动 ⇒ 库内 `/proc` 是新建的、宿主进程树不可见，`ps -p <宿主 pid>` 必然 `NO_SUCH_PID`。**这不是工具坏，是 namespace 语义**（`/proc/net/*` 是网络 namespace 视图故 socket 可见，进程表是 PID namespace 视图故不可见）。

---

## 6. 逐项验收清单

> **验收层级纪律**：`单元/机制 PASS` **不得**上推为 `目标 PASS`，更不得上推为「发布准入」或「切换授权」。五层必须分开写：**隔离证据 / 机制 PASS / 目标 PASS / 发布准入 / 切换授权**。

| # | 判据 | 命令/方法 | 通过条件 |
|---|---|---|---|
| **V1** | 组合可解析 | C4 | 条目数 = **199** |
| **V2** | 新实例可启动 | C6 | 日志内 URL 已发放（`http://127.0.0.1:3098`） |
| **V3** | peer 闸门清零 | C6 | `disabling profile plugin row` = **0** |
| **V4** | 插件加载 | C6 | 未激活 **≤ 2** 且**恰为** `vision-adam`、`session-status-board`（N1 的 2 项）；**无第三项** |
| **V5** | HTTP 可达 | C5（干跑 netns 内） | `401` → 带 token `303` |
| **V6** | 停栈干净 | C5 收尾 | 端口 `FREE` |
| **V7** | **现役未受污染** | §5.3 P1–P6 | 全部通过（含 patch 哈希相同、3080/3097 仍 LISTEN、会话数非递减、`session.v4` 命中 = 0） |
| **V8** | 现役配置未被改写 | §5.3 P1 | `manifest.sh check` = `fail=0 missing=0` |
| **V9** | **历史会话在 3080 仍可打开** | **用户操作**：在 `http://127.0.0.1:3080/` 打开若干既有会话（建议跨工作区各取 1 个、并包含至少 1 个带图片的会话） | 可列出、**可打开、可渲染正文**；带图会话图片正常显示（证明附件面未被动过）。**这是本形态的第一验收项** |
| **V10** | 历史侧会话数非递减 | §5.3 P3 | 非递减 |
| **V11** | 现役根未出现 0.2.0 产物 | `find ~/.dsh/sessions -name 'session.v4.jsonl.zstd' \| wc -l` | **= 0** |
| **V12** | 新实例会话落盘 | 用户建 1 个新会话后 `find "$NEWHOME/sessions" -name '*.zstd' \| wc -l` | **≥ 1**（相对 C3 的空根为增长） |
| **V13** | 新会话确实走新根 | `ls "$NEWHOME/sessions"` 有内容 + `~/.dsh/sessions` 无新增 v4 | 两侧一致（新写入只落新根） |
| **V14** | 附件面完整 | §3.3 三条验收 | 无 `MISMATCH`/`ONLY-IN-DST`；对象名==内容哈希；对象数/体积符合预期 |
| **V15** | sidecar 就位 | §3.4 两条命令 | `taste.md` = 17002 且两侧 sha256 相同；preset 两文件存在 |
| **V16** | preset 生效（**G11 缺口**） | 用户在新实例建 1 个会话后，读该会话头部字段 `agentPreset` | 期望 = `standard-glm`（**不是**官方 `standard`）。**未通过即视为「定制未生效」**，按 E1/E2 口径不得宣称两侧行为一致。⚠️ 配置层三层已修（§0.6：`prefix` 已改、非法包已移、目录已就位、`--dump-config` rc=0/199），**但运行时激活仍未验证 ⇒ 本条不可省** |
| **V17** | 零外呼（生产形态） | ① 遥测 `DISABLED` 已设置；② 新根无 `.env`、`grep -c 'API_KEY' "$NEWHOME/.credentials.yaml"` 与用户裁决一致；③ 日志中**无** `llm/retry` / `llm/retry-started` / `session/title`（成功）事件 | 三条同时成立。⚠️ `session/title-llm-request` 只表示「请求已**装配**」而**非**「已发出」，**不得**当作外呼证据 |
| **V18** | 已知门禁仍被标注为未闭 | 人工核对 | N1/N2/N3/N10/N16 等**必须在结论里显式列为未闭**，不得包装为通过 |
| **V19** | 用户告知已完成 | 人工核对 | 已明确告知：① 历史只在 3080；② 新会话只在 3098；③ 两侧列表互不可见；④ 本形态不解决 N17，只是延后 |
| **V20** | **新根不含历史语料**（用户裁决的数据面纪律） | `find "$NEWHOME/sessions" -mindepth 1 -print \| head` + `ls -d "$NEWHOME/attachments"` | `sessions/` **为空**（或不存在）、**无 `attachments/`**、`~/.dsh/sessions` 的会话数**未因本流程减少**。**任一不符 ⇒ 转 RB-D** |
| **V21** | **待裁决/待办项已登记，且未被当作已闭** | 人工核对 §0.5 与 §8 | 至少逐条登记：`remoteHosts` 回归（**待用户裁决是否找回**）、办公入口 **A/B/C/D 待裁决**、(b2) 报 issue 待裁决、插件 settings 断层阻塞 3 个。**不得**在结论里把其中任何一项包装为已解决 |

> **V9 为什么必须单列**：它把「数据无损」与「历史可用」两件事分开证。本形态的**唯一承诺**是「历史在 0.1.1 侧 100% 可用」，若这一条不成立，整个 (c) 方案就没有意义。
> **V16 为什么必须单列**：G11 已实测「assembly 根缺 `.agent-presets` 却仍能启动」⇒ **「起来了」与「定制生效了」在 0.2.0 上彻底脱钩**（评估报告 E1/E2）。没有 V16 就无法排除「新实例其实跑的是官方 standard」。

---

## 7. 明确禁止项

**对现役（`~/.dsh`、3080）：**

1. **不得自动停止、重启、升级或以任何方式改动现役实例**（含 `pkill`、`kill`、`systemctl`、端口重绑）。
2. **不得对现役根执行任何写操作**（含 `npm i -g` 到 `~/.npm-global`；含新增/删除 `.dsh-module-fallback`；含手动清理 `session.lock`）。
3. **不得把 `DSH_HOME`（或 `HOME`）指向 `~/.dsh`**。这会让 0.2.0 在现役会话根上取锁并发布 v4 后继代 —— 直接摧毁本形态的立论。
   - 亦**不得**用 profile patch 把 `session-persistence-jsonl.config.root` 单独指到现役 `sessions` 根（T21 §8-1 指出这是理论上唯一能绕过 `DSH_HOME` 的入口，**未实测**）——**禁止使用该入口**。
4. **不得用 `ps` 判定任何存活/未污染结论**（PID namespace 语义使该判据恒假）；**不得**把 `unshare -rn` 内的端口探测结果外推到宿主 netns。

**对会话数据（两侧都适用）：**

5. **不得改写任何真实会话**：禁止批量修改 `subagent/descriptor` 的 `version`、禁止映射 `text-chunks`/`reasoning-chunks`/`tool-call-chunks`、禁止删除「不可读」的会话、禁止重建索引。（这些属**产品级数据改写**，必须由用户单独裁决，且本形态**不需要**它们。）
6. **不得对现役会话根使用 `cp -al`（硬链接）做「零成本快照」**：副本与源**共享 inode**，0.2.0 的写打开发布后继 + append 会**写到源文件里**（POSIX 追加不更新 inode），直接破坏现役数据。
7. **不得把 0.2.0 写出的 `session.v4.jsonl.zstd`（或任何 v4-only 会话）搬进 `~/.dsh/sessions`**：0.1.1 只认固定文件名 `session.jsonl.zstd`，搬进去既不可见又制造双代目录 ⇒ 触发「最高代遮蔽」的静默数据丢失风险（真实库已发生 1 例）。
8. **不得把 `~/.dsh-017/sessions` 复制进任何一侧根**（第三个写入方 ⇒ 第四条数据血缘）。
9. **不得把历史语料复制回 0.2.0 新根**：含 `~/.dsh/sessions`、`~/.dsh/attachments`，以及 `.workspace/audit-020/n17-evidence/{sessions-copy,attachments-copy}` 这两份**证据快照**。**`n17-evidence/` 是取证件，不是数据源**——只能读、不得作为任何实例的根，也不得复制回任何实例（用户裁决：新根不承载历史语料，理由见 §3.2）。
10. **不得在报告/文档/截图/提交中出现**：会话正文、会话 id、cwd 明文、token、密钥。

**对本文档与流程：**

11. **不得把本档当作「已授权切换」**：用户已裁决**路径 (c)**，但**执行切换仍需用户显式授权**（授权的是动作，不是路径）；C7 的六问必须逐条得到「是」。
12. **不得在 V9/V16 未通过时对外宣称「迁移完成」「旧会话可用」「定制已生效」**。
13. **不得把「服务起来了」当作切换成功的判据**（E1 静默禁用 + E2 非致命 `auditStartupEntries` 叠加的后果）。
14. **不得把 `--dump-config-schema` 的退出码当作配置校验/启动失败判据**（两版都恒 `exit 1`，N5）。
15. **不得对新根执行 `git add` / `git commit`**（G16：新根落在未被 `.gitignore` 忽略的路径下）。
16. **不得把 §0.5 的待裁决项当成已闭**（`remoteHosts` 回归、办公入口 A/B/C/D、(b2) 报 issue、3 个插件的 settings 断层）。

---

## 8. 该形态的已知代价（诚实清单）

> 这些不是「待修复缺陷」，而是**选择 (c) 就必须长期承担的结构性成本**。向用户报备时不得省略。

1. **运维面翻倍且长期不同源**：两套实例、两套根、两套日志、两套 patch/插件树。现役 patch 与 0.2.0 patch 是**不同内容**（现役 123 行 vs 迁移组合 636 行，sha256 不同，已实测），两棵树今后各自演化 ⇒ **每一次修 bug、加插件、改配置都要做两遍**，且极易漂移。
2. **用户必须记住「去哪一侧」**：历史在 3080、新会话在 3098；两侧**列表互不可见**、**无跨实例检索/引用/交接**。这是本形态最直接、每天都要付的税；对多会话、长周期工作流尤其明显。
3. **子代理路由回归（N2 / T13）**：现役的「subagent 默认模型 = settings 段」是**73 行本地宿主补丁**，上游两树均无此逻辑 ⇒ **0.2.0 全新安装不继承**。若不重新施加补丁，两侧子代理行为**不一致**；若采用降级方案 B（preset 静态 `agentOptions`），则路由**被钉死**、设置页热切换能力丢失。**「同一部署两种行为」是长期隐患。**
4. **插件侧仍待改造，新实例功能面弱于现役**：settings 断层**只阻塞 3 个**插件（`dsh-subagent-model`、`dsh-session-board`、`dsh-vision-adam`；启动实测 2 条未激活）；**N10 已裁定采纳方案 B**（丢弃钉死 0.1.1 的私有依赖岛）⇒ 必须支付「丢岛 + 满足 0.2.0 新契约」的改造成本，**保留旧岛不是保守而是半吊子**；**N16**（`@local/dsh-btw` 需 21 个改造单元）。⇒ 新工作台将是**功能减配版**，用户会在两侧感到能力差异。**且不得把 import 通过当作功能通过**（RUNBOOK 附三.3 口径纪律）。
5. **`remoteHosts` 回归 —— 侧栏「分布式节点」树在 0.2.0 静默消失（⏳ 待用户裁决是否找回）**：实测官方 `dsh-client-ui-workspace` 的槽位契约在 **0.1.1 有 2 hits / 0.2.0 有 0 hits**（`lib/types/client/contract/slots.d.ts`、`lib/client.js`）；现役本地插件 `@local/dsh-ssh-gui` 另有 **2 处**引用（`lib/client.js`、`README.md`）。⇒ 该 UI 面在新侧**不存在**，且**不会**在启动日志报错（E1/E2 型静默失效）。**找回成本与是否值得找回，需用户裁决。**
6. **办公入口 Route A 失效（⏳ 待裁决：A/B/C/D 四选一）**：0.2.0 上办公入口不可用（N11），断点同样存在于 0.1.7；四条候选路径的证据与代价见 `reports/T15-office-feature-020.md`。
7. **上下文边界（N16 修正后仍成立的三条）**：`Session.events` 删除、`ISessions` 保留模型差异、`session/prompt-image-transform` 消失 —— 这三条是 0.2.0 新引入的，客户端插件必须改。
8. **不解决 N17，只是延后**：本形态把「90.6%–97% 历史不可读」从**风险**变成**架构约束**。未来若要真正统一到 0.2.0，仍要面对两道硬闸；届时的选项仍是 (b)/(b1)/(b2)。**若 (b2) 不推进（周知 issue 未提交），这个并存态就是无限期的。**
9. **遥测与凭据的两难（N4）**：0.2.0 默认远端遥测外呼且**无开关**、停实例时 drain ⇒ 生产形态要么长期 `DISABLED`（失去上游诊断面），要么接受外呼（破坏零外呼纪律）。凭据面同理：文件副本 route 会**多出一份密钥副本**，环境变量 route 会把 key 放进进程环境。
10. **磁盘与复制成本（本形态已显著降低，但仍非零）**：新根 = 组合层（约 291 条符号链接指向共享前缀，**+0**）+ sidecar（taste/btw/preset，KB 级）。**不复制会话根（省 ≈1.1 GiB）**、**不复制附件（省 205 MB / 991 对象）**——这是「新根不承载历史语料」顺带省下的。另：为验证而生的证据快照 `n17-evidence/`（2460 日志 + 附件副本）仍需 **≈1.4 GB** 磁盘，属取证件、需显式决定保留期限。若追求自包含前缀，再 **+540 MB**。
11. **沙箱/宿主布局双源**：新根必须在工作区内（家目录不可写）⇒ `DSH_HOME` 落在 **git 工作树内**（且未被忽略）；真实宿主 shell 需换成家目录布局 ⇒ **两处命令不同源**，文档与脚本必须同时维护。
12. **3097 作为第三套实例的附加成本**：见 §0.4（建议设期限）。它还是「两个 home 不同构」的假阳性来源（无 `settings.yaml`、引用已不存在的 `dsh-vision-adam`）。
13. **版本面风险**：目标仍是 **RC**（`0.2.0-rc.1`，无稳定 0.2.0）。并存期越长，两实例的版本差越大，行为/格式差异面越可能再次变化（0.2.0 的 chunk 位置迁移已经证明上游会做这类破坏性搬移）。
14. **`power` 面事实**：本形态**不减少**当前任何工作量；它把「迁移」拆成「长期并存」。**若用户真实目标是尽快单一实例化，则 (c) 是权宜之计，不是终点。**

---

## 9. 未验证边界与诚实标注

1. **本档未执行任何切换动作**：本档全程只读（除在 `.workspace/**` 内落盘本文件）。C1–C8 的命令**未由本档执行**——仅执行了 G 系列中的只读探测与 §2.2 的端口 bind-only 探针；**本档未启动、未停止任何实例**。
   ✅ **但该形态的冷启动面已被协调者轨道独立执行过一次**（空历史根：`disabling=0`、URL 发放、未激活 2 条、**`sessions/` 惰性创建**、停栈 FREE、现役逐位未污染）——见 **§0.6**。⇒ 本档的预期值**不是纸面推算**，而是与实际冷启动结果**逐项一致**；**但**那一次不等价于正式切换（根/端口/凭据面需按 §4 重做）。
   ⚠️ **时点说明**：本审计项目有多条并行轨道，**同期有其他轨道在隔离根上做启动演练**（boot 日志落在 `assembly-020/logs/` 下）——那**不是本档的动作**，不得据此认为「本档已执行切换」。
2. **0.1.1 侧可读性是协调者实测，不是本档实测**：§0.2 的双向对照（22.8 MB / 82 430 行 → 65 145 打包行 / 1 364 372 事件，零错误）由**协调者**跑出，本档**引用**之。它把「0.1.1 必然能读」从结构推断升级为实测结论，但**本档未独立复跑**。
3. **未跑通 0.2.0 的端到端读路径**：真实 `open(id)` 打开老会话**未被验证**（受零模型请求与不触碰现役约束）。N17 用的是**迁移链自身的校验器**（与读路径同源）。⇒ **不得**把「3.0% / 60.0%」当作「已实测的界面打开率」；它是**校验器口径**。
4. **3%/60%/40% 的抽样口径**：200 份取自 `find` **字典序前 200**（有偏），另有 120 份 mtime 均匀抽样（`PASS 3 / FAIL 117`）两次一致；全库精确占比以**全量扫描**为准（`descriptor v2 = 2229 / v3 = 0`）。chunk 类拒因占比**不可**用 22.5% 外推。
5. **V9 未实测**：其前提（0.1.1 能完整读本代 v0）**已有 §0.2 的实测支持**，但**GUI 层「打开并渲染」这一步未由本档实跑**（需用户操作）。
6. **V16（preset 生效）未实测**：**装配根的 `.agent-presets/` 已就位**（定稿时点实测：`standard-glm/agent.cordis.yml` 13431 B + `preset.yml` 179 B；本档初稿撰写时点其尚**不存在**，而当时实例**仍能启动且仅 2 条未激活**）⇒ 两条事实同时成立：① **缺 preset 不阻断启动**；② **就位 ≠ 生效**。因此 `default: standard-glm` 的**实际生效面仍未校验**，V16 是唯一判据（读新会话头部 `agentPreset`）。N3 的三层问题（`config.text:` → `prefix`、`dsh-workflow-worker-thread` 停发、`agentOptions.model` 与 settings 段不一致）中，本档实测到的是：迁移组合的 `agent-preset-registry` 条目**只有 `config.default`**，而 preset 文件里的 `text:` 出现在 `persona` 条目（第 27 行），**两者不是同一处** ⇒ **具体修法需由执行档按 N3 的原文核定**。
7. **`zod` 跨代依赖**：assembly 根实测为「→ 现役 profile → 0.1.1 前缀（4.6.2）」；0.2.0 前缀自带 4.6.5。C2 已给出切断命令，但**该命令本身未实测**（本轮不得写新根）。
8. **`storages/` 面未判定**：`usage.db`（72 MB WAL SQLite）、`workspace.json`、`message_feedback.json` 在 0.2.0 的兼容性属其他数据面，T21 只清点未判定。本档的处理是「**不迁移、由新实例自建**」，因此**新实例的用量统计从零开始**（副作用：用户会看到两边统计不一致）。
9. **端口/可达性的 netns 前提**：本档断言「普通 bash 调用与用户浏览器同处宿主 netns」（依据：3080/3097 在库内 `ss` 可见）。若实际部署中用户浏览器与 agent 命令**不在**同一 netns，则 C6 的形态需改为显式端口转发或绑定地址调整 —— **未实测**。
10. **`--dump-config` = 199 与「6 条豁免生效」**均为 assembly 根上的实测值；`$NEWHOME` 是**新根**，其 199 需在 C4 现场重取（不得引用 assembly 的历史值）。
11. **`settings.yaml` 迁移面（C2 未覆盖）**：0.1.7+ 起 `settings.yaml` **只被读一次随即改名，且不重试**（装配根内可见保留式暂存件 `settings.yaml.import-source`，**252 行**，**刻意不命名为 `settings.yaml`** ⇒ 该路径已被规划、且次序纪律已被遵守），且 settings 命名空间**取 profile 插件条目 id**（不再取 YAML 段名），未知段/未知 target **一律 warn + skip，从不报错 ⇒ 静默丢失**。本档的 C2 **只搬运 profile 层、不投放 `settings.yaml`**，**未包含逐段搬运**（12 段处置表见 RUNBOOK §9）⇒ **这是本档的一处显式缺口**：若用户要求新实例的 UI/主题/工作区/SSH/子代理等设置与现役一致，必须在 **C2 与 C6 之间先做 §9 逐段处置、再投放**（顺序不可反，见 §4-C3 的机制警示）；**默认（不投放）意味着新实例使用默认设置**。
12. **附件「默认不复制」是本档给出的结论**（依据 §3.3 的零引用推理 + 协调者已执行同方向动作），但**尚未由执行档实测验证**：若实际使用中出现「新实例需要解析历史 `attachmentId`」的场景（例如 V-seed 或文件级搬运），**必须回补 §3.3 的可选复制**，否则会得到 `ATTACHMENT_NOT_FOUND`。
13. **本档不含会话正文、密钥、原始会话 id**；所有 token 均以 `<REDACTED>` 形式引用。

---

## 10. 与既有文档的关系（引用索引）

| 文档 | 本档复用的部分 |
|---|---|
| `RUNBOOK-020.md` | §0 变量与隔离根理由；§1 前置闸门骨架；§2 现役备份；§3 安装（本档复用 `assembly-020` 已装前缀，未重装）；§3.2 运行时/原生面结论；§4 组合组装；§5 组合层三处差异；§6 peer 豁免；§7 启动/验收/停栈/零外呼；§9 settings 逐段处置表（**本档未含，见 §9-10**）；§11 V1–V12；§12 回滚；§13 故障排查；附二 T19 实测补充；**附三 阶段二已裁定事项**（N10 方案 B「丢岛」、N12 taste 图标已闭环、口径纪律 —— **不得重开**，本档 §4-C2 与 §8-4 已采纳） |
| `reports/MIGRATION-ASSESSMENT.md` | N1–N17（尤其 **N17 与 (c)**、N2/N3/N4/N10/N16）；§3.1 契约回归（E1–E4）；§4 迁移面 9 条；E1/E2 两条「更安静的启动语义变化」 |
| `reports/T19-rollback-and-backup-plan.md` | §6.2 场景表 R1–R7、§6.3 四条纪律；§7.2 七组见证判据、§7.3 `settings.yaml` 活值警告、§7.5 迁移期纪律；附二 patch 层真实根（85 个文件不可重建）、会话 `tar` 安全、`integrity_check` 抓不到静默丢数据 |
| `reports/T21-session-data-migration.md` | §1.1 规模、§1.2 四条结论、§4.1 零转换整根复制、§4.4 禁用 `cp -al`、§5 冻结基线与无损判据、**§7 附件面（布局同形 / `storeMissing=0`）**、§9 裁决建议 |
| `reports/T05-session-format-delta.md` | §1-5 旧会话可读性（90.8% 被拒）；§1-8 双代目录真实数据丢失实例；§1-9 读打开不落盘/写打开才发布；§1-10「**不建议**让 0.2.0 以写方式打开 0.1.1 会话」；§2.5 0.1.7 同墙实证；§7 三类只读预检 |
| `reports/T22-zero-model-operability.md` | 零外呼两条红线（`env -i` 与 netns 的关系、`.env` 供 key、`TRANSPORT` 重试） |
| `reports/T27-npm-offline-packaging.md` / `iso-020/**` | 离线重建与一键验收（本档未使用，仅在需重建前缀时引用） |
| `.workspace/audit-020/n17-evidence/`（**取证件，非数据源**） | 协调者从新根**移出**的历史语料快照：`sessions-copy/`（2460 份日志）+ `attachments-copy/`（205 MB），合计 ≈**1.4 GB**。用途：**只读取证**。**禁止**作为任何实例的根、**禁止**复制回任何实例（§7-9）；其保留期限需显式决定（§8-10） |
| `.workspace/audit-020/reports/OPTION-C-VERIFICATION.md`（**协调者轨道记录**） | (c) 形态的**冷启动验收记录**（空历史根：`disabling=0` / URL / 未激活 2 / `sessions/` 惰性创建 / 停栈 FREE / 现役未污染）、**四项缺陷修复**（zod 4.6.5、`.agent-presets` 迁入、`persona.config.text → prefix`、移除已停发包）、**生产形态须去掉 `unshare -rn`**、**`settings.yaml` 保留式暂存纪律**、以及**Runbook 插件复制源缺陷（现役根 → 已迁移件树）的独立复核**。本档 §0.6 / G11 / V16 / C2 / C3 / §9 引用之 |
| `.workspace/audit-020/assembly-020/`（**隔离组合，只读复用**） | 已实测可运行的 0.2.0 组合：`prefix-cli`（`--version` = `0.2.0-rc.1`）、`home/profiles/web/**`（199 条目组合 + 6 条 peer 豁免）、`boot-web.sh`。本档 C2 从中提升组合层；其 `home/` 已**不含 `sessions/` 与 `attachments/`**（历史语料已移出至 `n17-evidence/`） |

---

*本档是路径 (c) 的正式预案，但**只准备、不执行**：路径已裁决，**执行未授权**。任何一行命令的执行都需要用户的显式授权；切换授权与「本档存在」是两件事。*
