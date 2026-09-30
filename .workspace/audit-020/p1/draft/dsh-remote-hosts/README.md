# `@local/dsh-remote-hosts`（WP6 方案 1 · 代码草案）

把 0.1.1 侧栏的「分布式节点」树重新实现为 **0.2.0 右栏停靠面
（`@deepseek-ai/dsh-client-ui-sidebar-right`）的一个 tab 类型**。

**状态：草案。** 本目录没有被安装进任何 profile，`$A/home/profiles/…` 与现役
`~/.dsh/**`、`~/.dsh-017/**` 均未被改动。

## 文件

| 文件 | 作用 |
|---|---|
| `lib/client.js` | 客户端插件本体：一个 tab 类型（kind `remote-hosts`）+ 正文/标题两个 keyed 席位 |
| `lib/index.js` | host half：空 `apply()`（profile 行会 import main 入口，缺它会在 include 阶段报错） |
| `package.json` | `dsh.client.inject` 声明对 `dsh-client-connection` 与 `dsh-client-ui-sidebar-right` 的加载序依赖 |

## 落地步骤（**尚未执行**，需用户裁决后由执行档做）

```bash
# 1) 复制包（目标在 $A 的本地插件目录，与 @local/dsh-ssh-gui 同级）
cp -r p1/draft/dsh-remote-hosts \
      "$A/home/profiles/node_modules/@local/dsh-remote-hosts"

# 2) 在 $A/home/profiles/web/cordis.patch.yml 追加一行（该文件由协调者独占写入，需协调者执行）
#    - insert:
#        - id: remote-hosts
#          name: '@local/dsh-remote-hosts'

# 3) 只读复核：组合树里应出现该行且不带 disabled
grep -n -A3 "id: remote-hosts" "$A/logs/dump020b.yaml"
```

## 本地验收（不启动 web 服务）

```bash
bash p1/verify/run-all.sh     # 63 项断言，全部 PASS，退出码 0
```

## 上线验收（需要一次性实例，端口 3099，**不得**动 3080/3097/3098）

1. 右栏停靠面 tab 条的「添加控件」里出现「分布式节点」入口胶囊。
2. 点开后正文显示节点表；`nodes.json` 为空时显示空态文案。
3. 标题 chip 显示「🖧 分布式节点」。
4. 与旧行为对照：节点 CRUD 仍在 `settings.section`，本 tab 只读。

## 已知限制

- 正文第一版**只读**（列表 + 当前标记）。旧侧栏树的「展开 → 目录浏览 / 串口控制台」
  未移植；那部分依赖 `RemoteBrowser` / `SerialConsolePanel`，属 ssh-gui 内部组件，
  方案 2 才复用。
- `React.createElement` 走 `require("react")`，与 `@local/dsh-ssh-gui` 同一条零构建链路径。
