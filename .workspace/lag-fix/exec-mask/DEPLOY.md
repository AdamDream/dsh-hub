# DEPLOY.md — F1 deployment handoff (coordinator step)

**F1**: remove the full-viewport `backdrop-filter` from the settings-modal scrim `div.VOzbGW_mask`.

This write is **deliberately reserved for the coordinator**. I (the revise-execute-review line) could not
perform it: an attempted `--apply` against the deployed path failed with **EACCES** inside my sandbox
(`EACCES: permission denied, open '…/lib/.client.js.maskv1.<pid>.tmp'`), independently reproduced by an
adversarial reviewer whose sanctioned write-probe also returned `权限不够`. The deployed file was never
modified — it still hashes to the pre-image value below, and the deployed `lib/` directory is clean.

## 0. Freeze values (record these before you deploy)

| | |
|---|---|
| patch script | `apply-Mask-v1.mjs` sha256 `c2f04a48f6a62e19719705e7bb70cbc7ec9c5d7af9306c797d6469603c71d923` |
| script self-test | **37/37 PASS** (`node tools-mine/selftest-apply-Mask-v1.mjs --out raw/guardrails.json`) |
| pre-image | `9298ac5b087056555498550e0e0e6dd9d3202dce48bb07b2a2c4bfeed1d63da5` (26630 B, mode **664**) |
| candidate | `bd7edeaec382be264262c61933395b1fec6026dbedf57fd1be17a307cc899aec` (26593 B) |

If any of these differ from what you have, stop and re-derive — do not deploy a drifted artifact.

> ⚠ **Run the dry-run before the deployed apply and confirm the pre-image, because the script keeps
> its own naming.** The script records the pre-image as `preimage/client.js.<key>.pre` (key =
> `7873f2aa89b0` for this target) with a matching `manifest.<key>.json`. The `preimage/client.js.pre`
> file shipped in this folder is an **independent, byte-identical copy** kept for exactly that
> cross-check — it is not the file the script uses. So always confirm the live target first:
>
> ```bash
> node apply-Mask-v1.mjs --json    # expect: status=apply, reason=anchor-unique,
>                                  #         preSha256=9298ac5b087056555498550e0e0e6dd9d3202dce48bb07b2a2c4bfeed1d63da5
> ```
> If `preSha256` is not that value, **stop** — you are patching a different revision than the one
> measured.

---



## 1. Target (single file, single declaration)

| | |
|---|---|
| file | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` |
| line / col of the rule | **line 28**, column 704 |
| plugin | `@deepseek-ai/dsh-client-ui-settings-general` v0.1.1-rc.2 |
| mechanism | CSS **class** (not an inline style) — injected at runtime as `<style data-plugin-css="@deepseek-ai/dsh-client-ui-settings-general/SettingsRoot.module.css">` |
| served at | `http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js?rev=f733efde3f2f` |
| **face** | **HOT** — the served bytes are byte-identical to the on-disk file (verified by `curl` + sha256), and the module loader does **no** content-hash verification of `rev`. A page refresh is sufficient; **do not restart the host**. |

Pre-image sha256 (26630 bytes):

```
9298ac5b087056555498550e0e0e6dd9d3202dce48bb07b2a2c4bfeed1d63da5
```

## 2. The change

Delete exactly this 37-byte declaration from inside the one `.VOzbGW_mask{…}` rule:

```
backdrop-filter:var(--dsw-mask-blur);
```

before → after:

```css
.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);position:absolute;inset:0}
.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);position:absolute;inset:0}
```

Net effect: 26630 → 26593 bytes (−37), post-image sha256:

```
bd7edeaec382be264262c61933395b1fec6026dbedf57fd1be17a307cc899aec
```

Nothing else in the file changes; no JS control flow, no new DOM, no new CSS rule, no new class.
The scrim's `background:var(--dsw-alias-bg-mask-1)` (**`#0000003d` light / `#00000080` dark**) is
**untouched**, so the modal still dims its backdrop.

## 3. Deploy

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask

# 3a. preview (writes nothing) — expect status=apply, anchor-unique, node --check cjs=true esm=true
node apply-Mask-v1.mjs --json

# 3b. apply — captures the pre-image + manifest automatically, then writes atomically
node apply-Mask-v1.mjs --apply --json

# 3c. confirm — expect status=already-applied and the post sha256 above
node apply-Mask-v1.mjs --verify --json
sha256sum /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js
```

If your sandbox also denies the write, the script reports `status=write-denied` with the OS error and
**writes nothing** (all-or-nothing); perform the same byte replacement with your wider-access file tool
instead — the script already emitted the exact target bytes to `candidate/client.js`.

Then **refresh the GUI page** (no host restart). Verify in the browser console:

```js
getComputedStyle(document.querySelector('div[class*="_mask"]')).backdropFilter
// before: "blur(2px)"   after: "none"
```

## 4. Rollback (one step, no restart)

```bash
node apply-Mask-v1.mjs --rollback --json    # restores the recorded pre-image; refuses if the file drifted
```

`--rollback` only works against a manifest written by **this** script revision — do not mix script
generations. Use the **same `--target` spelling** you applied with if you want to be maximally
conservative, although path identity is now canonicalised (a directory alias and the real path
resolve to the same manifest key, and a `--target` change of spelling no longer silently disables
rollback — that defect was found by an adversarial reviewer and fixed).

The pre-image is also mirrored byte-for-byte at `preimage/client.js.pre`, so rollback is possible even
if the manifest is lost:

```bash
cp preimage/client.js.pre \
   /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js
```

## 5. Scope guards the script enforces (all mutation-tested, see `report.md` §4)

- dry-run is the default; only `--apply` writes.
- the anchor must occur **exactly once**; an ambiguous, absent, or already-patched-in-a-conflicting-way
  target is refused and **nothing is written**.
- **the patch is byte-exact**: the file is spliced as bytes and the result is asserted to differ by
  exactly one 37-byte deletion with every byte outside the anchor proven identical, so a target
  containing invalid UTF-8 is patched correctly rather than corrupted.
- `node --check` (parsed as **both** CJS and ESM) must pass on the post-image before the write commits.
- an existing pre-image with different content is never silently clobbered.
- the target's file **mode is preserved** across apply and restored by rollback.
- a **symlink** target is refused (a rename-over would have replaced the link itself).
- idempotent: a second `--apply` is a no-op; the file hash and mode do not change.
- `--rollback` refuses if the file drifted from the post-image it wrote, and refuses if the named
  target has no manifest entry (it never restores *another* target's pre-image).
- every failure path emits a machine-readable report and a non-zero exit rather than a bare stack trace.

## 6. What this does NOT cover

- **F2** (the full-viewport wallpaper layer's unconditional `background-image` rewrite) is a separate unit —
  not touched here.
- The `--dsw-mask-blur` **token** is deliberately left alone: it has **4 live consumers / 5 declarations**
  (`ui-settings-general` `.VOzbGW_mask`; `ui-attachment` `.fNh4Da_mask`; the `dsh-web-frontend` shell CSS
  `._mask_15u5s_14`, which declares it **twice** — `-webkit-backdrop-filter` and the standard property; and
  the third-party `@local/dsh-btw` `.SalQ5q_lightboxMask`), so a token change would be a much wider blast
  radius than F1's scope. The token is defined once (`ui-theme/lib/client.js:130`, `blur(2px)`) and the
  dark-theme block does **not** redefine it, so it is 2px in both themes.
- Any *other* place in the product that opens a `backdrop-filter` scrim still carries the same class of
  cost and is out of F1's scope. Enumerated from the live trees, for whoever picks this up next:
  `fNh4Da_mask` = the image lightbox, `BInVoG_mask` = the drag-drop overlay (**`blur(10px)`** — a wider
  kernel than the one removed here), `_mask_15u5s_14` = the generic modal mask, and `_onboardingMask_1cfrq_10`
  (a literal `blur(2px)`, spanning `top:80px` and so *not* a full-viewport case). The third-party
  `@local/dsh-btw` has one too. **None of these were measured**; the audit's finding was established only
  for the settings modal, so do not assume the others behave the same way.

---

## 7. ⚠ Durability — a dependency change silently reverts this patch

This patch edits a **shipped artifact inside `node_modules`**. The machine also holds:

| inode | bytes | path |
|---|---|---|
| 31346199 | 26630 | the deployed file (**this patch's target**) |
| 30948134 | 26630 | `~/.cache/yarn/v6/npm-@deepseek-ai-dsh-client-ui-settings-general-0.1.1-rc.2-…/lib/client.js` — **byte-identical pristine copy** |
| 31994037 | 29601 | `.dsh/profiles-archive/web2-20260915-105429/…` — an older build (different bytes) |

⇒ A `yarn` install, a `npm i`, or a `dsh` upgrade can restore the pristine bytes and **silently undo F1**,
with no error and no visible symptom other than the jank returning. **Re-run `--verify` (expect
`status=already-applied`, sha `bd7edeae…`) after any dependency or upgrade operation.** A proper upstream
fix belongs in the package source (`packages/client/ui-settings-general/src/client/SettingsRoot.module.css`),
which would also survive reinstalls.

## 8. What the script does NOT guarantee

- **`--rollback` must not be run concurrently with another writer in the target directory.** The target
  type-guard (`lstat` → symlink / non-regular refusal) is check-then-use, so it is **not atomic** with
  respect to the final `renameSync`. An adversarial reviewer demonstrated that a process able to replace the
  target path *during* a rollback can widen a ~18–30 ms window and get the symlink consumed while the
  rollback reports `rolled-back`. **Severity is low and it is not a privilege escalation** — such a writer
  could already modify the target directly — and it does not affect the normal deploy-then-rollback flow,
  where a regular file stays a regular file. Mitigation: **do not roll back while something else is writing
  that path.** This residual is disclosed rather than patched, because any further code change would
  invalidate the completed independent re-verification of this exact revision.


- **Multi-target atomicity.** Preflight is all-or-nothing across the target list, but the deployed spec has
  exactly one target, so the write is a single atomic temp-file + rename. The multiple-target case has no
  CLI surface and is therefore **not** a tested guarantee — an earlier revision advertised it; that wording
  was withdrawn after an adversarial review.
- **Byte-exactness is asserted, not assumed.** `classify()` splices as bytes and then asserts the length
  delta (exactly −37), the prefix bytes, the suffix bytes and the replacement span before writing. A target
  containing invalid UTF-8 is patched correctly rather than corrupted (regression case **C24**).

## 10. Verification status of this revision (for the record)

`apply-Mask-v1.mjs` sha256 `c2f04a48f6a62e19719705e7bb70cbc7ec9c5d7af9306c797d6469603c71d923` was
independently re-verified by an adversarial reviewer: every claimed fix substantively confirmed, the full
holds-list re-run green (19/19 — including byte-exactness, the syntax-gate-fires-before-any-pre-image-write
ordering, idempotency with stable sha **and** mode, and drift refusal), and the emitted bytes reproduced
exactly as `bd7edeae…`. The reviewer could not break the guard with any static target state
(symlink→pre-image-content, symlink→the pre-image file itself, FIFO, unix socket, mode-000 parent,
hardlink). The one residual is the concurrency window above. Transcripts:
`raw/adversarial/verify-final.md`, `verify4-*.txt|json`.

---

## 11. 交付确认（协调者要求逐项确认）+ 落地后复测口径

### 11.1 冻结值与命令（请以此为准）

| 项 | 值 |
|---|---|
| **部署目标** | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` （**第 28 行第 704 列**；CSS 类；运行时注入 `<style>`） |
| **pre-image sha256** | `9298ac5b087056555498550e0e0e6dd9d3202dce48bb07b2a2c4bfeed1d63da5`（26630 B，mode **664**） |
| **候选 sha256** | `bd7edeaec382be264262c61933395b1fec6026dbedf57fd1be17a307cc899aec`（26593 B） |
| **补丁脚本 sha256** | `c2f04a48f6a62e19719705e7bb70cbc7ec9c5d7af9306c797d6469603c71d923` |
| **脚本自测** | **37/37 PASS**（当前版本；协调者来信中的 "23/23" 是更早一版的数字，此后为 N1–N4/R0–R2 修复新增了 14 个用例） |

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask

# (1) 干跑——必须看到 status=apply / reason=anchor-unique / preSha256=9298ac5b…（不写任何文件）
node apply-Mask-v1.mjs --json

# (2) 落地（自动抓 pre-image + manifest，原子写入；写入被拒则一个文件都不写）
node apply-Mask-v1.mjs --apply --json

# (3) 确认
node apply-Mask-v1.mjs --verify --json      # 期望 status=already-applied
sha256sum /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js
# 期望 bd7edeaec382be264262c61933395b1fec6026dbedf57fd1be17a307cc899aec
```

**回滚（一步，无需重启）**

```bash
node apply-Mask-v1.mjs --rollback --json    # 从 manifest 记录的 pre-image 还原；文件已漂移则拒绝
# 或直接还原逐字节副本（manifest 丢失时）：
cp preimage/client.js.pre \
   /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js
```

> ⚠️ **请不要用 `served rev == 磁盘 sha 前 12 位` 做核对 —— 那会失败，且不是因为补丁没生效。**
> 已实测：URL 上的 `?rev=` **不是内容哈希**，服务端**忽略它**（`?rev=deadbeefdead`、`?rev=000000000000`、`?rev=`、以及完全不带 `rev` 都返回 **200 且字节相同**）；当前 boot manifest 给该插件的 `rev=f733efde3f2f`，而文件 sha256 以 `9298ac5b` 开头 —— 二者本就无关。
> **正确的核对方式（比较响应体的 sha256）**：
> ```bash
> curl -s "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js?rev=f733efde3f2f" \
>   | sha256sum
> # 落地前应为 9298ac5b…；落地 + 刷新后应为 bd7edeaec382…
> ```
> 另需注意：浏览器会缓存该脚本，**必须硬刷新**（Ctrl-Shift-R）后再核对。

### 11.2 刷新后的复测口径（可直接转给用户）

**客观复测（我方可跑，也可由用户跑）**
1. **页面内自证**（最强、不需要任何基准测试）：打开设置后，在控制台执行
   ```js
   getComputedStyle(document.querySelector('div[class$="_mask"]')).backdropFilter
   // 落地前: "blur(2px)"   落地后: "none"
   getComputedStyle(document.querySelector('div[class$="_mask"]')).backgroundColor
   // 两侧都应仍是 "rgba(0, 0, 0, 0.24)" —— 变暗未被改动
   document.querySelectorAll('*').length && [...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backdropFilter!=='none').length
   // 文档中非 none 的 backdrop-filter 元素数：落地后应为 0（该遮罩是全文档唯一一个）
   ```
2. **客观帧/LoAF 复测**（我方器械，同器械同口径）：`bash tools/campaign.sh` 会跑 `normal→patch→normal2` 三臂 × 3 rep；**主判据 = LoAF**（期望 `patch` 臂每个弹窗内相 `loafCount = 0`），副判据 = wall-clock 帧间隔（期望回到 ~16.7 ms 单 vsync 量级），`framesGt50` 只作相对 KPI。**注意**：`foreign` 非 0 属正常（用户 Chrome + 兄弟线），判读只用**同 rep 相邻配对**。
3. **RPC 侧**（与仪器口径无关，可直接计数）：切回「插件」栏目应在网络面板看到 **9 个 `/usage/*`**；这些**不受本补丁影响**，若用户仍觉切换卡顿，**下一梯队靶点就是它们**（见 `report.md` §10）。

**主观复测（请用户做，最直接）**
- 用户最初的抱怨动作是：**打开设置 → 来回切换「通用设置」/「模型」/「插件」→ 滚动列表**。
- 请在**硬刷新后**做同样的动作一遍，重点是**滚动那个 177 卡的长列表**（这是审计里抖动最大的相）。
- 请求用户给**一句话对比**（例如"滚动明显顺了 / 没好 / 更差"），并附一条：**缩放是否为 100%**（用户真实窗口 2560×1440；缩放会改变背衬像素数，是本次效应的自变量之一）。
- **预期**：本补丁消除的是**合成器侧 blur 重合成**造成的掉帧（本档实测 2560×1440 下 `LoAF` 条目 **34–36 → 0**、帧间隔上限 **81–84 ms → 18.6–20.4 ms**）；**若用户仍感到卡**，则说明残留来自**本补丁不覆盖的**来源，第一梯队就是 §10 的 T1/T2（`/usage/*` 每次切换重发 9 个、8 栏目无 keep-alive）。

### 11.3 耐久性（重申）
本补丁改的是 `node_modules` 内的**已发布产物**；机器上存在**字节相同的 pristine 副本**（yarn cache）。**任何 `yarn`/`npm` 安装或 `dsh` 升级都会静默还原它**——升级后请重跑 `--verify`。持久的修法在包源码 `packages/client/ui-settings-general/src/client/SettingsRoot.module.css`。
