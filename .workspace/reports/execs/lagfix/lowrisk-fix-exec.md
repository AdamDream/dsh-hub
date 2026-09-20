# lowrisk-fix-exec.md — 低危非阻断项 修订执行复核一体（阶段 2）

- 执行档：adam/deepseek-v4-flash（两阶段闭环·阶段 2 修订执行复核一体）
- 输入：audit-a-lagfix.md（L-1/L-2/L-3）、audit-b-btw.md（低严重度 peers 缺失）、
  btw 官方补丁产物（deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch +
  dsh-host-apiproxy.lib.index.js + APPLY.md）
- 执行时间：2026-09-15 10:50-11:00
- 结论：**通过（PASS）**——4 项全部落地，自复核通过；2 条残余观察客观上报（见问题清单）

---

## 落地项 1：replay 脚本并入 btw apiproxy 补丁（L-2）✅

文件：`.workspace/deploy-lag/replay-lag-fix.sh`（+47 行）

改动：
- 头部注释/`--help`：覆盖列表新增「btw 官方补丁 sessions/prompt-image-transform（patch -p1 于
  包目录，在 u4/u5/u5b 之后应用；锚点 ≥1 + node --check；备份/回滚经整目录快照覆盖）」；
  环境变量新增 `BTW_PATCH`（默认 `$SCRIPT_DIR/../deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch`，
  可覆盖）。
- 新增 `btw_applied()`：`grep -q "session/prompt-image-transform" $APIPROXY`（幂等锚点）。
- `precheck` 增加 `BTW_PATCH` 存在性检查。
- 新增 `patch_btw()`：锚点命中 → SKIP；DRY → dry 提示；否则
  `cd $ROOT/dsh-host-apiproxy && patch --batch -p1 --dry-run` 预检 → `patch --batch -p1` 应用。
- 新增 `verify_btw()`：`node --check` + `grep -c session/prompt-image-transform ≥1`。
- 主流程：U-4/U-5/U-5b 校验之后、P0 之前执行 `patch_btw`（满足「本补丁在 u4/u5/u5b 之后应用」）；
  `needs_apply` 加入 `btw_applied`（btw 缺失也会触发全量备份）。
- 备份/回滚覆盖：`backup_all` 本就快照 dsh-host-apiproxy 整目录，`--rollback` 还原整目录
  即含 btw 补丁状态，无需额外改动（模拟实测备份目录生成）。

验证证据：
1. `bash -n` → BASH_N_OK。
2. `--dry-run` 对 live 树 → 前置校验通过 → 「全部单元均已应用，无操作」exit 0（**SKIP 判定正确**）。
3. 补丁可应用性实测（临时副本，未碰 live）：对加固基线 `index.js.orig`（含 u4/u5/u5b、无 btw 补丁）
   `patch -p1` dry-run+应用均干净（offset 17 行），结果与 live **逐字节一致**
   （`session/prompt-image-transform`=1、`nowHasImage`=2、node --check OK）——偏移行号已由审计
   确认、本次实测复核通过。
4. 端到端模拟（临时假树 = live 5 包副本 + settings，仅将假树 apiproxy 反向回退到 btw 前状态）：
   真实执行本脚本 → btw 单元检测缺失 → 应用 → `verify_btw` PASS → 其余单元全 SKIP →
   应用后假树 apiproxy 与 live **逐字节一致** → 备份目录含 5 包整目录快照 → exit 0。
   模拟目录已清理，deploy-lag 未被污染。

## 落地项 2：web2 归档（L-1）✅

- 归档方式：`mkdir -p ~/.dsh/profiles-archive && mv ~/.dsh/profiles/web2 ~/.dsh/profiles-archive/web2-20260915-105429`
  （**完整备份迁移，非删除**，324M 原样保留）。
- 归档前安全检查：profiles/node_modules/@local 5 个包均为真实目录（无符号链接指向 web2）；
  `find -type l -lname '*web2*'` 无结果；`ps -ef | grep web2` 无进程引用。
- 核验结果：
  - `profiles/web2` 不存在 ✅；归档目录含 `DEPRECATED.md`/`node_modules`/`package.json` 等完整内容 ✅。
  - 归档副本 agent-loop `isSubagent` 计数 = **0**（L-1 实质——未打补丁副本已移出活动树）✅。
  - `settings.yaml` 无 web2 引用 ✅。
  - `profiles/web/cordis.patch.yml` 仅 L26 注释「web2 同款 @local/dsh-usage v0.1.0」
    （**非路径引用**，是 usage 插件出处说明，未改动）✅。
  - `session-board/peers/*.json`、`storages/session_projcache.json` 含历史会话/projcache 数据
    提及 web2（惰性缓存，不激活任何 profile，未改动）✅。
  - 归档后 `:3080` → **HTTP 200**（boot 不受影响）✅。

## 落地项 3：文档漂移（L-3）✅

文件：`execution-2b.md`（注：实际位于工作区根，非 `.workspace/`；已修改真实文件）+20 行
- 回滚 Runbook 重写：删除对已不存在的 `$PKG.orig-20260908` 的一键回滚命令，改为
  「deploy-lag 备份（backup-20260912-160759/160832，实测补丁前基线）+ `replay-lag-fix.sh --rollback`」。
- 同档同类漂移一并修正（同一文档内的失效路径引用）：
  - 文件位置说明（L4 后）：09-08 执行证据的旧路径 vs 当前 live 全局树路径；
  - 备份说明（L28）：`orig-20260908` 已不存在的事实标注；
  - 运行时验证 grep 路径（L46）：`profiles/web/node_modules` → 全局树实际路径。
- `master-runbook.md`：**无 `orig-20260908` 引用**（L37/L41 为 09-15 事故的叙述性记录，非回滚
  路径）；其回滚节 L80 已用 `replay-lag-fix.sh --rollback` → **无需修改**。

## 落地项 4：btw package.json peers（B-1）✅

- 部署版 `~/.dsh/profiles/node_modules/@local/dsh-btw/package.json`：补
  `"@deepseek-ai/dsh-attachment": ">=0.1.1-rc.2 <0.2.0"`（dsh-client-ui-slots 之后）与
  `"@deepseek-ai/dsh-vision-adam": ">=0.1.1-rc.2 <0.2.0"`（dsh-typert-protocol 之后），
  位置与源码逐字对齐。范围与同树其它 peers 一致（`>=0.1.1-rc.2 <0.2.0` 即 `^0.1.1-rc.2` 对 0.x
  的等价展开）。
- 源码 `dsh-btw/package.json`：**已含这两条 peer**（9-12 起即存在，diff 证实），无需改动。
- 核验：两文件 JSON 合法（node parse OK）；`diff` 源码 vs 部署 = **0 差异（逐字节一致）**；
  运行时解析 `require.resolve` 两包均成功（attachment → 全局符号链接副本、vision-adam →
  profiles 真实目录）。

---

## 自复核（逐项）

| 项 | 核对 | 结果 |
|---|---|---|
| replay `bash -n` + `--dry-run` 对 live 树 | BASH_N_OK；dry-run 全部 SKIP、「无操作」exit 0 | ✅ |
| replay btw 单元「缺则应用」路径 | 假树端到端模拟：检测缺失→应用→verify PASS→结果与 live 字节一致→备份生成 | ✅ |
| btw 补丁偏移可应用 | 加固基线实测 offset 17 行干净应用（审计已确认，本次复核） | ✅ |
| web2 已移出且无引用 | profiles/web2 不存在；settings/cordis 无路径引用（仅 1 条注释提及）；无进程/符号链接引用；:3080 200 | ✅ |
| 文档无残留旧引用（操作性） | execution-2b.md 回滚节/路径全部更新；master-runbook 无同类引用；剩余 `orig-20260908` 均属历史审计证据档叙述 | ✅ |
| 两 package.json JSON 合法 + peer 与部署解析一致 | JSON OK；源码=部署；两包解析成功；**注：vision-adam 已装 0.2.0 不在 `<0.2.0` 范围内（见问题清单 R-1，元数据级，运行不受影响）** | ⚠️ 见 R-1 |

**自裁决：通过（PASS）**。4 项落地项全部按规格完成，未做设计决策、未扩范围；
2 条残余观察如实上报，交由主 agent/用户裁决。

---

## 问题清单（残余观察，客观描述，未代决）

| # | 级别 | 描述 | 证据 | 可选处置（未执行） |
|---|---|---|---|---|
| R-1 | 低 | 已装 `@deepseek-ai/dsh-vision-adam` = **0.2.0**（profiles 真实目录，本地插件），
   源码与部署 peerDependencies 声明 `>=0.1.1-rc.2 <0.2.0` 不覆盖 0.2.0。属**源码既有**的
   元数据不一致（本次仅把部署版对齐源码，未改动范围）。运行不受影响：btw 经懒动态
   `import('@deepseek-ai/dsh-vision-adam')`（vision.ts:71）加载且包在位可解析；
   本部署为拷贝式，无 npm peer 强校验 | `vision-adam/package.json` version=0.2.0；
   `dsh-btw/package.json` peer `<0.2.0` | 改范围（如 `>=0.1.1-rc.2 <0.3.0` 或 `^0.2.0`）
   或对齐已装版本——**涉及设计决策，留给主 agent/用户** |
| R-2 | 信息 | `profiles/web/cordis.patch.yml` L26 注释提及「web2 同款」（usage 插件出处说明）；
   session-board/storages 缓存数据含历史 web2 提及。均非路径引用/激活配置，归档后无影响，
   未改动（改动注释属扩范围） | grep 结果 | 无需处理；如需彻底无痕可另行清理注释 |

## 变更文件清单

- `.workspace/deploy-lag/replay-lag-fix.sh`（修改，+47）
- `execution-2b.md`（修改，+20/-6）
- `~/.dsh/profiles/node_modules/@local/dsh-btw/package.json`（修改，+2 行 peer）
- 归档：`~/.dsh/profiles-archive/web2-20260915-105429/`（web2 完整迁移）
- 未改动：`dsh-btw/package.json`（源码已含 peers）、`.workspace/master-runbook.md`（无同类引用）
