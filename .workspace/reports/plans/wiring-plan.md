# 接线计划（安装两个 fork 到本地 DSH 0.1.1-rc.2）

## 已确认机制（2026 实测）
- 本地插件安装模式（见 `~/.dsh/install-plugins.sh`）：把插件真实目录复制进
  `~/.dsh/profiles/node_modules/` 的 flat 回退目录（loader 从 `~/.dsh/profiles/web/` 向上解析命中它）。
- 官方包都在 `~/.dsh/profiles/node_modules/@deepseek-ai/`；本地插件 vision-adam 也放这里。
- profile 注册：`~/.dsh/profiles/web/cordis.patch.yml` 的 `insert` 列表（id + name 指向包名）；
  `profiles/web/package.json` 的 deps 无需加（vision-adam 就不在 deps 里，直接落 flat 目录 + insert）。
- cordis.yml 保持 `[]`，由 bundles + patch 组成。

## 安装步骤（执行产物出来后照做）
1. 复制 fork 包到 flat 回退目录（新 scope `@local/`）：
   ```bash
   mkdir -p ~/.dsh/profiles/node_modules/@local
   cp -r /home/CNS2026495165/dsh/dsh-btw ~/.dsh/profiles/node_modules/@local/dsh-btw
   cp -r /home/CNS2026495165/dsh/dsh-wallpaper-local ~/.dsh/profiles/node_modules/@local/dsh-wallpaper-local
   ```
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 追加两个 insert（id/name 用执行产物的实际值）：
   ```yaml
   - insert:
       - id: dsh-btw
         name: '@local/dsh-btw'
   - insert:
       - id: dsh-wallpaper-local
         name: '@local/dsh-wallpaper-local'
   ```
3. 重启 DSH（web-search header 修复也一并生效）：`npx @deepseek-ai/dsh web`
4. 验证：GUI 出现 btw 侧栏按钮 + 壁纸 Settings 卡片；上传图片落 `~/.dsh/wallpapers/`；
   壁纸重启后仍在（settings.yaml）。

## 注意
- fork 包名避免与上游 npm 包混淆（上游是 @lukeknow0/、@frog755/，本地 fork 用 @local/）。
- 绝对路径图片导入只复制进 MEDIA_ROOT，不 serve 任意路径。
