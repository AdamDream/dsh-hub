# 投递器 Route B 改造：`lib/cli.js` 精确改法（**未落地**）

> 面向 `~/.local/lib/dsh-office-handoff/`（**只读源**，本工单不写）。
> `lib/api.js` 用 `p0c/deliverer-patch/api.route-b.js` **整份替换**（统一 diff 见
> `api.route-b.diff`）。下面 7 处是 `lib/cli.js` 的全部改动，按"搜索 → 替换"给出，
> 每处都带足够上下文，可逐条核对。行号以 2026-09-28 安装的那份为准（`owner` 清单里的
> sha256 可校验未被改过）。
>
> **本工单没有应用这些改动**（越界写入禁令）。改之前请先备份：
> `cp -a ~/.local/lib/dsh-office-handoff ~/.local/lib/dsh-office-handoff.pre-route-b`

---

## H1 · 导入（原第 24 行）

搜索：

```js
import { createWorkspace, probe, resolveOrigin } from "./api.js";
```

替换为：

```js
import { deliverFiles, probe, resolveOrigin, resolveRoute, resolveToken } from "./api.js";
```

---

## H2 · 选项默认值（`const options = {` … `rollbackOpId: null,` 之间）

搜索：

```js
    url: null,
    state: null,
```

替换为：

```js
    url: null,
    route: null,
    tokenFile: null,
    state: null,
```

---

## H3 · 选项解析（`assignOption` 的 `case "--url":` 之后）

搜索：

```js
      case "--url":
        options.url = value;
        break;
      case "--state":
```

替换为：

```js
      case "--url":
        options.url = value;
        break;
      case "--route":
        options.route = value;
        break;
      case "--token-file":
        options.tokenFile = value;
        break;
      case "--state":
```

---

## H4 · `usage()` 文案（`--url=` 那一行之后）

搜索：

```js
  --url=<origin>         目标 DSH 实例 origin。优先级：--url > $DSH_WEB_URL > http://127.0.0.1:3080
```

替换为：

```js
  --url=<origin>        目标 DSH 实例 origin。优先级：--url > $DSH_WEB_URL > http://127.0.0.1:3080
                        **Route B 起必须指向 0.2.0 实例**（本部署 3098），不是现役 3080。
  --route=<path>        Route B 落点。优先级：--route > $DSH_OFFICE_HANDOFF_ROUTE > /office-handoff
  --token-file=<path>   令牌文件（0600）。优先级：$DSH_OFFICE_ROUTE_B_TOKEN > --token-file
                        > $DSH_OFFICE_ROUTE_B_TOKEN_FILE > $DSH_HOME/office-handoff/route-b.token
```

> 说明：令牌**没有** `--token` 开关 —— 命令行参数会进 shell history 与 `ps`，
> 一律走环境变量或 600 权限的文件。

---

## H5 · origin 解析之后追加 route/token 解析（原第 806-808 行）

搜索：

```js
    const originInfo = resolveOrigin({ urlOption: parsed.options.url, env });
    report.origin = originInfo.origin;
    report.origin_source = originInfo.source;
```

替换为：

```js
    const originInfo = resolveOrigin({ urlOption: parsed.options.url, env });
    report.origin = originInfo.origin;
    report.origin_source = originInfo.source;

    /* ── ②' Route B 落点与令牌（令牌**只**进内存；report 里永远只写来源，不写值）── */
    const routeInfo = resolveRoute({ routeOption: parsed.options.route, env });
    report.route = routeInfo.route;
    report.route_source = routeInfo.source;

    let tokenInfo;
    try {
      tokenInfo = resolveToken({ env, tokenFileOption: parsed.options.tokenFile });
    } catch (error) {
      const refusal = toRefusal(error);
      report.refusal = refusal;
      report.decision = "refused";
      if (NOTIFY_REFUSAL_CODES.has(refusal.code)) sendUserNotice(refusal.message, logEvent);
      return finish(refusal.exitCode, [`投递令牌不可用：${refusal.message}`]);
    }
    report.token_source = tokenInfo.source;   // "env" | "file"，**不是值**
    report.token_file = tokenInfo.file;       // null 或路径；路径不是秘密
```

> `report` 里**只**出现 `token_source` / `token_file`。`deliverFiles()` 的成功/失败
> 结果里也不含令牌（已由 `p0c/deliverer-patch/selftest.mjs` 断言）。
> 若 `--json` 报告要被外部消费，建议在 `finish()` 前再套一层
> `report = redactReport(report, tokenInfo.token)` 兜底。

---

## H6 · 探针调用（原第 811 行）

搜索：

```js
    const probeResult = await probe(originInfo.origin);
```

替换为：

```js
    const probeResult = await probe(originInfo.origin, routeInfo.route);
```

并把紧随其后的 `report.probe` 行改为多带一个 `route`：

搜索：

```js
    report.probe = { ok: probeResult.ok, reason: probeResult.reason ?? null, httpStatus: probeResult.httpStatus ?? null, errno: probeResult.errno ?? null };
```

替换为：

```js
    report.probe = { ok: probeResult.ok, route: routeInfo.route, reason: probeResult.reason ?? null, httpStatus: probeResult.httpStatus ?? null, allow: probeResult.allow ?? null, errno: probeResult.errno ?? null };
```

> 语义变化：Route A 的探针判据是「200 + 合法信封 + `items` 是数组」；
> Route B 的判据是「**405 + `allow: POST`**」。两者的共同点是"零副作用"，
> 但**判据完全不同**，`spool` 里的 `reason: "api-<reason>"` 文案会从
> `api-not-a-dsh-instance` 变成 `api-route-missing` —— 消费 spool 的脚本要同步改。

---

## H7 · ⑥ 登记（原第 1035-1060 行，**最大的一处**）

搜索（多行，从注释到 `report.decision = "copied";` 之前）：

```js
    const created = await createWorkspace(originInfo.origin, workspaceReal);
    if (!created.ok) {
      const rollback = rollbackPublishedCopies(copies, logEvent);
      const written = journalSelfRollback(stateInfo.root, workspaceReal, copies, rollback, "workspace-create-failed", logEvent);
      recordRollbackOutcome(report, rollback, written, env);
      report.decision = "rolled-back";
      report.refusal = { code: created.code ?? created.reason, message: created.message ?? `workspace.create 失败：${created.reason}`, exitCode: EXIT.API_CREATE_FAILED };
      return finish(EXIT.API_CREATE_FAILED, [
        `登记工作区失败（${created.reason}${created.code ? `/${created.code}` : ""}）：${created.message ?? ""}`,
        ...rollbackSummaryLines(report, copies.length),
        ...report.notices.map((notice) => `提示：${notice}`),
      ]);
    }

    report.workspace = {
      workspaceId: created.workspace.workspaceId,
      path: created.workspace.path,
      title: created.workspace.title,
      created: created.created,
      sessionIds: created.workspace.sessionIds,
    };
    report.decision = "copied";
    if (!created.created) {
      report.notices.push("该目录已在工作区列表中（本次仍按副本另存，未覆盖同名文件）。");
    }
    return finish(0, [
      `已投递 ${copies.length} 个副本到 ${workspaceReal}`,
      ...copies.map((copy) => `  • ${copy.targetName}${copy.renamed ? "（同名已自动另名，未覆盖）" : ""} ← ${copy.targetPath}`),
      ...copies.map((copy) => `    可回滚 opId=${copy.opId}（手工：dsh-office-handoff --rollback=${copy.opId}）`),
      `工作区：${created.workspace.title}（${created.workspace.workspaceId}）${created.created ? "" : " — 该目录此前已登记"}`,
      `源文件未被修改：atime_preserved=${atimePreserved}（acceptance=${atimePreserved ? "source-metadata-unchanged" : "source-metadata-may-change"}）`,
      ...report.notices.map((notice) => `提示：${notice}`),
    ]);
```

替换为：

```js
    /* ── ⑥' 投递到 Route B：把**已经复制到位**的副本交给宿主规则 ───────────────
     * 语义变化（必须与 D17 的判决一起读）：
     *   * Route A 的 `workspace.create` 是**一元 RPC + 同步回执** ⇒ 报告里有
     *     `workspaceId` / `title` / `created`；
     *   * Route B 是**fire-and-forget**：宿主返回 **202**，且 202 **不代表**
     *     规则命中、更不代表会话建成（官方 README 原文）。因此这里**拿不到**
     *     workspaceId/title，报告里那几个字段改为明确的 `null` + 一句"异步发生"。
     *   * 反面收益：`workspace.create` 的"复制成功但登记失败"回滚路径消失了
     *     —— 登记失败时**副本仍在**（宿主侧 403/401 只是没建会话），
     *     所以仍然按原样回滚副本，语义与之前一致。
     */
    const delivered = await deliverFiles(
      originInfo.origin,
      routeInfo.route,
      tokenInfo.token,
      { workspacePath: workspaceReal, files: copies.map((copy) => copy.targetPath) },
    );
    if (!delivered.ok) {
      const rollback = rollbackPublishedCopies(copies, logEvent);
      const written = journalSelfRollback(stateInfo.root, workspaceReal, copies, rollback, `route-b-${delivered.reason}`, logEvent);
      recordRollbackOutcome(report, rollback, written, env);
      report.decision = "rolled-back";
      report.refusal = {
        code: delivered.code ?? delivered.reason,
        message: delivered.message ?? `Route B 投递失败：${delivered.reason}`,
        exitCode: EXIT.API_CREATE_FAILED,
      };
      return finish(EXIT.API_CREATE_FAILED, [
        `Route B 投递被拒（${delivered.reason}${delivered.code ? `/${delivered.code}` : ""}，HTTP ${delivered.httpStatus ?? "-"}）：${delivered.message ?? ""}`,
        ...rollbackSummaryLines(report, copies.length),
        ...report.notices.map((notice) => `提示：${notice}`),
      ]);
    }

    report.delivery = { accepted: true, status: delivered.status, route: routeInfo.route, files: copies.map((copy) => copy.targetPath) };
    report.workspace = { workspaceId: null, path: workspaceReal, title: null, created: "unknown", sessionIds: [] };
    report.decision = "copied";
    report.notices.push("宿主已 202 受理；工作区/会话由宿主侧规则**异步**创建（202 不代表已建成）。");
    return finish(0, [
      `已投递 ${copies.length} 个副本到 ${workspaceReal}，Route B 已受理（HTTP ${delivered.status}）`,
      ...copies.map((copy) => `  • ${copy.targetName}${copy.renamed ? "（同名已自动另名，未覆盖）" : ""} ← ${copy.targetPath}`),
      ...copies.map((copy) => `    可回滚 opId=${copy.opId}（手工：dsh-office-handoff --rollback=${copy.opId}）`),
      `工作区/会话在宿主侧异步出现（工作区根 ${workspaceReal}）；确认方式见 Runbook §4 的断言脚本`,
      `源文件未被修改：atime_preserved=${atimePreserved}（acceptance=${atimePreserved ? "source-metadata-unchanged" : "source-metadata-may-change"}）`,
      ...report.notices.map((notice) => `提示：${notice}`),
    ]);
```

---

## 未改但**必须复核**的两处

1. **`--workspace` 的默认值与宿主白名单必须同值。**
   默认是 `~/DSH-办公投递`（`DEFAULT_WORKSPACE_DIRNAME`，`lib/cli.js:50`），
   环境变量是 `DSH_OFFICE_HANDOFF_WORKSPACE`。
   宿主侧 `p0c/cordis.patch.insert.yml` 里写的是
   `!!js (process.env.HOME ?? '/tmp') + '/DSH-办公投递'`。
   **两者在同一个 `HOME` 下才一致** —— Nautilus 由桌面会话拉起，
   `HOME` 与从终端启动 dsh 时的 `HOME` 可能不同（本装配里 dsh 的 `HOME` 是
   `$A/home`）。Runbook §3 有一行命令把两侧钉死。

2. **`DSH_OFFICE_HANDOFF_FORBID_3080` 硬闸门保留。**
   Route B 起默认 origin 仍是 `http://127.0.0.1:3080`（`api.js` 的 `DEFAULT_ORIGIN`
   原样保留），所以 **0.2.0 实例必须显式给 `--url` 或 `$DSH_WEB_URL`**；
   配合 `DSH_OFFICE_HANDOFF_FORBID_3080=1` 可以确保右键流程永远不会误打现役 3080。

## 回归测试

改完后跑（**不投递、不动盘**）：

```bash
# 语法
node --check ~/.local/lib/dsh-office-handoff/lib/api.js
node --check ~/.local/lib/dsh-office-handoff/lib/cli.js

# 用法自检（不投递）
~/.local/bin/dsh-office-handoff --help | head -30

# dry-run（不确认、不复制、不登记、不写 spool）
DSH_OFFICE_HANDOFF_FORBID_3080=1 ~/.local/bin/dsh-office-handoff --dry-run --json -- ~/some.docx
```

> 本工单**没有**跑这三条（会读 `~/.local/**` 之外的真实文件、且 `--dry-run` 仍会
> 打印本机路径），标 **[未验证]**。
