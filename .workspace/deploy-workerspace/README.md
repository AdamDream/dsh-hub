# deploy-workerspace —— 交付物总览

> 底座（dsh-workspace-enhancement@0.1.2 rc.2 适配版）+ 自研薄插件（@local/dsh-workerspace）部署包。
> 目标宿主：@deepseek-ai/dsh 0.1.1-rc.2 / cordis 4.0.2 / node ≥22 / profile web。
> **staging 目录，不碰部署位**；真实安装由操作者按 RUNBOOK.md 执行。

```
deploy-workerspace/
├── README.md                     ← 本文件（总览）
├── base/                         ← 底座部署包
│   ├── dsh-workspace-enhancement-0.1.2.tgz   （npm pack 官方 tarball）
│   ├── tarball/package/          （原样展开）
│   ├── patch/
│   │   ├── dsh-workspace-enhancement-0.1.2-rc2.patch   （4 行 unified diff）
│   │   └── dsh-workspace-enhancement-0.1.2-rc2/        （部署副本）
│   ├── peer-deps-check.mjs / peer-deps-check-patched.mjs
│   ├── load-test2.mjs / loadtest/   （静态加载测试 staging）
│   ├── README.md                 （核对结论）
│   ├── cordis-insert.md          （装配片段 + settings 键）
│   └── client-slots.md           （slots/primitives 悬空结论）
├── dsh-workerspace/              ← 自研薄插件（@local/dsh-workerspace）
│   ├── package.json / README.md / LICENSE
│   ├── lib/{index,core,serial,flash}.js
│   └── test/{core,flash,serial}.test.mjs   （42 用例）
├── deploy.sh                     （dry-run 默认 / --apply / --rollback）
├── RUNBOOK.md                    （部署+验证+回滚）
└── self-review.md                （同档自复核 + 自裁决 + 问题清单）
```

## 快速开始
```bash
bash deploy.sh            # dry-run 看全量计划
bash deploy.sh --apply    # 目标机人工确认后安装
bash deploy.sh --rollback # 回滚
```
详见 RUNBOOK.md 与 base/README.md、dsh-workerspace/README.md。
报告：`.workspace/workerspace-exec.md`。
