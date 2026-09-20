# dsh-workerspace 修订执行复核一体档 —— 交付报告

- 档位：两阶段闭环第二阶段（修订执行复核一体，路由 adam/deepseek-v4-flash）
- 日期：2026-09-14
- 目标：按用户裁决落地「底座 dsh-workspace-enhancement@0.1.2（rc.2 原生，<50 行适配）+ 自研薄插件 @local/dsh-workerspace（SoC 本地面）」于 `.workspace/deploy-workerspace/`（staging，不碰部署位）
- 自裁决：**通过**（18/18 需求项达成或已标注偏差；42 单测 + 语法 + 静态加载全绿）

## 1. 结论式摘要

1. **底座**：`dsh-workspace-enhancement@0.1.2`（npm pack，sha256 与 research 一致）在 0.1.1-rc.2 上**改动面 4 行**（2 peer + 2 picker dep 从 `^0.1.0-rc.6` 放宽到 `^0.1.1-rc.2`）即全绿 —— 应用后 **13 个 @deepseek-ai deps + 2 peers 对本机 strict ✓**（消除 pnpm 装出第二份 picker 0.1.0-rc.8 的未核验实例）；**12 个 host 模块在本机 rc.2 树全部静态加载成功**，0.1.4-only 符号零命中，用的是 rc.2 的 `rpc.handle('/dsw')`。0.1.4 因硬依赖 rc.2 缺的 `connection.fetch`/`uiWorkspace` 不可跑（审计结论维持）。
2. **自研薄插件** `@local/dsh-workerspace`（零运行时依赖，无 client 注入）：`ws_serial_list/open/send/read/close`（会话式串口收发+日志，stty 零依赖默认后端 + serialport 可选后端）+ `ws_flash`（settings `flash.templates` 白名单模板：esptool/esptool.py/openocd/dfu-util/uuu/fastboot + `{{artifact:}}`/`{{credential:}}` 整 token 强校验 + 产物 realpath 围栏 + `ctx.approval.request` 高危确认模态 fail-closed + 输出脱敏 + 日志落盘）；settings 命名空间 `dsh-workerspace`（serial/flash.templates/artifacts.dir/security/hosts 全键）；产物默认落 `~/.dsh/workerspace/`（0700）。**未做** ws_upload/download（底座 fs 缝已覆盖远端文件传输，避免重复）与交叉编译（复用底座远端 bash）。**42 用例单测全绿 + node --check 4/4**，且在本机 rc.2 模块树静态加载成功、Config schema 行为实测通过。
3. **安全**：四道闸（命令白名单 / 占位符强校验+无 shell argv / 确认模态 / 脱敏），密钥一律 credential-ref（settings 只存引用，值经 `@deepseek-ai/dsh-credentials` 槽解析，明文永不进模型上下文/浏览器）——与 dsh-vision-adam 官方范式一致。
4. **部署**：`deploy.sh`（dry-run 默认 / --apply / --rollback，幂等）+ `RUNBOOK.md`（5.1–5.7 验证矩阵：工具列出 / 串口探测 / 烧录 dry-run 拒绝未授权模板 / 高危确认模态 / 日志落盘 + 回滚）。
5. **偏差上报**（问题清单 #1，请主 agent 裁决）：需求裁决给 0.1.2 底座列的「bwrap 沙箱 + 审批门」实为 **0.1.4 增量**（0.1.2 发布物 grep 零命中；审计 §4 证据）——本次按「改动面 <50 行」裁决取 0.1.2，缺口如实标注：薄插件已补本地面高危确认模态（ctx.approval），远端命令审批门未覆盖；若为硬需求需 0.1.4 backport（200–500 行）或升级 DSH。

## 2. 交付物清单（全部落 `.workspace/deploy-workerspace/`）

| 路径 | 内容 |
|---|---|
| `base/dsh-workspace-enhancement-0.1.2.tgz` | 底座官方 tarball（npm pack，sha256 与 research 一致） |
| `base/tarball/` | tarball 原样展开 |
| `base/patch/dsh-workspace-enhancement-0.1.2-rc2.patch` | **4 行 unified diff**（<50 行，无架构改动） |
| `base/patch/dsh-workspace-enhancement-0.1.2-rc2/` | 应用 diff 后的部署副本 |
| `base/peer-deps-check.mjs` / `-patched.mjs` | 13 deps + 2 peers 核对（原版/适配后，适配后全 strict ✓） |
| `base/load-test2.mjs` + `base/loadtest/` | 底座 12 host 模块静态加载测试（自包含 staging，不碰 ~/.dsh） |
| `base/README.md` / `cordis-insert.md` / `client-slots.md` | 底座说明 / cordis insert 片段 + settings 键 / client slots 悬空结论标注 |
| `dsh-workerspace/` | 薄插件源码（package.json + lib/{index,core,serial,flash}.js + test 3 文件 42 用例 + README + LICENSE） |
| `deploy.sh` | 部署脚本（dry-run/apply/rollback） |
| `RUNBOOK.md` | 部署 + 验证 + 回滚指引 |
| `self-review.md` | 同档自复核（逐需求核对表 + 自裁决 + 问题清单） |

## 3. 关键结论（供主 agent 决策）

- **底座选定**：0.1.2 ✓（唯一「rc.2 原生 + <50 行」选项；0.1.4 需 200–500 行 backport 且含未验证语义，不建议）。
- **薄插件**：按需求最小工具面实现，未扩范围；upload/download 与交叉编译按「避免重复/复用底座」裁决明确不做。
- **装后必须真 boot 冒烟**（RUNBOOK §5）：静态兼容 ≠ 能启动（作者 F1 教训）。
- **部署方式**：推荐本地拷贝 + profile patch 转录（与 install-plugins.sh 惯例一致）；`dsh plugin add file:` 为备选。
- **待裁决**：问题清单 #1（0.1.2 无审批门/bwrap 沙箱的取舍）。
