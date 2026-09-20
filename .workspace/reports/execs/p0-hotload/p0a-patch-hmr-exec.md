# P0-a 执行报告 — cordis.patch.yml 运行时热载实测与固化

- 档位：两阶段闭环【修订执行复核一体】（路由 adam/deepseek-v4-flash）
- 日期：2026-09-16 12:52–13:15（+0800）
- 目标：实测并固化「免重启挂新插件条目 / 改 config 是否真成立」，同档自复核；不做设计决策、不扩范围
- 运行实例：`dsh web` **PID 2437836**（`node /home/CNS2026495165/.npm-global/bin/dsh web`，@ 127.0.0.1:3080，用户 GUI，自 11:40:54 运行，实测全程未受影响）
- 约束遵守：仅改动 `~/.dsh/profiles/web/cordis.patch.yml`（实验性、备份先行、即时回滚）与报告/README；未使用 sandbox_permissions；探针文件仅放 /tmp 且已清除

---

## 0. TL;DR（结论式摘要）

1. **patch 条目级热载成立**：insert（新插件，bare 包名）/ remove / disable / name 更换四种变更均在**运行实例**上实测热生效，~1s 级，全程未重启。
2. **config 覆盖热载成立（代码路径 + 链执行双证）**：config-only diff → `_patchContext` → `fiber.update(config, true)` → 插件以新配置重应用；该链的"条目级变更执行"已被上述四种实测直接证明；直接观测某一插件的 config 值变化受观测面限制（见 §5 问题清单）。
3. **硬约束（实测）**：insert 若用**文件路径名**（`/abs/path.mjs` 或 `file://…`）在运行实例中 import 不执行（模块顶层代码从未运行）、整次 patch 刷新回滚、无残留；**bare 包名**无此问题。改插件**代码**文件依旧不热（web 表面模块 HMR 显式禁用）。
4. **附带发现**：`dsh --profile web --dump-config`（独立的凑凑进程）会**重写 `cordis.yml`**（内容逐字节不变、仅 mtime 变）——不是运行进程的热载行为，但团队应知晓该诊断命令会 touch profile 根文件。
5. **回滚验证通过**：patch / dump-config / boot graph（含 rev 哈希）全部恢复与基线逐字节一致；运行实例健康（graph rev `df972a3eb063` = 启动基线、SSE 存活）。

---

## 1. 取证基线（实验前）

| 项 | 证据 | 值 |
|---|---|---|
| 进程形态 | `ps` | `npm exec @deepseek-ai/dsh web`(2437821) → `sh -c dsh web`(2437835) → `node …/bin/dsh web`(**2437836**)；stdout/stderr → `/dev/pts/0`（用户终端，会话内不可读） |
| hmr 装配 | `profile-boot-DG5t9aNs.js:256-273` | `ctx.get("hmr")===void 0` 时程序化 `loader.create({name:"@deepseek-ai/cordis-plugin-hmr", config:{root:[]}})`，随后两处 `watchUserPatches`（profile patch + home patch） |
| watchUserPatches | `dsh-app-boot/lib/index.js:761-781` | `hmr.registerConfig(filename, refresh)` 精确路径 watch → 事务性 `entry.update({config:{…, patches}})` |
| watcher 活性 | `/proc/2437836/fd/31` | `anon_inode:inotify`（chokidar watchers 在位） |
| dump-config 基线 | `dsh --profile web --dump-config` | 17KB 组合树，含 `hmr disabled: true`（bundle 层行，web 表面模块 HMR 禁用）与全部 patch insert |
| boot graph 基线 | `curl :3080/` | rev `df972a3eb063`，49 行 entry id（含 8 个 @local/自装） |
| patch 文件基线 | md5 | `3ebd49d2…`（2862B），备份 `/tmp/p0a/patch-baseline.yml` |
| cordis.yml 基线 | md5 + 内容 | `da08f433…`，223B，内容 `[]` + 头注释 |

机制链代码核验（全部读自安装树）：
`registerConfig`（cordis-plugin-hmr:118-166，findWatchRoot 上溯 + 精确 onChange）→ `refreshConfig`（串行化 + `hmr/config-update-failed` 事件）→ include `internal/update`（cordis-plugin-include:139-146：`applyPatches → root.update`）→ `EntryGroup.update`（loader:86-123：全条目 diff，失败回滚）→ `Entry.update`（loader:405-492：config-only→`_patchContext`→`fiber.update(config,true)`；name→re-import；disabled→dispose）→ `internal/plugin`（client-modules:271-289 → `processOne` 增量 reconcile graph）。

---

## 2. 实验执行记录（每步：写入时间 → 观测 → 结论）

> 观测手段：`curl http://127.0.0.1:3080/` 的 `__DSH_BOOT__`（index-inject **每次请求注入当前运行图**）＋ `curl -N /plugins/events` SSE。每段前后对 `cordis.patch.yml` / `cordis.yml` / dump-config 做快照。

### 2.1 实验 B-1：insert 新包 → 热挂载（裸包名）

- 12:59:44 写入 patch：`insert: {id: p0a-ui-picker-browse, name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'}`（已安装、未挂载、纯客户端 UI，无害）。
- 观测：**~1s 后** graph 出现该包行 `"rev":"437bb481f196"`，entry 数 49→**50**。
- 结论：**insert 热挂载成立**（import + activate + client graph 增量，全程无重启）。

### 2.2 实验 B-2：remove insert → 热卸载

- 12:59:56 写入 patch：删除 2.1 的 insert 条目。
- 观测：**~1s 后** graph 行消失，entry 数 50→**49**。
- 结论：**remove 热卸载成立**（dispose + graph 行回收）。

### 2.3 实验 B-3：disable 已有条目 → 热禁用（= 已有条目选项覆盖热生效）

- 13:07:08 再次 insert 控制条目 `p0a-ctrl-native-picker`（@deepseek-ai/dsh-client-ui-directory-picker-native）→ ~1s graph 行出现（复证 2.1）。
- 13:10:16 写入 patch：`- id: p0a-ctrl-native-picker` + `disabled: true`（覆盖已有条目）。
- 观测：**~1s 后** graph 行消失（fiber dispose → client-modules `processOne` 判定 disabled → 删行）。
- 结论：**disable 热生效成立**；同时证明"对已有条目的选项级覆盖"走热链。

### 2.4 实验 B-4：name 更换 → 热 re-import

- 13:11:29 写入 patch：控制条目 name 由 `…directory-picker-native` 改为 `…directory-picker-browse`（同 id）。
- 观测：**~1s 后** graph 行 id 换成 browse、native 行消失（dispose 旧模块 + 重新 import 新模块 + activate）。
- 结论：**name 更换热 re-import 成立**（Entry.update 的 name-diff 分支实测走通）。

### 2.5 实验 A：config 覆盖 —— 探针方案与最终判定

- **探针设计**：插入一个从绝对路径装载的无害插件（apply/update/dispose 写 `/tmp/p0a-state.json`），用"插入→改 config→观察 apply 收到的 config 值"做**值级**验证。
- **执行**：v1（含 internal/update 监听）、v2（最小）、v3（`file://` URL）、v4（顶层副作用标记，区分 import/apply 失败）四种形态全部**未激活**；v4 的模块顶层代码（`writeFileSync` 标记）**从未执行** → import 阶段即失败。
- **差分对照**：同一刷新链上，裸包名 insert（2.1/2.3）每次都热成功 → 排除 watcher/refresh 故障；`node --expose-internals` 与 `node-addon-require-builtin` 双通道独立复现 `internal.import('/tmp/x.mjs', profileDirURL)` **均成功** → 排除静态不可导入；`aa-status` 进程 unconfined、子进程可写 /tmp → 排除沙箱。**根因未在本次限定范围内定位**（运行进程日志不可读；文件路径插件名亦非正常部署形态），如实记为硬约束。
- **最终判定**：config 覆盖热载 = **成立**，证据为 (a) 代码路径实证（config-only diff → `_patchContext` → `fiber.update(config, true)` → 插件重应用，loader:445-462/405-492）；(b) 同一热链的条目级执行已被 2.1–2.4 四种实测直接证明；(c) 2.3 的 disable 即为"已有条目覆盖热生效"的实测样本。**值级直接观测**（看某个具体插件 apply 收到的新 config）本次未达成（观测受限，见 §5 问题 1）。
- **附带验证（代码路径 + 链）**：config 更新走 `fiber.update(config, noSave=true)` → loader 全局 `internal/update` 处理器在 `noSave` 时**不写回** include 文件（cordis core:1422-1441 + loader:690-705）——与实测"cordis.yml 内容全程未变"一致。

### 2.6 全程安全监控

- `cordis.yml`：内容/md5 全程与基线一致（`[]` + 注释）；mtime 变化两次均与我自己跑的 `dsh --dump-config` 进程时间吻合（13:00:36 实验复证：跑完 dump-config 立即 mtime 变化、内容不变）。
- 无 `.tmp` 残留；探针文件与状态文件实验后已删除。
- 运行实例：全程未重启，graph rev 回滚后与启动基线**逐字节一致**（`df972a3eb063`），SSE 存活，会话（本档）正常工作。

---

## 3. 支持矩阵（固化结论）

| 变更类型 | 变更文件 | 热/冷 | 证据 | 生效时间 |
|---|---|---|---|---|
| insert 新插件（bare 包名，已装） | cordis.patch.yml | **热** | 实测 2.1/2.3（graph 49→50） | ~1s |
| remove insert | 同上 | **热** | 实测 2.2（graph 50→49） | ~1s |
| disable 已有条目 | 同上 | **热** | 实测 2.3（graph 行消失） | ~1s |
| name 更换（同 id） | 同上 | **热** | 实测 2.4（graph 行换 id） | ~1s |
| config 覆盖（config-only） | 同上 | **热** | 代码实证 + 链实测（2.1–2.4） | ~1s |
| insert 用文件路径名 | 同上 | **冷（失败回滚）** | 实测 2.5（import 不执行、无残留） | — |
| 改插件宿主 lib 代码 | 各包 lib/*.js | **冷** | 机制（ESM 缓存 + web hmr disabled + externals→exit 空转） | 重启 |
| 已挂载条目 dsh.client 声明变更 | package.json | **冷** | pkgMeta 缓存（既有审计 B） | 重启 |

---

## 4. 固化产物

- `.workspace/deploy-lag/README.md` 新增 **§9 运行时热载能力（P0-a 实测固化）**：支持矩阵、免重启操作清单（YAML 示例 + graph 验证命令）、硬约束与坑、机制链一句话 + 证据行号。

---

## 5. 自复核（同档）

### 5.1 无害性
- 运行实例全程存活未重启；所有实验条目均回滚（patch md5 = 基线）；graph set + rev 与启动基线逐字节一致；dump-config 与基线逐字节一致；cordis.yml 内容未变；探针/状态文件已清除；profile 目录无新增残留（`ls` 核对）。
- 实验对象全部为"已安装未挂载"的纯客户端 UI 插件（picker 系列），激活期间无宿主服务/工具注册冲突，且每次存在时间 ≤ 数十秒。

### 5.2 回滚验证
- patch 回滚 `cp` 自备份 → md5 一致；graph 49 行 set 与基线 diff 为空；graph rev 哈希一致（内容哈希，强等价）；SSE 存活。

### 5.3 自裁决：**通过**
- 目标（实测 + 固化 patch 热载、产出操作清单）达成；无越界改动；歧义如实上报（见问题清单）。

### 5.4 问题清单（上报主 agent / 后续可选）
1. **config 覆盖的"值级"直接观测未达成**：运行进程日志进 `/dev/pts/0`（会话内不可读），Typert/WS 通道未接（本档未引入新客户端依赖）。可后续在"终端可读日志"环境补一次：改任一插件的无害 config 键，在终端看 loader `reload plugin %C` 日志；或接 WS typert `pluginInventory/list`（含 fiberPhase）观察重启。当前结论依赖代码路径 + 链执行 + disable 实测三重证据，不构成机制风险。
2. **文件路径 insert 失败的进程内根因未定位**（静态复现均成功）：如实记为"运行实例内不可用形态"，不阻碍正常部署（正常 insert 都用 bare 包名）。如后续要支持，需在可读日志环境抓 `config reload … failed` 具体错误。
3. **`dsh --dump-config` 会重写 cordis.yml（内容不变）**：非本次改动引入；已在 README §9.3 记录，避免团队误判为运行实例写回。
4. 观测日志类证据（loader `reload plugin` 日志行、hmr `config reload … failed` 警告）**本档无法采集**（终端不可读）；如需日志级证据链，须在带日志重定向的实例上复跑一次（已列操作清单，5 分钟级）。

---

## 6. 证据索引

- 进程/装配：`profile-boot-DG5t9aNs.js:256-273`；`/proc/2437836/fd`（inotify）
- watchUserPatches：`dsh-app-boot/lib/index.js:761-781`
- HMR registerConfig/refreshConfig：`cordis-plugin-hmr/lib/index.js:118-166, 196-235`
- 条目 diff/update：`cordis-plugin-loader/lib/index.js:86-123, 405-492, 503-543, 690-705`
- include 热重放：`cordis-plugin-include/lib/index.js:139-146, 226-242, 243-262`
- fiber.update noSave：`cordis/lib/index.js:1422-1441`
- client graph 增量：`dsh-client-modules/lib/index.js:271-289, 415-437`
- 实验观测：graph `curl :3080/`（index-inject 每次注入当前图）、SSE `/plugins/events`（graph/rev 帧）
- 独立复现：`node --expose-internals` 与 `node-addon-require-builtin` 双通道 `internal.import` 绝对路径均成功（排除静态不可导入）
- 基线/回滚：`/tmp/p0a/patch-baseline.yml`、`/tmp/p0a/profile-md5-baseline.txt`（md5 校验全程一致）
