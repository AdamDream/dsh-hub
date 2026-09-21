# 落地台账（LANDING-LOG）

- 日期：2026-09-21
- 口径：每个单元记录 **deployed 终态指纹 / pre-image / 生效面 / 已完成的验证 / 待重启后验证 / 回滚命令**

---

## 一、已落地（deployed 已写）

### 1. U-B1（宿主 apiproxy，冷面）
| 项 | 值 |
|---|---|
| 目标 | `~/.npm-global/.../dsh-host-apiproxy/lib/index.js` + `lib/types/api-proxy.js` |
| 终态 sha256 | `index.js 96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310`（217,279 B）<br>`api-proxy.js f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734`（175,895 B） |
| pre-image | `.workspace/lag-fix/backup/B1/server/b1fix2-20260921-165442/`（含 `MANIFEST.json` + `rollback.sh`）<br>权威回滚点仍是 `backup/B1/server/20260920-154039/lib/**`（`142aac84…`/`7f56fb80…`） |
| 生效面 | **冷面：需重启** |
| 已验 | `--apply` **39/39 PASS**（三态 pin、`§0-E2` 不变量双向钉死、24×2 锚点闸门、语法、V5/V6 标识符与首形参校验、写入后复查）；反事实 18/18；规格替换为 v2；哨兵夹具同批同步（含"不同步必假失败"对照） |
| 待重启后验 | A6 活体集合等式（`run-all.mjs --post`，升格硬断言）、`session.list` 200 与顶层行齐全、`runningSubagentCount` 覆盖 |
| 回滚 | 只认 `20260920-154039/lib/**`；⚠️ `b1fix-.../index.buggy.js`（`f568f8a9…`）是中间故障态，**不是** pre-image |

### 2. U-P2AC（客户端 runtime，热面）
| 项 | 值 |
|---|---|
| 目标 | `~/.npm-global/.../dsh-client-runtime/lib/client.js` |
| 终态 sha256 | `357f1703722464ee7fc40566f13e0ae4dd225131589862c8d1def67deb93d61f`（398,569 B） |
| 标记 | `/* p2ac-fix */` × **4** |
| pre-image | `exec-p2/preimage/20260921-165510/`（+`CANONICAL.txt`）；取自当前 live（非 R4 同名件） |
| 生效面 | **热面：刷新即生效**；served rev 已变 `5559de4ce28c`，磁盘 sha1-12 一致 |
| 已验 | 10/10 步：58/58 变体对拍、21/21 静态断言、改前态 18/18 + 候选态 18/18、S-IDENT、S-CUTOVER、反向对照 6/6（含真实 `ReferenceError`/TDZ）、沙箱彩排 apply/幂等/rollback |
| 边界 | **E2 活体只读判据 = INCONCLUSIVE**（残留只在浏览器内存，不落盘不出网络）⇒ 只由离线 harness 判定 |
| 回滚 | `node apply-P2AC.mjs --rollback`；次序铁律 **P2AC → B1/C1 → C1**，禁止用 C1 `--rollback` |

### 3. U-IG1 + U-IG3 + U-IG2 形状（usage 宿主，冷面）
| 项 | 值 |
|---|---|
| 目标 | `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/` |
| 终态 md5-12 | `db.js d187d44932b3`、`index.js 303cab977557`、`rpc.js fa2654ab8e05`、**新增** `ingest-worker.js 9dc04f44ec98`、**新增** `ingest-runner.js 23c88e510906` |
| pre-image | `exec-ingest/pre-image/`（含 `*.ABSENT` 标记两个新文件原本不存在） |
| 关键开关 | `INGEST_TIMER_ENABLED = **false**`（index.js 内 3 处出现；启用方式写在常量注释里：改 `true` + 重启） |
| 已验（沙箱） | E1 等价对拍 11 面×3 时区×3 lib = **9/9 byte-identical**；**G1 替代：worker 路径宿主事件循环 max 11.07/11.86 ms vs 同步 31,188/29,829 ms**；G2 单飞（runner+rpc 两层 10 并发→1）；G3 单测；G4 线程回基线 + 崩溃/停滞重建不重试；**U-IG3 A1–A5 全绿**（真实 sessions root 冷 fold `failed=0`，UNIQUE 11→0）；反向对照 4/4（CF-B 证明"仅 upsert"只是掩盖：`produced∖deleted=[08-21,08-22]`） |
| 待重启后验 | **G1 活体**（真实宿主进程内、含 RPC 同进程竞争；**必须避开 `monitorEventLoopDelay` 的 reset 陷阱**）、G3 活体计时、G4 真实插件 reload、**G5 原套件**（`ingest-equiv/run-suite.sh` 硬编码指向 deployed） |
| timer 铁律 | **G1 活体通过前不得开 `INGEST_TIMER_ENABLED`** |

### 4. U-CC1（CC 游标 off-by-one，冷面）
| 项 | 值 |
|---|---|
| 目标 | `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/ingest-cc.js` |
| 终态 md5-12 | `5763aee12811`；标记 `dsh-perf-fix CC-cursor v1` × **2** |
| pre-image | `.workspace/lag-fix/backup/CC-cursor-20260921-091207/pre-ingest-cc.js` |
| 已验 | 部署前：`LOSS_CONFIRMED`（未修）/ `NO_LOSS`（修）/ `SELF_HEAL_PASS`（遗留游标自愈）；补丁脚本锚点唯一命中 + 语法 + 标识符校验 |
| 待重启后验 | 在 deployed 上重跑 `repro-cc-cursor.mjs`（需给 `repro-legacy-migration.mjs` 加 `--fixed` 指向 deployed）与真实规模观察（`failedCc` 不再随 CC 增长累加） |

### 5. U-R4（usage 客户端 + 宿主生命周期，先前已落地）
- client 热面已验证（真实浏览器 before/after 哨兵对换：修复前 `222222→111111` 覆写复现；修复后终值 `222222` 且旧哨兵从未出现）
- host 冷面已在 14:37 重启中生效（`usage/status` ok、`ingest` 曾跑通一次）

---

## 二、待落地

### 6. U-TP（主题批，热面）—— **已落地**
| 项 | 值 |
|---|---|
| 目标 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js` + `@local/dsh-wallpaper/lib/client.js` |
| 终态 md5 | `layout 684622de7914eaae058985fbeca09076`（+? 行）、`wallpaper 885bde89e33c33fec4ef399ba00e907c`（597→610 行，Δ+13） |
| pre-image md5 | `layout af19ea709a1556b8c48bedfa8b31e785`、`wallpaper b9cd4747f91084065d1227fba5aa7e61`（备份 `exec-theme/backup/20260921092148.`） |
| 落地校验 | 2 组锚点唯一命中、候选身份比对、`node --check`、引入标识符声明校验（`shadedTokens`/`sameShadedTokens`）全 PASS |
| **生效证据** | 宿主 HTML 注入 rev **= 磁盘 sha1-12**（`ui-layout 82cca1a6178a`、`wallpaper 826d9217a8fc`），服务端下发字节同值 ⇒ **页面刷新即生效**（落地器提示"需重启"偏保守） |
| 默认批内容 | `(i)` 内容签名跳过重放 + `(ii-b)` 帧内 rAF 延后去重 + `(iv-a)` wallpaper 内容比较；`lastTokens` 守卫修正已含 |
| 未含 | `(0)` 实例去重（**未定性**，待 v2 探针 `CAPTURED` 结论）、`(iv-b)` ui-theme（opt-in 次批）、`(iii) cssText`（审计否决） |
| 验收 | `before` 已采（8 变体×3 场景，全部 EXCLUSIVE）；`after` 采集中；随后 `compare`（primary＝相对降幅，reference＝受污染基线项仅报告） |

**`before` 因果实验的关键结果（落地前、页内开关）**：切断强制重算后 `recalc` 208→0.4–11.4 ms/s、`busy` 291→7.5–22、`raf` 47.8→60.4/s、`p99` 116.7→16.8 ms；
而**丢掉整个 session 事件流**（D 变体）对 settings 几乎无效（raf 仍 47.8/53.5、p99 100、>50ms 仍 9/8）⇒ 靶点正确 + "会话事件不是原因"的第三条独立证据。

### 6.1 单元 (0) 探针 v1 失效根因（返工轮已修）
v1 安装 `Error.prepareStackTrace` 后**从不读取 `.stack`** —— V8 仅在 `.stack` 被访问时调用该 hook ⇒ hook 一次都没执行、`framesByFn` 恒空
⇒ 早期输出的 `instances=0 / single presenter` 是**尸检报告上的空白**。v2 已修根因并扩到五路口径（N1 栈函数对象 / N2 DOM `meta[name=theme-color]` 节点数 / N3 派发突发 / N4 profile 行数 + cordis 旁证），
判定改为三值 `CAPTURED / NOT-OBSERVED / INCONCLUSIVE-INSTRUMENT`，且 `--compare` 拒绝非 CAPTURED 结果。
该档同轮还自曝**更严重**的一处：静态扫描只覆盖 `*/lib/client.js`，**漏了 shell 编译产物** `dsh-web-frontend/dist/assets/index-C6eRlFa6.css`（含 `body{background:var(--dsw-alias-bg-base,#fff)}`）⇒ 其"无 body background 规则"结论错误。


---

## 三、重启批次（一次重启覆盖全部冷面）

```
dsh-usage（U-IG1 + U-IG3 + U-IG2 形状 + U-CC1）＋ apiproxy（U-B1）
```
**前置**：主题批的 before/after 测量已完成（重启会打断进行中的浏览器测量）。
**重启后必做**：G1 活体延迟闸门 → G3/G4/G5 → CC 复现 → B1 A6 活体断言 → `session.list`/usage 端点回归哨兵 → 再决定是否开 timer。
