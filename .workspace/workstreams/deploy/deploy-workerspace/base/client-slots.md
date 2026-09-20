# 底座 client 侧依赖说明：注入 6 包 + 5 slot + slots/primitives 悬空结论

> 结论先行：**client 侧运行不需要磁盘上的 slots/primitives 包**；底座 6 个注入包本机全装；
> 5 个目标 slot 在 rc.2 的 48 条 slot 目录里全部存在。按现状标注即可，无需补装。

## 1. dsh.client.inject（package.json，与 rc.2 全兼容）

```
inject: [ "@deepseek-ai/dsh-client-connection",
          "@deepseek-ai/dsh-client-locale",
          "@deepseek-ai/dsh-client-runtime",
          "@deepseek-ai/dsh-client-ui-conversation",
          "@deepseek-ai/dsh-client-ui-sidebar",
          "@deepseek-ai/dsh-client-ui-workspace" ]
platform: web
```

- 6 个包在本机 `0.1.1-rc.2` **全部已装**（`~/.dsh/profiles/node_modules/@deepseek-ai/` 实查，
  200 项真实软链含全部 6 个）→ 无缺失。
- `dsh.client.inject` 只作为元数据透传给浏览器（graphRow 的 inject 字段），host 侧不解析
  （`dsh-client-modules/lib/index.js`，local-facts.md §D4）。

## 2. 5 个目标 slot（client 侧注册，lib/client/index.js + lib/client/remote-status.js）

| slot 名 | kind | rc.2 slot 目录（48 条） |
|---|---|---|
| `conversation.hero.workspace.directoryFlow` | single | ✅ 存在 |
| `sidebar.workspaces.directoryFlow` | single | ✅ 存在 |
| `settings.section` | list | ✅ 存在（id=`dsh-workspace-enhancement`，order 40） |
| `conversation.session.header.actions` | list | ✅ 存在（id=`dsh-workspace-enhancement-side`，order 25） |
| `conversation.session.header.utilities` | list | ✅ 存在（REMOTE_STATUS_SLOT） |

依据：`.workspace/research/audit-workspace-enhancement.md` §5.4（rc.2 `dsh-cordis-client-runner/lib/client.js` 48 条 slot 目录逐条比对）。

## 3. slots / primitives 悬空结论（继承 local-facts.md §D，标注即可）

- 本机 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-slots` 与 `-primitives` 是
  **悬空软链**（指向已清理的 npx 缓存），共 52 项悬空之一。
- **运行不需要补**：
  1. web shell 内置**平台种子表**（`dsh-web-frontend/dist/assets/index-*.js` 的 `function Jd()`
     含 `"@deepseek-ai/dsh-client-ui-slots"` / `"@deepseek-ai/dsh-client-ui-primitives"`）——任何
     插件 client bundle 在浏览器里 `require()` 它们都能命中种子表，与 node_modules 无关。
  2. host 侧 `dsh-client-modules` 只对 **cordis loader entry 的名字**做 `require.resolve`；
     解析失败 → 该行静默跳过（客户端 UI 不出现），**不报错、不阻断启动**。
- **需要磁盘副本的 3 种情况**（底座均不涉及）：① 插件把包名当自身 cordis entry；② 插件 host 半
  import 它们；③ 本地 TS 构建/类型检查（如 dsh-btw 自带副本的用法）。
- 底座 host 半静态 import 的 18 个 `@deepseek-ai/*` 符号全部指向 **dsh-tools / dsh-fs /
  dsh-llm / dsh-subprocess / dsh-sandbox-policy / dsh-subprocess-local / dsh-fs-local /
  dsh-fs-sandbox / dsh-host-directory-picker(-native) / dsh-timeout / dsh-system-prompt /
  dsh-settings / dsh-session** —— 均非 slots/primitives（audit §5.1 18/18 存在）。
- **结论**：不补装，把悬空清单当「装插件前的核对清单」即可；本次 base 静态加载测试
  （load-test2.mjs）也证实 host 侧加载不触碰这两个包。

## 4. 装后验证项（真 boot 冒烟，Runbook 第 5 步）
1. 重启 `dsh web` 后无插件树加载错误（bundle 层合成成功：ssh-remote / directory-picker-ssh / ssh-web-channel 三行）。
2. GUI 工作区选择器出现「SSH 远端目录」入口（slots 生效，settings.section 出现 dsh-workspace-enhancement 设置页）。
3. 浏览器控制台无 `missed the module table` 报错（client bundle 加载正常）。
