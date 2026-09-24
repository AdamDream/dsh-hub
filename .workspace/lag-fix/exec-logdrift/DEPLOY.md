# DEPLOY.md — exec-logdrift 落地手册（U-LD1 / U-LD2 / U-LD3）

> 面向执行者：协调者（有 `~/.dsh` 写权限）。本档**在会话沙箱里无法写 deployed**（实测 `touch ~/.dsh/.x` ⇒ `权限不够`），
> 因此以下命令**未经在真实 `~/.dsh` 上执行**；但**部署脚本自身已在工作区沙箱根（`--root=…/tmp/…`）跑完
> "dry-run → apply → 产品解析器验收 → 幂等 → 锚点闸门 → 回滚 → 再 apply"全流程**（原文见 `raw/apply-selftest-transcript.txt`）。

---

## 0. TL;DR（三条命令）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-logdrift

# ① 计划（默认 dry-run，不写任何文件）
node scripts/apply-LogDrift-v1.mjs

# ② 落地（U-LD1 宿主日志出口 + U-LD2 巡检；U-LD3 零部署足迹）
node scripts/apply-LogDrift-v1.mjs --apply

# ③ 一键复核：日志出口是否活了（不重启！）
head -3 ~/.dsh/logs/dsh-logfile-lifecycle.jsonl
```

---

## 1. 交付单元与面（务必先看这张表）

| 单元 | 内容 | **面** | 生效方式 | 回滚 |
|---|---|---|---|---|
| **U-LD1** | `<HOME>/profiles/node_modules/@local/dsh-logfile/{package.json,lib/*.js}` + `<HOME>/profiles/web/cordis.patch.yml` 追加一条 `insert` | **热面（零重启）** | patch 文件落盘后 chokidar → `entry.update`（实测 **2 s**）⇒ 立即开始写 `~/.dsh/logs/dsh-host.jsonl` | `--rollback=U-LD1`（热：删 insert 即回收；脚本同时还原 payload） |
| **U-LD2** | 同插件的 `orphanWatch` 巡检（只上报，不改行为） | **热面** | 随 U-LD1 一起生效；`fs.watch` 盯 `settings.yaml` 目录做事件驱动重巡 | `--rollback=U-LD2` ⇒ 把 insert config 的 `orphanWatch` 置 `false`（**不动**日志出口） |
| **U-LD3** | 部署漂移校验器（工作区内脚本 + 台账） | **离线冷面（脚本自身）**；守护对象跨冷面/热③ | 不需要宿主，随时手动跑 | 删除 `drift/` 与 `scripts/verify-deploy-drift-v1.mjs`（**零产品足迹**） |

> ⚠️ **改插件 payload 字节（`lib/*.js`）是冷面**（ESM 模块缓存，宿主永不重读）⇒ 若日后要改日志出口的**逻辑**，改完必须**重启宿主**才生效；只改 `insert` 的 **config**（`level` / `maxBytes` / `maxFiles` / `orphanWatch`）是**热面**。

---

## 2. U-LD1 部署（热面，零重启）

### 2.1 会写什么（逐文件）

| 目标路径 | 来源（工作区候选件） | 大小 |
|---|---|---|
| `<HOME>/profiles/node_modules/@local/dsh-logfile/package.json` | `candidates/dsh-logfile/package.json` | 384 B |
| `<HOME>/profiles/node_modules/@local/dsh-logfile/lib/index.js` | 同 | 17 286 B |
| `<HOME>/profiles/node_modules/@local/dsh-logfile/lib/jsonl-sink.js` | 同 | 9 222 B |
| `<HOME>/profiles/node_modules/@local/dsh-logfile/lib/orphan-settings.js` | 同 | 10 559 B |
| `<HOME>/profiles/web/cordis.patch.yml` | **追加**下文那段块（+531 B，原子 tmp+rename） | — |

`<HOME>` = `$DSH_HOME`（未设 ⇒ `~/.dsh`）。追加的补丁块（**原文**，dry-run 也会打印）：

```yaml

# ---- U-LD1：宿主日志文件出口（热①挂载；w20 audit §2.3 W-1 / §5 C1）----
# 唯一作用：注册一个**声明了 levels 的文件 exporter**，把 warn/info/error 落进有界 JSONL。
# 回滚：删掉下面这一条 insert（热面，秒级）或跑 apply-LogDrift-v1.mjs --rollback=U-LD1
- insert:
    - id: logfile
      name: '@local/dsh-logfile'
      config:
        level: 2                 # 必须显式：2 = error+info+warn（3 才含 debug）；不写就等于被级别过滤丢弃
        maxBytes: 8388608        # 单文件上限 8 MiB
        maxFiles: 3              # 保留 <file> + .1 + .2 ⇒ 硬顶 24 MiB
        orphanWatch: true        # U-LD2 巡检开关（独立回滚：置 false）
```

### 2.2 输出与硬规则（脚本已实现，无需人工把关）

- **dry-run 默认**：不传 `--apply` 时**零写入**。
- **锚点唯一命中闸门**：追加前要求"补丁文件**末行**"在文件里**恰好出现 1 次**，且文件不含 `'@local/dsh-logfile'`；
  不满足 ⇒ `action = ABORT(anchor-not-unique)` / `skip(already-patched)`，且**连 payload 都不写**（实测 `writes=0`、payload 文件数 0、补丁 sha 不变）。
- **自动 pre-image**：`preimage/<unit>/<ts>/`（含 `manifest.json`，记录 `existedBefore` 与 `sha256Before`；只登记本次真的会改写的文件）。
- **写入后校验**：每个 payload ⇒ `node --check`（`package.json` 走 `JSON.parse`）；补丁 ⇒ `yaml` 包解析确认**顶层仍是数组**；
  任何一步失败 ⇒ **本次已写文件被自动清理**。
- **幂等**：重复 `--apply` ⇒ 全部 `skip(identical)` / `skip(already-patched)`、`writes=0`、**不产生新 pre-image**。

### 2.3 落地后的即时验收（**不需要重启**）

```bash
H=${DSH_HOME:-$HOME/.dsh}

# (a) 出口活了：2 s 内应出现 plugin-apply + exporter-registered
ls -la $H/logs/
grep -c exporter-registered $H/logs/dsh-logfile-lifecycle.jsonl        # 期望 ≥1

# (b) 真产品 warn 落地（触发 = 往 patch 追加一个**不存在的 id**）
cp $H/profiles/web/cordis.patch.yml /tmp/cw.yml
printf '\n- id: ld-verify-1\n' >> /tmp/cw.yml
cp /tmp/cw.yml $H/profiles/web/cordis.patch.yml          # 热①：直接改这个文件即可
sleep 2
grep 'ld-verify-1' $H/logs/dsh-host.jsonl
#   期望原文形如：
#   {"ts":…,"iso":"…","type":"warn","level":2,"name":"loader","sn":…,"msg":"patch: entry ld-verify-1 not found"}

# (c) 清掉验证触发（把它从 patch 里删掉，恢复原文件）
cp /tmp/cw-original.yml $H/profiles/web/cordis.patch.yml   # ← 请先备份原文件；或直接删掉那一行
```

> ⚠️ **务必把 `ld-verify-1` 那一行删掉**：留着的话每次 patch 变更都会重新告警一次（不是错误，但会污染日志）。

### 2.4 阈值对照（可选，验收②）

把 insert 的 `level: 2` 改成 `level: 1`（热①）⇒ 同一条 `ld-verify-1` 触发**不再落盘**，而插件的
`host log exporter active` info 行**仍然落盘**（证明 exporter 活着、缺失只能由阈值解释）。验完改回 `2`。

### 2.5 回滚

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-logdrift
node scripts/apply-LogDrift-v1.mjs --rollback=U-LD1 --apply
```
- **热面回滚**：从 `cordis.patch.yml` 删掉那条 `insert` ⇒ chokidar 触发重应用 ⇒ 实测 **2 s 内** exporter 回收
  （`exporter-disposed`：`presentAfterDisposer:false`、`exportersSizeAfter:1`）且**不再写日志**。
- 脚本回滚：用最新 pre-image 逐文件还原（补丁 sha 逐字节回到原值）+ 删除 payload 文件（空目录保留，无害）。
- **不再需要出口时**：能只删 insert 就不必删 payload；payload 留着不影响（不挂载 = 不运行）。

---

## 3. U-LD2 部署（热面，只上报）

- U-LD2 **就是** U-LD1 那条 insert 的 `orphanWatch: true`，没有额外文件、没有额外写入。
- **独立回滚**：把该键改成 `false`（热①，秒级生效；日志出口继续工作）。
- 巡检结果去哪：`~/.dsh/logs/dsh-logfile-lifecycle.jsonl` 的 `orphan-inspect` 记录
  （字段：`documentKeys / registered / orphans / unsectioned / parser / censusOk`）；
  非空 `orphans` 会**同时**以 `info` 级写进 `dsh-host.jsonl`（**info 级是刻意的**：用户保留的历史段属正常用法，不该当错误告警）。
- **可选**：接上静态消费点普查，把"注册了但没人 `get`"这一维也带进去：
  ```bash
  node scripts/settings-orphan-census-v1.mjs --from-lifecycle=$HOME/.dsh/logs/dsh-logfile-lifecycle.jsonl \
       --out=$HOME/.dsh/logs/settings-orphan-census.json
  # 然后在 insert 的 config 里加：  orphanCensusPath: '<上面那个绝对路径>'
  ```
  实测结论（当前部署树）：`cross-plugin-read 5 / self-read 0 / registered-only 1 / mentioned-only 14 / unreferenced 0`
  ⇒ **没有可证孤儿**（`mentioned-only` 是"注册用常量，模式未解析"，**不是**孤儿证据）。

---

## 4. U-LD3（部署漂移校验器，零产品足迹）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-logdrift
node scripts/verify-deploy-drift-v1.mjs --check            # 只读，期望 verdict: MATCH / exit 0
node scripts/verify-deploy-drift-v1.mjs --check --scope=gap  # 只看 replay-lag-fix.sh 覆盖不到的 6 类（20 文件）
```
- 覆盖 **52 包 / 322 条登记文件**；漂移 **17 处 / 9 包**；**6 类未覆盖补丁全部确认**（`grep -c` 全 0）。
- **建议**：把 `--check` 挂进"任何 `npm i -g` / 重装 / `deploy-side.sh` 之后"的动作清单（**手动跑即可，不挂热路径**）。
- ⚠️ 两个已知缺口（详见 `drift/DRIFT-LIST.md`）：`dist/**` 构建产物通道**故意不登记**（避免把正常构建当漂移）；
  `profiles/web/node_modules` **模块遮蔽**通道字节不变、原理上看不见（当前无遮蔽树）。
- 升级/重装后若 `--check` 报不一致：**先判方向**（台账里每行都有 `deployed-only / source-only / equal`），
  再决定"重新打补丁"还是"接受新字节（`--accept --yes`）"。

---

## 5. 我无法执行、需要你做的一件事

| 项 | 原因 | 你要做的 |
|---|---|---|
| `--apply` 真实写入 `~/.dsh` | 本会话沙箱拒写工作区外（`touch ~/.dsh/.x` ⇒ `权限不够`；审批已禁用，不可扩权） | 跑 §0 的 ② |
| 是否停掉隔离宿主 | 属本档子代理启动（**不是**你的 3080 宿主），当前空闲健康 | 要停就 `bash iso/iso.sh stop`（pid **1194018** / 端口 **3188**）；要留就直接用 |

---

## 6. 回滚矩阵（一页版）

| 想撤销 | 命令 / 动作 | 面 | 影响 |
|---|---|---|---|
| 只想关掉孤儿巡检 | insert config `orphanWatch: false` 或 `--rollback=U-LD2` | 热 | 日志出口继续工作 |
| 想关掉日志出口 | 删掉那条 insert，或 `--rollback=U-LD1` | 热 | 秒级回收，日志文件保留（历史可查） |
| 想连文件一起清掉 | 删 `~/.dsh/logs/dsh-host.jsonl*` + `dsh-logfile-lifecycle.jsonl` | — | 无影响（不挂载就没人写） |
| 想彻底移除插件 | `--rollback=U-LD1 --apply` 后再删空的 `@local/dsh-logfile/` 目录 | 热+手动 | 干净 |
| U-LD3 | 删 `drift/`、`scripts/verify-deploy-drift-v1.mjs`、`scripts/settings-orphan-census-v1.mjs` | 无 | **零产品足迹** |

---

## 7. 出事后第一眼看哪儿

| 症状 | 先看 | 判据 |
|---|---|---|
| 日志文件没出现 | `~/.dsh/logs/dsh-logfile-lifecycle.jsonl` 是否存在 | 不存在 ⇒ 插件没挂载（查 `cordis.patch.yml` 是否是合法顶层数组、`@local/dsh-logfile` 是否在 `~/.dsh/profiles/node_modules/@local/` 下） |
| 有 lifecycle 但 `dsh-host.jsonl` 无 warn | lifecycle 里 `exporter-registered.level` | `level:1` ⇒ warn 会被级别过滤（这是**设计**）；改成 `2` |
| 记不到 boot 首轮的补丁告警 | —— | **预期行为**（见 `report.md` §0-13）：插件在同一次 apply 里才被插入，而该轮告警早于任何插件挂载。**下一次** patch 变更会把它们重新告警并捕获 |
| 日志文件增长异常 | `dsh-host.jsonl*` 总字节 | 硬顶 = `maxBytes × maxFiles`（默认 24 MiB）；超了说明有人改了 config |
| 文件句柄泄漏怀疑 | lifecycle 的 `exporter-disposed.sink.closed`、`draining` | `closed:true` / `draining:0` ⇒ 已收尾 |
