# T19 — 0.2.0 迁移：可回滚备份与迁移方案（审计轨道）

- 轨道：T19（审计阶段，只产出结论与方案，不改产品代码）
- 当轮实测时间：2026-09-29 16:44 – 17:28 (+08:00)
- 仓库根：`/home/CNS2026495165/dsh`；产物目录：`.workspace/audit-020/t19/`
- 现役实例（**全程只读，未触碰**）：3080 = DSH `0.1.1-rc.2`，3097 = DSH `0.1.7-rc.2`
- 迁移目标：`0.2.0-rc.1`
- 约束遵守：除 `.workspace/**` 外**未写入任何路径**；未修改/删除任何现有备份资产；未写入 `~/.dsh/**`、`~/.dsh-017/**`；未停止/重启任何服务；未启动任何监听端口的服务；未使用 `sandbox_permissions`。

---

## 1. 结论摘要

**C1. 历史结论「顺序 `cp` 活跃 db+wal+shm 不可靠」在本轮被复现并加强——但它有一个未被记录的前提条件。**

生产规模实测（300 MB 级、写入方持续活跃、已用 liveness guard 排除"静默库"假阳性）：

| 快照方法 | 有效试次 | 通过 | 判定 |
|---|---|---|---|
| 顺序 `cp` db → wal → shm | 12 | **0** | **12/12 `database disk image is malformed`** |
| 仅 `cp` db（丢弃 wal） | 12 | **0** | 11 malformed + 1 打不开 |
| **`{readOnly:true}` + `VACUUM INTO`** | 12 | **12** | 全部 `integrity_check=ok` |

⇒ 历史结论成立，且失败率是 **100%**（不只是"不一致"，而是**直接损坏**）。历史记录写的是"12 次里 0 次一致"，本轮为 **0/12 通过 / 12 次硬损坏**。

**C2. 该结论有前提：`cp` 是否撕裂取决于「拷贝耗时 vs checkpoint 频率」，不取决于"是否活跃"本身。**
同一方法在 28 KB 小库（拷贝 ~0.2 ms）上 25/25 通过，在 300 MB 库（拷贝 47–192 ms）上 0/12 通过。**现役 `usage.db` 是 72 MB，属于撕裂区间**。因此不能因"小库试通了"就推广到现役库。

**C3. 最危险的失败模式不是"损坏"而是"静默丢数据"，且现有校验方法抓不到它。**
对**真实现役** `~/.dsh/storages/usage/usage.db` 仅拷 db（丢掉 5,170,632 B 的 `-wal`）：
`PRAGMA integrity_check` = **ok**、schema 完整、表内自洽 —— **但静默丢失 13 条已提交事件**（snapshot 224392 vs live 224405）。
⇒ **仅凭 `integrity_check` 判定快照可用是错的**，必须叠加"staleness 水印"（见 §5）。

**C4. 会话数据（sessions）与 SQLite 是两套完全不同的形态——历史坑不适用于 sessions。**
实测会话文件是**多帧 zstd 追加流**（单个 548 KB 文件内含 **979 个 zstd 帧**），且 09-25 备份的 40/40 抽样文件都是现役文件的**字节前缀**（`cmp -n` 全等），无一个比现役大。
⇒ sessions **可以**直接 `tar`/`cp`（追加写、帧独立、无页级撕裂）；最坏情况只丢尾部若干帧，且丢帧**可被前缀性质检出**。

**C5. 最小备份集合极小：119 MB / 8 秒**（实测执行，见 §4），且**通过恢复演练验证可用**（patch 层 85/85 哈希全等、本地插件 9/9 全等、配置 53/53 非易变文件全等）。

**C6. 现役 `usage.db` 是"突发写入"而非持续写入**：审计早期 12 次采样 WAL 字节数完全不变（5,170,632 B）、事件数不变，随后 11 分钟内新增 805 条。⇒ 在静默窗口采样的 `cp` **会偶然通过**，这正是历史结论难以复现、也容易被误判为"其实没问题"的原因。

**C7. patch 层的真实根目录是 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/`，不是顶层 `node_modules/`。**
用错根 → 85 个文件全部"未找到"（本轮实测 `missing=85`），恢复动作**静默无效**。这是回滚脚本最容易写错的一点。

**C8. 「未污染」判据可完全避开 `ps`。** 沙箱用 `bwrap --unshare-pid` 起新 PID namespace，故 `ps -p <宿主 pid>` 恒 `NO_SUCH_PID`；但 **socket inode、`/proc/net/tcp`、HTTP 指纹、宿主日志序号、日志内 `pid` 字段**全部可读且稳定。全程 40 分钟观测，3080/3097 的 inode **恒为 14152 / 15397376 未变**。

**C9. 回滚流程中最隐蔽的失败源不是"恢复动作错"，而是"校验命令误报"。**
按常规写法用 `grep -F "  $rel"` 去 patch 清单里查哈希，会被**前缀同名的孪生文件**误匹配：`.../client.js` 同时命中 `.../client.js.pre-ShellFix-v1.bak`，拼出两个 md5 ⇒ **2/85 假 MISMATCH**，把一次正确的恢复判成失败。改用 `awk '$2==r'` 精确匹配后 85/85 通过。**所有回滚校验必须做精确路径匹配，禁止子串匹配。**

---

## 2. 证据（全部当轮实测）

所有实验均在 `.workspace/audit-020/t19/` 内进行；对现役资产**只读**。

### E1. 现役实例观测（§8 判据的基线）

```
$ ss -ltnie | grep -E '3080|3097'
LISTEN 0 511 127.0.0.1:3080 0.0.0.0:*  uid:1001 ino:14152
LISTEN 0 511 127.0.0.1:3097 0.0.0.0:*  uid:1001 ino:15397376

$ awk '$4=="0A" && ($2=="0100007F:0C08" || $2=="0100007F:0C19") {printf "sock=%s st=%s uid=%s inode=%s\n",$2,$4,$8,$10}' /proc/net/tcp
sock=0100007F:0C08 st=0A uid=1001 inode=14152
sock=0100007F:0C19 st=0A uid=1001 inode=15397376

$ curl -s -o /tmp/w.3080.html -w '%{http_code}' http://127.0.0.1:3080/   # 200, 16611 B, sha256-16=2e3458f8f0d11434
$ curl -s -o /tmp/w.3097.html -w '%{http_code}' http://127.0.0.1:3097/   # 401,    68 B, sha256-16=3aad6226baa021e7
```

`ps` 在沙箱内**不可用为宿主视图**（`bwrap --unshare-pid`）：

```
$ ps -ef
UID  PID PPID C STIME TTY  TIME CMD
CNS+   1    0 0 16:44 ?  00:00:00 bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc ...
```
namespace 内 PID 1 就是 `bwrap` 自身，宿主进程树不可见。

### E2. 快照方法对照实验（受控写入方 + ground truth 不变量）

不变量：同一事务内把 `kv.seq` 与 `journal` 行数推进到同一值 ⇒ **任何事务一致快照必满足 `count(journal) == kv.seq`**；撕裂则 `integrity_check` 失败。
每试次前后读一次现役水印，**水印未推进的试次记为 `invalid` 并丢弃**（排除"库已静默"假阳性 —— 该 guard 抓到过一次真实假阳性，见 §2 E3）。

小库（28 KB，30 试次/方法）：

| 方法 | 有效试次 | 通过 | 失效 | 结论 |
|---|---|---|---|---|
| `cp` db→wal→shm | 5 | 5 | 0 | 拷贝窗口太短，几乎撞不上 checkpoint |
| `cp` wal→shm→db | 25 | 25 | 0 | 同上 |
| `cp` db only | 29 | 29 | 0（但 stale 25–190 事务） | **自洽但静默过期** |
| `{readOnly:true}`+`VACUUM INTO` | 30 | **30** | 0 | 一致，stale 35–237 事务 |

生产规模（72 MB 表 224k 行 + 追加写入方，12 试次/方法，`wal_autocheckpoint=1000`）：

| 方法 | 有效 | 通过 | 失败构成 | 耗时 |
|---|---|---|---|---|
| `cp` db→wal→shm | 12 | **0** | **12 malformed** | 47–192 ms |
| `cp` db only | 12 | **0** | 11 malformed + 1 打不开 | 45–137 ms |
| `{readOnly:true}`+`VACUUM INTO` | 12 | **12** | — | 111–253 ms |

### E3. 一次被 guard 拦下的无效实验（方法论证据）

首次生产规模运行时，`{readOnly:true}`+`VACUUM INTO` 报 12/12 通过，但 12 个快照的水印**完全相同**。追查背景写入方 stdout：`writer done n=499272`，与快照水印逐一相等 ⇒ **该 12/12 是对"已静默库"测出的，属无效证据**，已整轮作废重做（即 E2 的生产规模表）。
⇒ 这也是对协调者的提醒：**任何快照一致性结论都必须附 liveness 证据**，否则数字好看但无意义。

### E4. 真实现役库上的方法验证（只读源）

```
0.1.1  ~/.dsh/storages/usage/usage.db      72,237,056 B, WAL 模式, 表 sync_state/usage_daily/usage_events
       {readOnly:true}+VACUUM INTO  -> 67,346,432 B, 95 ms
       快照 integrity_check=ok, journal_mode=delete, page_count 17637->16442,
       无 -wal/-shm 附属文件, 表集合完全一致                        => OK
0.1.7  ~/.dsh-017/storages/usage/usage.db   9,789,440 B, WAL 模式, 同名三表
       {readOnly:true}+VACUUM INTO  -> 9,510,912 B, 39 ms
       integrity_check=ok, journal_mode=delete, 无附属文件         => OK
```
⇒ 同一方法对 **0.1.1 与 0.1.7 两种现役存储形态都成立**。

### E5. 静默丢数据实证（真实现役库）

```
$ cp ~/.dsh/storages/usage/usage.db dbonly/only.db     # 不带 -wal / -shm
db-only  integrity_check = ok
db-only  usage_events 行数 = 224392   maxRowid = 224392
LIVE     usage_events 行数 = 224405   maxRowid = 224405
现役 -wal 大小 = 5,170,632 B
```
⇒ `integrity_check=ok` 的库**丢了 13 条已提交数据**，且无任何报错。

### E6. 现役 usage.db 的写入是"突发"的

`cp` db+wal+shm 连续 12 次：`walBytesAtStart == walBytesAfter == 5,170,632`、`events` 恒 224405、`stalenessRows` 恒 0 ⇒ 该窗口内库**静默**，故 12/12 "通过" —— 与 E2 的 0/12 并不矛盾，而是同一方法在两种库状态下的表现。
11 分钟后复查：live 事件数 224405 → **225210（+805）**，同时快照 staleness 变为 805。

### E7. 会话存储形态与"前缀性质"

```
$ zstd --version                     # /usr/bin/zstd 可用
会话文件帧数（多帧，逐次追加）：
  548,186 B 文件 ->  979 帧
  244,208 B 文件 ->  134 帧
  238,108 B 文件 ->   87 帧
首帧偏移 [0,196,344,809,12025,...]  末帧偏移 [527853,528102,528269,548102]

09-25 备份 vs 现役，抽样 40 个会话文件：
  byte_prefix_of_live = 40 / 40      （cmp -n <backup_size> 全等）
  NOT_prefix = 0     live_smaller_than_backup = 0
  zstd_valid = 40    zstd_invalid = 0
```
全量 zstd 校验：09-25 备份 1,875 个 `session.jsonl.zstd`，`zstd -t` **1,875/1,875 全部有效**，无零字节/可疑小文件（1,895 个零尺寸条目全是目录）。

会话集合差异（09-25 备份 vs 现役）：
```
backup sessions = 1875
live   sessions = 2458      -> 备份仅 1875，落后 583 个文件
in backup only  = 0          -> 严格子集，期间无删除
新增项目目录 2 个
```
⇒ 09-25 会话备份**内容有效但日期过期**。

### E8. 备份资产可恢复性逐一实测

**patch 层 —— 可信且无漂移：**
```
$ for rel in $(cat patched-files.list); do
    cmp -s "pf/$rel" "$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/$rel"
  done
identical = 85 / 85     different = 0     missing = 0
```
另：本轮自建 `patched-layer.tgz` = **1,081,521 B**，与 09-25 备份的 `patched-official-files-FULL.tgz` **字节数完全相同**。

**用错根的对照（易错点实证）：**
```
PROOT = ~/.npm-global/lib/node_modules              -> missing = 85 / 85   （全部"未找到"）
PROOT = ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules
                                                    -> identical = 85 / 85
```

**本地插件层 —— 可信但不完整：**
```
@local 逐插件目录哈希（备份 vs 现役）：
  dsh-btw dsh-logfile dsh-pptmaster dsh-ssh-gui dsh-subagent-model
  dsh-usage dsh-wallpaper dsh-workerspace            -> SAME 8 / 8
  dsh-web-search-sse                                 -> NEW_IN_LIVE（备份中缺失）
```
⇒ 09-25 插件备份**恰缺 1 个插件**（该插件 mtime 09-25 14:55，晚于备份时刻 11:00）。

**`cp -a` 绝对链接坑 —— 现役复现：**
```
$ find ~/.dsh/profiles/node_modules -maxdepth 2 -type l | wc -l
594
$ find ... -printf '%l\n' | grep -c 'npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules'
496          # 496 条绝对链接指向 0.1.1 全局树
```
⇒ 若把 `~/.dsh/profiles` 当"独立组合"整体拷走，496 条链接仍指旧根；**且若 0.2.0 装进同一全局树，这些链接会把 0.2.0 的文件当作 0.1.1 的依赖解析**。

**大归档完整性：**
```
gzip -t dsh-home-config.tgz        (897 MB, 09-11)  -> OK (3.8 s)
gzip -t 20260925-110042/sessions-full.tgz (897 MB) -> OK (3.5 s)
条目数：dsh-home-config.tgz 3223；sessions-full.tgz 3770（含 1895 目录）
```
`gzip -t` 只验 gzip 框架 + tar 结构；sessions 已按 E7 做**逐文件 zstd -t**（这才是内容级校验）。

### E9. 最小备份集合执行实测（写入仅限 `.workspace`）

```
DEST=.workspace/audit-020/t19/minbk/20260929-172337
config-011.tgz        1,455,171 B
config-017.tgz           28,692 B
patched-layer.tgz     1,081,521 B     （85 个 patch 文件）
local-plugins.tgz    65,670,638 B     （9 个 @local 插件）
skills.tgz           53,463,569 B
wallpapers.tgz        2,330,481 B
TAR_TOTAL_SECONDS = 8
du -sh = 119M
```

### E10. 恢复演练（证明备份真的能用）

解包后逐文件与现役源对哈希：

| 单元 | 结果 |
|---|---|
| patch 层（85 文件，按正确根） | **identical 85 / different 0** |
| 本地插件（9 插件目录哈希） | **identical 9 / different 0** |
| 配置/状态（非易变文件） | **identical 53 / different 4** |

4 个"不同"全部是**现役持续改写的易变文件**：`session-board/peers/*.json` ×2、`storages/session_projcache.json`、`logs/dsh-host.jsonl`。
⇒ **哈希清单必须内置易变路径排除表**，否则每次校验都报假失败（该结论已写入 §6 工具）。

### E11. 会话备份代价实测（推翻"备份要几百秒"的直觉）

```
tar -cf  bs-sessions.tar   -> 1,202,483,200 B  in    802 ms
gzip -c  (同一 tar)        -> 1,168,955,324 B  in 19,551 ms
```
⇒ 载荷本身已是 zstd，gzip 只省 2.8% 却慢 **24×**。09-25 备份用 `.tgz` 属无谓开销。

### E12. 校验工具实测

```
$ node snapverify.mjs live/snap-usage-011.db ~/.dsh/storages/usage/usage.db
verdict = ACCEPT   （self_contained / integrity_check / foreign_key_check /
                    tables / snapshot_journal_mode 全 ok）
staleness: usage_events rowDelta = 805, rowidDelta = 805   <- 正确暴露过期量
$ bash manifest.sh check manifest-T0.txt
RESULT pass=118 fail=0 volatile_skipped=0 missing=0
```

### E13. 回滚校验命令的假失败实测（前缀碰撞）

09-25 归档成员名为 `@deepseek-ai/...`（无 `./` 前缀），故 §4.2(b) 的 `grep -qx`（整行精确）可用：**85/85 命中**。

但 R3 若用子串匹配则误报：
```
$ grep -F "  @deepseek-ai/dsh-client-ui-layout/lib/client.js" patched-official-files-FULL.md5
feaedc5d28fcfb5c29ec59036bf65cce  @deepseek-ai/dsh-client-ui-layout/lib/client.js
ed91f7f345cb91c87a941088fc5dba71  @deepseek-ai/dsh-client-ui-layout/lib/client.js.pre-ShellFix-v1.bak
              # ^ 孪生文件被一并命中 -> awk '{print $1}' 输出两行 -> 假 MISMATCH
$ <子串匹配写法>   -> patch restore verify: 83/85 ok, fail=2
$ <awk '$2==r' 精确写法> -> patch restore verify: 85/85 ok, fail=0
```
受影响文件对共 2 组 4 个（`client.js` / `client.js.pre-ShellFix-v1.bak`；`columns.d.ts` / `columns.d.ts.pre-ShellFix-v1.bak`）。

### E14. 快照工具端到端实测

```
$ node vacuum-into.mjs ~/.dsh-017/storages/usage/usage.db verify/t.db
  sourceBytes 9,789,440  snapshotBytes 9,510,912  elapsedMs 28
  sidecars { wal: false, shm: false }
  integrity_check=ok  journal_mode=delete    => SNAPSHOT OK
$ node snapverify.mjs verify/t.db ~/.dsh-017/storages/usage/usage.db
  verdict ACCEPT, usage_events rowDelta=0 rowidDelta=0
$ node vacuum-into.mjs <same> verify/t.db      # 二次调用
  refusing to overwrite existing snapshot      # 防误覆盖生效
```

### E15. 现役版本与命名空间事实

```
~/.npm-global/lib/node_modules/@deepseek-ai/dsh/package.json  ->  "0.1.1-rc.2"
~/.dsh-017 无 settings.yaml（仅有 0 字节 settings.yaml.imported）
            -> 3097 实例不读 ~/.dsh/settings.yaml
~/.dsh-017/profiles/web/cordis.patch.yml  32,702 B, mtime 09-28 15:57  (600)
~/.dsh/profiles/web/cordis.patch.yml       5,365 B, mtime 09-25 14:56
```
与协调者基线交叉核对一致：`settings.yaml` sha256 前缀 `0f19b0fe…`、`profiles/web/cordis.patch.yml` `513413e7…`、`.dsh-017` 同名文件 `61adb8ae…` —— 均与本轮实测相符。

---

## 3. 现有备份资产清点表

体积：`~/dsh-upgrade-backup` 2.3 G；`~/.dsh/backups` 8.2 M（22 项）；`~/.dsh/profiles-archive` 324 M；`~/.dsh/profiles/.backup-p0-20260914-112357` 8.3 M。

| # | 资产 | 时间 | 体积 | 内容 | 当轮校验 | 判定 |
|---|---|---|---|---|---|---|
| 1 | `~/dsh-upgrade-backup/20260925-110042/patched-official-files-FULL.tgz` | 09-25 11:00 | 1.08 MB | 85 个手改官方文件 | `cmp` **85/85 全等现役** | ✅ **可信回滚点**（patch 层） |
| 2 | `.../20260925-110042/sessions-full.tgz` | 09-25 11:00 | 897 MB | 1875 会话文件 | `zstd -t` **1875/1875 有效**；40/40 为现役字节前缀；gzip OK | ✅ **可信回滚点**（会话，**落后 583 文件**） |
| 3 | `.../20260925-110042/local-plugins/@local/*` | 09-25 11:00 | 413 MB | 8 个 @local 插件 | 8/8 目录哈希全等现役 | ⚠️ **不完整**（缺 `dsh-web-search-sse`） |
| 4 | `.../20260925-110042/settings.yaml` | 09-25 11:00 | 6,371 B | 配置 | 现役为 11,044 B 且已变 | ❌ **过期**（仅作历史参考） |
| 5 | `.../20260925-110042/taste/` | 09-25 | — | taste 数据 | 现役 `taste.md` 17,002 B / mtime 09-29 15:21 | ❌ **过期** |
| 6 | `.../20260925-110042/{md5-verify.txt,patched-files.list,patched-official-files-FULL.md5}` | 09-25 | 小 | 清单 | `md5-verify.txt` 只有"成功"字样**无哈希**；`.md5` 才是真清单（85 行） | ⚠️ 仅 `.md5`/`.list` 可用 |
| 7 | `.../20260925-110042/config-*.tgz`（本轮新增） | 09-29 | — | — | — | — |
| 8 | `~/dsh-upgrade-backup/dsh-home-config.tgz` | **09-11** | 897 MB | 整份 `~/.dsh`（含 sessions/storages/settings/credentials/profiles/skills/wallpapers） | `gzip -t` OK；条目 3223；**未做内容级哈希比对** | ⚠️ **过期 18 天**，仅灾备兜底 |
| 9 | `~/dsh-upgrade-backup/self-built-plugins.tgz` | 09-11 | 7.9 MB | 仅 `@local/dsh-btw`、`@local/dsh-wallpaper`（121 条目） | 未做内容比对 | ❌ **不完整**（2/9 插件） |
| 10 | `~/dsh-upgrade-backup/patched-official-files.tgz` | 09-11 | 28 KB | 3 条目 | 未做内容比对 | ❌ **不完整**（被 #1 取代） |
| 11 | `~/dsh-upgrade-backup/dsh-vision-adam-0.2.0/` | 09-11 | 56 KB | 单插件副本 | — | ⚠️ 单件，现役 `@local` 已无此插件 |
| 12 | `~/dsh-upgrade-backup/settings.yaml.bak-20260911-1645` | 09-11 | 8 KB | 配置 | — | ❌ 过期 |
| 13 | `~/.dsh/backups/`（22 项） | 09-16 ~ 09-24 | 8.2 MB | 逐文件备份：`agent.cordis.yml`、`AGENTS.md`、`settings.yaml` ×6 代、`dsh-tool-subagent/index.js`、`goal-round-driver/index.js` ×3、`vision-adam/index.js`、`taste.md`、`project-taste.md`、`cordis.patch.yml`、btw/usage tgz | 未逐一比对 | ⚠️ **细粒度历史点**，时间跨度旧，仅适合单文件取证 |
| 14 | `~/.dsh/profiles-archive/web2-20260915-105429` | 09-15 | 324 MB | 归档 profile（`cordis.patch.yml`+`package*.json`+`node_modules`+`DEPRECATED.md`） | 未做恢复演练 | ⚠️ 过期，且含 `node_modules`（346 条以上绝对链接风险） |
| 15 | `~/.dsh/profiles/.backup-p0-20260914-112357` | 09-14 | 8.3 MB | `dsh-subagent`/`dsh-btw` 等 + `original.sha256` | 未做比对 | ⚠️ 过期，**含 `original.sha256` 可自校验** |

**可信回滚点小计：4 个**
- R-a patch 层（#1，**已 byte 级验证 85/85**）
- R-b 会话内容（#2，**已 zstd 级验证 1875/1875 + 前缀性质**）
- R-c 插件层（#3，**已验证 8/8，但需补 `dsh-web-search-sse`**）
- R-d 本轮新建最小集合（§4，**已通过恢复演练**）
其余 11 项为**过期或不完整**，不得单独作为回滚依赖。

---

## 4. 最小备份集合与命令

### 4.1 「一旦损坏不可重建」的判据

判定原则：**能否从上游 npm 制品或 git 干净重建？** 不能重建的才进最小集合。据此排除：`@deepseek-ai/*` 官方包本体（可 `npm i` 重装）、`profiles/node_modules` 依赖树（可 `npm ci`）、repo 里已 git 跟踪的文件。

### 4.2 清单（逐项：为何不可重建 + 命令 + 校验）

设：
```bash
H="$HOME"
BK="$H/dsh-020-backup/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$BK"   # 切换前执行
PROOT="$H/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules"   # ← patch 层真实根，勿写错
PLIST="$H/dsh-upgrade-backup/20260925-110042/patched-files.list"
```

**(a) 配置与状态（不可重建：用户手写 + 运行时状态）**
```bash
tar -czf "$BK/config-011.tgz" -C "$H" \
  .dsh/settings.yaml .dsh/AGENTS.md .dsh/.credentials.yaml .dsh/.anonymous-user-id \
  .dsh/.agent-presets .dsh/profiles/web .dsh/taste .dsh/office-handoff \
  .dsh/session-board .dsh/btw .dsh/install-plugins.sh \
  .dsh/storages/workspace.json .dsh/storages/message_feedback.json \
  .dsh/storages/session_projcache.json .dsh/logs

tar -czf "$BK/config-017.tgz" -C "$H" \
  .dsh-017/AGENTS.md .dsh-017/.credentials.yaml .dsh-017/.anonymous-user-id \
  .dsh-017/.agent-presets .dsh-017/profiles/web .dsh-017/taste \
  .dsh-017/office-ppt .dsh-017/storages/workspace.json
```
校验：
```bash
tar -tzf "$BK/config-011.tgz" | wc -l
tar -tzf "$BK/config-011.tgz" | grep -E 'settings.yaml|.credentials.yaml|cordis.patch.yml'  # 关键件在位
```

**(b) patch 层（**最不可重建**：85 个手改官方文件，`npm i` 会整片覆盖）**
```bash
( cd "$PROOT" && tar -czf "$BK/patched-layer.tgz" -T "$PLIST" )
```
校验（**必须按 `$PROOT`，用顶层 node_modules 会全 miss**）：
```bash
n=0; ok=0
while IFS= read -r rel; do [ -z "$rel" ] && continue; n=$((n+1)); \
  tar -tzf "$BK/patched-layer.tgz" | grep -qx "$rel" && ok=$((ok+1)); done < "$PLIST"
echo "patch entries present: $ok / $n"          # 期望 85 / 85
```

**(c) 本地插件源码/部署件（不可重建：树外自研）**
```bash
tar -czf "$BK/local-plugins.tgz" -C "$H/.dsh/profiles/node_modules/@local" .
```
校验（插件数 + 逐插件目录哈希）：
```bash
tar -tzf "$BK/local-plugins.tgz" | awk -F/ 'NF>1{print $2}' | sort -u | wc -l    # 期望 9
for d in "$H"/.dsh/profiles/node_modules/@local/*/; do
  echo "$(basename "$d") $(cd "$d" && find . -type f -exec sha256sum {} \; | sort | sha256sum | cut -c1-32)"
done | tee "$BK/local-plugins.hashes"
```

**(d) agent preset（不可重建：用户自建 `standard-glm`）**
随 (a) 的 `.dsh/.agent-presets` 覆盖；单独校验：
```bash
tar -tzf "$BK/config-011.tgz" | grep 'agent-presets'
sha256sum "$H/.dsh/.agent-presets/standard-glm/agent.cordis.yml" \
          "$H/.dsh/.agent-presets/standard-glm/preset.yml"
```

**(e) 技能（不可重建：用户自建 skill，含 116 MB 资产）**
```bash
tar -czf "$BK/skills.tgz" -C "$H/.dsh" skills
tar -czf "$BK/skills-017.tgz" -C "$H/.dsh-017" skills     # 0.1.7 侧同名副本
```
校验：
```bash
tar -tzf "$BK/skills.tgz" | wc -l                         # 12,946 文件级
tar -tzf "$BK/skills.tgz" | grep -E 'session-handoff/SKILL.md|ppt-master'
```

**(f) 会话数据（不可重建：对话历史；见 §5 方法）**
```bash
tar -cf "$BK/sessions-011.tar" -C "$H/.dsh" sessions      # 不压缩，802 ms
tar -czf "$BK/sessions-017.tgz" -C "$H/.dsh-017" sessions # 2.4 MB，压缩无妨
```
校验（**内容级，不是 tar 级**）：
```bash
mkdir -p /tmp/vt && tar -xf "$BK/sessions-011.tar" -C /tmp/vt
find /tmp/vt -name '*.zstd' -print0 | xargs -0 -n1 -P4 sh -c 'zstd -t -q "$0" || echo "BAD $0"'
echo "validated $(find /tmp/vt -name '*.zstd' | wc -l) / $(find "$H/.dsh/sessions" -name '*.zstd' | wc -l)"
```

**(g) 凭据 / office journal（不可重建：密钥 + 会话级 journal）**
随 (a) 的 `.credentials.yaml`、`.dsh/office-handoff`（含 `journal.secret`）覆盖。
校验（**只核存在性与权限，不打印内容**）：
```bash
tar -tzf "$BK/config-011.tgz" | grep -E 'credentials|office-handoff' | head
stat -c '%a %s %n' "$H/.dsh/office-handoff/journal.secret"
```

**(h) wallpaper 资源（不可重建：用户上传的 PNG）**
```bash
tar -czf "$BK/wallpapers.tgz" -C "$H/.dsh" wallpapers
sha256sum "$H/.dsh/wallpapers/"*.png | tee "$BK/wallpapers.sha256"
```

**(i) SQLite 存储（不可重建：用量统计；**必须用 §5 方法**）**
```bash
node snapverify-vacuum.mjs "$H/.dsh/storages/usage/usage.db"     "$BK/usage-011.db"
node snapverify-vacuum.mjs "$H/.dsh-017/storages/usage/usage.db" "$BK/usage-017.db"
```

**(j) 汇总哈希清单（恢复验收的唯一依据）**
```bash
( cd "$BK" && sha256sum *.tgz *.tar *.db *.hashes *.sha256 > MANIFEST.sha256 2>/dev/null )
sha256sum -c "$BK/MANIFEST.sha256"
```
并叠加"现役源侧清单"（本轮工具，含易变路径排除）：
```bash
bash .workspace/audit-020/t19/manifest.sh gen  "$BK/source-manifest.txt"
bash .workspace/audit-020/t19/manifest.sh check "$BK/source-manifest.txt"   # 期望 fail=0 missing=0
```

### 4.3 实测代价

| 单元 | 体积 | 耗时 |
|---|---|---|
| config-011 + config-017 | 1.48 MB | < 1 s |
| patched-layer | 1.08 MB | < 1 s |
| local-plugins | 65.7 MB | ~3 s |
| skills | 53.5 MB | ~4 s |
| wallpapers | 2.33 MB | < 1 s |
| **小计（a~e,h）** | **119 MB** | **8 s（实测）** |
| sessions-011 (`tar -cf`) | 1.20 GB | **802 ms** |
| usage snapshot ×2 | 77 MB | 134 ms |
| **总计** | **~1.4 GB** | **~10 s** |

---

## 5. 会话快照方法（实测结论）

### 5.1 结论：现役存在**两种**存储形态，必须分别处理

| 数据 | 形态 | 正确方法 | 错误方法的后果 |
|---|---|---|---|
| `~/.dsh/sessions/**` | 每会话一个 `session.jsonl.zstd`，**追加写、多帧 zstd** | 直接 `tar`（无需压缩、无需静默） | 仅丢尾部若干帧（可检出） |
| `~/.dsh/storages/usage/usage.db` | SQLite **WAL 模式** + `-wal` + `-shm` | **`{readOnly:true}` + `VACUUM INTO`** | 100% 概率损坏或静默丢行 |

### 5.2 历史结论是否仍适用 —— 适用，且更严重

- **仍适用**：生产规模 0/12 通过、12/12 硬损坏（§2 E2）。
- **但必须加前提**：撕裂概率取决于**拷贝耗时 vs checkpoint 频率**。28 KB 小库 25/25 通过；72 MB 现役库处于撕裂区间。
- **历史上"12 次 0 次一致"未记录 liveness 条件**，本轮补上后仍成立，并额外发现：**失败多数是"打不开/损坏"而非"静默不一致"** —— 这反而更容易被发现，**真正的危险是仅拷 db 时的静默丢数据**（E5）。

### 5.3 0.1.1 / 0.1.7 均适用

`VACUUM INTO` 对 `~/.dsh`（72 MB）与 `~/.dsh-017`（9.8 MB）都成功，输出 `journal_mode=delete`、无 `-wal/-shm`（E4）。⇒ 迁移期只需维护**一套**快照命令。

### 5.4 快照可验证性判据（如何证明快照可用，而不是坏文件）

工具：`.workspace/audit-020/t19/snapverify.mjs`。**六条判据全部为 must**：

| # | 判据 | 为什么必须 |
|---|---|---|
| V1 | 存在且为单文件，**无 `-wal`/`-shm` 附属** | 有附属 = 又变成"db+wal 配对"，重新引入撕裂风险 |
| V2 | `PRAGMA integrity_check` == `ok` | 抓 E2 的 12/12 malformed 类 |
| V3 | `PRAGMA foreign_key_check` 干净 | `integrity_check` 不查引用完整性 |
| V4 | 表集合与源**完全一致** | 抓"VACUUM 到一半"或缺表 |
| V5 | 快照 `journal_mode` ≠ `wal` | 佐证确实是 `VACUUM INTO` 产物而非裸拷 |
| V6 | **staleness 水印**：逐表比对行数/`MAX(rowid)` 与现役的差 | **唯一能抓静默丢数据的判据** |

另加两条运行纪律：
- **V7**：快照必须**记录生成时刻的现役水印**（行数/max rowid），否则事后无法界定"丢了多少"。
- **V8**：`usage_events` 这类只追加表用 `rowidDelta` 做水印；`sync_state` 这类有删改的表用 `rowCount`（实测 `sync_state` 行数 +1 而 `rowid` +319 ⇒ **只看 rowid 会误判**）。

**绝对不充分的判据（实测反例）**：
- ❌ 只做 `PRAGMA integrity_check` —— 真实现役库 db-only 拷贝 **ok 但丢 13 行**（E5）。
- ❌ 只做 `gzip -t` / `tar -t` —— 只验容器，不验内容。
- ❌ 只做"文件非零/能打开" —— 抓不到撕裂。
- ❌ **不附 liveness 证据就宣称一致性** —— E3 的 12/12 假阳性。

### 5.5 可复制执行

```bash
# ① 生成快照（只读现役，不写 ~/.dsh）
node .workspace/audit-020/t19/vacuum-into.mjs "$HOME/.dsh/storages/usage/usage.db" "$BK/usage-011.db"
node .workspace/audit-020/t19/vacuum-into.mjs "$HOME/.dsh-017/storages/usage/usage.db" "$BK/usage-017.db"

# ② 验收（exit 0 = ACCEPT）
node .workspace/audit-020/t19/snapverify.mjs "$BK/usage-011.db" "$HOME/.dsh/storages/usage/usage.db"
node .workspace/audit-020/t19/snapverify.mjs "$BK/usage-017.db" "$HOME/.dsh-017/storages/usage/usage.db"
```
`vacuum-into.mjs`（8 行，与 `snapverify` 配套）：
```js
import { DatabaseSync } from 'node:sqlite';
const [,, src, out] = process.argv;
const db = new DatabaseSync(src, { readOnly: true });   // 只读打开，绝不写现役
db.exec(`VACUUM INTO '${out}'`);
db.close();
```
> 注：本沙箱**无 `sqlite3` CLI**，但 `node:sqlite`（Node v22.23.2，`DatabaseSync`）可用 —— 这是唯一可行路径，Runbook 不要写成 `sqlite3`。
> `{readOnly:true}` **可与 `VACUUM INTO` 同时使用**（实测 30/30 通过）；`VACUUM INTO` 的写目标由参数给，不需要写源库。

---

## 6. 回滚命令序列（按场景）

### 6.0 前置：迁移期固定约定（消除对 agent 记忆的依赖）

```bash
# —— 常量（切换前一次性设定并写入 RUNBOOK.env）——
export H="$HOME"
export DSH020_HOME="$H/.dsh-020"                    # 0.2.0 独立 profile 根（并行，不覆盖现役）
export DSH020_PREFIX="$H/.npm-global-020"           # 0.2.0 独立全局前缀（★ 关键，见 C7）
export DSH011_PREFIX="$H/.npm-global"               # 现役 0.1.1 全局前缀（只读）
export PROOT011="$DSH011_PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules"
export PROOT020="$DSH020_PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules"
export BK="$H/dsh-020-backup/20260929-XXXXXX"       # §4 生成的备份目录
export T19="$H/dsh/.workspace/audit-020/t19"
export P0=3080   # 现役 0.1.1 端口（只读观测）
export P1=3097   # 隔离 0.1.7 端口（只读观测）
export P2=3120   # 0.2.0 新实例端口
```

**★ 为什么必须用独立前缀**：patch 层位于 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/`（C7）。若把 0.2.0 装进同一前缀，`npm i` 会**就地覆盖 0.1.1 的 85 个手改文件**（它们不可重建），且 `~/.dsh/profiles/node_modules` 的 **496 条绝对链接**会把两个代的文件混着解析。独立前缀下，**0.1.1 天然可回滚，不需要任何恢复动作**。

### 6.1 切换前基线（必须留存，用于场景 R7 判定）

```bash
bash "$T19/witness.sh"                 | tee "$BK/witness-A.txt"
bash "$T19/manifest.sh" gen "$BK/source-A.txt"
cp "$BK/witness-A.txt" "$BK/witness-BASELINE.txt"   # 判定基准
```

### 6.2 场景表

| 场景 | 停止点（立刻做） | 恢复点 | 验证命令 |
|---|---|---|---|
| R1 0.2.0 起不来 | 不启动 0.2.0、不关现役 | **无需恢复**（独立前缀+独立 home） | `bash "$T19/witness.sh"` 与 BASELINE 逐行比对 |
| R2 0.2.0 改坏了现役配置 | 停 0.2.0 | `config-011.tgz` / `config-017.tgz` | `manifest.sh check "$BK/source-A.txt"` |
| R3 patch 层被覆盖 | 停 0.2.0 | `patched-layer.tgz` → `$PROOT011` | 85/85 `cmp` |
| R4 插件不兼容/缺失 | 停 0.2.0 | `local-plugins.tgz` → `@local` | 9 插件哈希比对 |
| R5 会话数据被改/删 | 停 0.2.0 | `sessions-011.tar` | `zstd -t` + 前缀性质 |
| R6 usage.db 损坏 | 停 0.2.0 | `usage-011.db`（VACUUM 产物） | `snapverify.mjs` |
| R7 全面回滚 | 停 0.2.0、删 `$DSH020_HOME` | 上述全部 | `manifest.sh check` + witness 逐行等值 |

### R1 — 0.2.0 无法启动（最常见；应当**零恢复动作**）

```bash
# 停止点：不动现役，只放弃 0.2.0
[ -n "$DSH020_PID" ] && kill "$DSH020_PID" 2>/dev/null      # 若已记录；否则跳过

# 恢复点：无（0.1.1 未被触碰 —— 这正是独立前缀+独立 home 的目的）
# 验证：现役必须逐行等于基线
bash "$T19/witness.sh" | tee "$BK/witness-R1.txt"
diff "$BK/witness-BASELINE.txt" "$BK/witness-R1.txt" \
  && echo "R1 PASS: 现役未被触碰" \
  || echo "R1 CHECK: 下述差异行应为**仅增长量**（W3/W6 的 sn/文件数），inode/HTTP/pid 行必须完全相同"
```
**判定**：`W1 inode`、`W2 http/bytes/sha256`、`W4 pid` 必须**逐字符相同**；`W3 sn`、`W6 计数` 允许**单向增长**。任何 `W1/W2/W4` 变化 ⇒ 立即转 R7。

### R2 — 0.2.0 改写了现役配置

```bash
# 停止点
[ -n "$DSH020_PID" ] && kill "$DSH020_PID"

# 先留证（不要直接覆盖，保留现场）
mkdir -p "$BK/forensic-R2"
cp -av "$H/.dsh/settings.yaml" "$H/.dsh/profiles/web/cordis.patch.yml" "$BK/forensic-R2/"

# 恢复点（只还原配置，不碰其他）
tar -xzf "$BK/config-011.tgz" -C "$H" \
  .dsh/settings.yaml .dsh/AGENTS.md .dsh/profiles/web .dsh/.agent-presets .dsh/taste
tar -xzf "$BK/config-017.tgz" -C "$H" \
  .dsh-017/AGENTS.md .dsh-017/profiles/web .dsh-017/.agent-presets .dsh-017/taste

# 验证
bash "$T19/manifest.sh" check "$BK/source-A.txt"        # 期望 fail=0 missing=0
bash "$T19/witness.sh" | grep -E 'W2|W4'                # HTTP 指纹与 pid 必须回到基线
tar -xzf "$BK/config-011.tgz" -O .dsh/settings.yaml | sha256sum   # 与备份记录比对
```
> 注意：`settings.yaml` 是**活值**（现役会自行改写），其哈希随时间变化 ⇒ 校验请用 `manifest.sh`（已排除易变路径），**不要**拿整文件哈希做"未污染"断言。

### R3 — patch 层被覆盖（伤害最大）

```bash
# 停止点
[ -n "$DSH020_PID" ] && kill "$DSH020_PID"

# 恢复点：按**正确根**展开
tar -xzf "$BK/patched-layer.tgz" -C "$PROOT011"

# 验证：85/85 逐一比对备份内哈希清单
# ★ 必须用 awk 精确匹配第 2 字段；用 `grep -F "  $rel"` 会被"前缀同名前缀"文件误匹配
#   （实测：`client.js` 同时命中 `client.js.pre-ShellFix-v1.bak` -> 拼出两个 md5 -> 假 MISMATCH 2/85）
MD5F="$H/dsh-upgrade-backup/20260925-110042/patched-official-files-FULL.md5"
fail=0; chk=0
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  want=$(awk -v r="$rel" '$2==r {print $1}' "$MD5F")
  have=$(md5sum "$PROOT011/$rel" 2>/dev/null | awk '{print $1}')
  chk=$((chk+1))
  [ "$want" = "$have" ] || { echo "MISMATCH $rel"; fail=$((fail+1)); }
done < "$H/dsh-upgrade-backup/20260925-110042/patched-files.list"
echo "patch restore: $((chk-fail))/$chk ok   # 期望 85/85, fail=0"
```

### R4 — 插件层回滚

```bash
[ -n "$DSH020_PID" ] && kill "$DSH020_PID"

# 留证
cp -av "$H/.dsh/profiles/node_modules/@local" "$BK/forensic-R4-local"

# 恢复点（@local 内是真实目录，可直接覆盖；勿动 profiles/node_modules 的符号链接层）
tar -xzf "$BK/local-plugins.tgz" -C "$H/.dsh/profiles/node_modules/@local"

# 验证：逐插件目录哈希
for d in "$H"/.dsh/profiles/node_modules/@local/*/; do
  echo "$(basename "$d") $(cd "$d" && find . -type f -exec sha256sum {} \; | sort | sha256sum | cut -c1-32)"
done
diff <(sort "$BK/local-plugins.hashes") <(for d in "$H"/.dsh/profiles/node_modules/@local/*/; do \
  echo "$(basename "$d") $(cd "$d" && find . -type f -exec sha256sum {} \; | sort | sha256sum | cut -c1-32)"; done | sort) \
  && echo "R4 PASS"
```

### R5 — 会话数据回滚

```bash
[ -n "$DSH020_PID" ] && kill "$DSH020_PID"

# ★ 前置：确认现役 0.1.1 未在写这些会话（否则覆盖会与现役打架）
#   查看是否仍有活跃 session.lock：
find "$H/.dsh/sessions" -name 'session.lock' -newermt '-10 minutes'

# 恢复点：先备份现状，再按缺失补回（不要 rm -rf 整个 sessions！）
mv "$H/.dsh/sessions" "$BK/forensic-R5-sessions"
mkdir -p "$H/.dsh/sessions"
tar -xf "$BK/sessions-011.tar" -C "$H/.dsh"        # 解出 sessions/
# 再叠加现役现状（保留备份之后新建的会话）
cp -an "$BK/forensic-R5-sessions/." "$H/.dsh/sessions/" 2>/dev/null

# 验证
find "$H/.dsh/sessions" -name '*.zstd' -print0 | xargs -0 -n1 -P4 sh -c 'zstd -t -q "$0" || echo "BAD $0"'
echo "count=$(find "$H/.dsh/sessions" -name '*.zstd' | wc -l)  (基线见 witness-A.txt 的 W6)"
```
> 用 `cp -an`（no-clobber）叠加而非整目录替换 ⇒ **不会丢掉备份之后新建的会话**，这是"可回滚"与"可前进"兼容的关键。

### R6 — usage.db 回滚

```bash
[ -n "$DSH020_PID" ] && kill "$DSH020_PID"

mkdir -p "$BK/forensic-R6"
mv "$H/.dsh/storages/usage/usage.db"     "$BK/forensic-R6/usage.db"
mv "$H/.dsh/storages/usage/usage.db-wal" "$BK/forensic-R6/" 2>/dev/null
mv "$H/.dsh/storages/usage/usage.db-shm" "$BK/forensic-R6/" 2>/dev/null
# ★ 必须移走 -wal/-shm，否则残留 wal 会被应用到新 db 上造成再次撕裂

# 恢复点：快照是 VACUUM 产物（journal_mode=delete, 无附属）
cp "$BK/usage-011.db" "$H/.dsh/storages/usage/usage.db"

# 验证
node "$T19/snapverify.mjs" "$H/.dsh/storages/usage/usage.db"
ls -la "$H/.dsh/storages/usage/"        # 应无 -wal/-shm（下次写入时由 DSH 自建）
```

### R7 — 全面回滚

```bash
# ① 停止点：停 0.2.0（不触碰 3080/3097）
[ -n "$DSH020_PID" ] && kill "$DSH020_PID"

# ② 摘除 0.2.0 资产（隔离根整体移走，不删，留作取证）
mv "$DSH020_HOME"   "$BK/rolledback-dsh-020"   2>/dev/null
mv "$DSH020_PREFIX" "$BK/rolledback-npm-global-020" 2>/dev/null

# ③ 按序恢复现役（R3→R2→R4→R5→R6 的顺序，先底层后数据）
tar -xzf "$BK/patched-layer.tgz" -C "$PROOT011"
tar -xzf "$BK/config-011.tgz"    -C "$H"
tar -xzf "$BK/config-017.tgz"    -C "$H"
tar -xzf "$BK/local-plugins.tgz" -C "$H/.dsh/profiles/node_modules/@local"
tar -xzf "$BK/wallpapers.tgz"    -C "$H/.dsh"
tar -xzf "$BK/skills.tgz"        -C "$H/.dsh"

# ④ 数据层（会话用叠加，usage 用 VACUUM 快照）
cp -an "$BK/sessions-extracted/." "$H/.dsh/sessions/" 2>/dev/null
cp "$BK/usage-011.db" "$H/.dsh/storages/usage/usage.db"
cp "$BK/usage-017.db" "$H/.dsh-017/storages/usage/usage.db"

# ⑤ 验收（三条独立判据，全绿才算回滚成功）
bash "$T19/manifest.sh" check "$BK/source-A.txt"                 # 期望 fail=0 missing=0
bash "$T19/witness.sh" | tee "$BK/witness-R7.txt"
diff "$BK/witness-BASELINE.txt" "$BK/witness-R7.txt"             # W1/W2/W4 必须相同
ss -ltn | grep -qE '127.0.0.1:3080' && ss -ltn | grep -qE '127.0.0.1:3097' \
  && echo "R7 PASS: 两个现役实例仍在监听"
```

### 6.3 回滚序列的四条纪律

1. **先取证后覆盖**：每个恢复点前把现场 `cp -av` 到 `$BK/forensic-R*/`；否则二次失败时无现场可查。
2. **数据层用"叠加"而非"替换"**：`cp -an` 保证不丢备份之后的新数据（R5）。
3. **SQLite 恢复必须先移走 `-wal`/`-shm`**：残留 wal 应用到还原后的 db 上等于重演撕裂（R6）。
4. **哈希校验一律做"精确路径匹配"，禁止子串匹配**：本轮实测踩到真实前缀碰撞 —— `.../client.js` 会同时命中 `.../client.js.pre-ShellFix-v1.bak`，`grep -F` 拼出两个 md5 导致 **2/85 假 MISMATCH**；改用 `awk '$2==r'` 后 85/85 通过。同类风险文件在 patch 清单中共 4 个（`client.js`、`columns.d.ts` 各带 `.pre-ShellFix-v1.bak` 变体）。**校验命令的误报会反过来把正确的恢复判成失败，是回滚流程里最隐蔽的失败源。**

---

## 7. 「未污染现役」判据

### 7.1 为什么不能靠 `ps`

```bash
$ ps -ef
UID PID PPID C STIME TTY TIME CMD
CNS+  1    0 0 16:44 ?  00:00:00 bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc ...
```
沙箱以 `bwrap --unshare-pid --proc /proc` 启动 ⇒ **PID namespace 隔离**：库内 `/proc` 是新建的，宿主进程树不可见，`ps -p <宿主 pid>` 必然 `NO_SUCH_PID`。
**注意这不是"`ps` 坏了"，而是 namespace 语义**：`/proc/net/*` 是**网络 namespace** 视图（未隔离），所以 socket 可见；进程表是 PID namespace 视图，所以不可见。

### 7.2 替代判据（7 组独立见证，全部可复制执行）

工具：`.workspace/audit-020/t19/witness.sh`（只读，不用 `ps`）。

| # | 见证 | 命令 | 基线（本轮实测） | 判据 |
|---|---|---|---|---|
| **W1** | **socket inode** | `awk '$4=="0A" && ($2=="0100007F:0C08"\|\|$2=="0100007F:0C19"){print $2,$10}' /proc/net/tcp` | 3080 `inode=14152`；3097 `inode=15397376` | **必须完全相同**（重启 ⇒ 新 socket ⇒ 新 inode） |
| **W1b** | 交叉校验 | `ss -ltnie \| grep -E '3080\|3097'` | 同上 + `uid:1001` | 同上 |
| **W2** | **HTTP 指纹** | `curl -s -o /tmp/w.$p.html -w '%{http_code}' http://127.0.0.1:$p/` + `sha256sum` | 3080 `200 / 16611 B / 2e3458f8f0d11434`；3097 `401 / 68 B / 3aad6226baa021e7` | **必须完全相同** |
| **W3** | **宿主日志世代**（0.1.1） | `sed -n 's/.*"sn":\([0-9]*\).*/\1/p' ~/.dsh/logs/dsh-host.jsonl \| tail -1` | 观测期内 `sn` 由 4150 单调增至 4160 | `sn` **必须 ≥ 基线且持续增长**；出现**更小的 sn** ⇒ 进程换代（重启） |
| **W3b** | 同上（0.1.7） | `~/.dsh-017/logs/dsh-host.jsonl` | `sn_last=1311`，持续增长 | 同上 |
| **W4** | **日志内宿主 pid** | `sed -n 's/.*"pid":\([0-9]*\).*/\1/p' ~/.dsh/logs/dsh-logfile-lifecycle.jsonl \| tail -1` | `pid=6021`（全程未变） | **必须完全相同**。⚠️ 该 pid 是**宿主** pid，库内 `/proc/$pid` **不存在**，只能用日志文本比对，不可 `ps` |
| **W5** | **现役配置未被改写** | `sha256sum` + `stat -c'%s %Y'` | `settings.yaml 0f19b0fe…`、`profiles/web/cordis.patch.yml 513413e7…`、`.dsh-017/… 61adb8ae…`、`AGENTS.md a9744b5a…` | `cordis.patch.yml`/`AGENTS.md` **必须完全相同**；`settings.yaml` 见下方警告 |
| **W6** | **会话集合未被删减** | `find ~/.dsh/sessions -name '*.zstd' \| wc -l` | 2458 → 2459（单向增长） | **必须非递减**；下降 ⇒ 有会话被删 |
| **W7** | **无越界写入** | `bash "$T19/manifest.sh" gen/check` | `pass=118 fail=0 missing=0` | `fail=0 且 missing=0` |

### 7.3 关键警告：`settings.yaml` 是**活值**，不能当未污染判据

- 实测 mtime `1790670663`（≈ 09-29 08:31），与 `dsh-logfile-lifecycle.jsonl` 最后一条 `09-29 08:31:04` **同刻** ⇒ 现役会自行改写 `settings.yaml`。
- 它在 90 秒观测窗内**恰好**未变，但这是**巧合**，不是保证。
- ⇒ 判定必须用 `manifest.sh`（**已内置易变路径排除表**），**不要**用整文件哈希；否则迁移期任何一次现役自改写都会误报"被污染"。
- 易变路径（**必须排除**）：`~/.dsh/logs/**`、`~/.dsh/storages/usage/**`、`storages/session_projcache.json`、`session-board/peers/**`、`~/.dsh/sessions/**`、`~/.dsh-017/sessions/**`、`~/.dsh/btw/**`、`**/session.lock`。

### 7.4 判据灵敏度证据（负向对照）

无法通过"实际重启一次"来验证灵敏度（**禁止停止/重启现役**）。改用**历史漂移**作证：

```
~/.dsh/logs/dsh-logfile-lifecycle.jsonl      窗 2026-09-23T02:02 → 2026-09-29T08:31
  出现 6 个不同宿主 pid ⇒ 该期间至少换代 6 次
~/.dsh-017/logs/dsh-logfile-lifecycle.jsonl  窗 2026-09-25T09:36 → 2026-09-28T07:57
  同样出现 6 个不同宿主 pid
```
⇒ **W4（pid）与 W3（sn 复位）在真实重启时确实会变化**，是有效见证，而非恒真断言。

### 7.4b 判据在本轮审计内的实盘验证（capstone）

本轨道全程 ~46 分钟（16:44 → 17:30）对现役只读操作，结束时把 `witness.sh` 输出与基线逐行 diff，
**差异仅落在 W3/W3b 两行**：

```
$ diff witness-BASELINE.txt witness-FINAL.txt
11c11
< sn_last=4160 ts_last=2026-09-29T09:23:05.463Z bytes=1482395
---
> sn_last=4176 ts_last=2026-09-29T09:30:19.063Z bytes=1485996    # 0.1.1 host：同一世代继续写入
13c13
< sn_last=1311 ts_last=2026-09-29T09:23:11.041Z bytes=540572
---
> sn_last=1320 ts_last=2026-09-29T09:29:56.043Z bytes=542309      # 0.1.7 host：同上
```

其余见证**逐字符相同**：

| 见证 | 基线 = 结束值 | 含义 |
|---|---|---|
| W1 inode | `14152` / `15397376` | 监听 socket 未重建 ⇒ **未重启** |
| W2 HTTP | `200/16611/2e3458f8…`、`401/68/3aad6226…` | 进程对外行为未变 |
| W4 pid | `6021` | 宿主进程世代未换 |
| W5 配置 | 6 个文件的 sha256/size/mtime 全部相同 | **现役配置未被改写** |
| W6 会话 | `2459` / `19`（非递减） | 会话未被删减 |

⇒ §7.2 的判据组合**在真实迁移期尺度（~46 分钟连续只读作业）上可用**：
既能容忍现役正常自写（W3/W6 单向增长），又能对"重启 / 改写 / 删减"给出逐字符级判定。

### 7.5 迁移期运行纪律

1. **每步前后各跑一次 `witness.sh`**，存 `$BK/witness-<步骤>.txt`，与 `BASELINE` 逐行 diff。
2. 只对 3080/3097 做**只读**操作：`curl` GET、`ss`、读 `/proc/net/tcp`、读日志。**禁止** `POST`/`PUT`、禁止读任何写接口。
3. 0.2.0 一律绑**新端口 3120** + **新 home `~/.dsh-020`** + **新前缀 `~/.npm-global-020`**；**绝不**指向 `~/.dsh`、`~/.dsh-017` 或 3080/3097 的端口。
4. 迁移期**不执行** `npm i -g` 到 `~/.npm-global`（会覆盖 patch 层）；所有安装限定 `--prefix ~/.npm-global-020`，并设 `npm_config_cache` 到工作区内（默认 npm cache 只读）。
5. 若 `W1/W2/W4` 任一发生变化 ⇒ **立即中止迁移**，按 R7 回滚并取证。

---

## 8. 未验证项与限制

1. **见证灵敏度未做真实重启验证**。以 §7.4 的历史 pid 漂移作间接证据；因硬约束禁止重启现役，**无法**做"重启一次 → 观察 W1/W2/W4 变化"的正向对照。W1 的 inode 复用风险（内核回收后重新分配同一 inode 号）**未实测**，理论上极低但未排除。
2. **`dsh-home-config.tgz`（897 MB, 09-11）只做了 `gzip -t` + 条目枚举**，**未解包做内容级哈希比对**，也未做恢复演练。其"可用性"属未验证。若需依赖它做灾备，须补 `tar -xzf` + 逐文件比对（预计解包 ~900 MB）。
3. **`~/dsh-upgrade-backup/self-built-plugins.tgz`（09-11）与 `patched-official-files.tgz`（09-11）未做内容比对**；从条目看分别为 2 插件与 3 条目，判定"不完整"基于**条目清单**而非哈希。
4. **`~/.dsh/backups/`（22 项）与 `~/.dsh/profiles-archive/web2-20260915-105429`（324 MB）未做恢复演练或内容验证**；"过期"判定基于时间（09-14 ~ 09-24）与体积/结构。
5. **3097 的宿主 pid 见证弱**：`~/.dsh-017/logs/dsh-logfile-lifecycle.jsonl` 最后一条为 09-28 07:57（早于其 `dsh-host.jsonl` 的 09-29 17:19），且其末行 pid（1254035）并非集合中的最大值（2852428）⇒ 该文件的"末行 pid"不可直接当作 3097 当前 pid。3097 的可靠见证是 **W1/W2/W3b**。
6. **0.2.0 侧未做任何端到端验证**（超出 T19 范围）：未安装 `0.2.0-rc.1`、未起 0.2.0 实例、未验证 0.2.0 能否读 0.1.1 的 sessions/storages/settings。**"迁移后能用"未被本轨道证明。**
7. **`0.1.7` 的插件解析未完全厘清**：`~/.dsh-017/profiles/web/cordis.patch.yml` 引用 `@deepseek-ai/dsh-vision-adam`，而现役 `~/.dsh/profiles/node_modules/@local` 中**已无**该插件；该引用在 3097 上的解析路径（是否落到别处/是否悬挂）**未验证**。同时 `~/.dsh-017` **无 `settings.yaml`**（仅 0 字节 `settings.yaml.imported`）⇒ 该实例的配置来源与 0.1.1 不同，迁移脚本不可假设两侧同构。
8. **本轮所有一致性结论均在合成库上做对照实验**（除 E4/E5/E6 在真实现役库上做的只读验证）。合成库与现役库在**页大小、表结构、写入模式**上已尽量对齐（`page_size=4096`、追加型事件表、`wal_autocheckpoint=1000`），但**现役库在真实高负载突发写入下的撕裂率未直接测量**（现役库无法被施加受控负载）。
9. **`VACUUM INTO` 期间现役写入方是否受影响**：实测快照耗时 95 ms / 39 ms，未观测到现役异常；但**未做**"快照期间现役写入延迟"的量化测量（需侵入性观测）。
10. **回滚序列中的 `$DSH020_PID` 未实现采集**：0.2.0 尚未启动，其 pid 采集方式（必然也是"日志内 pid"或启动时记录 `$!`）未验证。建议启动时用 `dsh ... & echo $! > "$BK/dsh020.pid"` 显式记录，而非事后从日志反查。

---

## 附：本轮产物与工具（均在 `.workspace/audit-020/t19/`）

| 文件 | 用途 |
|---|---|
| `witness.sh` | 未污染见证采集（6 组，只读，不用 `ps`）；`witness-BASELINE.txt` / `witness-T0.txt` / `witness-T1.txt` 为实测输出 |
| `manifest.sh` | 最小集合哈希清单生成/校验，含易变路径排除表；`manifest-T0.txt` 为实测清单（118 项全通过） |
| `snapverify.mjs` | SQLite 快照可验证性判据 V1–V6（`ACCEPT`/`REJECT` + staleness 水印） |
| `vacuum-into.mjs` | 对活跃 WAL 库执行 `{readOnly:true}`+`VACUUM INTO`，产物自验（拒覆盖已有快照）；快照生成的**唯一**正确入口 |
| `livetest.mjs` | 对只读源执行 `{readOnly:true}`+`VACUUM INTO` 并自验（E4 用） |
| `minbk-run.sh` | §4 最小集合打包脚本（实测 119 MB / 8 s） |
| `minset.sh` | 候选集合逐项体积/文件数测量（E9/§3 用） |

> 工具与清单中**不含**会话正文、密钥或原始会话 id。
