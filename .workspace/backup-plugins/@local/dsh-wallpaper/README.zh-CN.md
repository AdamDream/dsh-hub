# @local/dsh-wallpaper

[English](README.md) | [简体中文](README.zh-CN.md)

DeepSeek Harness Web 的静态图片壁纸插件 —— 基于
[@frog755/dsh-wallpaper](https://github.com/Frog755/dsh-wallpaper) 0.4.0（MIT）
的本地 fork，适配本地 DSH **0.1.1-rc.2** 部署。

`@local/dsh-wallpaper` 会在 **设置 → 通用** 中增加一个壁纸设置项：

- 选择配置目标：**全局默认**、**首页**、**会话页** 或 **设置页**，
  每个页面可独立覆盖全局壁纸；
- 三种图片来源：文件上传（PNG / JPG / WebP / GIF，≤ 10 MB，原图保存）、
  远程 `http(s)` URL、或本机绝对路径（复制进壁纸目录，绝不直接对外提供原路径）；
- 调节图片上的**暗色遮罩**、界面表层**透明度**与**模糊**；
- 随时移除壁纸或清除某页的覆盖。

图片保存在 `~/.dsh/wallpapers/`，经私有回环路由提供。配置（全局默认与
各页覆盖）持久化在宿主用户设置文档（`~/.dsh/settings.yaml` 的 `wallpaper`
节），因此所有浏览器看到同一份壁纸，且变更实时同步。

## 与上游 0.4.0 的差异

- **移除 MP4 / ffmpeg 视频支持** —— 本 fork 仅支持静态图片。
- **删除固定 9191 端口的 webserver patch** —— 本部署 GUI 使用自己的端口，
  且持久化不再依赖浏览器 `localStorage`，固定 origin 已无必要。
- **图片不再在浏览器压缩为 data URL**。上传原图流式写入
  `~/.dsh/wallpapers/<uuid>.<ext>`（≤ 10 MB），壁纸引用媒体路由 URL。
- **持久化迁移到 `settings.yaml`**（上游为 `localStorage` +
  `~/.dsh/wallpapers/settings.json`）：宿主半注册 `wallpaper` 设置 namespace；
  浏览器半经 `settingsScope` 服务绑定，配置跨浏览器一致并实时更新。
- **新增 per-page 覆盖、暗色遮罩层、URL / 绝对路径来源**。

## 前置条件

- DeepSeek Harness **0.1.1-rc.2** Web profile；peer 依赖（`react`、
  `@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-settings`
  及 `dsh-client-*` 各包）由 DSH 宿主安装提供。
- 无需任何外部工具（不需要 ffmpeg）。

## 安装（本部署）

在包目录内运行自带安装脚本：

```bash
bash install.sh
```

脚本会把包复制到 `~/.dsh/profiles/node_modules/@local/dsh-wallpaper`
（扁平回退模块目录，沿用 `~/.dsh/install-plugins.sh` 的模式），并在
`~/.dsh/profiles/web/cordis.patch.yml` 追加激活条目：

```yaml
- insert:
    - id: wallpaper
      name: '@local/dsh-wallpaper'
```

重启 `npx @deepseek-ai/dsh web`，打开 **设置 → 通用 → 壁纸**。

## 设置结构（`~/.dsh/settings.yaml`）

```yaml
wallpaper:
  global:
    source: /dsh-wallpaper/media/<uuid>.png   # 媒体 URL、http(s) URL 或 null
    darkMask: 0        # 0..1 图片上的暗色遮罩
    opacity: 0.8       # 0..1 界面表层（基础 token）透明度
    blur: 0            # 0..60 px 壁纸模糊
  pages:
    home:      { ... }   # 可选覆盖；未设置的页面回落 global
    session:   { ... }
    settings:  { ... }
```

## 持久化内容

- `~/.dsh/settings.yaml`（`wallpaper` 节）：上述配置，所有浏览器共享。
- `~/.dsh/wallpapers/`：图片文件本身。替换或移除壁纸时，若无任何目标再
  引用该文件则删除；启动时清理未被引用的文件。
- 不使用任何 `localStorage` key；无浏览器本地状态。

设置服务不可用时，设置行降级为只读而不是崩溃。

## 开发

客户端 bundle 使用 DSH 的 `window.__ModuleLoader__.load` 格式，无需构建
步骤。由 `dsh-client-modules` 提供；`dsh-client-hmr` 监听内容变化并向
浏览器发送重建通知。

## 署名

上游插件：[@frog755/dsh-wallpaper](https://github.com/Frog755/dsh-wallpaper)
（MIT，© 2026 KinGao294 / Frog755），其本身派生自
[KinGao294/dsh-skin](https://github.com/KinGao294/dsh-skin) 的壁纸组件。
原版权声明保留于 [LICENSE](LICENSE)。
