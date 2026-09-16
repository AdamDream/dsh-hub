# examples/minimal-plugin —— 最小 @local 插件脚手架

> 目标：5 分钟跑通一个自装插件的全生命周期（拷贝 → cordis insert → 启动 → 模型可调工具）。
> 以 **@local/dsh-workerspace 薄插件**（零运行时依赖、host-only）为最小范本；
> 更多先例：`dsh-usage`（手写 client bundle）、`dsh-ssh-gui`（host + client 三槽注册）、
> `dsh-vision-adam`（settings 设置页）。

## 文件结构

```
examples/minimal-plugin/
  package.json    — @local/dsh-minimal-plugin（peer 依赖：cordis / dsh-tools / dsh-settings / schemastery）
  lib/index.js    — 最小 host 插件：name/inject/apply + 1 个示例工具 minimal_hello + 可选 settings 段
  lib/client.js   — 最小客户端骨架（**可选**：host-only 插件不需要；要 UI 才启用，见 §4）
```

## 1. 拷贝到 profile 模块目录

```bash
# 结果路径：~/.dsh/profiles/node_modules/@local/dsh-minimal-plugin/
cp -r examples/minimal-plugin ~/.dsh/profiles/node_modules/@local/dsh-minimal-plugin
# 预期输出：无（cp 静默成功）；核对：
ls ~/.dsh/profiles/node_modules/@local/dsh-minimal-plugin/lib/index.js
# 预期输出：~/.dsh/profiles/node_modules/@local/dsh-minimal-plugin/lib/index.js
```

## 2. 追加 cordis insert（备份先行）

在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加（**insert 的 name 必须是 bare 包名**——
P0-a 实测：用文件路径名 insert 会在运行实例 import 失败并整次回滚）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: minimal-plugin
      name: '@local/dsh-minimal-plugin'
```

## 3. 启动（二选一）

```bash
# 方式 A（推荐，P0-a 实测）：不重启，热载 —— insert 裸包名约 1s 生效
# 观测：curl -s http://127.0.0.1:3080/ | grep -o '"id":"[^"]*"' | grep minimal-plugin
# 预期输出：出现 "id":"@local/dsh-minimal-plugin"（graph 行 = 已挂载）

# 方式 B：重启（宿主 lib 代码改动后的标准路径）
.workspace/deploy-lag/dsh-restart.sh --dry-run   # 先预览
.workspace/deploy-lag/dsh-restart.sh --yes       # 一键优雅重启 + 冒烟 200
```

## 4. 启用客户端（可选）

- host-only 即可满足「模型可调工具」：**跳过本步**。
- 要 UI 时：在 package.json 增加 `dsh.client` 声明（client-modules 扫描活动 loader 条目的
  package.json，改后需重启 web 一次）：

```json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-settings"]
    }
  }
}
```

- client 模块 id 必须 == 包名（`@local/dsh-minimal-plugin`）；新 UI 槽用**新 id + 新 order**，
  不重复注册 single 槽（directoryFlow 等），避免 audit-d §3.3 的 picker 冲突教训。

## 5. 验证

```bash
# 新开会话，模型应能看到并调用 minimal_hello（可先问模型「列出可用工具里含 minimal 的」）
# 手工冒烟：settings 段
grep -n 'dsh-minimal-plugin' ~/.dsh/settings.yaml   # 有则见 greeting；无键 = 默认值（旧配置兼容）
```

## 6. 回滚

```bash
# 1) 从 cordis.patch.yml 删除 insert 条目（热载或重启生效）
# 2) 删除目录（可选）
rm -rf ~/.dsh/profiles/node_modules/@local/dsh-minimal-plugin
```

## 7. 本脚手架的纪律（写插件前先读）

- **id == 包名**（client 模块 id 必须等于 package.json name；master-runbook §1 事故 #6）。
- **工具名前缀**：`ws_`/`minimal_` 这类前缀避免与官方/其它插件重名。
- **安全**：高危操作走 `ctx.approval.request` 确认模态（fail-closed，见 workerspace ws_flash 先例）；
  密钥一律 credential-ref，明文永不进模型上下文/浏览器。
- **生效边界**（README 两条规则之二）：改 client bundle 刷新即生效；改宿主 lib 需重启。
- 完整插件惯例见 `.workspace/deploy-workerspace/`（薄插件全量源码 + RUNBOOK）与
  `.workspace/deploy-ssh-gui/`（host+client 框架）。
