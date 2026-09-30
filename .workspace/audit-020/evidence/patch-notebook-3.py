#!/usr/bin/env python3
# 笔记本补丁批次 3：§7 新增 D36–D38；§8 新增未验证项 13–16
p = "docs/program-notebook.md"
s = open(p, encoding="utf-8").read()
orig = s


def rep(old, new, cnt=1, tag=""):
    global s
    n = s.count(old)
    assert n == cnt, f"[{tag}] 期望 {cnt} 处命中，实得 {n}: {old[:70]!r}"
    s = s.replace(old, new)
    print(f"  ok [{tag}]")


# ---------- §7 追加 D36–D38 ----------
anchor = "| D35 | **0.2.0 的 peer 闸门豁免值绑死内核精确版本**"
i = s.index(anchor)
eol = s.index("\n", i)
rows = "\n".join(
    [
        "| D36 | **0.2.0 设置面只暴露 `.volatile()` 字段 ⇒ 非 volatile 条目被整条跳过**（用户点名「设置命名空间未注册」的真因）："
        "`dsh-settings/lib/index.js:418-419` 对 `volatileForm(schema) === undefined` 的条目**整条 `return []`**（不报错、不出现在 served 列表），"
        "`:505-507` 的写入还会直接抛 `Plugin entry <ns> has no volatile fields`；客户端在命名空间不在 view 里时把快照置 `status:unavailable`"
        "（`dsh-client-ui-settings/lib/client.js:1226-1233`）。**`@local/dsh-subagent-model` 与 `@deepseek-ai/dsh-vision-adam` 的 `Config` 当时一个 volatile 字段都没有** ⇒ 设置页必然不可用。"
        "**教训与 D34 同型但不同门**：`import 成功` ≠ `客户端 inject 满足` ≠ **`SettingForms.describe()` 收录** —— 这是第三道独立门 | "
        "**已修**：两插件的设置字段加 `.volatile()`，并补 cosmokit 引用解包（`apply`/`current` 两条路径）；"
        "**drill 实证** served 25 → 27、`disabling` 0 | "
        "`reports/VOLATILE-FIX-VERIFY.md`（含 200 条 profile 条目可服务性登记表：缺口修复前 2 / 修复后 0）；"
        "`assembly-020/home/profiles/node_modules/{@local/dsh-subagent-model,@deepseek-ai/dsh-vision-adam}/lib/index.js`；官方同形 `dsh-agent-default-model/lib/index.js:21-25` |",
        "| D37 | **会话持久层的「物理布局」闸门：首帧不合法会导致整根被静默跳过**（本轮新发现，非回归）："
        "0.2.0 要求会话日志的**首帧恰好只有一行 header**（`dsh-session-persistence-jsonl/lib/index.js:2293-2295` `assertZstdHeaderFrame`；"
        "`:2951` `readZstdPrefix` 同断言），而 `:3040-3044`（`listArtifacts`）把该错误**静默 `continue`** ⇒ **整根枚举返 0 条**（无报错、无日志）。"
        "把 2508 份历史压成**单帧**时：**codec 层逐份解码 2508/2508 全通过，但 `listArtifacts` 枚举 0**；同内容**分帧**（frame#0 = header 单独成帧）后 gate 通过、枚举正常。"
        "⇒ **任何会话产物必须同时过 codec 闸门与物理闸门**，只用 catalog 解码会得到假绿 | "
        "**已修**（转换器改分帧，并新增独立闸门脚本） | `p0a/framecheck.mjs`；`p0a/verify/VERIFY-REPORT.md` §5（含 A/B 可复跑反证）；勘误 E9 |",
        "| D38 | **「Open in App」的可用性依赖宿主进程的桌面环境，而生产启动脚本用 `env -i` 清空环境**（用户点名）："
        "启动链 `dsh-host-open-in-app/lib/index.js:348-357` 以 `spawn(..., {detached:true, stdio:\"ignore\", env:{...scrubbedParentEnv(), ...options.env}})` 启动应用，"
        "而 `dsh-subprocess/lib/index.js:50-56` 的 `scrubbedParentEnv()` 是**凭据擦洗、不是白名单**（只剔除 `/KEY|PASSWORD|SECRET|TOKEN/i` 与 `DSH_*`；"
        "**`DISPLAY`/`WAYLAND_DISPLAY`/`XAUTHORITY`/`DBUS_SESSION_BUS_ADDRESS`/`XDG_RUNTIME_DIR` 全部 keep**）"
        "⇒ 桌面变量「宿主有则必转发」，断点唯一 = `boot-web.sh` 的 `env -i`。另两个限制同源：`stdio:\"ignore\"` **丢弃被启动应用的 stderr**；"
        "观察窗口（`launchWatchMs=1000`，`:366-367`）到期仍运行即判 `launched`、路由回 **200**（`:1390-1399` 的 200/502 映射）⇒ **「已发起」≠「窗口已出现」** | "
        "**已修（启动脚本，保留 `env -i` 与隔离）**：白名单 15 项从启动终端显式带入 + 无桌面会话时明确告警；真实窗口**未验收** | "
        "`reports/OPEN-IN-APP-FIX.md`；`docs/architecture/06-…md` 的组合/插件章节 |",
    ]
)
s = s[: eol + 1] + rows + "\n" + s[eol + 1 :]
print("  ok [§7 追加 D36-D38]")

# D35 补一句：peer 放宽后已解除对豁免文件的人工依赖
rep(
    "| **已修**（6 条豁免值升为 `0.2.0-rc.2`） | `assembly-020/home/profiles/web/compatibility.json`",
    "| **已修**（6 条豁免值升为 `0.2.0-rc.2`）；**接手轮进一步**：把 6 个插件（`subagent-model`/`vision-adam`/`taste`/`workerspace`/`dsh-pptmaster`/`web-search-sse`）的 peer 放宽为 "
    "`^0.1.x-rc.y \\|\\| ^0.2.0-rc.1`，**实测删掉 `compatibility.json` 后 `disabling` = 0** ⇒ 不再依赖该人工豁免文件（该文件仍须保留给其它条目） | "
    "`assembly-020/home/profiles/web/compatibility.json`",
    tag="D35 补注",
)

# ---------- §8 追加 13–16 ----------
anchor8 = "以上均标注为**未知**，不写入架构断言。"
assert s.count(anchor8) == 1
add8 = "\n".join(
    [
        "13. **接手轮的修复在 3098 里尚未生效**：两插件 `.volatile()` 与启动脚本桌面变量转发都**需要重启宿主**（宿主半是 ESM 模块，`hmr root: []` 不重载）。"
        "本轮只做到「drill 真启动 + 进程内探针 + RPC 实证」，**未重启 3098**（本会话就跑在该进程里）。⇒ 设置页与 Open in App 的**实际可用性未验证**。",
        "14. **GUI 层逐项未验收**：设置页表单的**点击保存**、识图工具调用、btw 侧聊面板、SSH 远端子功能**均未逐一验证**（本轮只做到进程内 + `/api/settings/describe` RPC 层）。"
        "另：`send_message` 在 GUI 里按设计渲染为**一行投递回执**（`dsh-client-ui-tool/lib/client.js:3338-3348`，正文在明细项 `description` 上），"
        "且**子代理会话不进左侧列表**（`dsh-client-ui-workspace/lib/client.js:357-366` 对 `origin === \"subagent\"` 返回 false）—— 复核时须走父会话的子代理目录。",
        "15. **切换前必须重取语料快照**（用户 2026-09-30 新裁决）：`~/.dsh/sessions` 是**活跃 append-only 根**（本轮冻结快照后又增长：+2 份、7 份被追加、单文件 +577 帧）。"
        "本轮 2508 份为**冻结时刻口径**，**不得当作切换终稿**；重跑入口：`p0a/{census.py,scan.mjs,framecheck.mjs,convert.mjs}`。",
        "16. **0.2.0 的 v0 codec 读不了 0.2.0 自己写出的 v0 日志**（上游缺陷，D22 裁决留待存量修完再报）：实测 10:55 后新写入 9 份中 **7 份当场被自家 codec 拒收**"
        "（header `version: 0` + `descriptor v2` + taste snapshot 无 `sections`）。⇒ 更准确的说法不是「0.2.0 读不了 0.1.1 的历史」，而是**写入侧形态与自家 codec 契约不一致**。",
    ]
)
s = s.replace(anchor8, add8 + "\n\n" + anchor8)
print("  ok [§8 追加 13-16]")

open(p, "w", encoding="utf-8").write(s)
print(f"\n完成：行数 {orig.count(chr(10))} -> {s.count(chr(10))}")
