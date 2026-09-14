

## 实际数据一致性复核（2026-09-05，追加）

### 原因裁决

- 迁移脚本：`/home/CNS2026495165/dsh/dsh-taste/scripts/migrate-chinese-single-track.mjs`。脚本是 fail-closed 的受控词典/sidecar 精确匹配事务；无可靠候选会停在 staging，不会猜译。
- 实际 global：`/home/CNS2026495165/.dsh/taste/taste.md`，23 条；实际 project：`/home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/.dsh/taste/taste.md`，25 条；当前均为中文且所有 Confidence 均为两位小数。一级 category 文件实际未发现（0 个；因此无 category 条目可迁移）。
- 之前“committed 但 taste.md 仍英文”的矛盾来自报告记录与当前磁盘状态不一致：旧报告中的“committed”是 2026-09-03 迁移产物的历史状态，而其后/同一迁移批次的实际文件已是中文；本次 2026-09-05 重新读取确认磁盘并非英文。当前脚本 `--apply` 结果为两 scope `no-op`、整体 `committed`，表示已中文单轨、无需再次写入，而不是声称发生了新的文件提交。
- 旧 sidecar 不再使用：仅保留带时间戳的备份：
  - `/home/CNS2026495165/.dsh/taste/display.zh.json.migrated-backup-2026-09-03T09-06-15-960Z`
  - `/home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/.dsh/taste/display.zh.json.migrated-backup-2026-09-03T09-06-15-960Z`
  当前两个 scope 均无活动 `display.zh.json`。

### 事务与数据证据

- 实际命令：`node scripts/migrate-chinese-single-track.mjs --apply --global-dir /home/CNS2026495165/.dsh/taste --project-dir /home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/.dsh/taste --artifacts-root /tmp/dsh-taste-final`
- 产物 manifest：`/tmp/dsh-taste-final/dsh-taste-migration-2026-09-03T09-10-57-093Z/reports/manifest.json`；failure list：同目录 `reports/failure-list.json`。
- 结果：`status=committed`；global `no-op`（1 文件，23 条，0 失败）；project `no-op`（1 文件，25 条，0 失败）；Command Code 两个只读候选路径均“未发现”。由于两 scope 已无差异，本次事务按设计跳过写入/备份/sidecar rename，未破坏既有时间戳备份。
- 独立全量校验：global 23 条、project 25 条、category 0 条；非中文条目 0；Confidence 非两位小数 0。

### 同步与测试证据

- 已同步：`/home/CNS2026495165/dsh/dsh-taste/` → `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/`（`rsync -a`）。workspace 与安装目录的生产 `lib/*.js`、`config.example.json`、`README.md` SHA-256 一致；安装目录仅保留其原有额外历史审计文件/`translate.js`，未删除它们。
- `node --test test/*.test.js`：**212 passed / 0 failed / 212 total**。
- `node -e "import('./lib/index.js').then(()=>console.log('import ok'))"`：`import ok`。
- `node --check lib/client.js`：通过。
- `git diff --check`：通过。
- 未删除测试；本次未修改 collector、GUI 或业务实现行为；未新增长文档，仅追加本报告证据。

### 最终裁决

**pass**；`testsPassed: true`；`blockerCount: 0`。

## 本次实际复核与重跑证据（追加，2026-09-05）

- 工作区：`/home/CNS2026495165/dsh/dsh-taste`；迁移脚本：`/home/CNS2026495165/dsh/dsh-taste/scripts/migrate-chinese-single-track.mjs`。
- 原因确认：报告中的 `committed` 是迁移事务的整体终态（包括“无差异 no-op”）；并不等于该次一定重写了 taste.md。实际磁盘重新读取显示 global/project 已经是中文单轨，因此本次 `--apply` 对两个 scope 均为 `no-op`，整体状态 `committed`。工作区当时已有大量业务/UI/测试 diff；本次未改动这些业务代码，也未据此声称它们属于迁移提交。
- 实际 global 文件：`/home/CNS2026495165/.dsh/taste/taste.md`，23 条；实际 project 文件：`/home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/.dsh/taste/taste.md`，25 条；实际一级 category：0 个、0 条；合计 48 条。
- sidecar：两个 scope 均不存在活动 `display.zh.json`；仅保留带时间戳备份：
  - `/home/CNS2026495165/.dsh/taste/display.zh.json.migrated-backup-2026-09-03T09-06-15-960Z`
  - `/home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/.dsh/taste/display.zh.json.migrated-backup-2026-09-03T09-06-15-960Z`
- 受控事务命令：`node scripts/migrate-chinese-single-track.mjs --apply --global-dir /home/CNS2026495165/.dsh/taste --project-dir /home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/.dsh/taste --artifacts-root /tmp/dsh-taste-final-20260905`；实际产物：`/tmp/dsh-taste-final-20260905/dsh-taste-migration-2026-09-03T09-14-40-615Z/reports/manifest.json` 与同目录 `failure-list.json`；global/project 均 `no-op`、0 failures，整体 `committed`。脚本 selftest 为 5/5 PASS（含 staging fail-closed、category 提交/sidecar 时间戳备份、回滚）。
- 独立全量校验：global 23 条、project 25 条、category 0 条；非中文条目 0；Confidence 非两位小数 0。
- 同步：已执行 `rsync -a /home/CNS2026495165/dsh/dsh-taste/ /home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/`。workspace 与安装目录生产 `lib/*.js`、`config.example.json`、`README.md` 的 SHA-256 一致；安装目录既有额外历史文件未删除。
- 测试证据：`node --test test/*.test.js` → **212 passed / 0 failed / 212 total**；`node -e "import('./lib/index.js').then(()=>console.log('import ok'))"` → `import ok`；`node --check lib/client.js` → 通过；`git diff --check` → 通过。
- 范围约束：未删除测试、未新增长文档（仅追加本报告）、未修改 collector/GUI 行为；本轮无实际 taste 数据改写，因此无新的数据变更 blocker。

**本次最终裁决：pass；blockerCount: 0；testsPassed: true。**
