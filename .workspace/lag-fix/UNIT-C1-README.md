# 单元 C1 — 官方客户端运行时三处性能补丁（交付物导航）

> 结论与证据请看 **`reports/unit-C1.md`**（本文件只做导航与快速上手）。

## 60 秒上手

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix

bash patches/client-runtime-perf.sh --dry-run              # 只动工作区副本，绝不写目标
bash patches/client-runtime-perf.sh --dry-run --only P1,P2 # 只看 P1+P2 子集（推荐路径）
bash patches/client-runtime-perf.sh --apply                # 真实应用（先备份到 backup/C1/）
bash patches/client-runtime-perf.sh --apply --only P1,P2   # 只应用 P1+P2
bash patches/client-runtime-perf.sh --rollback             # 用最新备份还原

node probes/equivalence-C1.mjs                             # 等价性单测（10 例）
node probes/bench-projectlist-C1.mjs --n 2361              # 微观基准（指向安装树=基线）
node probes/bench-projectlist-C1.mjs --n 2361 --file patched/client-runtime.client.js
node probes/measure-after-C1.mjs --window 20 --out reports/measure-after-C1.json   # 只读复测（应用后跑）
```

## 目录

| 路径 | 说明 |
|---|---|
| `reports/unit-C1.md` | **主报告**：逐条单元（锚点原文→替换后原文→验收命令→预期数字）、dry-run 实测输出与 diff、等价性单测、自复核结论、主 agent 命令序列 |
| `patches/client-runtime-perf.sh` | 补丁脚本（`--dry-run` / `--apply` / `--rollback` / `--only` / `--help`；幂等；锚点唯一命中校验） |
| `patches/unit-C1-clientspec.mjs` | 补丁规格（唯一真相源：锚点/替换文本，逐字节生成 + 基线 sha1） |
| `patches/unit-C1-fixer.mjs` | 确定性打补丁器（不写盘；交付态复核含「逐条新增行必须出现」） |
| `probes/equivalence-C1.mjs` | 等价性单测（真实代码区域逐字节抽取后对比执行；支持子集副本） |
| `probes/bench-projectlist-C1.mjs` | 微观基准（可指向基线或改后副本） |
| `probes/measure-after-C1.mjs` | 只读复测探针（rAF / CDP Performance / session.list 规模 / WS 帧率） |
| `probes/extract-C1.mjs` | 抽取工具（锚点定位 + 括号配对） |
| `patched/client-runtime.client.js` | 全量改后副本（sha1 `f7a0d8ab…`，`node --check` 通过） |
| `patched/client-runtime.client-only-P1-P2.js` | 仅 P1+P2 的改后副本（sha1 `867207a9…`） |
| `sandbox/C1/client.baseline-pristine.js` | 干净基线副本（`aba836a0…`）；live 已被应用时用它复现 dry-run 全绿 |
| `backup/C1/<stamp>/` | 单元独占备份根（`client-runtime.client.js` + `.sha1` + 带 `pre_sha1` 的 `META.txt`） |
| `evidence/unit-C1-client.diff` | 全量 diff（238 行 / 8 hunk / +148 −31） |
| `evidence/unit-C1-only-P1-P2.diff` | 子集 diff（138 行 / 4 hunk / +99 −11） |
| `reports/*.json`、`reports/.*.txt` | 基准 / 等价性 / dry-run 的原始输出 |

## 命名空间与回滚安全（与并行交付单元共存）

- 产物名**单元独占**：`patched/client-runtime.client.js`（不用裸 `client.js`；C2 用 `workspace-enhancement.client.js`）。
- 备份根**单元独占**：`backup/C1/`（A/B1 用 `backup/B1/`、C2 用 `patches/backup/C2/`）；工作副本在 `sandbox/C1/`。
- `--rollback` 四条所有权校验（fail-closed）：C1 标记文件 → `META.unit=C1` → `pre_sha1 == 备份实际内容 sha1`
  → `pre_sha1 ==` 本单元记录的补丁前 live sha（运行时从规格现读）。任一条不满足即 `[FAIL]` + 非零退出，**绝不写 live**。
- 已用三种异常备份（他档快照 / 伪装 unit / 被篡改）实测全部被拒；完整 apply→rollback 周期在 staging 跑通。
  详见 `reports/unit-C1.md` §1.5。

## 三条硬事实（先看这个）

1. **本档从未写 live**。`~/.dsh/profiles/.../dsh-client-runtime/lib/client.js` 目前在
   `a0fb4bb225d3…` = **主 agent 于 15:38 用旧版脚本应用的 P1+P2 子集**（P4 未应用，符合本档结论）。
   要复现 dry-run 全绿请用 `C1_TARGET=$PWD/sandbox/C1/client.baseline-pristine.js`（干净基线 `aba836a0…`）。
2. **P1 是主收益**：整段 `buildListSnapshot`（N=2361）**14.22ms → 0.37ms**；
   P2 让内容不变时 `list.set` 实参引用不变（3 次调用 3 个引用 → 1 个）。
3. **P4 实测是负收益**（单次 upsert 0.022→0.058ms；回放 64 次 0.96→3.14ms）。
   已按交付单元实现且语义等价（单测全绿），但**建议不应用** —— 推荐 `--only P1,P2`。
   依据与最小改法见 `reports/unit-C1.md` §4.2 / §4.3。
