# 底座装配：cordis insert 片段 + settings/config 键说明

> 目标：`~/.dsh/profiles/web/cordis.patch.yml`（本 profile 的补丁层，bundle 层后应用）。
> 本机装配事实：`cordis.yml` 为空数组；bundle 层 = `dsh.profile.bundles`（dsh-base、dsh-web-app）；
> 本地插件惯例 = 真实目录拷入 `~/.dsh/profiles/node_modules/` + profile patch insert 行
> （见 `~/.dsh/install-plugins.sh` 与 `local-facts.md` §E）。

## 路径 A（推荐，零网络、与本地惯例一致）：@local 拷贝 + 手工补丁

### A1. 拷贝底座到 profile 模块目录（loader 向上解析可命中）
```bash
FB="$HOME/.dsh/profiles/node_modules"
# 底座包名是**不带 scope** 的 dsh-workspace-enhancement（其 bundle patch 用裸名引用）
rm -rf "$FB/dsh-workspace-enhancement"
cp -r <deploy>/base/patch/dsh-workspace-enhancement-0.1.2-rc2 "$FB/dsh-workspace-enhancement"
# 底座唯一非官方依赖：
cd ~/.dsh/profiles/web && pnpm add ssh2@^1.16.0
```

### A2. 把底座 bundle patch 抄入 profile patch（等价的 3 disable + 3 insert）
底座自带 `cordis.patch.yml`（作为 bundle patch 层生效的前提是走 `dsh plugin add`；本地拷贝路径
下不会自动合成，需手工转录进 profile patch —— 内容逐条来自 `patch/dsh-workspace-enhancement-0.1.2-rc2/cordis.patch.yml`）：

```yaml
# ---- dsh-workspace-enhancement@0.1.2（底座：SSH 远程开发 + 多工作区）----
# 关闭默认 -auto picker（SSH 客户端 UI 接管 add-workspace 流程）
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true

# 本地 provider 行交由混合 provider（ctx.subprocess / ctx.fs 按 cwd 路由本地↔SSH）
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
  disabled: true

- id: fs-sandbox
  name: '@deepseek-ai/dsh-fs-sandbox'
  disabled: true

- insert:
    # ctx.ssh / ctx.subprocess / ctx.fs 三合一（占位连接，懒建立）
    - id: ssh-remote
      name: dsh-workspace-enhancement
      config:
        host: 127.0.0.1
        port: 22
        username: ssh
        cwd: /tmp

    # 本机/远程目录 browse 后端
    - id: directory-picker-ssh
      name: dsh-workspace-enhancement/picker
      config:
        maxEntries: 1000

    # 机器注册表 + /dsw RPC（持久化、连接管理、远程目录浏览）
    - id: ssh-web-channel
      name: dsh-workspace-enhancement/web
      config:
        maxEntries: 1000
```

> ⚠️ 语义提示（承接审计 §7.3）：上面 **disable 官方 3 行是对部署装配的接管** —— 装上后
> `ctx.subprocess` / `ctx.fs` 由底座混合 provider 接管（本地路径仍委托本地实现，行为等价）；
> 若只要底座工具面、不想接管缝，可只插 3 行 insert 而**不 disable**（风险自负：缝重复注册冲突）。
> 建议按底座原意整体转录，与作者在 rc.2 家族验证过的形态一致。

## 路径 B（官方通道，自动合成 bundle 层）：dsh plugin add
```bash
# 从本地适配副本安装（dsh plugin add 是 pnpm 薄转发 + reconcilePlugins：
# 声明 dsh.bundle.patch 的依赖会被加入 dsh.profile.bundles 层栈，boot 时自动应用底座补丁）
dsh plugin --profile web add "file:<deploy>/base/patch/dsh-workspace-enhancement-0.1.2-rc2"
# 或者从 npm 原包（peer 越界仅警告）+ 之后人工放宽：
#   dsh plugin --profile web add dsh-workspace-enhancement@0.1.2
```
> 走 B 时 profile patch 无需任何底座条目（bundle 层自动合成）；但依赖从 npm 解析，picker 双包会
> 装 0.1.0-rc.8 第二份 —— **优先 file: 本地适配副本**，保证单实例。

## 三行的 config/settings 键说明（源码级，lib/ 实测）

### `ssh-remote`（name: `dsh-workspace-enhancement`，SshRuntime + 混合 provider，lib/runtime.js）
| 键 | 类型/默认 | 说明 |
|---|---|---|
| `host` | string（patch 占位 `127.0.0.1`） | 默认连接目标；真实工作走注册表机器，此为占位 |
| `port` | number，默认 22 | |
| `username` | string | |
| `password` | string（secret） | 只写保存；0.1.4 起注册不再收凭据，凭据在注册表 |
| `privateKeyPath` | string（secret） | 私钥**路径**引用（不内联内容） |
| `passphrase` | string（secret） | 私钥口令 |
| `agent` | string | SSH agent 路径 |
| `cwd` | string（patch ` /tmp`） | 默认远端工作目录 |
| `readyTimeout` | number，默认 45000 | 连接握手超时（ms） |
| `strictHostKeyChecking` | boolean | 缺省走 `hostKeyMode`（默认 accept-new = TOFU） |
| `knownHosts` | string[] | known_hosts 路径集 |
| 多跳 | `jumps[]`（host/port/username/…/readyTimeout） | ProxyJump 链，逐跳 host-key 校验 |

### `directory-picker-ssh`（name: `dsh-workspace-enhancement/picker`，lib/picker.js）
| 键 | 默认 | 说明 |
|---|---|---|
| `maxEntries` | 1000 | browse 返回行数上限 |
| `remoteLabel` | — | 远端标签文案（未配则用内置默认） |
| `localLabel` | — | 本地标签文案 |

### `ssh-web-channel`（name: `dsh-workspace-enhancement/web`，lib/web.js + lib/registry.js）
| 键 | 默认 | 说明 |
|---|---|---|
| `stateFile` | `$DSH_HOME/dsh-ssh-connections.json`（legacy） | 旧状态文件迁移源 |
| `maxEntries` | 1000 | /dsw 列表上限 |
| `machinesFile` | `$DSH_HOME/remote-workspaces/machines.json` | **机器注册表单一事实源**（web UI 增删改） |
| `knownHostsFile` | DSH 默认 known_hosts | TOFU 指纹存储 |
| `secretsDir` | DSH 默认 secrets 目录 | OS 钥匙串/凭据落盘目录 |
| `hostKeyMode` | `accept-new` | `accept-new` / `verify` / `off` |
| `statusTtlMs` | 5000 | 状态缓存 TTL |

> **settings.yaml 说明**：底座的配置面是 **cordis 行 config**（上表），不是 settings 命名空间
> （它没有 `installSettingsSection` 命名空间段）；机器/密钥经 web UI 写入 `machines.json` +
> secretsDir，不进模型上下文。用户侧需要覆盖默认时，在 profile patch 里给对应行叠加 `config:` 键
> 即可（patch 层覆盖 bundle 层，底座自带注释明示该语义）。

## 与薄插件（dsh-workerspace）的分工
- 底座：远程主机登记 + 远端执行/文件（sw_* 工具 + 缝路由）→ 交叉编译复用其远端 bash。
- 薄插件：USB 串口 + 本地烧录 + 产物落盘（`ws_*` 工具），settings 命名空间 `dsh-workerspace`，
  主机连接**只引用底座**不重复实现（薄插件 hosts 键为引用性说明，见 dsh-workerspace/README.md）。
