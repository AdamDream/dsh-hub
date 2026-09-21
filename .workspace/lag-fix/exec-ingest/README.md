# exec-ingest — Ingest-v1（B0 + B1，B2 只留开关）

**先读 `report.md`**（逐单元实施、真跑结果、G1–G5 沙箱/重启分区、与审计的偏差清单、自复核 PASS）。

本目录是**修订执行复核一体**档的交付物：候选件 + 补丁脚本 + 全部自证。
**本档未写工作区之外**；deployed 写入由主 agent 执行（脚本已就绪）。

## 一句话状态

- 等价对拍 **PASS**（11 面对拍 × 3 时区 × 3 个 lib，全 byte-identical，含真实 append 相位）
- G1 替代验证 **PASS**（worker 路径宿主事件循环 max **11.07 / 11.86 ms** ≪ 100 ms；同步对照 **31.2 s / 29.8 s**）
- G2 / G4 **PASS**（10 并发 → 1 fold；卸载无线程残留；崩溃/停滞 → 重建且不重试）
- U-IG3 A1–A5 **PASS**（真实 sessions root 冷 fold `UNIQUE=0`，原为 11）
- B2 timer **未启用**：`INGEST_TIMER_ENABLED = false`（铁律：G1 生产实测通过后再单独开）
- 全套件：`./tests/run-all.sh` → **INGEST-V1 SUITE EXIT: 0**

## 主 agent 的使用顺序

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-ingest

node apply-Ingest-v1.mjs                       # 1) dry-run（默认；锚点唯一 + 声明/导入/语法校验）
node apply-Ingest-v1.mjs --apply               # 2) 写入 deployed（自动 pre-image + 写后复核）
md5sum ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/{db.js,index.js,rpc.js,ingest-worker.js,ingest-runner.js}
#    期望 d187d44932b3 / 303cab977557 / fa2654ab8e05 / 9dc04f44ec98 / 23c88e510906
# 3) 冷面合并一次重启（B0+B1+U-CC1；U-IG2 不随本批启用）
# 4) 重启后按 report.md §7.3 验收；G1 活体通过后才翻 INGEST_TIMER_ENABLED
```

回滚：`patch-runs/pre-image/` 覆盖回去（两个新文件删除即回滚）。
运行级回滚不重新部署：`INGEST_VIA_WORKER = false` → 回到原同步 fold（`runIngestSync` 逐字保留）。

## 目录

| 路径 | 内容 |
|---|---|
| `apply-Ingest-v1.mjs` | 补丁脚本（dry-run 默认、fail-closed、pre-image、写后复核、幂等） |
| `candidates/` | 5 个候选件（已证明 == 脚本产物，见 `tests/verify-candidates.sh`） |
| `tests/` | 全部自证；`run-all.sh` 一键，原始 stdout 落 `out/*.stdout` |
| `out/` | 全部原始 JSON / 日志（report.md 引用的每个数字都在这里） |
| `tools/` | 沙箱机制探针：`probe-eld-reset.mjs`（**monitorEventLoopDelay 的 reset 陷阱**）、`probe-worker-*.mjs`、`probe-tempstore.mjs` |
| `stage/` | 隔离暂存 lib（`lib-cand` / `lib-origdb` / `lib-cand-ccfix` / `lib-orig`） |
| `scratch/`, `patch-runs/` | 临时库与 patch 运行产物（可删） |

## 复现

```bash
./tests/run-all.sh              # 除 G1 外全部（≈3 min）
./tests/run-all.sh --with-g1    # 含 G1（≈3 min，需机器相对安静）
./tests/verify-candidates.sh    # 候选件 == 脚本产物
```
