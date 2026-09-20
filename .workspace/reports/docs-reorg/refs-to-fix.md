# 需要修改的路径引用清单（refs-to-fix）

> 由 `.workspace/docs-reorg/tools/gen_refs.py` 依据 `mapping.json` 机械生成（`git grep` 只读扫描，自动跳过 `.gitignore` 排除的备份目录）。

> 命中 **778** 处，分布 **153** 个文件。`自身档` 列 = 该行位于自身将被搬移的文件内。


## 0. 处置原则

| 类别 | 判定 | 处置 |
| --- | --- | --- |
| **①实链（必须改）** | Markdown 链接 `](path)`、可执行路径 `cd path` / `bash path` / `./x.sh` | 不改则链接或命令失效 |
| **②证据引用（可保留）** | 正文里 `\`file.md\`` 式的历史证据指认 | DOC-STYLE 明示「历史证据报告按落盘时的档期格式保留」；**只改路径不改语义**，也可整体保留并注明路径已迁移 |
| **③自身档** | 位于将被搬移的文件内部、指向自己的旧路径 | 随文件搬走；若同时是对外指路则一并改 |

> 说明：`mapping.json` 里的 `renamed` 字段只用于目录归位（如 `.workspace/acceptance-probe/` → `.workspace/probes/acceptance/`），
> **没有对任何单个 `.md` 报告做改名**，因此②类引用的文件名一律不变，只有所在目录变了。


---


## `.gitignore` （13 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 14 | `.workspace/repos/` | `.workspace/workstreams/research/repos/` | ②证据 |  |
| 15 | `.workspace/research-dsh-workerspace/repos/` | `.workspace/workstreams/research/research-dsh-workerspace/repos/` | ②证据 |  |
| 16 | `.workspace/tmp-ppt-research/` | `.workspace/workstreams/research/tmp-ppt-research/` | ②证据 |  |
| 17 | `.workspace/research/tarballs/` | `.workspace/workstreams/research/research/tarballs/` | ②证据 |  |
| 18 | `.workspace/research/tgz/` | `.workspace/workstreams/research/research/tgz/` | ②证据 |  |
| 19 | `.workspace/research/tarballs/` | `.workspace/workstreams/research/research/tarballs/` | ②证据 |  |
| 20 | `.workspace/deploy-pptmaster/skills/` | `.workspace/workstreams/deploy/deploy-pptmaster/skills/` | ②证据 |  |
| 21 | `.workspace/upstream-015-diff/pkgs/` | `.workspace/workstreams/upstream-015-diff/pkgs/` | ②证据 |  |
| 23 | `.workspace/deploy-lag/backup-*/` | `.workspace/workstreams/deploy/deploy-lag/backup-*/` | ②证据 |  |
| 24 | `.workspace/deploy-lag/sim/` | `.workspace/workstreams/deploy/deploy-lag/sim/` | ②证据 |  |
| 25 | `.workspace/research-luxweft-doc/` | `.workspace/workstreams/research/research-luxweft-doc/` | ②证据 |  |
| 29 | `.workspace/deploy-pptmaster/.venv-ppt-test/` | `.workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/` | ②证据 |  |
| 32 | `.workspace/mmt-probe/pasted-2048.png` | `.workspace/probes/mmt/pasted-2048.png` | ②证据 |  |

## `.workspace/acceptance-probe/brief-history-bigfile.md` （81 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- 待核声称来源：`.workspace/NEXT_SESSION_PROMPT.txt:138`` | `- 待核声称来源：`.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt:138`` | ②证据 |  |
| 7 | `> `| `dsh-hub` 历史里 51MB `.workspace/tmp-ppt-research/raw/mgr.tgz` | GitHub 持续告警；**保留 vs 重写历史待用户裁决** ` | `> `| `dsh-hub` 历史里 51MB `.workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz` | GitHub 持续告警` | ②证据 |  |
| 15 | `| 1 | 路径 `.workspace/tmp-ppt-research/raw/mgr.tgz` 在**历史**里 | 存在。blob `15dcbf4818e5bb93956c2e8266269` | `| 1 | 路径 `.workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz` 在**历史**里 | 存在。blob `15dcbf48` | ②证据 |  |
| 18 | `| 4 | 是否真触发告警 | **真触发了**，GitHub 原文点名该文件与该大小 | `remote: warning: File .workspace/tmp-ppt-research/raw` | `| 4 | 是否真触发告警 | **真触发了**，GitHub 原文点名该文件与该大小 | `remote: warning: File .workspace/workstreams/research` | ②证据 |  |
| 28 | `| **`HEAD` 里仍在被跟踪的最大单文件** | `.workspace/deploy-pptmaster/.venv-ppt-test/…` 共 **1817 个文件 / 51.62 MiB*` | `| **`HEAD` 里仍在被跟踪的最大单文件** | `.workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/…` 共 **18` | ②证据 |  |
| 51 | `$ git log --all --oneline -- '.workspace/tmp-ppt-research/raw/mgr.tgz'` | `$ git log --all --oneline -- '.workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz'` | ②证据 |  |
| 55 | `$ git log --all --pretty='%H %ad %s' --date=short -- '.workspace/tmp-ppt-research/raw/mgr.tgz'` | `$ git log --all --pretty='%H %ad %s' --date=short -- '.workspace/workstreams/research/tmp-ppt-resear` | ②证据 |  |
| 73 | `| 文件名 | `.workspace/tmp-ppt-research/raw/mgr.tgz` |` | `| 文件名 | `.workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz` |` | ②证据 |  |
| 103 | `53561751   51.08 MiB  .workspace/tmp-ppt-research/raw/mgr.tgz` | `53561751   51.08 MiB  .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz` | ②证据 |  |
| 104 | `7019133    6.69 MiB  .workspace/research/tarballs/bs-0.18.1/lib/client-mermaid.js` | `7019133    6.69 MiB  .workspace/workstreams/research/research/tarballs/bs-0.18.1/lib/client-mermaid.` | ②证据 |  |
| 105 | `7014225    6.69 MiB  .workspace/research/tarballs/bs-0.19.1/lib/client-mermaid.js` | `7014225    6.69 MiB  .workspace/workstreams/research/research/tarballs/bs-0.19.1/lib/client-mermaid.` | ②证据 |  |
| 106 | `7013349    6.69 MiB  .workspace/research/tarballs/bs-0.18.0/lib/client-mermaid.js` | `7013349    6.69 MiB  .workspace/workstreams/research/research/tarballs/bs-0.18.0/lib/client-mermaid.` | ②证据 |  |
| 107 | `7011871    6.69 MiB  .workspace/research/tarballs/bs-0.17.1/lib/client-mermaid.js` | `7011871    6.69 MiB  .workspace/workstreams/research/research/tarballs/bs-0.17.1/lib/client-mermaid.` | ②证据 |  |
| 108 | `7009820    6.69 MiB  .workspace/research/tarballs/bs-0.16.0/lib/client-mermaid.js` | `7009820    6.69 MiB  .workspace/workstreams/research/research/tarballs/bs-0.16.0/lib/client-mermaid.` | ②证据 |  |
| 109 | `6996658    6.67 MiB  .workspace/research/tarballs/bs-0.15.0/lib/client-mermaid.js` | `6996658    6.67 MiB  .workspace/workstreams/research/research/tarballs/bs-0.15.0/lib/client-mermaid.` | ②证据 |  |
| 110 | `6977165    6.65 MiB  .workspace/research/tarballs/bs-0.14.0/lib/client-mermaid.js` | `6977165    6.65 MiB  .workspace/workstreams/research/research/tarballs/bs-0.14.0/lib/client-mermaid.` | ②证据 |  |
| 111 | `5276624    5.03 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/lib/python3.12/site-packages/lxml/et` | `5276624    5.03 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/lib/python3.12/si` | ②证据 |  |
| 112 | `5203513    4.96 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/lib/python3.12/site-packages/pillow.` | `5203513    4.96 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/lib/python3.12/si` | ②证据 |  |
| 120 | `85.95 MiB  25 files  .workspace/research/tarballs` | `85.95 MiB  25 files  .workspace/workstreams/research/research/tarballs` | ②证据 |  |
| 121 | `59.34 MiB   6 files  .workspace/tmp-ppt-research/raw` | `59.34 MiB   6 files  .workspace/workstreams/research/tmp-ppt-research/raw` | ②证据 |  |
| 122 | `21.70 MiB   7 files  .workspace/deploy-pptmaster/.venv-ppt-test` | `21.70 MiB   7 files  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test` | ②证据 |  |
| 123 | `18.53 MiB  13 files  .workspace/deploy-pptmaster/skills` | `18.53 MiB  13 files  .workspace/workstreams/deploy/deploy-pptmaster/skills` | ②证据 |  |
| 124 | `7.30 MiB   2 files  .workspace/deploy-pptmaster/plugin` | `7.30 MiB   2 files  .workspace/workstreams/deploy/deploy-pptmaster/plugin` | ②证据 |  |
| 125 | `4.29 MiB   3 files  .workspace/research/tgz` | `4.29 MiB   3 files  .workspace/workstreams/research/research/tgz` | ②证据 |  |
| 126 | `2.49 MiB   1 files  .workspace/deploy-pptmaster/wb-src.tgz` | `2.49 MiB   1 files  .workspace/workstreams/deploy/deploy-pptmaster/wb-src.tgz` | ②证据 |  |
| 128 | `1.22 MiB   1 files  .workspace/upstream-015-diff/pkgs` | `1.22 MiB   1 files  .workspace/workstreams/upstream-015-diff/pkgs` | ②证据 |  |
| 139 | `MAX=53561751 bytes (51.08 MiB) .workspace/tmp-ppt-research/raw/mgr.tgz` | `MAX=53561751 bytes (51.08 MiB) .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz` | ②证据 |  |
| 228 | `5276624   5.03 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/lxml/etree.cpython-312-x86_64-linux` | `5276624   5.03 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/…/lxml/etree.cpyth` | ②证据 |  |
| 229 | `5203513   4.96 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/pillow.libs/libavif-8a7f9d56.so.16.` | `5203513   4.96 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/…/pillow.libs/liba` | ②证据 |  |
| 230 | `4096050   3.91 MiB  .workspace/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.js` | `4096050   3.91 MiB  .workspace/workstreams/deploy/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.j` | ②证据 |  |
| 231 | `3559243   3.39 MiB  .workspace/deploy-pptmaster/plugin/dsh-pptmaster/lib/index.js` | `3559243   3.39 MiB  .workspace/workstreams/deploy/deploy-pptmaster/plugin/dsh-pptmaster/lib/index.js` | ②证据 |  |
| 232 | `3402345   3.24 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/PIL/_imaging.cpython-312-x86_64-lin` | `3402345   3.24 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/…/PIL/_imaging.cpy` | ②证据 |  |
| 233 | `2920920   2.79 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/lxml/objectify.cpython-312-x86_64-l` | `2920920   2.79 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/…/lxml/objectify.c` | ②证据 |  |
| 234 | `2679264   2.56 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/yaml/_yaml.cpython-312-x86_64-linux` | `2679264   2.56 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/…/yaml/_yaml.cpyth` | ②证据 |  |
| 235 | `2608867   2.49 MiB  .workspace/deploy-pptmaster/wb-src.tgz` | `2608867   2.49 MiB  .workspace/workstreams/deploy/deploy-pptmaster/wb-src.tgz` | ②证据 |  |
| 236 | `1800497   1.72 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/pillow.libs/libzstd-44be1190.so.1.5` | `1800497   1.72 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/…/pillow.libs/libz` | ②证据 |  |
| 239 | `1467713   1.40 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/libfreetype-9fc94c80.so.6.20.6` | `1467713   1.40 MiB  .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/…/libfreetype-9fc9` | ②证据 |  |
| 244 | `61.65 MiB  1885 files  .workspace/deploy-pptmaster` | `61.65 MiB  1885 files  .workspace/workstreams/deploy/deploy-pptmaster` | ②证据 |  |
| 246 | `5.96 MiB   384 files  .workspace/deploy-workerspace` | `5.96 MiB   384 files  .workspace/workstreams/deploy/deploy-workerspace` | ②证据 |  |
| 317 | `-rw-rw-r-- 117  9月 14 11:00 .workspace/push-log2.txt` | `-rw-rw-r-- 117  9月 14 11:00 .workspace/reports/push-logs/push-log2.txt` | ②证据 |  |
| 319 | `-rw-rw-r-- 2189 9月 14 10:50 .workspace/push-log.txt       # ← 另一码事：secret 扫描拒绝` | `-rw-rw-r-- 2189 9月 14 10:50 .workspace/reports/push-logs/push-log.txt       # ← 另一码事：secret 扫描拒绝` | ②证据 |  |
| 323 | `remote: warning: File .workspace/tmp-ppt-research/raw/mgr.tgz is 51.08 MB; this is larger than GitHu` | `remote: warning: File .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz is 51.08 MB; this` | ②证据 |  |
| 366 | `14	.workspace/repos/` | `14	.workspace/workstreams/research/repos/` | ②证据 |  |
| 367 | `15	.workspace/research-dsh-workerspace/repos/` | `15	.workspace/workstreams/research/research-dsh-workerspace/repos/` | ②证据 |  |
| 368 | `16	.workspace/tmp-ppt-research/        # ← mgr.tgz 就此被忽略` | `16	.workspace/workstreams/research/tmp-ppt-research/        # ← mgr.tgz 就此被忽略` | ②证据 |  |
| 369 | `17	.workspace/research/tarballs/` | `17	.workspace/workstreams/research/research/tarballs/` | ②证据 |  |
| 370 | `18	.workspace/research/tgz/` | `18	.workspace/workstreams/research/research/tgz/` | ②证据 |  |
| 371 | `19	.workspace/research/tarballs/        # ← 与 17 行重复（可清理）` | `19	.workspace/workstreams/research/research/tarballs/        # ← 与 17 行重复（可清理）` | ②证据 |  |
| 372 | `20	.workspace/deploy-pptmaster/skills/` | `20	.workspace/workstreams/deploy/deploy-pptmaster/skills/` | ②证据 |  |
| 373 | `21	.workspace/upstream-015-diff/pkgs/` | `21	.workspace/workstreams/upstream-015-diff/pkgs/` | ②证据 |  |
| 375 | `23	.workspace/deploy-lag/backup-*/` | `23	.workspace/workstreams/deploy/deploy-lag/backup-*/` | ②证据 |  |
| 376 | `24	.workspace/deploy-lag/sim/` | `24	.workspace/workstreams/deploy/deploy-lag/sim/` | ②证据 |  |
| 377 | `25	.workspace/research-luxweft-doc/` | `25	.workspace/workstreams/research/research-luxweft-doc/` | ②证据 |  |
| 379 | `$ git check-ignore -v .workspace/tmp-ppt-research/raw/mgr.tgz` | `$ git check-ignore -v .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz` | ②证据 |  |
| 380 | `.gitignore:16:.workspace/tmp-ppt-research/	.workspace/tmp-ppt-research/raw/mgr.tgz` | `.gitignore:16:.workspace/workstreams/research/tmp-ppt-research/	.workspace/workstreams/research/tmp-` | ②证据 |  |
| 386 | `$ for p in .workspace/deploy-pptmaster/.venv-ppt-test/ .workspace/deploy-pptmaster/wb-src.tgz \` | `$ for p in .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/ .workspace/workstreams/dep` | ②证据 |  |
| 387 | `.workspace/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.js \` | `.workspace/workstreams/deploy/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.js \` | ②证据 |  |
| 388 | `dsh-btw/docs/assets/installed.png .workspace/tmp-ppt-research/raw/mgr.tgz; do` | `dsh-btw/docs/assets/installed.png .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz; do` | ②证据 |  |
| 390 | `.workspace/deploy-pptmaster/.venv-ppt-test/                    NOT ignored` | `.workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/                    NOT ignored` | ②证据 |  |
| 391 | `.workspace/deploy-pptmaster/wb-src.tgz                         NOT ignored` | `.workspace/workstreams/deploy/deploy-pptmaster/wb-src.tgz                         NOT ignored` | ②证据 |  |
| 392 | `.workspace/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.js NOT ignored` | `.workspace/workstreams/deploy/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.js NOT ignored` | ②证据 |  |
| 394 | `.workspace/tmp-ppt-research/raw/mgr.tgz                        IGNORED` | `.workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz                        IGNORED` | ②证据 |  |
| 398 | `$ git log --oneline --diff-filter=A -- .workspace/deploy-pptmaster/.venv-ppt-test` | `$ git log --oneline --diff-filter=A -- .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test` | ②证据 |  |
| 400 | `$ git log --oneline --diff-filter=A -- .workspace/deploy-pptmaster/wb-src.tgz` | `$ git log --oneline --diff-filter=A -- .workspace/workstreams/deploy/deploy-pptmaster/wb-src.tgz` | ②证据 |  |
| 454 | `git check-ignore -q .workspace/deploy-pptmaster/.venv-ppt-test/ && echo IGNORED || echo "NOT ignored` | `git check-ignore -q .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/ && echo IGNORED |` | ②证据 |  |
| 457 | `git rm -r --cached .workspace/deploy-pptmaster/.venv-ppt-test` | `git rm -r --cached .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test` | ②证据 |  |
| 460 | `printf '\n# 本地 Python 虚拟环境（测试用，不入库）\n.workspace/deploy-pptmaster/.venv-ppt-test/\n' >> .gitignore` | `printf '\n# 本地 Python 虚拟环境（测试用，不入库）\n.workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/\` | ②证据 |  |
| 463 | `#    （第 17 行与第 19 行都是 .workspace/research/tarballs/）` | `#    （第 17 行与第 19 行都是 .workspace/workstreams/research/research/tarballs/）` | ②证据 |  |
| 472 | `> ⚠️ 上面 ③ 刻意**只加 venv 一行**：`git ls-tree -r HEAD --name-only | grep -c '\.tgz$'` = **27**，全局 `*.tgz` ` | `> ⚠️ 上面 ③ 刻意**只加 venv 一行**：`git ls-tree -r HEAD --name-only | grep -c '\.tgz$'` = **27**，全局 `*.tgz` ` | ②证据 |  |
| 502 | `**若同时清理其余死历史**（`.workspace/research/tarballs/`、`.venv-ppt-test/`、`skills/`、`wb-src.tgz` 等）：这些由 `88c6` | `**若同时清理其余死历史**（`.workspace/workstreams/research/research/tarballs/`、`.venv-ppt-test/`、`skills/`、`wb-` | ②证据 |  |
| 548 | `#   'git rm --cached --ignore-unmatch .workspace/tmp-ppt-research/raw/mgr.tgz' -- --all` | `#   'git rm --cached --ignore-unmatch .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz' ` | ②证据 |  |
| 559 | `--path .workspace/tmp-ppt-research/raw/mgr.tgz --invert-paths` | `--path .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz --invert-paths` | ②证据 |  |
| 577 | `--path .workspace/tmp-ppt-research/        --invert-paths \` | `--path .workspace/workstreams/research/tmp-ppt-research/        --invert-paths \` | ②证据 |  |
| 578 | `--path .workspace/research/tarballs/       --invert-paths \` | `--path .workspace/workstreams/research/research/tarballs/       --invert-paths \` | ②证据 |  |
| 579 | `--path .workspace/research/tgz/            --invert-paths \` | `--path .workspace/workstreams/research/research/tgz/            --invert-paths \` | ②证据 |  |
| 580 | `--path .workspace/deploy-pptmaster/skills/ --invert-paths \` | `--path .workspace/workstreams/deploy/deploy-pptmaster/skills/ --invert-paths \` | ②证据 |  |
| 581 | `--path .workspace/deploy-pptmaster/.venv-ppt-test/ --invert-paths \` | `--path .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/ --invert-paths \` | ②证据 |  |
| 582 | `--path .workspace/deploy-pptmaster/wb-src.tgz      --invert-paths \` | `--path .workspace/workstreams/deploy/deploy-pptmaster/wb-src.tgz      --invert-paths \` | ②证据 |  |
| 583 | `--path .workspace/upstream-015-diff/pkgs/  --invert-paths` | `--path .workspace/workstreams/upstream-015-diff/pkgs/  --invert-paths` | ②证据 |  |
| 601 | `--path .workspace/tmp-ppt-research/raw/mgr.tgz --invert-paths` | `--path .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz --invert-paths` | ②证据 |  |
| 718 | `1. `git rm -r --cached .workspace/deploy-pptmaster/.venv-ppt-test` + 追加 `.gitignore` 一行（见 §2.A 命令块）；` | `1. `git rm -r --cached .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test` + 追加 `.gitigno` | ②证据 |  |

## `.workspace/acceptance-exec.md` （36 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 72 | `.workspace/deploy-subagent-model/dsh-tool-subagent.index.js.patched` | `.workspace/workstreams/deploy/deploy-subagent-model/dsh-tool-subagent.index.js.patched` | ②证据 |  |
| 125 | `**独立复核（`.workspace/acceptance-probe/verify-goal-gate.md`，271 行，观测窗口 18:16:14→18:32:14）**` | `**独立复核（`.workspace/probes/acceptance/verify-goal-gate.md`，271 行，观测窗口 18:16:14→18:32:14）**` | ②证据 |  |
| 135 | `- `node --check` 通过；sha `c4f3ea68…` → **`4351e1742d3a6db1deb3b95e5006976e10b15c897362eb4518a0e42fcec` | `- `node --check` 通过；sha `c4f3ea68…` → **`4351e1742d3a6db1deb3b95e5006976e10b15c897362eb4518a0e42fcec` | ②证据 |  |
| 181 | `- **真实多模态实测**（`.workspace/mmt-probe/RESULTS.md`）：v4.1-flash 原生识图可用（UI 截图大字/色值逐字命中 **15/17**）；对照组 `de` | `- **真实多模态实测**（`.workspace/probes/mmt/RESULTS.md`）：v4.1-flash 原生识图可用（UI 截图大字/色值逐字命中 **15/17**）；对照组 `d` | ②证据 |  |
| 207 | `### 3.1 预检：GO + 1 红灯（R1）— `.workspace/acceptance-probe/preflight.md`` | `### 3.1 预检：GO + 1 红灯（R1）— `.workspace/probes/acceptance/preflight.md`` | ②证据 |  |
| 237 | `### 3.3 历史大文件：交接声称半成立，且发现真正的扩散源 — `.workspace/acceptance-probe/brief-history-bigfile.md`` | `### 3.3 历史大文件：交接声称半成立，且发现真正的扩散源 — `.workspace/probes/acceptance/brief-history-bigfile.md`` | ②证据 |  |
| 241 | `| 历史含 `.workspace/tmp-ppt-research/raw/mgr.tgz`（51MB） | ✅ blob `15dcbf4818e5bb93956c2e826626923a41af` | `| 历史含 `.workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz`（51MB） | ✅ blob `15dcbf4818e5bb9` | ②证据 |  |
| 244 | `| — | **新发现（真正在扩散）**：HEAD 仍跟踪 **`.workspace/deploy-pptmaster/.venv-ppt-test/` = 1817 文件 / 51.62 MiB（` | `| — | **新发现（真正在扩散）**：HEAD 仍跟踪 **`.workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/` = 1` | ②证据 |  |
| 250 | `$ { grep -n "GH001\|remote: warning" .workspace/push-log3.txt ; } > .workspace/acceptance-probe/push` | `$ { grep -n "GH001\|remote: warning" .workspace/push-log3.txt ; } > .workspace/probes/acceptance/pus` | ②证据 |  |
| 251 | `# 归档原文：remote: warning: File .workspace/tmp-ppt-research/raw/mgr.tgz is 51.08 MB; this is larger tha` | `# 归档原文：remote: warning: File .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz is 51.08 M` | ②证据 |  |
| 254 | `$ git rm -r --cached .workspace/deploy-pptmaster/.venv-ppt-test/` | `$ git rm -r --cached .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/` | ②证据 |  |
| 255 | `$ git ls-files .workspace/deploy-pptmaster/.venv-ppt-test/ | wc -l     → 0` | `$ git ls-files .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/ | wc -l     → 0` | ②证据 |  |
| 256 | `$ ls .workspace/deploy-pptmaster/.venv-ppt-test/ | wc -l               → 5   （磁盘文件保留）` | `$ ls .workspace/workstreams/deploy/deploy-pptmaster/.venv-ppt-test/ | wc -l               → 5   （磁盘文` | ②证据 |  |
| 260 | `### 3.4 S21 显式模型选择：**建议否决** — `.workspace/acceptance-probe/brief-s21.md`` | `### 3.4 S21 显式模型选择：**建议否决** — `.workspace/probes/acceptance/brief-s21.md`` | ②证据 |  |
| 266 | `### 3.5 preset 热重载：**建议不做** + 机制纠正 — `.workspace/acceptance-probe/brief-preset-hot.md`` | `### 3.5 preset 热重载：**建议不做** + 机制纠正 — `.workspace/probes/acceptance/brief-preset-hot.md`` | ②证据 |  |
| 273 | `### 3.6 context overflow 根因与修复 ✅ 已根治（本轮最重的发现）— `.workspace/acceptance-probe/rootcause-context-overfl` | `### 3.6 context overflow 根因与修复 ✅ 已根治（本轮最重的发现）— `.workspace/probes/acceptance/rootcause-context-overf` | ②证据 |  |
| 293 | `**修复**：45 个未声明条目按「证据优先保守档」补齐 40 条（E1 同文件条目 7 条 / E2-cat 本机 pi-ai 目录同名规格 28 条 / E3 无证据兜底 1000000 5 条）` | `**修复**：45 个未声明条目按「证据优先保守档」补齐 40 条（E1 同文件条目 7 条 / E2-cat 本机 pi-ai 目录同名规格 28 条 / E3 无证据兜底 1000000 5 条）` | ②证据 |  |
| 316 | `### 3.7 baseURL 尾斜杠判定 ✅ 结案：provider 层无害，真凶是 vision-adam 手写拼接 — `.workspace/acceptance-probe/fact-bas` | `### 3.7 baseURL 尾斜杠判定 ✅ 结案：provider 层无害，真凶是 vision-adam 手写拼接 — `.workspace/probes/acceptance/fact-ba` | ②证据 |  |
| 320 | `- **已加固**：该行改为先归一化 `.replace(/\/+$/, "")`；部署位与 `.workspace/dsh-vision-adam-src` 逐字节一致（`f331b3d8…`），`` | `- **已加固**：该行改为先归一化 `.replace(/\/+$/, "")`；部署位与 `.workspace/workstreams/sources/dsh-vision-adam-src` ` | ②证据 |  |
| 369 | `| `.workspace/acceptance-probe/live-vs-disk.md` | 3080 上是**新进程**（重启已发生）；启动窗口后被主代理实测定位为 17:45:39 |` | `| `.workspace/probes/acceptance/live-vs-disk.md` | 3080 上是**新进程**（重启已发生）；启动窗口后被主代理实测定位为 17:45:39 |` | ②证据 |  |
| 370 | `| `.workspace/acceptance-probe/preflight.md` | 冷面装载 **GO**；红灯 R1 = 回滚 glob 失效（已修） |` | `| `.workspace/probes/acceptance/preflight.md` | 冷面装载 **GO**；红灯 R1 = 回滚 glob 失效（已修） |` | ②证据 |  |
| 371 | `| `.workspace/acceptance-probe/brief-s21.md` | S21 **否决**（缺宿主半边，启用即 throw） |` | `| `.workspace/probes/acceptance/brief-s21.md` | S21 **否决**（缺宿主半边，启用即 throw） |` | ②证据 |  |
| 372 | `| `.workspace/acceptance-probe/brief-preset-hot.md` | preset 热化**不做**；机制纠正：新建会话已热 |` | `| `.workspace/probes/acceptance/brief-preset-hot.md` | preset 热化**不做**；机制纠正：新建会话已热 |` | ②证据 |  |
| 373 | `| `.workspace/acceptance-probe/brief-history-bigfile.md` | mgr.tgz 51.08 MiB 确在历史；"持续告警"不成立；扩散源实为 `.` | `| `.workspace/probes/acceptance/brief-history-bigfile.md` | mgr.tgz 51.08 MiB 确在历史；"持续告警"不成立；扩散源实为 `` | ②证据 |  |
| 374 | `| `.workspace/acceptance-probe/rootcause-context-overflow.md` | 默认窗口 262144（`:849`）→ 客户端预估误判；真实失败会话 ` | `| `.workspace/probes/acceptance/rootcause-context-overflow.md` | 默认窗口 262144（`:849`）→ 客户端预估误判；真实失败会话` | ②证据 |  |
| 375 | `| `.workspace/acceptance-probe/context-window-table.md` | 45 条逐项取值表（E1 7 / E2-cat 28 / E3 5 / N/A 5）` | `| `.workspace/probes/acceptance/context-window-table.md` | 45 条逐项取值表（E1 7 / E2-cat 28 / E3 5 / N/A 5` | ②证据 |  |
| 376 | `| `.workspace/acceptance-probe/fact-baseurl-slash.md` | provider 层尾斜杠无害；真凶是 vision-adam 手写拼接（已加固） |` | `| `.workspace/probes/acceptance/fact-baseurl-slash.md` | provider 层尾斜杠无害；真凶是 vision-adam 手写拼接（已加固） |` | ②证据 |  |
| 377 | `| `.workspace/acceptance-probe/probe-context-window{,-round2}.sh` + `.log` | 受压探测脚本与原始响应（窗口 ∈ (998,8` | `| `.workspace/probes/acceptance/probe-context-window{,-round2}.sh` + `.log` | 受压探测脚本与原始响应（窗口 ∈ (998,` | ②证据 |  |
| 378 | `| `.workspace/acceptance-probe/fill-context-windows.py` | 40 条落地脚本（含 N/A 排除与主模型恢复） |` | `| `.workspace/probes/acceptance/fill-context-windows.py` | 40 条落地脚本（含 N/A 排除与主模型恢复） |` | ②证据 |  |
| 379 | `| `.workspace/acceptance-probe/probe-channel-availability.sh` | **已写好未运行**：v4.1-flash vs v4-flash 通道` | `| `.workspace/probes/acceptance/probe-channel-availability.sh` | **已写好未运行**：v4.1-flash vs v4-flash 通` | ②证据 |  |
| 380 | `| `.workspace/acceptance-probe/push-log3-GH001-archive.txt` | 原 `push-log3.txt` 关键内容归档（原件已删） |` | `| `.workspace/probes/acceptance/push-log3-GH001-archive.txt` | 原 `push-log3.txt` 关键内容归档（原件已删） |` | ②证据 |  |
| 389 | `| `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` + `.workspace/dsh-vision-` | `| `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` + `.workspace/workstreams` | ②证据 |  |
| 391 | `| `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver/l` | `| `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver/l` | ②证据 |  |
| 394 | `| `.workspace/RESTART-ACCEPTANCE.md` | 顶部状态更新（重启已完成）+ §3 回滚表修正（R1 glob、嵌套包路径、btw 备份黄灯） |` | `| `.workspace/reports/execs/acceptance/RESTART-ACCEPTANCE.md` | 顶部状态更新（重启已完成）+ §3 回滚表修正（R1 glob、嵌套包路` | ②证据 |  |
| 395 | `| `.workspace/NEXT_SESSION_PROMPT.txt` | 顶部 7 条勘误（重启/HEAD/settings 段/goal 归类/尾斜杠归属/包路径/新增事实） |` | `| `.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt` | 顶部 7 条勘误（重启/HEAD/settings 段/goal 归类/尾斜杠归属/包` | ②证据 |  |
| 398 | `| `.workspace/acceptance-exec.md` + `.workspace/acceptance-probe/**` | 本报告与全部证据档 |` | `| `.workspace/reports/execs/acceptance/acceptance-exec.md` + `.workspace/acceptance-probe/**` | 本报告与` | ③自身档 | 是 |

## `.workspace/lag-fix-audit.md` （24 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `> （唯一写盘：本报告；tgz 仅解包到 `.workspace/tmp-tgz-audit/` 只读核对）。` | `> （唯一写盘：本报告；tgz 仅解包到 `.workspace/workstreams/tmp-tgz-audit/` 只读核对）。` | ②证据 |  |
| 6 | `> 前置输入已全部读完：`lag-audit-mechanism.md`、`lag-audit-diff.md`、`execution-2b.md`、` | `> 前置输入已全部读完：`lag-audit-mechanism.md`、`lag-audit-diff.md`、`.workspace/reports/execs/subagent/executio` | ②证据 |  |
| 8 | `> `.workspace/deploy/vision-adam/lib/index.js` 与 `settings-vision-adam.snippet.yaml`。` | `> `.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js` 与 `settings-vision-adam.snippet.ya` | ②证据 |  |
| 18 | `| ① 恢复 3 个丢失补丁 | **可行，证据完整**：tgz 含且仅含 3 个补丁文件；agent-loop 补丁与 execution-2b.md 逐字一致；3 个补丁对 live 原厂文件 *` | `| ① 恢复 3 个丢失补丁 | **可行，证据完整**：tgz 含且仅含 3 个补丁文件；agent-loop 补丁与 .workspace/reports/execs/subagent/execu` | ②证据 |  |
| 44 | `### 1.2 与 execution-2b.md 的一致性（②b）` | `### 1.2 与 .workspace/reports/execs/subagent/execution-2b.md 的一致性（②b）` | ②证据 |  |
| 46 | `tgz 内 agent-loop 与 live 原厂的 diff **精确等于 execution-2b.md L6-15 描述的两处改动**（无第三处、无差异）：` | `tgz 内 agent-loop 与 live 原厂的 diff **精确等于 .workspace/reports/execs/subagent/execution-2b.md L6-15 描述的两` | ②证据 |  |
| 56 | ``assembler.push(chunk)` 在 `if (!isSubagent)` **之外**（保持逐字组装，最终 assistant/message 内容不变）——与 execution-2` | ``assembler.push(chunk)` 在 `if (!isSubagent)` **之外**（保持逐字组装，最终 assistant/message 内容不变）——与 .workspace/` | ②证据 |  |
| 68 | `两份 dry-run patch 产物在 `.workspace/tmp-tgz-audit/{pkg}.patch`（可复用于执行档，或直接走 tgz 解包 cp）。**推荐应用方式 = 从 tgz` | `两份 dry-run patch 产物在 `.workspace/workstreams/tmp-tgz-audit/{pkg}.patch`（可复用于执行档，或直接走 tgz 解包 cp）。**推荐` | ②证据 |  |
| 136 | `配置加载机制：`dsh-settings-file/lib/index.js` 用 chokidar watch（`watch: config.watch ?? true`，L37）→ setting` | `配置加载机制：`dsh-settings-file/lib/index.js` 用 chokidar watch（`watch: config.watch ?? true`，L37）→ setting` | ②证据 |  |
| 148 | `**U-8（vision-adam 段替换，按已产出 snippet `.workspace/deploy/settings-vision-adam.snippet.yaml` L17-27）**：将` | `**U-8（vision-adam 段替换，按已产出 snippet `.workspace/workstreams/deploy/deploy/settings-vision-adam.snippe` | ②证据 |  |
| 175 | `**位置**：`/home/CNS2026495165/dsh/.workspace/deploy-lag/`（新建；含 `replay.sh` + `patches/` 目录 + `known-sh` | `**位置**：`/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/`（新建；含 `replay.sh` + `patch` | ②证据 |  |
| 192 | `1. **备份**：首次应用前 `cp -r` 受改包目录 → `.workspace/deploy-lag/backup-<YYYYmmdd-HHMMSS>/<pkg>/`（settings.yam` | `1. **备份**：首次应用前 `cp -r` 受改包目录 → `.workspace/workstreams/deploy/deploy-lag/backup-<YYYYmmdd-HHMMSS>/<` | ②证据 |  |
| 201 | `**固化说明**：tgz 在 `~/dsh-upgrade-backup/`、脚本在 `.workspace/deploy-lag/`，均在 npm 全局树之外——任何 `npm i -g @deep` | `**固化说明**：tgz 在 `~/dsh-upgrade-backup/`、脚本在 `.workspace/workstreams/deploy/deploy-lag/`，均在 npm 全局树之外—` | ②证据 |  |
| 214 | `| 脚本语法 | `bash -n .workspace/deploy-lag/replay.sh`；先跑 `--dry-run` | U-9 |` | `| 脚本语法 | `bash -n .workspace/workstreams/deploy/deploy-lag/replay.sh`；先跑 `--dry-run` | U-9 |` | ②证据 |  |
| 215 | `| 运行时（重启后，执行档可选） | 派一个 subagent 调研：子代理会话 0 条 assistant/chunk、1 条 assistant/message；主会话打字机照常（executio` | `| 运行时（重启后，执行档可选） | 派一个 subagent 调研：子代理会话 0 条 assistant/chunk、1 条 assistant/message；主会话打字机照常（.workspa` | ②证据 |  |
| 224 | `4. **②b 与主会话/btw 兼容**：isSubagent 门控 `depth>0`，主会话与 btw 侧聊（depth=0）逐 chunk 流式不变；`sourceEventSeqs:[]` ` | `4. **②b 与主会话/btw 兼容**：isSubagent 门控 `depth>0`，主会话与 btw 侧聊（depth=0）逐 chunk 流式不变；`sourceEventSeqs:[]` ` | ②证据 |  |
| 240 | `- **改动**（与 execution-2b.md L6-15 逐字一致，2 处）：` | `- **改动**（与 .workspace/reports/execs/subagent/execution-2b.md L6-15 逐字一致，2 处）：` | ②证据 |  |
| 243 | `- **合并方式**：tgz 解包 cp 覆盖（sha256 == `b20d42dc…`）或 2-hunk patch（已 dry-run 通过，patch 在 `.workspace/tmp-tg` | `- **合并方式**：tgz 解包 cp 覆盖（sha256 == `b20d42dc…`）或 2-hunk patch（已 dry-run 通过，patch 在 `.workspace/workst` | ②证据 |  |
| 249 | `- **合并方式**：tgz cp（sha256 == `ac7cbb97…`）或 patch（`.workspace/tmp-tgz-audit/dsh-client-ui-subagent.pat` | `- **合并方式**：tgz cp（sha256 == `ac7cbb97…`）或 patch（`.workspace/workstreams/tmp-tgz-audit/dsh-client-ui-` | ②证据 |  |
| 292 | `- **改动**：替换为 snippet（`.workspace/deploy/settings-vision-adam.snippet.yaml` L17-27）的 4 键段：model=deeps` | `- **改动**：替换为 snippet（`.workspace/workstreams/deploy/deploy/settings-vision-adam.snippet.yaml` L17-27` | ②证据 |  |
| 297 | `- **目标文件**：`/home/CNS2026495165/dsh/.workspace/deploy-lag/replay.sh`（+ `patches/`、`known-sha256.txt`` | `- **目标文件**：`/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/replay.sh`（+ `patches/`` | ②证据 |  |
| 308 | `| agent-loop 补丁 == execution-2b.md | tgz↔live diff 仅 2 hunk（isSubagent + if 门控），与 execution-2b.md L6` | `| agent-loop 补丁 == .workspace/reports/execs/subagent/execution-2b.md | tgz↔live diff 仅 2 hunk（isSuba` | ②证据 |  |
| 309 | `| 3 补丁 CLEAN MERGE | `patch --dry-run -p0` 全过；patch 产物 `.workspace/tmp-tgz-audit/{pkg}.patch` |` | `| 3 补丁 CLEAN MERGE | `patch --dry-run -p0` 全过；patch 产物 `.workspace/workstreams/tmp-tgz-audit/{pkg}.p` | ②证据 |  |
| 322 | `| vision-adam 新 lib | .workspace/deploy/vision-adam/lib/index.js L39 `DEFAULT_MAX_TOKENS = 2000`；sni` | `| vision-adam 新 lib | .workspace/workstreams/deploy/deploy/vision-adam/lib/index.js L39 `DEFAULT_MAX` | ②证据 |  |

## `.workspace/btw-wf-v2.cjs` （22 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 27 | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/btw-upgrade-plan.md（裁决 R1-1..R1-10 与沿用项 R0-3/4/5，不得违背/重` | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（裁决 R1-1..R1-10 与沿` | ②证据 |  |
| 28 | `- 现状审计：/home/CNS2026495165/dsh/.workspace/btw-upgrade-audit.md（269 行，全部带文件:行号证据）` | `- 现状审计：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-audit.md（269 行，全部带文件:行号证据）` | ②证据 |  |
| 29 | `- 实测证据：/home/CNS2026495165/dsh/.workspace/opencode-deepseek-v4-flash-probe.md（deepseek-v4.1-flash 实测` | `- 实测证据：/home/CNS2026495165/dsh/.workspace/reports/research/opencode-deepseek-v4-flash-probe.md（deeps` | ②证据 |  |
| 44 | `- 修订后的方案 + 细粒度交付单元清单，落盘 /home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-audit.md（每单元含验收标准与依赖；明确 ` | `- 修订后的方案 + 细粒度交付单元清单，落盘 /home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit` | ②证据 |  |
| 52 | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-audit.md（权威清单；你只负责其中标为 dsh-btw 源码的部分，不含` | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md（权威清单；你只负责其中` | ②证据 |  |
| 53 | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/btw-upgrade-plan.md（裁决 R1-1..R1-10，不得违背）` | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（裁决 R1-1..R1-10，不得` | ②证据 |  |
| 54 | `- 现状审计：/home/CNS2026495165/dsh/.workspace/btw-upgrade-audit.md；实测：/home/CNS2026495165/dsh/.workspace` | `- 现状审计：/home/CNS2026495165/dsh/.workspace/btw-upgrade-audit.md；实测：/home/CNS2026495165/dsh/.workspace` | ②证据 |  |
| 64 | `5. 产出执行报告 /home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-exec.md：逐单元状态（done/部分/跳过+理由）、改动文件+关键行号` | `5. 产出执行报告 /home/CNS2026495165/dsh/.workspace/reports/execs/btw/btw-upgrade-impl-exec.md：逐单元状态（done/部` | ②证据 |  |
| 72 | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-audit.md（其中 U-H vision-adam 配置化新 lib 的完` | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md（其中 U-H visi` | ②证据 |  |
| 73 | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/btw-upgrade-plan.md（R1-4/R1-5/R1-9）` | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（R1-4/R1-5/R1-9）` | ②证据 |  |
| 74 | `- 实测证据：/home/CNS2026495165/dsh/.workspace/opencode-deepseek-v4-flash-probe.md（模型 deepseek-v4.1-flash` | `- 实测证据：/home/CNS2026495165/dsh/.workspace/reports/research/opencode-deepseek-v4-flash-probe.md（模型 de` | ②证据 |  |
| 77 | `产出（全部落在 /home/CNS2026495165/dsh/.workspace/deploy/ 下）：` | `产出（全部落在 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/ 下）：` | ②证据 |  |
| 78 | `1. vision-adam 配置化新 lib：.workspace/deploy/vision-adam/lib/index.js —— 严格按审计 U-H 设计实现（Config 扩展 model` | `1. vision-adam 配置化新 lib：.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js —— 严格按审计 U-H 设` | ②证据 |  |
| 79 | `2. 若审计判定 U-G 需「官方包 patch」：产出补丁文件到 .workspace/deploy/patches/（被改文件的新版本或 unified diff，标明目标绝对路径与备份/应用步骤` | `2. 若审计判定 U-G 需「官方包 patch」：产出补丁文件到 .workspace/workstreams/deploy/deploy/patches/（被改文件的新版本或 unified di` | ②证据 |  |
| 80 | `3. settings.yaml 的 vision-adam 段最终形态：.workspace/deploy/settings-vision-adam.snippet.yaml（含注释，兼容旧键）。` | `3. settings.yaml 的 vision-adam 段最终形态：.workspace/workstreams/deploy/deploy/settings-vision-adam.snipp` | ②证据 |  |
| 81 | `4. 产出执行报告 /home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-exec-patches.md：产物清单+路径、与审计 U-H/U-G 规格` | `4. 产出执行报告 /home/CNS2026495165/dsh/.workspace/reports/execs/btw/btw-upgrade-impl-exec-patches.md：产物清单` | ②证据 |  |
| 84 | `约束：只写 /home/CNS2026495165/dsh/.workspace/deploy/ 与报告文件（工作区内）；不得改 ~/.dsh 任何文件；禁止使用 sandbox_permission` | `约束：只写 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/ 与报告文件（工作区内）；不得改 ~/.dsh 任何文件；禁止使用` | ②证据 |  |
| 89 | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/btw-upgrade-plan.md` | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md` | ②证据 |  |
| 90 | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-audit.md` | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md` | ②证据 |  |
| 91 | `- 执行报告：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-exec.md 与 /home/CNS2026495165/dsh/.worksp` | `- 执行报告：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-exec.md 与 /home/CNS2026495165/dsh/.worksp` | ②证据 |  |
| 92 | `- 真实代码：/home/CNS2026495165/dsh/dsh-btw/（逐单元核对；工作区根有 git 则用 git -C /home/CNS2026495165/dsh status/dif` | `- 真实代码：/home/CNS2026495165/dsh/dsh-btw/（逐单元核对；工作区根有 git 则用 git -C /home/CNS2026495165/dsh status/dif` | ②证据 |  |
| 109 | `return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查 .wor` | `return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查 .wor` | ②证据 |  |

## `.workspace/btw-wf-v2.mjs` （22 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 27 | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/btw-upgrade-plan.md（裁决 R1-1..R1-10 与沿用项 R0-3/4/5，不得违背/重` | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（裁决 R1-1..R1-10 与沿` | ②证据 |  |
| 28 | `- 现状审计：/home/CNS2026495165/dsh/.workspace/btw-upgrade-audit.md（269 行，全部带文件:行号证据）` | `- 现状审计：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-audit.md（269 行，全部带文件:行号证据）` | ②证据 |  |
| 29 | `- 实测证据：/home/CNS2026495165/dsh/.workspace/opencode-deepseek-v4-flash-probe.md（deepseek-v4.1-flash 实测` | `- 实测证据：/home/CNS2026495165/dsh/.workspace/reports/research/opencode-deepseek-v4-flash-probe.md（deeps` | ②证据 |  |
| 44 | `- 修订后的方案 + 细粒度交付单元清单，落盘 /home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-audit.md（每单元含验收标准与依赖；明确 ` | `- 修订后的方案 + 细粒度交付单元清单，落盘 /home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit` | ②证据 |  |
| 52 | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-audit.md（权威清单；你只负责其中标为 dsh-btw 源码的部分，不含` | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md（权威清单；你只负责其中` | ②证据 |  |
| 53 | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/btw-upgrade-plan.md（裁决 R1-1..R1-10，不得违背）` | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（裁决 R1-1..R1-10，不得` | ②证据 |  |
| 54 | `- 现状审计：/home/CNS2026495165/dsh/.workspace/btw-upgrade-audit.md；实测：/home/CNS2026495165/dsh/.workspace` | `- 现状审计：/home/CNS2026495165/dsh/.workspace/btw-upgrade-audit.md；实测：/home/CNS2026495165/dsh/.workspace` | ②证据 |  |
| 64 | `5. 产出执行报告 /home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-exec.md：逐单元状态（done/部分/跳过+理由）、改动文件+关键行号` | `5. 产出执行报告 /home/CNS2026495165/dsh/.workspace/reports/execs/btw/btw-upgrade-impl-exec.md：逐单元状态（done/部` | ②证据 |  |
| 72 | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-audit.md（其中 U-H vision-adam 配置化新 lib 的完` | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md（其中 U-H visi` | ②证据 |  |
| 73 | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/btw-upgrade-plan.md（R1-4/R1-5/R1-9）` | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（R1-4/R1-5/R1-9）` | ②证据 |  |
| 74 | `- 实测证据：/home/CNS2026495165/dsh/.workspace/opencode-deepseek-v4-flash-probe.md（模型 deepseek-v4.1-flash` | `- 实测证据：/home/CNS2026495165/dsh/.workspace/reports/research/opencode-deepseek-v4-flash-probe.md（模型 de` | ②证据 |  |
| 77 | `产出（全部落在 /home/CNS2026495165/dsh/.workspace/deploy/ 下）：` | `产出（全部落在 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/ 下）：` | ②证据 |  |
| 78 | `1. vision-adam 配置化新 lib：.workspace/deploy/vision-adam/lib/index.js —— 严格按审计 U-H 设计实现（Config 扩展 model` | `1. vision-adam 配置化新 lib：.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js —— 严格按审计 U-H 设` | ②证据 |  |
| 79 | `2. 若审计判定 U-G 需「官方包 patch」：产出补丁文件到 .workspace/deploy/patches/（被改文件的新版本或 unified diff，标明目标绝对路径与备份/应用步骤` | `2. 若审计判定 U-G 需「官方包 patch」：产出补丁文件到 .workspace/workstreams/deploy/deploy/patches/（被改文件的新版本或 unified di` | ②证据 |  |
| 80 | `3. settings.yaml 的 vision-adam 段最终形态：.workspace/deploy/settings-vision-adam.snippet.yaml（含注释，兼容旧键）。` | `3. settings.yaml 的 vision-adam 段最终形态：.workspace/workstreams/deploy/deploy/settings-vision-adam.snipp` | ②证据 |  |
| 81 | `4. 产出执行报告 /home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-exec-patches.md：产物清单+路径、与审计 U-H/U-G 规格` | `4. 产出执行报告 /home/CNS2026495165/dsh/.workspace/reports/execs/btw/btw-upgrade-impl-exec-patches.md：产物清单` | ②证据 |  |
| 84 | `约束：只写 /home/CNS2026495165/dsh/.workspace/deploy/ 与报告文件（工作区内）；不得改 ~/.dsh 任何文件；禁止使用 sandbox_permission` | `约束：只写 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/ 与报告文件（工作区内）；不得改 ~/.dsh 任何文件；禁止使用` | ②证据 |  |
| 89 | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/btw-upgrade-plan.md` | `- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md` | ②证据 |  |
| 90 | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-audit.md` | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md` | ②证据 |  |
| 91 | `- 执行报告：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-exec.md 与 /home/CNS2026495165/dsh/.worksp` | `- 执行报告：/home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-exec.md 与 /home/CNS2026495165/dsh/.worksp` | ②证据 |  |
| 92 | `- 真实代码：/home/CNS2026495165/dsh/dsh-btw/（逐单元核对；工作区根有 git 则用 git -C /home/CNS2026495165/dsh status/dif` | `- 真实代码：/home/CNS2026495165/dsh/dsh-btw/（逐单元核对；工作区根有 git 则用 git -C /home/CNS2026495165/dsh status/dif` | ②证据 |  |
| 109 | `return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查 .wor` | `return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查 .wor` | ②证据 |  |

## `.workspace/lag-fix-wf.mjs` （21 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 27 | `- 机制审计：/home/CNS2026495165/dsh/.workspace/lag-audit-mechanism.md（驱动=in-process、因果链、L3556-3574 mux 与 ` | `- 机制审计：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-audit-mechanism.md（驱动=in-process` | ②证据 |  |
| 28 | `- 差异审计：/home/CNS2026495165/dsh/.workspace/lag-audit-diff.md（回退完整、3 个丢失补丁清单与 tgz 位置、cordis.patch.yml ` | `- 差异审计：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-audit-diff.md（回退完整、3 个丢失补丁清单与 tg` | ②证据 |  |
| 29 | `- ②b 补丁权威记录：/home/CNS2026495165/dsh/execution-2b.md（两行改动的精确语义与复核 PASS）` | `- ②b 补丁权威记录：/home/CNS2026495165/dsh/.workspace/reports/execs/subagent/execution-2b.md（两行改动的精确语义与复核 P` | ②证据 |  |
| 36 | `- 配置：~/.dsh/settings.yaml（adam provider 的 models 段——deepseek-v4-flash 的 maxTokens 现值；vision-adam 段——` | `- 配置：~/.dsh/settings.yaml（adam provider 的 models 段——deepseek-v4-flash 的 maxTokens 现值；vision-adam 段——` | ②证据 |  |
| 39 | `1. tgz 内 3 个补丁文件的确切内容与目标路径；与 execution-2b.md 描述的 ②b 改动是否一致（解包后 diff 核对）；与 live 原厂文件是否可干净合并（补丁上下文匹配或需` | `1. tgz 内 3 个补丁文件的确切内容与目标路径；与 .workspace/reports/execs/subagent/execution-2b.md 描述的 ②b 改动是否一致（解包后 dif` | ②证据 |  |
| 45 | `4. 重放脚本规格：脚本应含 备份（cp -r/时间戳后缀）、应用（cp 或 patch）、校验（grep 锚点/node --check/字节比对）、幂等（已应用则跳过并提示）、dry-run 模式` | `4. 重放脚本规格：脚本应含 备份（cp -r/时间戳后缀）、应用（cp 或 patch）、校验（grep 锚点/node --check/字节比对）、幂等（已应用则跳过并提示）、dry-run 模式` | ②证据 |  |
| 50 | `- 细粒度交付单元清单落盘 /home/CNS2026495165/dsh/.workspace/lag-fix-audit.md（每单元：编号 U-1..U-N、目标文件、精确改动、验收标准；含 t` | `- 细粒度交付单元清单落盘 /home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-fix-audit.md（每单元：编号 U-1..` | ②证据 |  |
| 55 | `const EXEC_PROMPT = `你是「subagent 多开卡顿修复」三阶段闭环的【修订并执行】阶段子代理（路由 adam/deepseek-v4-flash）。职责：严格按审计交付单元产出` | `const EXEC_PROMPT = `你是「subagent 多开卡顿修复」三阶段闭环的【修订并执行】阶段子代理（路由 adam/deepseek-v4-flash）。职责：严格按审计交付单元产出` | ②证据 |  |
| 58 | `- 审计交付单元（权威）：/home/CNS2026495165/dsh/.workspace/lag-fix-audit.md` | `- 审计交付单元（权威）：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-fix-audit.md` | ②证据 |  |
| 59 | `- 机制审计 / 差异审计：/home/CNS2026495165/dsh/.workspace/lag-audit-mechanism.md、lag-audit-diff.md；②b 记录：/hom` | `- 机制审计 / 差异审计：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-audit-mechanism.md、lag-au` | ②证据 |  |
| 62 | `产出（全部落在 /home/CNS2026495165/dsh/.workspace/deploy-lag/ 下）：` | `产出（全部落在 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/ 下）：` | ②证据 |  |
| 65 | `3. settings/ 目录：settings.yaml 的修改片段（含注释）：adam provider models 段 deepseek-v4-flash maxTokens=990000；v` | `3. settings/ 目录：settings.yaml 的修改片段（含注释）：adam provider models 段 deepseek-v4-flash maxTokens=990000；v` | ②证据 |  |
| 67 | `5. 执行报告 /home/CNS2026495165/dsh/.workspace/lag-fix-exec.md：产物清单+路径、逐单元状态、每项验证结果（node --check、grep 锚点` | `5. 执行报告 /home/CNS2026495165/dsh/.workspace/reports/execs/lagfix/lag-fix-exec.md：产物清单+路径、逐单元状态、每项验证结果` | ②证据 |  |
| 71 | `- 3 个恢复文件与 tgz 补丁语义一致（diff 核对改动点与 execution-2b.md 描述吻合）；` | `- 3 个恢复文件与 tgz 补丁语义一致（diff 核对改动点与 .workspace/reports/execs/subagent/execution-2b.md 描述吻合）；` | ②证据 |  |
| 76 | `约束：只写 /home/CNS2026495165/dsh/.workspace/deploy-lag/ 与报告文件；不得改 ~/.npm-global 与 ~/.dsh 任何文件；禁止使用 sand` | `约束：只写 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/ 与报告文件；不得改 ~/.npm-global 与 ~/` | ②证据 |  |
| 81 | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/lag-fix-audit.md` | `- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-fix-audit.md` | ②证据 |  |
| 82 | `- 执行报告：/home/CNS2026495165/dsh/.workspace/lag-fix-exec.md` | `- 执行报告：/home/CNS2026495165/dsh/.workspace/reports/execs/lagfix/lag-fix-exec.md` | ②证据 |  |
| 83 | `- 产物：/home/CNS2026495165/dsh/.workspace/deploy-lag/（restore/ hardening/ settings/ replay-lag-fix.sh）` | `- 产物：/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/（restore/ hardening/ settings/` | ②证据 |  |
| 87 | `1. 逐单元验收标准是否达成（读产物真实核对，不信报告声称）：3 个补丁恢复文件与 tgz 补丁语义一致（diff 关键锚点）、②b 与 execution-2b.md 语义逐条吻合；` | `1. 逐单元验收标准是否达成（读产物真实核对，不信报告声称）：3 个补丁恢复文件与 tgz 补丁语义一致（diff 关键锚点）、②b 与 .workspace/reports/execs/subage` | ②证据 |  |
| 101 | `return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查 .wor` | `return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查 .wor` | ②证据 |  |
| 108 | `log('修订并执行：产出 restore/hardening/settings 产物与重放脚本到 .workspace/deploy-lag/');` | `log('修订并执行：产出 restore/hardening/settings 产物与重放脚本到 .workspace/workstreams/deploy/deploy-lag/');` | ②证据 |  |

## `.workspace/NEXT_SESSION_PROMPT.txt` （18 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `> ## ⚠️ 勘误（2026-09-17 18:0x 由下一会话实测回写，逐条原始输出见 `.workspace/acceptance-exec.md` §0）` | `> ## ⚠️ 勘误（2026-09-17 18:0x 由下一会话实测回写，逐条原始输出见 `.workspace/reports/execs/acceptance/acceptance-exec.m` | ②证据 |  |
| 40 | `验收矩阵与逐项回滚命令：`.workspace/RESTART-ACCEPTANCE.md`（含可复制命令，照做即可）。` | `验收矩阵与逐项回滚命令：`.workspace/reports/execs/acceptance/RESTART-ACCEPTANCE.md`（含可复制命令，照做即可）。` | ②证据 |  |
| 54 | `| 未跟踪文件 | `.workspace/mmt-probe/pasted-2048.png`（用户桌面截图，**不入库**）、`.workspace/push-log3.txt`（历史 push ` | `| 未跟踪文件 | `.workspace/probes/mmt/pasted-2048.png`（用户桌面截图，**不入库**）、`.workspace/push-log3.txt`（历史 push` | ②证据 |  |
| 107 | `- **E2E 真实证据**（`.workspace/deploy-subagent-model/evidence/`）：覆写 → 子代理实跑 `glm-5.3`；` | `- **E2E 真实证据**（`.workspace/workstreams/deploy/deploy-subagent-model/evidence/`）：覆写 → 子代理实跑 `glm-5.3`` | ②证据 |  |
| 131 | ``DOC-STYLE.md` 风格约定；`examples/minimal-plugin/` 脚手架；`.workspace/deploy-lag/dsh-restart.sh`` | ``DOC-STYLE.md` 风格约定；`examples/minimal-plugin/` 脚手架；`.workspace/workstreams/deploy/deploy-lag/dsh-res` | ②证据 |  |
| 159 | `| `dsh-hub` 历史里 51MB `.workspace/tmp-ppt-research/raw/mgr.tgz` | GitHub 持续告警；**保留 vs 重写历史待用户裁决** |` | `| `dsh-hub` 历史里 51MB `.workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz` | GitHub 持续告警；**` | ②证据 |  |
| 189 | `- `.workspace/RESTART-ACCEPTANCE.md` —— 本批次重启验收矩阵 + 逐项回滚（**开工必读**）` | `- `.workspace/reports/execs/acceptance/RESTART-ACCEPTANCE.md` —— 本批次重启验收矩阵 + 逐项回滚（**开工必读**）` | ②证据 |  |
| 190 | `- `.workspace/deploy-subagent-model/README.md` —— 新插件部署/回滚/热载语义` | `- `.workspace/workstreams/deploy/deploy-subagent-model/README.md` —— 新插件部署/回滚/热载语义` | ②证据 |  |
| 191 | `- `.workspace/master-runbook.md`、`.workspace/deploy-lag/README.md` §9（热载）` | `- `.workspace/reports/runbooks/master-runbook.md`、`.workspace/deploy-lag/README.md` §9（热载）` | ②证据 |  |
| 192 | `- `.workspace/deploy-lag/dsh-restart.sh` —— 优雅重启辅助（dry-run / `--watch`）` | `- `.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh` —— 优雅重启辅助（dry-run / `--watch`）` | ②证据 |  |
| 195 | `- `.workspace/subagent-model-gui-audit.md`（审计契约）→ `.workspace/subagent-model-settings-exec.md`（执行）` | `- `.workspace/subagent-model-gui-audit.md`（审计契约）→ `.workspace/reports/execs/subagent-model/subagent-` | ②证据 |  |
| 196 | `- `.workspace/btw-model-v41-exec.md`（btw 两单元）` | `- `.workspace/reports/execs/btw/btw-model-v41-exec.md`（btw 两单元）` | ②证据 |  |
| 197 | `- `.workspace/deploy-subagent-model/`（`dsh-tool-subagent.p0.diff`、patched 全文、包三件、smoke、`evidence/` 真` | `- `.workspace/workstreams/deploy/deploy-subagent-model/`（`dsh-tool-subagent.p0.diff`、patched 全文、包三件、` | ②证据 |  |
| 198 | `- `.workspace/mmt-probe/RESULTS.md`（adam v4.1-flash 多模态实测原始数据）` | `- `.workspace/probes/mmt/RESULTS.md`（adam v4.1-flash 多模态实测原始数据）` | ②证据 |  |
| 201 | `- `.workspace/goal-p0a-exec.md`、`.workspace/goal-pending-subagent-exec.md`` | `- `.workspace/goal-p0a-exec.md`、`.workspace/reports/execs/goal/goal-pending-subagent-exec.md`` | ②证据 |  |
| 202 | `- `.workspace/p0a-patch-hmr-exec.md`（冷热面实测）、`.workspace/p0b-settings-switch-exec.md`（settings 热载 + 行` | `- `.workspace/p0a-patch-hmr-exec.md`（冷热面实测）、`.workspace/reports/execs/p0-hotload/p0b-settings-switch` | ②证据 |  |
| 203 | `- `.workspace/deploy-ssh-gui/RUNBOOK.md`、`.workspace/deploy-workerspace/RUNBOOK.md`（均含"未真机"边界）` | `- `.workspace/deploy-ssh-gui/RUNBOOK.md`、`.workspace/workstreams/deploy/deploy-workerspace/RUNBOOK.m` | ②证据 |  |
| 226 | `> 读 `/home/CNS2026495165/dsh/.workspace/RESTART-ACCEPTANCE.md` 与 `.workspace/NEXT_SESSION_PROMPT.txt` | `> 读 `/home/CNS2026495165/dsh/.workspace/RESTART-ACCEPTANCE.md` 与 `.workspace/reports/handoff/NEXT_SE` | ③自身档 | 是 |

## `.workspace/btw-upgrade-impl-exec-patches.md` （16 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 依据：`.workspace/btw-upgrade-impl-audit.md`（U-H / U-G-2 / §8 部署步骤，本线权威）、`.workspace/btw-upgrade-plan` | `> 依据：`.workspace/btw-upgrade-impl-audit.md`（U-H / U-G-2 / §8 部署步骤，本线权威）、`.workspace/btw-upgrade-plan` | ②证据 |  |
| 10 | `## 1. 产物清单（全部在 /home/CNS2026495165/dsh/.workspace/deploy/ 下）` | `## 1. 产物清单（全部在 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/ 下）` | ②证据 |  |
| 14 | `| 1 | vision-adam 配置化新 lib | `.workspace/deploy/vision-adam/lib/index.js` | 替换 `~/.dsh/profiles/node` | `| 1 | vision-adam 配置化新 lib | `.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js` | 替换 `~` | ②证据 |  |
| 15 | `| 2 | 变更说明 | `.workspace/deploy/vision-adam/CHANGES.md` | 逐条变更 + 兼容性 + 已知风险 |` | `| 2 | 变更说明 | `.workspace/workstreams/deploy/deploy/vision-adam/CHANGES.md` | 逐条变更 + 兼容性 + 已知风险 |` | ②证据 |  |
| 16 | `| 3 | 官方包 patch（unified diff） | `.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transfo` | `| 3 | 官方包 patch（unified diff） | `.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.sess` | ②证据 |  |
| 17 | `| 4 | 应用后完整文件副本 | `.workspace/deploy/patches/dsh-host-apiproxy.lib.index.js` | 5561 行；与原文件 md5 不同、与 ` | `| 4 | 应用后完整文件副本 | `.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.lib.index.js` | 55` | ②证据 |  |
| 18 | `| 5 | patch 应用说明 | `.workspace/deploy/patches/APPLY.md` | 备份/应用/验证/回滚步骤 + 行为验收 |` | `| 5 | patch 应用说明 | `.workspace/workstreams/deploy/deploy/patches/APPLY.md` | 备份/应用/验证/回滚步骤 + 行为验收 |` | ②证据 |  |
| 19 | `| 6 | settings.yaml vision-adam 段最终形态 | `.workspace/deploy/settings-vision-adam.snippet.yaml` | 含注释、` | `| 6 | settings.yaml vision-adam 段最终形态 | `.workspace/workstreams/deploy/deploy/settings-vision-adam.s` | ②证据 |  |
| 20 | `| 7 | 本报告 | `.workspace/btw-upgrade-impl-exec-patches.md` | 产物 + 规格对应 + 验证 + 风险 |` | `| 7 | 本报告 | `.workspace/reports/execs/btw/btw-upgrade-impl-exec-patches.md` | 产物 + 规格对应 + 验证 + 风险 |` | ③自身档 | 是 |
| 24 | `### 2.1 U-H（vision-adam 新 lib）— `.workspace/deploy/vision-adam/lib/index.js`` | `### 2.1 U-H（vision-adam 新 lib）— `.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js`` | ②证据 |  |
| 43 | `### 2.2 U-G-2（官方包 patch）— `.workspace/deploy/patches/`` | `### 2.2 U-G-2（官方包 patch）— `.workspace/workstreams/deploy/deploy/patches/`` | ②证据 |  |
| 58 | `### 2.3 settings 段（审计 §8 步骤 5 / plan §F）— `.workspace/deploy/settings-vision-adam.snippet.yaml`` | `### 2.3 settings 段（审计 §8 步骤 5 / plan §F）— `.workspace/workstreams/deploy/deploy/settings-vision-adam` | ②证据 |  |
| 76 | `| 约束 | 全程 | 只写 `.workspace/deploy/` 与报告；`~/.dsh` 零改动；未使用 sandbox_permissions |` | `| 约束 | 全程 | 只写 `.workspace/workstreams/deploy/deploy/` 与报告；`~/.dsh` 零改动；未使用 sandbox_permissions |` | ②证据 |  |
| 87 | `cp .workspace/deploy/vision-adam/lib/index.js ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-a` | `cp .workspace/workstreams/deploy/deploy/vision-adam/lib/index.js ~/.dsh/profiles/node_modules/@deeps` | ②证据 |  |
| 90 | `cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy && patch -p1 < ~/dsh/.workspace/d` | `cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy && patch -p1 < ~/dsh/.workspace/w` | **①实链** |  |
| 92 | `# 4) settings.yaml vision-adam 段替换为 .workspace/deploy/settings-vision-adam.snippet.yaml 内容` | `# 4) settings.yaml vision-adam 段替换为 .workspace/workstreams/deploy/deploy/settings-vision-adam.snippe` | ②证据 |  |

## `.workspace/borrow-015-groupA-exec.md` （15 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- 依据：`.workspace/upstream-015-diff.md` §6.2/§6.4 + 深挖 notes G4/G5/G6 对应项` | `- 依据：`.workspace/reports/audits/upstream/upstream-015-diff.md` §6.2/§6.4 + 深挖 notes G4/G5/G6 对应项` | ②证据 |  |
| 7 | `- 约束遵守：只写 `.workspace/deploy-015/` 与报告；未改 `~/.dsh`/`~/.npm-global` 目标树；未用 sandbox_permissions；未触碰 re` | `- 约束遵守：只写 `.workspace/workstreams/deploy/deploy-015/` 与报告；未改 `~/.dsh`/`~/.npm-global` 目标树；未用 sandbox` | ②证据 |  |
| 18 | `- diff 路径：`.workspace/deploy-015/patches/dsh-spill-local.cleanup-sweep-saveTextFile-retry.patch`（与 S` | `- diff 路径：`.workspace/workstreams/deploy/deploy-015/patches/dsh-spill-local.cleanup-sweep-saveTextFi` | ②证据 |  |
| 19 | `- 应用后完整副本：`.workspace/deploy-015/dsh-spill-local/`` | `- 应用后完整副本：`.workspace/workstreams/deploy/deploy-015/dsh-spill-local/`` | ②证据 |  |
| 43 | `- diff 路径：`.workspace/deploy-015/patches/dsh-client-connection.recovery-enhancement.patch`` | `- diff 路径：`.workspace/workstreams/deploy/deploy-015/patches/dsh-client-connection.recovery-enhanceme` | ②证据 |  |
| 44 | `- 应用后完整副本：`.workspace/deploy-015/dsh-client-connection/`` | `- 应用后完整副本：`.workspace/workstreams/deploy/deploy-015/dsh-client-connection/`` | ②证据 |  |
| 57 | `- diff 路径：`.workspace/deploy-015/patches/dsh-client-ui-trajectory.zh-dict-9values.patch`` | `- diff 路径：`.workspace/workstreams/deploy/deploy-015/patches/dsh-client-ui-trajectory.zh-dict-9values` | ②证据 |  |
| 58 | `- 应用后完整副本：`.workspace/deploy-015/dsh-client-ui-trajectory/`` | `- 应用后完整副本：`.workspace/workstreams/deploy/deploy-015/dsh-client-ui-trajectory/`` | ②证据 |  |
| 67 | `- diff 路径：`.workspace/deploy-015/patches/dsh-host-frontend-static.base-href-gz-mime.patch`` | `- diff 路径：`.workspace/workstreams/deploy/deploy-015/patches/dsh-host-frontend-static.base-href-gz-mi` | ②证据 |  |
| 68 | `- 应用后完整副本：`.workspace/deploy-015/dsh-host-frontend-static/`` | `- 应用后完整副本：`.workspace/workstreams/deploy/deploy-015/dsh-host-frontend-static/`` | ②证据 |  |
| 77 | `- diff 路径：`.workspace/deploy-015/patches/dsh-file-reference-local.index-constants.patch`` | `- diff 路径：`.workspace/workstreams/deploy/deploy-015/patches/dsh-file-reference-local.index-constants` | ②证据 |  |
| 78 | `- 应用后完整副本：`.workspace/deploy-015/dsh-file-reference-local/`` | `- 应用后完整副本：`.workspace/workstreams/deploy/deploy-015/dsh-file-reference-local/`` | ②证据 |  |
| 90 | `- diff 路径：`.workspace/deploy-015/patches/dsh-cmdline.stdin-eof-exit.patch`` | `- diff 路径：`.workspace/workstreams/deploy/deploy-015/patches/dsh-cmdline.stdin-eof-exit.patch`` | ②证据 |  |
| 91 | `- 应用后完整副本：`.workspace/deploy-015/dsh-cmdline/`` | `- 应用后完整副本：`.workspace/workstreams/deploy/deploy-015/dsh-cmdline/`` | ②证据 |  |
| 132 | `全部 patch 均可 `patch -p1` 于 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` | `全部 patch 均可 `patch -p1` 于 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` | ②证据 |  |

## `.workspace/borrow-015-groupC-exec.md` （13 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `- 依据：`.workspace/upstream-015-diff.md` §6.2/§6.4（S6/S7/S8/S9 + P3 高价值子集）；G1/G3/G4 组深挖 notes` | `- 依据：`.workspace/reports/audits/upstream/upstream-015-diff.md` §6.2/§6.4（S6/S7/S8/S9 + P3 高价值子集）；G1/` | ②证据 |  |
| 12 | `| 项 | 目标包 | diff 文件（`.workspace/deploy-015/patches/`） | deploy-015 完整副本 | 说明 |` | `| 项 | 目标包 | diff 文件（`.workspace/workstreams/deploy/deploy-015/patches/`） | deploy-015 完整副本 | 说明 |` | ②证据 |  |
| 14 | `| S6 | dsh-session | `dsh-session.tool-result-isError.patch` | `.workspace/deploy-015/dsh-session/` ` | `| S6 | dsh-session | `dsh-session.tool-result-isError.patch` | `.workspace/workstreams/deploy/deploy` | ②证据 |  |
| 15 | `| S7 | dsh-session-projection | `dsh-session-projection.restore-contiguity.patch` | `.workspace/depl` | `| S7 | dsh-session-projection | `dsh-session-projection.restore-contiguity.patch` | `.workspace/work` | ②证据 |  |
| 16 | `| S8 | dsh-agent-loop | `dsh-agent-loop.reasoningEffort.patch` | `.workspace/deploy-015/dsh-agent-lo` | `| S8 | dsh-agent-loop | `dsh-agent-loop.reasoningEffort.patch` | `.workspace/workstreams/deploy/depl` | ②证据 |  |
| 17 | `| S9 | dsh-client-connection | `dsh-client-connection.ws-downlink-heartbeat-serial.patch` | `.worksp` | `| S9 | dsh-client-connection | `dsh-client-connection.ws-downlink-heartbeat-serial.patch` | `.worksp` | ②证据 |  |
| 18 | `| P3-C3 | dsh-session-persistence | `dsh-session-persistence.not-found-error.patch` | `.workspace/de` | `| P3-C3 | dsh-session-persistence | `dsh-session-persistence.not-found-error.patch` | `.workspace/wo` | ②证据 |  |
| 20 | `| P3-G3C07 | dsh-llm-retry | `dsh-llm-retry.projection.patch` | `.workspace/deploy-015/dsh-llm-retry` | `| P3-G3C07 | dsh-llm-retry | `dsh-llm-retry.projection.patch` | `.workspace/workstreams/deploy/deplo` | ②证据 |  |
| 21 | `| P3-G3C05 | dsh-agent | `dsh-agent.model-switch-notice.patch` | `.workspace/deploy-015/dsh-agent/` ` | `| P3-G3C05 | dsh-agent | `dsh-agent.model-switch-notice.patch` | `.workspace/workstreams/deploy/depl` | ②证据 |  |
| 24 | `- ✅ 全部产物只在 `.workspace/deploy-015/` 与报告文件；未改 `~/.dsh`、未改 GLOB 部署树（deploy 由主代理执行）` | `- ✅ 全部产物只在 `.workspace/workstreams/deploy/deploy-015/` 与报告文件；未改 `~/.dsh`、未改 GLOB 部署树（deploy 由主代理执行）` | ②证据 |  |
| 148 | `| 不改 ~/.dsh | ✅ 只读 ARCH/GLOB，产物全部在 .workspace/deploy-015/ |` | `| 不改 ~/.dsh | ✅ 只读 ARCH/GLOB，产物全部在 .workspace/workstreams/deploy/deploy-015/ |` | ②证据 |  |
| 163 | `- 7 个 patch 文件：`.workspace/deploy-015/patches/`（`dsh-agent-loop.reasoningEffort.patch` 同时含 S8 + P3-C` | `- 7 个 patch 文件：`.workspace/workstreams/deploy/deploy-015/patches/`（`dsh-agent-loop.reasoningEffort.p` | ②证据 |  |
| 164 | `- 完整应用后副本：`.workspace/deploy-015/<pkg>/`（7 包，lib 与 GLOB 原树逐字节比对过，仅改动目标文件）` | `- 完整应用后副本：`.workspace/workstreams/deploy/deploy-015/<pkg>/`（7 包，lib 与 GLOB 原树逐字节比对过，仅改动目标文件）` | ②证据 |  |

## `.workspace/usage-chart-audit.md` （12 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- 证据基线：部署位 `~/.dsh/profiles/node_modules/@local/dsh-usage/`（运行态权威）+ 工作区源码副本 `/home/CNS2026495165/dsh` | `- 证据基线：部署位 `~/.dsh/profiles/node_modules/@local/dsh-usage/`（运行态权威）+ 工作区源码副本 `/home/CNS2026495165/dsh` | ②证据 |  |
| 422 | `- `.workspace/usage-tooltip-exec.md:103`：「**生效方式**：client.js 是浏览器端 bundle，替换后刷新页面即生效；无需重启宿主、无需动 DB/R` | `- `.workspace/reports/execs/usage/usage-tooltip-exec.md:103`：「**生效方式**：client.js 是浏览器端 bundle，替换后刷新页` | ②证据 |  |
| 423 | `- `.workspace/usage-heatmap-exec.md:86`：「替换后**刷新页面**即生效（rev 变化重新拉取）；无需重启宿主、无需动 DB/RPC」` | `- `.workspace/reports/execs/usage/usage-heatmap-exec.md:86`：「替换后**刷新页面**即生效（rev 变化重新拉取）；无需重启宿主、无需动 D` | ②证据 |  |
| 429 | `可用的重启工具：`.workspace/deploy-lag/dsh-restart.sh`（`FEATURE-MAP.md:69` 一行式优雅重启，SIGTERM 有界等待 dispose → 重启` | `可用的重启工具：`.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh`（`FEATURE-MAP.md:69` 一行式优雅重启，SIGTER` | ②证据 |  |
| 433 | `**源码 of truth = `/home/CNS2026495165/dsh/.workspace/dsh-usage-src/`**` | `**源码 of truth = `/home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-usage-src/`**` | ②证据 |  |
| 438 | `# 1) 在 .workspace/dsh-usage-src/lib/ 下改 client.js / charts.js` | `# 1) 在 .workspace/workstreams/sources/dsh-usage-src/lib/ 下改 client.js / charts.js` | ②证据 |  |
| 440 | `node --check /home/CNS2026495165/dsh/.workspace/dsh-usage-src/lib/client.js` | `node --check /home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-usage-src/lib/client.js` | ②证据 |  |
| 441 | `node --check /home/CNS2026495165/dsh/.workspace/dsh-usage-src/lib/charts.js` | `node --check /home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-usage-src/lib/charts.js` | ②证据 |  |
| 443 | `cp /home/CNS2026495165/dsh/.workspace/dsh-usage-src/lib/client.js \` | `cp /home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-usage-src/lib/client.js \` | ②证据 |  |
| 445 | `cp /home/CNS2026495165/dsh/.workspace/dsh-usage-src/lib/charts.js \` | `cp /home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-usage-src/lib/charts.js \` | ②证据 |  |
| 453 | `# 1) 改 .workspace/dsh-usage-src/lib/{rpc.js,db.js}` | `# 1) 改 .workspace/workstreams/sources/dsh-usage-src/lib/{rpc.js,db.js}` | ②证据 |  |
| 456 | `# 3) 重启宿主：bash /home/CNS2026495165/dsh/.workspace/deploy-lag/dsh-restart.sh` | `# 3) 重启宿主：bash /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh` | **①实链** |  |

## `.workspace/goal-p0a-exec.md` （11 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- 素材：`.workspace/goal-round-gap-audit.md`（审计结论）、0.1.5 归档 `~/.dsh/profiles-archive/web2-20260915-1054` | `- 素材：`.workspace/reports/audits/goal/goal-round-gap-audit.md`（审计结论）、0.1.5 归档 `~/.dsh/profiles-archiv` | ②证据 |  |
| 7 | `- 约束遵守：只写 `.workspace/deploy-015/dsh-goal-round-driver/` 与本报告；未改 `~/.dsh`（live 树 sha256 不变，见 §5）；未使用` | `- 约束遵守：只写 `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/` 与本报告；未改 `~/.dsh`（live 树 ` | ②证据 |  |
| 16 | `- unified diff（patch -p1 于包目录）：`.workspace/deploy-015/dsh-goal-round-driver/P0A.pause-abort-round.pa` | `- unified diff（patch -p1 于包目录）：`.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/P0A.p` | ②证据 |  |
| 17 | `- 应用后完整副本：`.workspace/deploy-015/dsh-goal-round-driver/`（与既有 attempt-attribution 副本同目录共存，`lib/index.` | `- 应用后完整副本：`.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/`（与既有 attempt-attribution ` | ②证据 |  |
| 21 | `- **部署要点**：宿主 lib 改动需**重启 dsh 进程生效**，可并入下次重启批次（与 peer 会话 P0-a 批次同理）。部署由主代理执行：将 `lib/index.js` 复制到全局包` | `- **部署要点**：宿主 lib 改动需**重启 dsh 进程生效**，可并入下次重启批次（与 peer 会话 P0-a 批次同理）。部署由主代理执行：将 `lib/index.js` 复制到全局包` | ②证据 |  |
| 92 | `路径：`.workspace/deploy-015/dsh-goal-round-driver/P0A.pause-abort-round.patch`（sha256 `1026e1e1...`）` | `路径：`.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/P0A.pause-abort-round.patch`（sha2` | ②证据 |  |
| 116 | `路径：`.workspace/deploy-015/dsh-goal-round-driver/`（既有 attempt-attribution 副本目录，本次更新 `lib/index.js` 为「` | `路径：`.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/`（既有 attempt-attribution 副本目录，本次更` | ②证据 |  |
| 190 | `- 部署动作（主代理执行）：将 `.workspace/deploy-015/dsh-goal-round-driver/lib/index.js` 覆盖至 `~/.npm-global/lib/no` | `- 部署动作（主代理执行）：将 `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/lib/index.js` 覆盖至 `~` | ②证据 |  |
| 210 | `- 交付副本：`.workspace/deploy-015/dsh-goal-round-driver/lib/index.js:234-239`（锚点 `:237`）` | `- 交付副本：`.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/lib/index.js:234-239`（锚点 `:23` | ②证据 |  |
| 212 | `- 既有补丁：`.workspace/deploy-015/patches/dsh-goal-round-driver.attempt-attribution.patch`（hunk `@@ -219` | `- 既有补丁：`.workspace/workstreams/deploy/deploy-015/patches/dsh-goal-round-driver.attempt-attribution.p` | ②证据 |  |
| 213 | `- 审计：`.workspace/goal-round-gap-audit.md`（§3.1 P0-A 机制、§4.1 事实修正）` | `- 审计：`.workspace/reports/audits/goal/goal-round-gap-audit.md`（§3.1 P0-A 机制、§4.1 事实修正）` | ②证据 |  |

## `.workspace/lag-audit-mechanism.md` （11 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 14 | `3. **「subagent 非流式落盘」机制确实存在过、且确实被清除了**（§4/§5）：2026-09-08 落地过 ②b 补丁（`execution-2b.md` 权威记录：`dsh-agent` | `3. **「subagent 非流式落盘」机制确实存在过、且确实被清除了**（§4/§5）：2026-09-08 落地过 ②b 补丁（`.workspace/reports/execs/subagen` | ②证据 |  |
| 62 | `- boot dump（`.workspace/.tmp-boot3080.html`，15:02 实抓）：43 个客户端插件条目，含 `@local/dsh-btw`；`dsh-client-run` | `- boot dump（`.workspace/probes/legacy/tmp-boot3080.html`，15:02 实抓）：43 个客户端插件条目，含 `@local/dsh-btw`；`d` | ②证据 |  |
| 93 | `- **存在证据**（工作区根 `execution-2b.md`，2026-09-08，含独立复核 PASS）：` | `- **存在证据**（工作区根 `.workspace/reports/execs/subagent/execution-2b.md`，2026-09-08，含独立复核 PASS）：` | ②证据 |  |
| 97 | `- 备份：`dsh-agent-loop.orig-20260908/`（完整目录拷贝，回滚 Runbook 在 execution-2b.md L26-31）。` | `- 备份：`dsh-agent-loop.orig-20260908/`（完整目录拷贝，回滚 Runbook 在 .workspace/reports/execs/subagent/execution` | ②证据 |  |
| 166 | `- 历史审计结论：audit-subagent-arch-A「线 W：worker_threads 驱动 = 需大改、收益存疑」；audit-subagent-arch-B「① worker_thre` | `- 历史审计结论：audit-subagent-arch-A「线 W：worker_threads 驱动 = 需大改、收益存疑」；audit-subagent-arch-B「① worker_thre` | ②证据 |  |
| 171 | `- 存在：execution-2b.md（09-08，复核 PASS）—— ②b 补丁落在运行树的 `dsh-agent-loop`（§2.3）。` | `- 存在：.workspace/reports/execs/subagent/execution-2b.md（09-08，复核 PASS）—— ②b 补丁落在运行树的 `dsh-agent-loop`` | ②证据 |  |
| 177 | `- `.workspace/lag-audit-diff.md` **尚未落盘**（本次检查时不存在；该线任务「备份 tgz 内补丁记录」的 tgz 在 `~/.dsh` 亦未找到，仅 `~/.dsh` | `- `.workspace/reports/audits/lagfix/lag-audit-diff.md` **尚未落盘**（本次检查时不存在；该线任务「备份 tgz 内补丁记录」的 tgz 在 `` | ②证据 |  |
| 178 | `- 「未确认」项清单：① host 进程线程数（沙箱 PID namespace 限制，§1.4）；② 0.1.5 尝试期间旧全局树是否也打过 ②b（无残留物证，按 execution-2b.md 的` | `- 「未确认」项清单：① host 进程线程数（沙箱 PID namespace 限制，§1.4）；② 0.1.5 尝试期间旧全局树是否也打过 ②b（无残留物证，按 .workspace/report` | ②证据 |  |
| 200 | `- **改动**（与 execution-2b.md 完全一致，2 处）：` | `- **改动**（与 .workspace/reports/execs/subagent/execution-2b.md 完全一致，2 处）：` | ②证据 |  |
| 203 | `- **前置**：`cp -r` 备份该包目录（回滚 = 还原目录；execution-2b.md L23/L26-31 的 Runbook 可复用）。` | `- **前置**：`cp -r` 备份该包目录（回滚 = 还原目录；.workspace/reports/execs/subagent/execution-2b.md L23/L26-31 的 Run` | ②证据 |  |
| 242 | `| ②b 曾存在（权威记录） | 工作区根 execution-2b.md（L6-15 改动 / L23 备份 / L26-31 回滚 / L51-57 复核 PASS） |` | `| ②b 曾存在（权威记录） | 工作区根 .workspace/reports/execs/subagent/execution-2b.md（L6-15 改动 / L23 备份 / L26-31 回` | ②证据 |  |

## `.workspace/acceptance-probe/preflight.md` （10 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 14 | `| 1 | 新插件 `@local/dsh-subagent-model` | **GO** | host `lib/index.js` + `lib/client.js` + `package.js` | `| 1 | 新插件 `@local/dsh-subagent-model` | **GO** | host `lib/index.js` + `lib/client.js` + `package.js` | ②证据 |  |
| 52 | `产物源目录：`/home/CNS2026495165/dsh/.workspace/deploy-subagent-model/`（含 `lib/index.js`、`lib/client.js`、`` | `产物源目录：`/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-subagent-model/`（含 `lib/index.js` | ②证据 |  |
| 97 | `cmp <部署位>/$f <.workspace/deploy-subagent-model>/$f && echo "IDENTICAL: $f"; done` | `cmp <部署位>/$f <.workspace/workstreams/deploy/deploy-subagent-model>/$f && echo "IDENTICAL: $f"; done` | ②证据 |  |
| 218 | `$ sha256sum .workspace/deploy-subagent-model/dsh-tool-subagent.index.js.patched \` | `$ sha256sum .workspace/workstreams/deploy/deploy-subagent-model/dsh-tool-subagent.index.js.patched \` | ②证据 |  |
| 499 | `本档为只读纪律，**未写真实 profile 目录**；改为把 `DSH_HOME` 指向 `.workspace/acceptance-probe/mirror`（软链 `node_modules`` | `本档为只读纪律，**未写真实 profile 目录**；改为把 `DSH_HOME` 指向 `.workspace/probes/acceptance/mirror`（软链 `node_modules` | ②证据 |  |
| 669 | `| 2 | `cp -r .workspace/backup-btw-20260917-170146/* ~/.dsh/profiles/node_modules/@local/dsh-btw/` |` | `| 2 | `cp -r .workspace/backups/btw/20260917-170146/* ~/.dsh/profiles/node_modules/@local/dsh-btw/` ` | ②证据 |  |
| 759 | `- **位置**：`.workspace/RESTART-ACCEPTANCE.md` §3 回滚表第 4 行` | `- **位置**：`.workspace/reports/execs/acceptance/RESTART-ACCEPTANCE.md` §3 回滚表第 4 行` | ②证据 |  |
| 766 | ``sed -i 's|dsh-tool-subagent.index.js.bak-\*.bak|dsh-tool-subagent.index.js.bak-*|' .workspace/RESTA` | ``sed -i 's|dsh-tool-subagent.index.js.bak-\*.bak|dsh-tool-subagent.index.js.bak-*|' .workspace/repor` | ②证据 |  |
| 796 | `S=~/.dsh/../CNS2026495165/dsh/.workspace/deploy-subagent-model` | `S=~/.dsh/../CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-subagent-model` | **①实链** |  |
| 835 | `ls /home/CNS2026495165/dsh/.workspace/backup-btw-20260917-170146/* >/dev/null && echo GLOB_OK` | `ls /home/CNS2026495165/dsh/.workspace/backups/btw/20260917-170146/* >/dev/null && echo GLOB_OK` | ②证据 |  |

## `.workspace/audit-a-lagfix.md` （10 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 20 | `| 与 execution-2b.md 语义一致 | — | 与备份 diff 仅 2 处，逐字等于 execution-2b.md L8/L12 记载代码；子代理不逐 chunk 落盘、一轮结束写 ` | `| 与 .workspace/reports/execs/subagent/execution-2b.md 语义一致 | — | 与备份 diff 仅 2 处，逐字等于 .workspace/repo` | ②证据 |  |
| 50 | `| `session/prompt-image-transform` waterfall（btw 官方补丁） | L2771 `const transformed = await ctx.waterf` | `| `session/prompt-image-transform` waterfall（btw 官方补丁） | L2771 `const transformed = await ctx.waterf` | ②证据 |  |
| 55 | `- `.workspace/deploy-lag/hardening/host-apiproxy.lib.index.js`（加固副本）与 live **diff 0 行**（完全一致）。` | `- `.workspace/workstreams/deploy/deploy-lag/hardening/host-apiproxy.lib.index.js`（加固副本）与 live **diff` | ②证据 |  |
| 58 | `**⚠️ 观察 L-2（低危）**：replay-lag-fix.sh 只重放 u4/u5/u5b 三个 patch，**不覆盖 btw sessions-prompt-transform 补丁**；` | `**⚠️ 观察 L-2（低危）**：replay-lag-fix.sh 只重放 u4/u5/u5b 三个 patch，**不覆盖 btw sessions-prompt-transform 补丁**；` | ②证据 |  |
| 69 | `- live `lib/index.js` sha256 `64088a4be6f84f1e5c803f9848899cd8cba7b38537d5fb9aa523fbead8c467b5` == `` | `- live `lib/index.js` sha256 `64088a4be6f84f1e5c803f9848899cd8cba7b38537d5fb9aa523fbead8c467b5` == `` | ②证据 |  |
| 82 | `| llm-pi-ai 可服务性 | — | 用 `.workspace/diag-piai-route.mjs`（复刻 dsh-llm-pi-ai resolveRouteModels L607-6` | `| llm-pi-ai 可服务性 | — | 用 `.workspace/probes/workflow-drivers/diag-piai-route.mjs`（复刻 dsh-llm-pi-ai r` | ②证据 |  |
| 86 | `文件：`.workspace/deploy-lag/replay-lag-fix.sh`（418 行，mtime 09-14 10:38）` | `文件：`.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh`（418 行，mtime 09-14 10:38）` | ②证据 |  |
| 99 | `**⚠️ 观察 L-3（低危，文档漂移）**：execution-2b.md L23/L27-30 回滚 runbook 引用 `~/.dsh/profiles/web/node_modules/@d` | `**⚠️ 观察 L-3（低危，文档漂移）**：.workspace/reports/execs/subagent/execution-2b.md L23/L27-30 回滚 runbook 引用 `~` | ②证据 |  |
| 117 | `| L-2 | 低 | replay-lag-fix.sh 不重放 btw `session/prompt-image-transform` 补丁（仅 u4/u5/u5b）；apiproxy 还原官方` | `| L-2 | 低 | replay-lag-fix.sh 不重放 btw `session/prompt-image-transform` 补丁（仅 u4/u5/u5b）；apiproxy 还原官方` | ②证据 |  |
| 118 | `| L-3 | 低 | execution-2b.md 回滚 runbook 引用已不存在的 `.orig-20260908` 目录（文档漂移） | `find ~/.dsh /home/CNS202` | `| L-3 | 低 | .workspace/reports/execs/subagent/execution-2b.md 回滚 runbook 引用已不存在的 `.orig-20260908` 目录` | ②证据 |  |

## `.workspace/goal-pending-subagent-exec.md` （10 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- 依据：`.workspace/goal-round-gap-audit.md` §6.4（方案 A 设计）、用户裁决实施方案 A` | `- 依据：`.workspace/reports/audits/goal/goal-round-gap-audit.md` §6.4（方案 A 设计）、用户裁决实施方案 A` | ②证据 |  |
| 7 | `- 约束遵守：只写 `.workspace/deploy-015/dsh-goal-round-driver/` 与报告；未改 `~/.dsh` / live 宿主 lib（部署由主代理执行）；未使用` | `- 约束遵守：只写 `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/` 与报告；未改 `~/.dsh` / live 宿` | ②证据 |  |
| 17 | `| unified diff | ✅ `.workspace/deploy-015/dsh-goal-round-driver/pending-subagent.patch`（patch -p1 于包` | `| unified diff | ✅ `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/pending-subagent.` | ②证据 |  |
| 18 | `| 应用后完整副本 | ✅ `.workspace/deploy-015/dsh-goal-round-driver/lib/index.js`（sha256 `c4f3ea68c56f51a1181` | `| 应用后完整副本 | ✅ `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/lib/index.js`（sha256 `` | ②证据 |  |
| 62 | `| unified diff（patch -p1 于包目录） | `.workspace/deploy-015/dsh-goal-round-driver/pending-subagent.patch` | `| unified diff（patch -p1 于包目录） | `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/pen` | ②证据 |  |
| 63 | `| 应用后完整副本 | `.workspace/deploy-015/dsh-goal-round-driver/lib/index.js`（392 行，sha256 `c4f3ea68c56f51a` | `| 应用后完整副本 | `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/lib/index.js`（392 行，sha2` | ②证据 |  |
| 64 | `| mock 验证脚本 | `.workspace/deploy-015/dsh-goal-round-driver/verify/mock-verify.mjs` |` | `| mock 验证脚本 | `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/verify/mock-verify.mjs` | ②证据 |  |
| 65 | `| mock 验证输出 | `.workspace/deploy-015/dsh-goal-round-driver/verify/mock-verify-output.txt`（13/13 PASS` | `| mock 验证输出 | `.workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/verify/mock-verify-out` | ②证据 |  |
| 66 | `| 本报告 | `.workspace/goal-pending-subagent-exec.md` |` | `| 本报告 | `.workspace/reports/execs/goal/goal-pending-subagent-exec.md` |` | ③自身档 | 是 |
| 112 | `- 部署步骤：`patch -p1 < .workspace/deploy-015/dsh-goal-round-driver/pending-subagent.patch`（于 `~/.npm-gl` | `- 部署步骤：`patch -p1 < .workspace/workstreams/deploy/deploy-015/dsh-goal-round-driver/pending-subagent.` | ②证据 |  |

## `.workspace/research/audit-dsh-remote.md` （10 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 7 | `- 源码：`/home/CNS2026495165/dsh/.workspace/repos/dsh-remote`` | `- 源码：`/home/CNS2026495165/dsh/.workspace/workstreams/research/repos/dsh-remote`` | ②证据 |  |
| 8 | `- tarball 展开：`/home/CNS2026495165/dsh/.workspace/research/tarballs/{dr-0.8.14,dr-0.8.15,bs-0.14.0,bs` | `- tarball 展开：`/home/CNS2026495165/dsh/.workspace/workstreams/research/research/tarballs/{dr-0.8.14,d` | ②证据 |  |
| 9 | `- registry 原始 JSON：`/home/CNS2026495165/dsh/.workspace/research/data/dsh-remote-registry.json`、`dsh-` | `- registry 原始 JSON：`/home/CNS2026495165/dsh/.workspace/workstreams/research/research/data/dsh-remote` | ②证据 |  |
| 38 | `/home/CNS2026495165/dsh/.workspace/repos/dsh-remote` | `/home/CNS2026495165/dsh/.workspace/workstreams/research/repos/dsh-remote` | ②证据 |  |
| 659 | `/home/CNS2026495165/dsh/.workspace/repos/dsh-remote` | `/home/CNS2026495165/dsh/.workspace/workstreams/research/repos/dsh-remote` | ②证据 |  |
| 660 | `cd /home/CNS2026495165/dsh/.workspace/repos/dsh-remote` | `cd /home/CNS2026495165/dsh/.workspace/workstreams/research/repos/dsh-remote` | **①实链** |  |
| 691 | `- `/home/CNS2026495165/dsh/.workspace/research/data/dsh-remote-registry.json`` | `- `/home/CNS2026495165/dsh/.workspace/workstreams/research/research/data/dsh-remote-registry.json`` | ②证据 |  |
| 692 | `- `/home/CNS2026495165/dsh/.workspace/research/data/dsh-better-sidebar-registry.json`` | `- `/home/CNS2026495165/dsh/.workspace/workstreams/research/research/data/dsh-better-sidebar-registry` | ②证据 |  |
| 693 | `- `/home/CNS2026495165/dsh/.workspace/research/tarballs/*`（9 个版本 tarball + 展开目录）` | `- `/home/CNS2026495165/dsh/.workspace/workstreams/research/research/tarballs/*`（9 个版本 tarball + 展开目录` | ②证据 |  |
| 694 | `- `/home/CNS2026495165/dsh/.workspace/repos/dsh-remote`（源码，HEAD `559e26c`）` | `- `/home/CNS2026495165/dsh/.workspace/workstreams/research/repos/dsh-remote`（源码，HEAD `559e26c`）` | ②证据 |  |

## `.workspace/borrow-015-exec.md` （8 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `- 依据：`.workspace/upstream-015-diff.md` §3 值得借鉴短清单（P0/P1/P2 全采纳）；`upstream-borrow-validation.md` 已否决项` | `- 依据：`.workspace/reports/audits/upstream/upstream-015-diff.md` §3 值得借鉴短清单（P0/P1/P2 全采纳）；`upstream-bo` | ②证据 |  |
| 7 | `- 产出：`.workspace/deploy-015/<pkg>/`（应用后完整副本，12 包）、`.workspace/deploy-015/patches/*.patch`（unified di` | `- 产出：`.workspace/workstreams/deploy/deploy-015/<pkg>/`（应用后完整副本，12 包）、`.workspace/workstreams/deploy/` | ②证据 |  |
| 8 | `- 约束遵守：只写 `.workspace/deploy-015/`、`.workspace/deploy-lag/` 与本报告；未改 `~/.dsh` 任何文件与全局树（5 个既有补丁包时间戳保持 ` | `- 约束遵守：只写 `.workspace/workstreams/deploy/deploy-015/`、`.workspace/deploy-lag/` 与本报告；未改 `~/.dsh` 任何文件` | ②证据 |  |
| 102 | `## 2. 统一 diff 与副本产物（.workspace/deploy-015/）` | `## 2. 统一 diff 与副本产物（.workspace/workstreams/deploy/deploy-015/）` | ②证据 |  |
| 111 | `## 3. replay 扩展：`.workspace/deploy-lag/patch-official-015.sh`（新增独立脚本）` | `## 3. replay 扩展：`.workspace/workstreams/deploy/deploy-lag/patch-official-015.sh`（新增独立脚本）` | ②证据 |  |
| 152 | `.workspace/deploy-lag/patch-official-015.sh            # 或先 --dry-run 预览` | `.workspace/workstreams/deploy/deploy-lag/patch-official-015.sh            # 或先 --dry-run 预览` | ②证据 |  |
| 158 | `# 4) 回滚（如需要）：.workspace/deploy-lag/patch-official-015.sh --rollback && 重启` | `# 4) 回滚（如需要）：.workspace/workstreams/deploy/deploy-lag/patch-official-015.sh --rollback && 重启` | ②证据 |  |
| 162 | `- 部署脚本默认 DSH_ROOT 指向全局树；补丁根 `.workspace/deploy-015/` 经 `P015_DIR` 可覆盖。` | `- 部署脚本默认 DSH_ROOT 指向全局树；补丁根 `.workspace/workstreams/deploy/deploy-015/` 经 `P015_DIR` 可覆盖。` | ②证据 |  |

## `.workspace/borrow-015-groupB-exec.md` （8 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `- 上游背景：组 B 原档耗尽上下文；`.workspace/deploy-015/<pkg>/` 应用后副本已在，patch 疑似缺失/为空。经核验：**4 个 patch 均已在位且完整**（15` | `- 上游背景：组 B 原档耗尽上下文；`.workspace/workstreams/deploy/deploy-015/<pkg>/` 应用后副本已在，patch 疑似缺失/为空。经核验：**4 个` | ②证据 |  |
| 6 | `- 约束遵守：只写 `.workspace/deploy-015/` 与报告；未改动 `~/.dsh`（部署由主代理执行）；未使用 sandbox_permissions。` | `- 约束遵守：只写 `.workspace/workstreams/deploy/deploy-015/` 与报告；未改动 `~/.dsh`（部署由主代理执行）；未使用 sandbox_permiss` | ②证据 |  |
| 24 | `| # | 包 | patch 路径（相对 `.workspace/deploy-015/patches/`） | 差异文件 | 锚点 | 状态 |` | `| # | 包 | patch 路径（相对 `.workspace/workstreams/deploy/deploy-015/patches/`） | 差异文件 | 锚点 | 状态 |` | ②证据 |  |
| 46 | `5. **可应用性实测**：`/tmp/exec015-v/` 以 GLOB 重建 4 包，`patch -p1 --dry-run` 全过；实打后 `diff -rq` 与 `.workspace/` | `5. **可应用性实测**：`/tmp/exec015-v/` 以 GLOB 重建 4 包，`patch -p1 --dry-run` 全过；实打后 `diff -rq` 与 `.workspace/` | ②证据 |  |
| 61 | `2. **应用方式**：每包目录内 `patch -p1 < .workspace/deploy-015/patches/<pkg>.groupB.patch`（已验证可应用且结果与副本逐字节一致）。` | `2. **应用方式**：每包目录内 `patch -p1 < .workspace/workstreams/deploy/deploy-015/patches/<pkg>.groupB.patch`（` | ②证据 |  |
| 70 | `- dsh-subagent：`.workspace/baseline-011/x/dsh-subagent`（0.1.1 原样）+ `.workspace/deploy-p0/dsh-subagen` | `- dsh-subagent：`.workspace/workstreams/baseline-011/x/dsh-subagent`（0.1.1 原样）+ `.workspace/deploy-p0` | ②证据 |  |
| 71 | `- fork / spawn / tool-subagent：`.workspace/baseline-011/x/<pkg>` 原样 + 各自 groupB patch → 与副本 **BYTE-I` | `- fork / spawn / tool-subagent：`.workspace/workstreams/baseline-011/x/<pkg>` 原样 + 各自 groupB patch → ` | ②证据 |  |
| 76 | `- 两树各包根目录出现 `*.rej` 残留（mtime 16:08，13 个），来源为部署方对已应用内容的二次 patch 触发 "Reversed (or previously applied) ` | `- 两树各包根目录出现 `*.rej` 残留（mtime 16:08，13 个），来源为部署方对已应用内容的二次 patch 触发 "Reversed (or previously applied) ` | ②证据 |  |

## `.workspace/deploy-slots/REPLAY.md` （8 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 依据：`.workspace/slot-mod-audit.md` §6/§7（replay 体系要求）与 `master-runbook.md` §1b（npm 遮蔽事故教训：` | `> 依据：`.workspace/reports/audits/slots/slot-mod-audit.md` §6/§7（replay 体系要求）与 `master-runbook.md` §1b` | ②证据 |  |
| 5 | `> 本次落地（修订执行复核一体档，`.workspace/deploy-slots/slot-b-exec.md`）。` | `> 本次落地（修订执行复核一体档，`.workspace/workstreams/deploy/deploy-slots/slot-b-exec.md`）。` | ②证据 |  |
| 11 | `| S-B1 | 官方 `@deepseek-ai/dsh-client-ui-workspace` 槽位路径 B 补丁（`lib/client.js` children 声明 + Workspace` | `| S-B1 | 官方 `@deepseek-ai/dsh-client-ui-workspace` 槽位路径 B 补丁（`lib/client.js` children 声明 + Workspace` | ②证据 |  |
| 17 | `cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh            # dry-run 预检` | `cd ~/dsh/.workspace/workstreams/deploy/deploy-slots && bash patch-official-slots.sh            # dry` | **①实链** |  |
| 18 | `cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --apply    # 真实应用` | `cd ~/dsh/.workspace/workstreams/deploy/deploy-slots && bash patch-official-slots.sh --apply    # 真实应` | **①实链** |  |
| 20 | `cd ~/dsh/.workspace/deploy-ssh-gui && bash deploy.sh --apply` | `cd ~/dsh/.workspace/workstreams/deploy/deploy-ssh-gui && bash deploy.sh --apply` | **①实链** |  |
| 24 | `**回滚**：`cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --rollback`（还原最新备份）。` | `**回滚**：`cd ~/dsh/.workspace/workstreams/deploy/deploy-slots && bash patch-official-slots.sh --rollba` | **①实链** |  |
| 37 | `cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --rollback` | `cd ~/dsh/.workspace/workstreams/deploy/deploy-slots && bash patch-official-slots.sh --rollback` | **①实链** |  |

## `.workspace/lag-fix-exec.md` （8 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `> `lag-audit-mechanism.md`、`lag-audit-diff.md`、`execution-2b.md`、` | `> `lag-audit-mechanism.md`、`lag-audit-diff.md`、`.workspace/reports/execs/subagent/execution-2b.md`、` | ②证据 |  |
| 8 | `> 约束遵守：**只写** `.workspace/deploy-lag/` 与本报告；未改 `~/.npm-global` 与 `~/.dsh` 任何文件；` | `> 约束遵守：**只写** `.workspace/workstreams/deploy/deploy-lag/` 与本报告；未改 `~/.npm-global` 与 `~/.dsh` 任何文件；` | ②证据 |  |
| 30 | `- U-8 与已产出 `.workspace/deploy/settings-vision-adam.snippet.yaml` 合并：新 lib 默认` | `- U-8 与已产出 `.workspace/workstreams/deploy/deploy/settings-vision-adam.snippet.yaml` 合并：新 lib 默认` | ②证据 |  |
| 35 | `## 1. 产物清单（全部在 /home/CNS2026495165/dsh/.workspace/deploy-lag/ 下）` | `## 1. 产物清单（全部在 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/ 下）` | ②证据 |  |
| 60 | `- 与 live 原厂 diff = **恰 2 hunk**，与 execution-2b.md L6-15 逐字一致：` | `- 与 live 原厂 diff = **恰 2 hunk**，与 .workspace/reports/execs/subagent/execution-2b.md L6-15 逐字一致：` | ②证据 |  |
| 66 | `- 与 live 原厂 diff = 4 hunk，与审计 patch（`.workspace/tmp-tgz-audit/dsh-client-ui-subagent.patch`）` | `- 与 live 原厂 diff = 4 hunk，与审计 patch（`.workspace/workstreams/tmp-tgz-audit/dsh-client-ui-subagent.pat` | ②证据 |  |
| 173 | `主会话打字机照常」需部署期执行（execution-2b.md L33-44 Runbook 已固化进脚本 --help）。` | `主会话打字机照常」需部署期执行（.workspace/reports/execs/subagent/execution-2b.md L33-44 Runbook 已固化进脚本 --help）。` | ②证据 |  |
| 183 | `- 未使用 `sandbox_permissions`；仅写 `.workspace/deploy-lag/`（产物）与 `.workspace/lag-fix-exec.md`（本报告）。` | `- 未使用 `sandbox_permissions`；仅写 `.workspace/deploy-lag/`（产物）与 `.workspace/reports/execs/lagfix/lag-fi` | ③自身档 | 是 |

## `.workspace/btw-upgrade-impl-audit.md` （7 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 依据：方案契约 v2（.workspace/btw-upgrade-plan.md，裁决 R1-1..R1-10 / 沿用 R0-3/4/5，本报告不违背、不开新裁决）、现状审计（.workspa` | `> 依据：方案契约 v2（.workspace/btw-upgrade-plan.md，裁决 R1-1..R1-10 / 沿用 R0-3/4/5，本报告不违背、不开新裁决）、现状审计（.workspa` | ②证据 |  |
| 133 | `- **产物**：`.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch`（diff）+ 应用后完整文` | `- **产物**：`.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.p` | ②证据 |  |
| 241 | `- 文件/位置：产物 `.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch` + 应用后的完整文件副` | `- 文件/位置：产物 `.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform` | ②证据 |  |
| 251 | `- 文件/位置：新源码 `.workspace/deploy/vision-adam/lib/index.js`（替换 `~/.dsh/profiles/node_modules/@deepseek-` | `- 文件/位置：新源码 `.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js`（替换 `~/.dsh/profiles/node` | ②证据 |  |
| 319 | `- 文件/位置：`.workspace/deploy/README-v2.md`（部署 runbook）或并入现有部署脚本目录。` | `- 文件/位置：`.workspace/workstreams/deploy/deploy/README-v2.md`（部署 runbook）或并入现有部署脚本目录。` | ②证据 |  |
| 357 | `3. 替换 vision-adam：`cp .workspace/deploy/vision-adam/lib/index.js ~/.dsh/profiles/node_modules/@deeps` | `3. 替换 vision-adam：`cp .workspace/workstreams/deploy/deploy/vision-adam/lib/index.js ~/.dsh/profiles/` | ②证据 |  |
| 358 | `4. 应用 patch：`cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy && patch -p1 < ~/dsh` | `4. 应用 patch：`cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy && patch -p1 < ~/dsh` | ②证据 |  |

## `.workspace/btw-upgrade-impl-exec.md` （7 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 依据：审计交付单元（.workspace/btw-upgrade-impl-audit.md，388 行全文）、方案契约 v2（.workspace/btw-upgrade-plan.md）、现状` | `> 依据：审计交付单元（.workspace/reports/audits/btw/btw-upgrade-impl-audit.md，388 行全文）、方案契约 v2（.workspace/btw-` | ②证据 |  |
| 27 | `| U-G-2 官方包 patch | 非本线（部署产物已就绪） | `.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-tran` | `| U-G-2 官方包 patch | 非本线（部署产物已就绪） | `.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.s` | ②证据 |  |
| 28 | `| U-H vision-adam 新 lib | 非本线（部署产物已就绪） | `.workspace/deploy/vision-adam/lib/index.js` 已存在；导出 resolve` | `| U-H vision-adam 新 lib | 非本线（部署产物已就绪） | `.workspace/workstreams/deploy/deploy/vision-adam/lib/index` | ②证据 |  |
| 35 | `| U-O 部署 runbook/文档产物 | 非本线 | `.workspace/deploy/`（patches/APPLY.md/settings snippet/README 由部署线维护）；` | `| U-O 部署 runbook/文档产物 | 非本线 | `.workspace/workstreams/deploy/deploy/`（patches/APPLY.md/settings snip` | ②证据 |  |
| 90 | `1. **vision-adam lib**（U-H 产物）：btw 经 lazy `import('@deepseek-ai/dsh-vision-adam')` 调 `analyzeImageBy` | `1. **vision-adam lib**（U-H 产物）：btw 经 lazy `import('@deepseek-ai/dsh-vision-adam')` 调 `analyzeImageBy` | ②证据 |  |
| 91 | `2. **官方包 patch**（U-G-2 产物）：waterfall 名 **`session/prompt-image-transform`**，payload `{agent, content` | `2. **官方包 patch**（U-G-2 产物）：waterfall 名 **`session/prompt-image-transform`**，payload `{agent, content` | ②证据 |  |
| 112 | `3. 部署顺序（审计 §8）：备份（btw lib / vision-adam index.js / host-apiproxy index.js）→ 拷 btw lib → 替换 vision-ad` | `3. 部署顺序（审计 §8）：备份（btw lib / vision-adam index.js / host-apiproxy index.js）→ 拷 btw lib → 替换 vision-ad` | ②证据 |  |

## `.workspace/btw-upgrade-plan.md` （7 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 29 | `- 证据：`.workspace/opencode-deepseek-v4-flash-probe.md`（+ oc_* 原始产物）；`.workspace/vision-flash-test.md`` | `- 证据：`.workspace/reports/research/opencode-deepseek-v4-flash-probe.md`（+ oc_* 原始产物）；`.workspace/visi` | ②证据 |  |
| 32 | `## 2. 关键现状事实（审计证据，详见 .workspace/btw-upgrade-audit.md）` | `## 2. 关键现状事实（审计证据，详见 .workspace/reports/audits/btw/btw-upgrade-audit.md）` | ②证据 |  |
| 62 | `- 产物形态：因部署位在 ~/.dsh（工作区外），执行阶段把**新 lib 文件落到 `.workspace/deploy/vision-adam/lib/index.js`**（+ diff/pa` | `- 产物形态：因部署位在 ~/.dsh（工作区外），执行阶段把**新 lib 文件落到 `.workspace/workstreams/deploy/deploy/vision-adam/lib/in` | ②证据 |  |
| 84 | `- U-G 主会话 hook：插件面挂点（在 btw 内）或官方包 patch 产物（`.workspace/deploy/`）` | `- U-G 主会话 hook：插件面挂点（在 btw 内）或官方包 patch 产物（`.workspace/workstreams/deploy/deploy/`）` | ②证据 |  |
| 85 | `- U-H vision-adam 配置化新 lib 产物（`.workspace/deploy/vision-adam/lib/index.js` + 兼容说明）` | `- U-H vision-adam 配置化新 lib 产物（`.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js` + 兼容说明` | ②证据 |  |
| 111 | `cp .workspace/deploy/vision-adam/lib/index.js ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-a` | `cp .workspace/workstreams/deploy/deploy/vision-adam/lib/index.js ~/.dsh/profiles/node_modules/@deeps` | ②证据 |  |
| 113 | `# （若产出官方包 patch）：备份 + 应用 .workspace/deploy/patches/ 下的补丁` | `# （若产出官方包 patch）：备份 + 应用 .workspace/workstreams/deploy/deploy/patches/ 下的补丁` | ②证据 |  |

## `.workspace/deploy-subagent-model/README.md` （7 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `审计契约：`.workspace/subagent-model-gui-audit.md`（§2.3 读取层选点、§3 四件套、§5 P0'/P0）。` | `审计契约：`.workspace/reports/audits/subagent-model/subagent-model-gui-audit.md`（§2.3 读取层选点、§3 四件套、§5 P0'` | ②证据 |  |
| 4 | `执行报告：`.workspace/subagent-model-settings-exec.md`。` | `执行报告：`.workspace/reports/execs/subagent-model/subagent-model-settings-exec.md`。` | ②证据 |  |
| 29 | `cp .workspace/deploy-subagent-model/dsh-tool-subagent.index.js.patched \` | `cp .workspace/workstreams/deploy/deploy-subagent-model/dsh-tool-subagent.index.js.patched \` | ②证据 |  |
| 35 | `cp .workspace/deploy-subagent-model/package.json "$DST/package.json"` | `cp .workspace/workstreams/deploy/deploy-subagent-model/package.json "$DST/package.json"` | ②证据 |  |
| 36 | `cp .workspace/deploy-subagent-model/lib/index.js "$DST/lib/index.js"` | `cp .workspace/workstreams/deploy/deploy-subagent-model/lib/index.js "$DST/lib/index.js"` | ②证据 |  |
| 37 | `cp .workspace/deploy-subagent-model/lib/client.js "$DST/lib/client.js"` | `cp .workspace/workstreams/deploy/deploy-subagent-model/lib/client.js "$DST/lib/client.js"` | ②证据 |  |
| 77 | `cd .workspace/deploy-subagent-model && node smoke-client.mjs` | `cd .workspace/workstreams/deploy/deploy-subagent-model && node smoke-client.mjs` | **①实链** |  |

## `.workspace/subagent-model-settings-exec.md` （7 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `- 审计契约：`.workspace/subagent-model-gui-audit.md`（§2.3 读取层选点、§3 四件套、§5 P0'/P0）；先例：P0-b（settings 命名空间 +` | `- 审计契约：`.workspace/reports/audits/subagent-model/subagent-model-gui-audit.md`（§2.3 读取层选点、§3 四件套、§5 P` | ②证据 |  |
| 5 | `- 约束遵守：未改 dsh-btw；改动前备份 `~/.dsh/backups/`（dsh-tool-subagent.index.js.bak-20260917-165928、cordis.patc` | `- 约束遵守：未改 dsh-btw；改动前备份 `~/.dsh/backups/`（dsh-tool-subagent.index.js.bak-20260917-165928、cordis.patc` | ②证据 |  |
| 16 | `- diff：`.workspace/deploy-subagent-model/dsh-tool-subagent.p0.diff`（46 行，仅 2 处 hunk）；部署位 sha256 与 `d` | `- diff：`.workspace/workstreams/deploy/deploy-subagent-model/dsh-tool-subagent.p0.diff`（46 行，仅 2 处 hu` | ②证据 |  |
| 40 | `- `lib/index.js` sha256 `e93de18da406…` == `.workspace/deploy-subagent-model/lib/index.js`（逐字节一致）✅` | `- `lib/index.js` sha256 `e93de18da406…` == `.workspace/workstreams/deploy/deploy-subagent-model/lib/` | ②证据 |  |
| 62 | `node --check .workspace/deploy-subagent-model/{lib/index.js,lib/client.js} ✅` | `node --check .workspace/workstreams/deploy/deploy-subagent-model/{lib/index.js,lib/client.js} ✅` | ②证据 |  |
| 95 | `- 交付副本：`.workspace/deploy-subagent-model/`（diff、patched 全文、包三件、smoke-client.mjs、README、settings.exam` | `- 交付副本：`.workspace/workstreams/deploy/deploy-subagent-model/`（diff、patched 全文、包三件、smoke-client.mjs、R` | ②证据 |  |
| 96 | `- 备份：`~/.dsh/backups/` + `.workspace/backup-subagent-model-20260917-165928/`` | `- 备份：`~/.dsh/backups/` + `.workspace/backups/subagent-model/20260917-165928/`` | ②证据 |  |

## `.workspace/upstream-015-diff.md` （7 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `> 纯净基线（BASE）：`.workspace/baseline-011/x/`（0.1.1-rc.2 原厂 tgz，界定既有补丁面）` | `> 纯净基线（BASE）：`.workspace/workstreams/baseline-011/x/`（0.1.1-rc.2 原厂 tgz，界定既有补丁面）` | ②证据 |  |
| 8 | `> 前置资料：`.workspace/upstream-borrow-validation.md`（槽位/流式两项独立验证）、前版 `upstream-015-diff.md`（B1–B10 破坏面）` | `> 前置资料：`.workspace/reports/audits/upstream/upstream-borrow-validation.md`（槽位/流式两项独立验证）、前版 `upstream-` | ②证据 |  |
| 9 | `> **§6（2026-09-15 追加）**：G1–G6 六档并行深挖（120 包逐包裁决）核验补充，notes 见 `.workspace/upstream-015-diff/groups/`；新` | `> **§6（2026-09-15 追加）**：G1–G6 六档并行深挖（120 包逐包裁决）核验补充，notes 见 `.workspace/workstreams/upstream-015-dif` | ②证据 |  |
| 104 | `| **P2(条件)** | `dsh-llm-deepseek` image-tokens 定价模块 | DeepSeek v4 图像 token 计费纯函数 | 独立纯函数 ~40 行，零新依赖 ` | `| **P2(条件)** | `dsh-llm-deepseek` image-tokens 定价模块 | DeepSeek v4 图像 token 计费纯函数 | 独立纯函数 ~40 行，零新依赖 ` | ②证据 |  |
| 111 | `### A. 已否决项（引用 `.workspace/upstream-borrow-validation.md` §3.2 + 前版 §4，不再论证）` | `### A. 已否决项（引用 `.workspace/reports/audits/upstream/upstream-borrow-validation.md` §3.2 + 前版 §4，不再论证）` | ②证据 |  |
| 141 | `- 既有补丁面参照 `.workspace/upstream-borrow-validation.md` §0 与 `baseline-011`；本清单 P0–P2 全部避开 5 个补丁包。` | `- 既有补丁面参照 `.workspace/reports/audits/upstream/upstream-borrow-validation.md` §0 与 `baseline-011`；本清单` | ②证据 |  |
| 148 | `> 深挖 notes（每文件含 (a)-(e) 小节 + file:line 索引）：`.workspace/upstream-015-diff/groups/G1..G6-*.md`` | `> 深挖 notes（每文件含 (a)-(e) 小节 + file:line 索引）：`.workspace/workstreams/upstream-015-diff/groups/G1..G6-*` | ②证据 |  |

## `.workspace/vision-prompt-exec.md` （7 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `> 依据：`.workspace/btw-usage-ui-audit.md` §4（落点 :149-153/:236-279/:229-233、vision.ts:46/:70-78）。` | `> 依据：`.workspace/reports/audits/btw/btw-usage-ui-audit.md` §4（落点 :149-153/:236-279/:229-233、vision.t` | ②证据 |  |
| 21 | `- `.workspace/dsh-vision-adam-src/lib/index.js` — 工作区源副本（= 部署位 cp 后改，两处 hunk）` | `- `.workspace/workstreams/sources/dsh-vision-adam-src/lib/index.js` — 工作区源副本（= 部署位 cp 后改，两处 hunk）` | ②证据 |  |
| 22 | `- `.workspace/deploy-vision-prompt/index.js` — 应用后完整副本（sha256 `54ac2548ff3215b0837185de6949c6bd796e0` | `- `.workspace/workstreams/deploy/deploy-vision-prompt/index.js` — 应用后完整副本（sha256 `54ac2548ff3215b083` | ②证据 |  |
| 23 | `- `.workspace/deploy-vision-prompt/vision-adam-index.js.diff` — unified diff（a/ b/ 相对路径，`patch -p1` ` | `- `.workspace/workstreams/deploy/deploy-vision-prompt/vision-adam-index.js.diff` — unified diff（a/ b` | ②证据 |  |
| 24 | `- `.workspace/deploy-vision-prompt/APPLY.md` — 备份/应用/回滚 runbook（含 btw 侧构建流）` | `- `.workspace/workstreams/deploy/deploy-vision-prompt/APPLY.md` — 备份/应用/回滚 runbook（含 btw 侧构建流）` | ②证据 |  |
| 25 | `- `.workspace/deploy-vision-prompt/smoke-test-output.txt` — 实测输出存档` | `- `.workspace/workstreams/deploy/deploy-vision-prompt/smoke-test-output.txt` — 实测输出存档` | ②证据 |  |
| 26 | `- `.workspace/dsh-vision-adam-src/smoke-test.mjs` — 冒烟脚本（测试用；需临时 symlink profiles node_modules 方可 im` | `- `.workspace/workstreams/sources/dsh-vision-adam-src/smoke-test.mjs` — 冒烟脚本（测试用；需临时 symlink profile` | ②证据 |  |

## `.workspace/acceptance-probe/context-window-table.md` （6 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 13 | `3484987 四 9月 17 18:05:23 2026 bash -c cd /home/CNS2026495165/dsh && bash .workspace/acceptance-probe` | `3484987 四 9月 17 18:05:23 2026 bash -c cd /home/CNS2026495165/dsh && bash .workspace/probes/acceptanc` | **①实链** |  |
| 243 | `$ python3 -c "import json;d=json.load(open('.workspace/models_fresh.json'));print('count',len(d['dat` | `$ python3 -c "import json;d=json.load(open('.workspace/probes/captures/models_fresh.json'));print('c` | ②证据 |  |
| 438 | `| A11 | `python3` 解析 `.workspace/models_fresh.json` | 缓存证明 `/v1/models` **字段并集不含任何 context 字段** |` | `| A11 | `python3` 解析 `.workspace/probes/captures/models_fresh.json` | 缓存证明 `/v1/models` **字段并集不含任何 c` | ②证据 |  |
| 440 | `| A13 | `grep -rn "contextWindow" .workspace/acceptance-exec.md` | `:83` 实测 `glm-5.3` 解析为 `contextWi` | `| A13 | `grep -rn "contextWindow" .workspace/reports/execs/acceptance/acceptance-exec.md` | `:83` 实测` | ②证据 |  |
| 441 | `| A14 | `grep -n "504264" .workspace/acceptance-probe/rootcause-context-overflow.md` | `:413` 实测 `64` | `| A14 | `grep -n "504264" .workspace/probes/acceptance/rootcause-context-overflow.md` | `:413` 实测 `6` | ②证据 |  |
| 445 | `**只读合规声明**：本档**未修改** `~/.dsh/settings.yaml`（全程仅 `read` 与只读 shell：`grep`/`sed`/`diff`/`stat`/`ps`/`py` | `**只读合规声明**：本档**未修改** `~/.dsh/settings.yaml`（全程仅 `read` 与只读 shell：`grep`/`sed`/`diff`/`stat`/`ps`/`py` | ②证据 |  |

## `.workspace/btw-upgrade-audit.md` （6 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 35 | `- `composeChild`（:496-509）：persona（SIDE_CHAT_PERSONA :50-56）+ `applyChildComposition({sandboxMode:'r` | `- `composeChild`（:496-509）：persona（SIDE_CHAT_PERSONA :50-56）+ `applyChildComposition({sandboxMode:'r` | ②证据 |  |
| 86 | `- **运行时实证**：`@deepseek-ai/dsh-tool-fs`（web profile，运行树）为含 read_image 的版本；shared profile 同包不含（版本差异），但` | `- **运行时实证**：`@deepseek-ai/dsh-tool-fs`（web profile，运行树）为含 read_image 的版本；shared profile 同包不含（版本差异），但` | ②证据 |  |
| 185 | `| 与既往报告的差异 | audit-btw-model.md 曾定默认 glm-5.3-flash，**当前代码已改为 deepseek-v4-flash**（settings.yaml `agen` | `| 与既往报告的差异 | .workspace/reports/audits/btw/audit-btw-model.md 曾定默认 glm-5.3-flash，**当前代码已改为 deepseek-` | ②证据 |  |
| 191 | `- **scripts**（`dsh-btw/package.json`）：`build`=tsdown；`typecheck`=tsc ×3（tsconfig / client / tests）；`` | `- **scripts**（`dsh-btw/package.json`）：`build`=tsdown；`typecheck`=tsc ×3（tsconfig / client / tests）；`` | ②证据 |  |
| 193 | `- **部署目标**：`~/.dsh/profiles/node_modules/@local/dsh-btw/`（**@local 命名，真实目录拷贝，非 @deepseek-ai、非符号链接**；` | `- **部署目标**：`~/.dsh/profiles/node_modules/@local/dsh-btw/`（**@local 命名，真实目录拷贝，非 @deepseek-ai、非符号链接**；` | ②证据 |  |
| 255 | `- **(e) 模型路由**：已落地且运行中——默认 `deepseek-v4-flash`、三选项 deepseek-v4-flash/glm-5.3/deepseek-v4-pro（provide` | `- **(e) 模型路由**：已落地且运行中——默认 `deepseek-v4-flash`、三选项 deepseek-v4-flash/glm-5.3/deepseek-v4-pro（provide` | ②证据 |  |

## `.workspace/deploy-slots/slot-b-exec.md` （6 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 档：修订执行复核一体（路由 adam/deepseek-v4-flash），按 `.workspace/slot-mod-audit.md` §7 落地单元逐条实现 + 同档自复核。` | `> 档：修订执行复核一体（路由 adam/deepseek-v4-flash），按 `.workspace/reports/audits/slots/slot-mod-audit.md` §7 落地单` | ②证据 |  |
| 5 | `> 写入边界遵守：仅写 `.workspace/deploy-slots/`、`.workspace/deploy-ssh-gui/`、`.workspace/deploy-lag/`；未改 `~/.` | `> 写入边界遵守：仅写 `.workspace/deploy-slots/`、`.workspace/workstreams/deploy/deploy-ssh-gui/`、`.workspace/d` | ②证据 |  |
| 6 | `> 基线：官方包 `@deepseek-ai/dsh-client-ui-workspace`（全局树 0.1.1-rc.2，`lib/client.js` 2460 行，sha256 `75d8a0` | `> 基线：官方包 `@deepseek-ai/dsh-client-ui-workspace`（全局树 0.1.1-rc.2，`lib/client.js` 2460 行，sha256 `75d8a0` | ②证据 |  |
| 103 | `cd ~/dsh/.workspace/deploy-slots` | `cd ~/dsh/.workspace/workstreams/deploy/deploy-slots` | **①实链** |  |
| 107 | `cd ~/dsh/.workspace/deploy-ssh-gui && bash deploy.sh --apply` | `cd ~/dsh/.workspace/workstreams/deploy/deploy-ssh-gui && bash deploy.sh --apply` | **①实链** |  |
| 109 | `# 4) 回滚（如需）：cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --rollback` | `# 4) 回滚（如需）：cd ~/dsh/.workspace/workstreams/deploy/deploy-slots && bash patch-official-slots.sh --ro` | **①实链** |  |

## `.workspace/distributed-control-exec.md` （6 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- **输入**：`.workspace/ssh-gui-audit.md`、`.workspace/ssh-gui-exec.md`、`.workspace/slot-b-exec.md` + `.` | `- **输入**：`.workspace/ssh-gui-audit.md`、`.workspace/ssh-gui-exec.md`、`.workspace/slot-b-exec.md` + `.` | ②证据 |  |
| 7 | `- **交付目录**：`.workspace/deploy-ssh-gui/`（改源码，未部署）` | `- **交付目录**：`.workspace/workstreams/deploy/deploy-ssh-gui/`（改源码，未部署）` | ②证据 |  |
| 31 | `写入面仅 `.workspace/deploy-ssh-gui/` 与报告（git status 复核，未碰 dsh-workerspace` | `写入面仅 `.workspace/workstreams/deploy/deploy-ssh-gui/` 与报告（git status 复核，未碰 dsh-workerspace` | ②证据 |  |
| 36 | `## §2 改动文件清单（`.workspace/deploy-ssh-gui/`）` | `## §2 改动文件清单（`.workspace/workstreams/deploy/deploy-ssh-gui/`）` | ②证据 |  |
| 153 | `cd /home/CNS2026495165/dsh/.workspace/deploy-ssh-gui` | `cd /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-ssh-gui` | **①实链** |  |
| 157 | `#   cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --apply` | `#   cd ~/dsh/.workspace/workstreams/deploy/deploy-slots && bash patch-official-slots.sh --apply` | **①实链** |  |

## `.workspace/lowrisk-fix-exec.md` （6 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 14 | `文件：`.workspace/deploy-lag/replay-lag-fix.sh`（+47 行）` | `文件：`.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh`（+47 行）` | ②证据 |  |
| 61 | `文件：`execution-2b.md`（注：实际位于工作区根，非 `.workspace/`；已修改真实文件）+20 行` | `文件：`.workspace/reports/execs/subagent/execution-2b.md`（注：实际位于工作区根，非 `.workspace/`；已修改真实文件）+20 行` | ②证据 |  |
| 93 | `| 文档无残留旧引用（操作性） | execution-2b.md 回滚节/路径全部更新；master-runbook 无同类引用；剩余 `orig-20260908` 均属历史审计证据档叙述 | ✅` | `| 文档无残留旧引用（操作性） | .workspace/reports/execs/subagent/execution-2b.md 回滚节/路径全部更新；master-runbook 无同类引用；` | ②证据 |  |
| 118 | `- `.workspace/deploy-lag/replay-lag-fix.sh`（修改，+47）` | `- `.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh`（修改，+47）` | ②证据 |  |
| 119 | `- `execution-2b.md`（修改，+20/-6）` | `- `.workspace/reports/execs/subagent/execution-2b.md`（修改，+20/-6）` | ②证据 |  |
| 122 | `- 未改动：`dsh-btw/package.json`（源码已含 peers）、`.workspace/master-runbook.md`（无同类引用）` | `- 未改动：`dsh-btw/package.json`（源码已含 peers）、`.workspace/reports/runbooks/master-runbook.md`（无同类引用）` | ②证据 |  |

## `.workspace/btw-ui-batch-exec.md` （5 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 依据：用户裁决需求（三 UI 项）+ 只读审计（`.workspace/btw-usage-ui-audit.md` §1 横幅样式点、§2a 图片块/Modal/徽标=不存在、§2b 官方放大机` | `> 依据：用户裁决需求（三 UI 项）+ 只读审计（`.workspace/reports/audits/btw/btw-usage-ui-audit.md` §1 横幅样式点、§2a 图片块/Mod` | ②证据 |  |
| 5 | `> 红线遵守：只改 `/home/CNS2026495165/dsh/dsh-btw/` 与 `.workspace/btw-ui-previews/` 与报告；未改 ~/.dsh 任何文件；未使用 ` | `> 红线遵守：只改 `/home/CNS2026495165/dsh/dsh-btw/` 与 `.workspace/probes/previews/btw-ui/` 与报告；未改 ~/.dsh 任何` | ②证据 |  |
| 87 | `- `.workspace/btw-ui-previews/preview.png`（1240×880，PIL 复刻：绿色运行横幅 + 双缩略图含 1/2 徽标 + 打开的大图 lightbox，遮罩` | `- `.workspace/probes/previews/btw-ui/preview.png`（1240×880，PIL 复刻：绿色运行横幅 + 双缩略图含 1/2 徽标 + 打开的大图 ligh` | ②证据 |  |
| 88 | `- `.workspace/btw-ui-previews/index.html`（自包含可交互 HTML，CSS 逐条复刻 side-chat.module.css 真实值，可直接浏览器打开目检）` | `- `.workspace/probes/previews/btw-ui/index.html`（自包含可交互 HTML，CSS 逐条复刻 side-chat.module.css 真实值，可直接浏览` | ②证据 |  |
| 89 | `- `.workspace/btw-ui-previews/render-preview.py`（PNG 生成脚本，可复跑）` | `- `.workspace/probes/previews/btw-ui/render-preview.py`（PNG 生成脚本，可复跑）` | ②证据 |  |

## `.workspace/deploy-p0/APPLY-P0.md` （5 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 49 | `(cd "$ROOT" && patch --batch -p0 --dry-run < /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subage` | `(cd "$ROOT" && patch --batch -p0 --dry-run < /home/CNS2026495165/dsh/.workspace/workstreams/deploy/d` | ②证据 |  |
| 51 | `(cd "$ROOT" && patch --batch -p0 < /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.materia` | `(cd "$ROOT" && patch --batch -p0 < /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-p0/d` | ②证据 |  |
| 76 | `/home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.lib.index.js` | `/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-p0/dsh-subagent.lib.index.js` | ②证据 |  |
| 78 | `/home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.lib.types.index.d.ts` | `/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-p0/dsh-subagent.lib.types.index.d.ts` | ②证据 |  |
| 99 | `(cd "$ROOT" && patch --batch -p0 -R < /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.mate` | `(cd "$ROOT" && patch --batch -p0 -R < /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-p` | ②证据 |  |

## `.workspace/doc-restructure-exec.md` （5 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- 范本：`.workspace/research-luxweft-doc/zh-cn/README.md`（导航中枢/从这里开始路由表/Tier 分层/两条规则/诚实边界/状态词汇）+ `01-ov` | `- 范本：`.workspace/workstreams/research/research-luxweft-doc/zh-cn/README.md`（导航中枢/从这里开始路由表/Tier 分层/两条` | ②证据 |  |
| 21 | `| 本报告 | `.workspace/doc-restructure-exec.md` | 见下 |` | `| 本报告 | `.workspace/reports/execs/docs/doc-restructure-exec.md` | 见下 |` | ③自身档 | 是 |
| 30 | `1. **补丁归脚本，进程归 dsh-restart**（来源：`.workspace/deploy-lag/README.md` §0 分工表——补丁脚本管代码层、dsh-restart 管进程层，` | `1. **补丁归脚本，进程归 dsh-restart**（来源：`.workspace/workstreams/deploy/deploy-lag/README.md` §0 分工表——补丁脚本管代码` | ②证据 |  |
| 71 | `| 1 | 事实修正 | `port-taste.md` / `port-wallpaper.md` / `port-vision-adam.md` 位于**仓库根**（不在 `.workspace/` | `| 1 | 事实修正 | `port-taste.md` / `port-wallpaper.md` / `.workspace/reports/ports/port-vision-adam.md` ` | ②证据 |  |
| 72 | `| 2 | 观察项 | 根目录仍散落大量历史审计/执行报告（audit-btw.md、execute-*.md、review-*.md 等，未在仓库内容表列出）——它们是旧三阶段时期产物，未纳入新文档` | `| 2 | 观察项 | 根目录仍散落大量历史审计/执行报告（.workspace/reports/audits/btw/audit-btw.md、execute-*.md、review-*.md 等，` | ②证据 |  |

## `.workspace/p0c-restart-helper-exec.md` （5 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `- **任务**：按需求实现 `.workspace/deploy-lag/dsh-restart.sh`（一键优雅重启 + watch 自动重启）、` | `- **任务**：按需求实现 `.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh`（一键优雅重启 + watch 自动重启）、` | ②证据 |  |
| 7 | `- **约束遵守**：只写 `.workspace/deploy-lag/dsh-restart.sh`、`.workspace/deploy-lag/README.md`、` | `- **约束遵守**：只写 `.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh`、`.workspace/workstreams/depl` | ②证据 |  |
| 114 | `- `.workspace/deploy-lag/dsh-restart.sh`（可执行，~260 行，bash）` | `- `.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh`（可执行，~260 行，bash）` | ②证据 |  |
| 115 | `- `.workspace/deploy-lag/README.md`（分工 + 用法 + 会话 resume + 安全 + 环境变量 + 验证）` | `- `.workspace/workstreams/deploy/deploy-lag/README.md`（分工 + 用法 + 会话 resume + 安全 + 环境变量 + 验证）` | ②证据 |  |
| 116 | `- 本报告 `.workspace/p0c-restart-helper-exec.md`` | `- 本报告 `.workspace/reports/execs/p0-hotload/p0c-restart-helper-exec.md`` | ③自身档 | 是 |

## `.workspace/p1-hotswap-gate-exec.md` （5 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 7 | `- 隔离约束：✓ 全部实验只写 `.workspace/p1-hotswap-lab/` 与本文档；未触碰 live 树 / `~/.dsh` / 全局树任何文件；未使用 sandbox_permis` | `- 隔离约束：✓ 全部实验只写 `.workspace/probes/hotswap-lab/` 与本文档；未触碰 live 树 / `~/.dsh` / 全局树任何文件；未使用 sandbox_pe` | ②证据 |  |
| 38 | `### 1.1 隔离项目：`.workspace/p1-hotswap-lab/`` | `### 1.1 隔离项目：`.workspace/probes/hotswap-lab/`` | ②证据 |  |
| 192 | `| 是否只写隔离目录 + 报告 | ✅ 仅 `.workspace/p1-hotswap-lab/` + 本文档；未触 live 树 / `~/.dsh` / 全局树 |` | `| 是否只写隔离目录 + 报告 | ✅ 仅 `.workspace/probes/hotswap-lab/` + 本文档；未触 live 树 / `~/.dsh` / 全局树 |` | ②证据 |  |
| 204 | `cd /home/CNS2026495165/dsh/.workspace/p1-hotswap-lab` | `cd /home/CNS2026495165/dsh/.workspace/probes/hotswap-lab` | **①实链** |  |
| 215 | `- 实验代码：`.workspace/p1-hotswap-lab/`（host/loadHost.js、tests/t1..t7、fixtures.js、run-all.mjs）` | `- 实验代码：`.workspace/probes/hotswap-lab/`（host/loadHost.js、tests/t1..t7、fixtures.js、run-all.mjs）` | ②证据 |  |

## `.workspace/ssh-gui-exec.md` （5 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- **输入**：`.workspace/ssh-gui-audit.md`、`.workspace/audit-d-plugins.md`、`.workspace/workspace-plugins` | `- **输入**：`.workspace/ssh-gui-audit.md`、`.workspace/audit-d-plugins.md`、`.workspace/reports/research/` | ②证据 |  |
| 7 | `- **交付目录**：`.workspace/deploy-ssh-gui/`` | `- **交付目录**：`.workspace/workstreams/deploy/deploy-ssh-gui/`` | ②证据 |  |
| 49 | `## §1 交付物清单（`.workspace/deploy-ssh-gui/`）` | `## §1 交付物清单（`.workspace/workstreams/deploy/deploy-ssh-gui/`）` | ②证据 |  |
| 63 | `合计 2726 行；**本档写入仅限 `.workspace/deploy-ssh-gui/` 与本报告**（`git status` 中其余改动文件 mtime 均早于本档开工时间 11:30，属既` | `合计 2726 行；**本档写入仅限 `.workspace/workstreams/deploy/deploy-ssh-gui/` 与本报告**（`git status` 中其余改动文件 mtime` | ②证据 |  |
| 188 | `cd /home/CNS2026495165/dsh/.workspace/deploy-ssh-gui` | `cd /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-ssh-gui` | **①实链** |  |

## `.workspace/vision-settings-capability-exec.md` （5 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `范围：仅 `.workspace/dsh-vision-adam-src/`、`dsh-btw/`、部署产物目录 `.workspace/deploy-vision-settings/`、本报告。`~` | `范围：仅 `.workspace/dsh-vision-adam-src/`、`dsh-btw/`、部署产物目录 `.workspace/workstreams/deploy/deploy-visio` | ②证据 |  |
| 41 | `- `.workspace/dsh-vision-adam-src/lib/client.js`（手写 `__ModuleLoader__.load` bundle：`id: "@deepseek-a` | `- `.workspace/workstreams/sources/dsh-vision-adam-src/lib/client.js`（手写 `__ModuleLoader__.load` bund` | ②证据 |  |
| 46 | `- 部署包：`.workspace/deploy-vision-settings/`（package.json + lib/index.js + lib/client.js + README.md，含` | `- 部署包：`.workspace/workstreams/deploy/deploy-vision-settings/`（package.json + lib/index.js + lib/clie` | ②证据 |  |
| 65 | `**部署件**：`.workspace/deploy-vision-settings/btw/`（构建后 `lib/` + 改动源码 + 测试 + README 复制命令）。` | `**部署件**：`.workspace/workstreams/deploy/deploy-vision-settings/btw/`（构建后 `lib/` + 改动源码 + 测试 + README ` | ②证据 |  |
| 80 | `**部署要点（主代理执行）**：`.workspace/deploy-vision-settings/README.md`（vision-adam：备份 + 覆盖 package.json/lib/i` | `**部署要点（主代理执行）**：`.workspace/workstreams/deploy/deploy-vision-settings/README.md`（vision-adam：备份 + 覆盖` | ②证据 |  |

## `.workspace/acceptance-probe/brief-s21.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 32 | `| 9 | 线上 boot 图无该宿主行，且无 `list_subagent_models` | `curl :3080/` → `"id":"@local/dsh-subagent-model"`、` | `| 9 | 线上 boot 图无该宿主行，且无 `list_subagent_models` | `curl :3080/` → `"id":"@local/dsh-subagent-model"`、` | ②证据 |  |
| 143 | `- 历史结论同向：`.workspace/plugin-restore/README.md:14` 记「0.1.1 全局树无此 id……该 id 是 0.1.5 的 `lib/model-select` | `- 历史结论同向：`.workspace/plugin-restore/README.md:14` 记「0.1.1 全局树无此 id……该 id 是 0.1.5 的 `lib/model-select` | ②证据 |  |
| 326 | `| 兜底 | 目录级备份还原（本部署既有实践：`.workspace/backup-subagent-model-20260917-165928/` 保留了 `dsh-tool-subagent.in` | `| 兜底 | 目录级备份还原（本部署既有实践：`.workspace/backups/subagent-model/20260917-165928/` 保留了 `dsh-tool-subagent.i` | ②证据 |  |
| 395 | `- 历史定性同向：`.workspace/plugin-restore/README.md:14`、`.workspace/lag-audit-diff.md:11`` | `- 历史定性同向：`.workspace/plugin-restore/README.md:14`、`.workspace/reports/audits/lagfix/lag-audit-diff.m` | ②证据 |  |

## `.workspace/btw-live-stream-audit.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 21 | `- 注：`.workspace/lag-audit-mechanism.md` L98 曾写「主会话/btw（depth=0）仍流式」——与当前代码不符（btw 子代理 depth=1），该文档此句作` | `- 注：`.workspace/reports/audits/lagfix/lag-audit-mechanism.md` L98 曾写「主会话/btw（depth=0）仍流式」——与当前代码不符（b` | ②证据 |  |
| 156 | `| 补丁管理 | `.workspace/deploy-lag/replay-lag-fix.sh` | 扩展：agent-loop 补丁 #2 的备份/应用/锚点/回滚（脚本锚点现为 `isSuba` | `| 补丁管理 | `.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh` | 扩展：agent-loop 补丁 #2 的备份/应用/锚` | ②证据 |  |
| 163 | `- **②b 补丁共存**：dsh-agent-loop 已被 ②b 打过（2 hunk，`.workspace/lag-fix-exec.md` U-1），本补丁为同文件第 2 个补丁；`repla` | `- **②b 补丁共存**：dsh-agent-loop 已被 ②b 打过（2 hunk，`.workspace/reports/execs/lagfix/lag-fix-exec.md` U-1），` | ②证据 |  |
| 231 | `- 部署：btw lib `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`（工作区构建）；补丁 replay 脚本 `.workspace/depl` | `- 部署：btw lib `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`（工作区构建）；补丁 replay 脚本 `.workspace/depl` | ②证据 |  |

## `.workspace/btw-model-v41-exec.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 39 | `部署：先备份 `~/.dsh/profiles/node_modules/@local/dsh-btw/` 整目录 → `.workspace/backup-btw-20260917-170146/`` | `部署：先备份 `~/.dsh/profiles/node_modules/@local/dsh-btw/` 整目录 → `.workspace/backups/btw/20260917-170146/` | ②证据 |  |
| 72 | `1. `cp -r ~/.dsh/profiles/node_modules/@local/dsh-btw/. .workspace/backup-btw-20260917-170146/`（备份）` | `1. `cp -r ~/.dsh/profiles/node_modules/@local/dsh-btw/. .workspace/backups/btw/20260917-170146/`（备份）` | ②证据 |  |
| 78 | `- `cp -r .workspace/backup-btw-20260917-170146/. ~/.dsh/profiles/node_modules/@local/dsh-btw/`（整目录还原` | `- `cp -r .workspace/backups/btw/20260917-170146/. ~/.dsh/profiles/node_modules/@local/dsh-btw/`（整目录还` | ②证据 |  |
| 146 | `**回滚**：`cp -r .workspace/backup-btw-20260917-172915/. ~/.dsh/profiles/node_modules/@local/dsh-btw/`（` | `**回滚**：`cp -r .workspace/backups/btw/20260917-172915/. ~/.dsh/profiles/node_modules/@local/dsh-btw/`` | ②证据 |  |

## `.workspace/btw-usage-ui-audit.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `> 部署位说明：`~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` 与工作区 `dsh-btw/lib/client.js` 逐字节` | `> 部署位说明：`~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` 与工作区 `dsh-btw/lib/client.js` 逐字节` | ②证据 |  |
| 59 | `- **几何层** `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/charts.js`（= `.workspace/dsh-usage-src/` | `- **几何层** `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/charts.js`（= `.workspace/workstreams/so` | ②证据 |  |
| 77 | `- **部署流**（usage 插件既定流程，见 `.workspace/usage-heatmap-exec.md`）：改 `.workspace/dsh-usage-src/lib/{charts` | `- **部署流**（usage 插件既定流程，见 `.workspace/reports/execs/usage/usage-heatmap-exec.md`）：改 `.workspace/dsh-u` | ②证据 |  |
| 120 | `| 3 图表 tooltip | `.workspace/dsh-usage-src/lib/client.js`（:219、:225-226 后）+ 可选 `charts.js`（:187-196/` | `| 3 图表 tooltip | `.workspace/workstreams/sources/dsh-usage-src/lib/client.js`（:219、:225-226 后）+ 可选 `` | ②证据 |  |

## `.workspace/combined-restore-runbook.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 详细参考：`.workspace/lag-fix-runbook.md`（卡顿修复）、`.workspace/plugin-restore/README.md`（插件恢复）。` | `> 详细参考：`.workspace/reports/runbooks/lag-fix-runbook.md`（卡顿修复）、`.workspace/plugin-restore/README.md`（` | ②证据 |  |
| 10 | `| 卡顿修复 | ②b 子代理非流式（isSubagent）、tok/s 补丁、x-opencode-session 补丁、apiproxy mux 订阅过滤、FrameQueue 有界（4096，丢` | `| 卡顿修复 | ②b 子代理非流式（isSubagent）、tok/s 补丁、x-opencode-session 补丁、apiproxy mux 订阅过滤、FrameQueue 有界（4096，丢` | ②证据 |  |
| 11 | `| 上下文上限 | adam `deepseek-v4-flash` → `contextWindow: 1000000` + `maxTokens: 990000`（adam 网关实测接受 9900` | `| 上下文上限 | adam `deepseek-v4-flash` → `contextWindow: 1000000` + `maxTokens: 990000`（adam 网关实测接受 9900` | ②证据 |  |
| 55 | `cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback` | `cd /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag && bash replay-lag-fix.sh --roll` | **①实链** |  |

## `.workspace/deploy-vision-settings/README.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 19 | `cp .workspace/deploy-vision-settings/lib/index.js  "$DST/lib/index.js"` | `cp .workspace/workstreams/deploy/deploy-vision-settings/lib/index.js  "$DST/lib/index.js"` | ②证据 |  |
| 20 | `cp .workspace/deploy-vision-settings/lib/client.js "$DST/lib/client.js"` | `cp .workspace/workstreams/deploy/deploy-vision-settings/lib/client.js "$DST/lib/client.js"` | ②证据 |  |
| 21 | `cp .workspace/deploy-vision-settings/package.json "$DST/package.json"` | `cp .workspace/workstreams/deploy/deploy-vision-settings/package.json "$DST/package.json"` | ②证据 |  |
| 33 | `cd .workspace/dsh-vision-adam-src` | `cd .workspace/workstreams/sources/dsh-vision-adam-src` | **①实链** |  |

## `.workspace/deploy/patches/APPLY.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 审计单元 U-G-2（`.workspace/btw-upgrade-impl-audit.md` §3.1 / U-G-2）。` | `> 审计单元 U-G-2（`.workspace/reports/audits/btw/btw-upgrade-impl-audit.md` §3.1 / U-G-2）。` | ②证据 |  |
| 29 | `patch -p1 < ~/dsh/.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch` | `patch -p1 < ~/dsh/.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.sessions-prompt-tra` | ②证据 |  |
| 36 | `cp ~/dsh/.workspace/deploy/patches/dsh-host-apiproxy.lib.index.js \` | `cp ~/dsh/.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.lib.index.js \` | ②证据 |  |
| 47 | `diff ~/dsh/.workspace/deploy/patches/dsh-host-apiproxy.lib.index.js \` | `diff ~/dsh/.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.lib.index.js \` | ②证据 |  |

## `.workspace/mmt-probe/RESULTS.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `探针：`.workspace/mmt-probe/{probe-adam-multimodal.sh,probe-image.sh,probe-transcribe.sh}`` | `探针：`.workspace/probes/mmt/{probe-adam-multimodal.sh,probe-image.sh,probe-transcribe.sh}`` | ②证据 |  |
| 25 | `测试图 `.workspace/btw-ui-previews/preview.png`（真实 UI 预览，1240×880）。对照真值取**源码权威串**（`.workspace/btw-ui-pr` | `测试图 `.workspace/probes/previews/btw-ui/preview.png`（真实 UI 预览，1240×880）。对照真值取**源码权威串**（`.workspace/pr` | ②证据 |  |
| 60 | `bash /home/CNS2026495165/dsh/.workspace/mmt-probe/probe-image.sh` | `bash /home/CNS2026495165/dsh/.workspace/probes/mmt/probe-image.sh` | **①实链** |  |
| 62 | `bash /home/CNS2026495165/dsh/.workspace/mmt-probe/probe-transcribe.sh <图片路径> deepseek-v4.1-flash` | `bash /home/CNS2026495165/dsh/.workspace/probes/mmt/probe-transcribe.sh <图片路径> deepseek-v4.1-flash` | **①实链** |  |

## `.workspace/plugin-restore/README.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 约束落实：全程只读 `~/.dsh`、只写 `.workspace/plugin-restore/`；未使用 sandbox_permissions；` | `> 约束落实：全程只读 `~/.dsh`、只写 `.workspace/workstreams/plugin-restore/`；未使用 sandbox_permissions；` | ②证据 |  |
| 38 | `bash /home/CNS2026495165/dsh/.workspace/plugin-restore/apply-restore.sh --dry-run` | `bash /home/CNS2026495165/dsh/.workspace/workstreams/plugin-restore/apply-restore.sh --dry-run` | **①实链** |  |
| 40 | `bash /home/CNS2026495165/dsh/.workspace/plugin-restore/apply-restore.sh --apply` | `bash /home/CNS2026495165/dsh/.workspace/workstreams/plugin-restore/apply-restore.sh --apply` | **①实链** |  |
| 42 | `bash /home/CNS2026495165/dsh/.workspace/plugin-restore/apply-restore.sh --verify` | `bash /home/CNS2026495165/dsh/.workspace/workstreams/plugin-restore/apply-restore.sh --verify` | **①实链** |  |

## `.workspace/pptmaster-skill-research.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `> 本报告产出物：仅本文件；调研中间产物在 `.workspace/tmp-ppt-research/`（克隆与下载缓存，可清理）。` | `> 本报告产出物：仅本文件；调研中间产物在 `.workspace/workstreams/research/tmp-ppt-research/`（克隆与下载缓存，可清理）。` | ②证据 |  |
| 216 | `- GitHub raw/codeload 与 `git clone --depth 1`（pn1024 6.1.0、zbsph v1.0.0、opencentra）实测克隆至 `.workspace` | `- GitHub raw/codeload 与 `git clone --depth 1`（pn1024 6.1.0、zbsph v1.0.0、opencentra）实测克隆至 `.workspace` | ②证据 |  |
| 227 | `- 上一轮报告 `/home/CNS2026495165/dsh/.workspace/pptmaster-research.md`（插件生态全景，本轮在其上合并）` | `- 上一轮报告 `/home/CNS2026495165/dsh/.workspace/reports/research/pptmaster/pptmaster-research.md`（插件生态全景` | ②证据 |  |
| 228 | `- 本轮调研缓存 `.workspace/tmp-ppt-research/`（pn1024-dsh-ppt-master 全量克隆 116MB/12 937 文件、zbsph-dsh-ppt-stu` | `- 本轮调研缓存 `.workspace/workstreams/research/tmp-ppt-research/`（pn1024-dsh-ppt-master 全量克隆 116MB/12 937` | ②证据 |  |

## `.workspace/usage-tooltip-exec.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `工作区源码库（source of truth）：`/home/CNS2026495165/dsh/.workspace/dsh-usage-src/`。` | `工作区源码库（source of truth）：`/home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-usage-src/`。` | ②证据 |  |
| 6 | `预览产物：`/home/CNS2026495165/dsh/.workspace/usage-tooltip-previews/`（亮/暗 × 三图无悬停 + hover 示意，共 8 张）。` | `预览产物：`/home/CNS2026495165/dsh/.workspace/probes/previews/usage-tooltip/`（亮/暗 × 三图无悬停 + hover 示意，共 8 ` | ②证据 |  |
| 85 | `逐需求核对无遗漏（§2），验证全绿（§3：语法 + 182/182 行为等价 + 64/64 命中/防溢出断言 + 8 张真实数据预览目检），未发现需返工项。约束遵守：仅改 `.workspace/d` | `逐需求核对无遗漏（§2），验证全绿（§3：语法 + 182/182 行为等价 + 64/64 命中/防溢出断言 + 8 张真实数据预览目检），未发现需返工项。约束遵守：仅改 `.workspace/w` | ②证据 |  |
| 106 | `6. **维护资产重出预览**：`node dev/dump-trend.mjs && node dev/dump-grid.mjs && python3 dev/render-tooltip-pre` | `6. **维护资产重出预览**：`node dev/dump-trend.mjs && node dev/dump-grid.mjs && python3 dev/render-tooltip-pre` | ②证据 |  |

## `.workspace/acceptance-probe/rootcause-context-overflow.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 269 | `（出处：`/home/CNS2026495165/dsh/.workspace/incident-piai-model-selection.md` 第 51-54 行，见 §5 原文引用。）` | `（出处：`/home/CNS2026495165/dsh/.workspace/reports/incidents/incident-piai-model-selection.md` 第 51-54 ` | ②证据 |  |
| 548 | `出处文件：`/home/CNS2026495165/dsh/.workspace/incident-piai-model-selection.md`（第 47-54 行，` | `出处文件：`/home/CNS2026495165/dsh/.workspace/reports/incidents/incident-piai-model-selection.md`（第 47-54` | ②证据 |  |
| 686 | `| 溢出检测用的窗口仍是 262144 是上一轮 agent 已写下但只修了 v4-flash 的漏修 | **[实测确证]**（历史 session 事件 + `.workspace/inciden` | `| 溢出检测用的窗口仍是 262144 是上一轮 agent 已写下但只修了 v4-flash 的漏修 | **[实测确证]**（历史 session 事件 + `.workspace/reports` | ②证据 |  |

## `.workspace/audit-c-usage-vision.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 14 | `| `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/charts.js` vs `.workspace/dsh-usage-src/lib/cha` | `| `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/charts.js` vs `.workspace/workstreams/sources/d` | ②证据 |  |
| 15 | `| `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` vs `.workspace/dsh-usage-src/lib/cli` | `| `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` vs `.workspace/workstreams/sources/d` | ②证据 |  |
| 50 | `- **部署一致性**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` 与 `.workspace/d` | `- **部署一致性**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` 与 `.workspace/w` | ②证据 |  |

## `.workspace/deploy-lag/README.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 规格来源：`.workspace/hotreload-e-design.md` §2 方案 D（裁决采纳）+ 附录候选单元 D1；` | `> 规格来源：`.workspace/reports/research/hotreload/hotreload-e-design.md` §2 方案 D（裁决采纳）+ 附录候选单元 D1；` | ②证据 |  |
| 5 | `> 本 README 与脚本同目录（`dsh-restart.sh`），报告见 `.workspace/p0c-restart-helper-exec.md`。` | `> 本 README 与脚本同目录（`dsh-restart.sh`），报告见 `.workspace/reports/execs/p0-hotload/p0c-restart-helper-exec` | ②证据 |  |
| 129 | `> 实测档：`.workspace/p0a-patch-hmr-exec.md`（证据时间线、观测手段、自复核）。` | `> 实测档：`.workspace/reports/execs/p0-hotload/p0a-patch-hmr-exec.md`（证据时间线、观测手段、自复核）。` | ②证据 |  |

## `.workspace/deploy-lag/replay-lag-fix.sh` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 39 | `echo "（复用 execution-2b.md L33-44 模板）。重装全局树后重跑本脚本即可恢复全部补丁。"` | `echo "（复用 .workspace/reports/execs/subagent/execution-2b.md L33-44 模板）。重装全局树后重跑本脚本即可恢复全部补丁。"` | ②证据 |  |
| 258 | `fail "btw patch dry-run 未命中（live apiproxy 可能已漂移，需重新锚定 .workspace/deploy/patches），中止"` | `fail "btw patch dry-run 未命中（live apiproxy 可能已漂移，需重新锚定 .workspace/workstreams/deploy/deploy/patches），` | ②证据 |  |
| 455 | `say "      btw sessions/prompt-image-transform 补丁已并入本重放（在 u4/u5/u5b 之后应用，见 .workspace/deploy/patches` | `say "      btw sessions/prompt-image-transform 补丁已并入本重放（在 u4/u5/u5b 之后应用，见 .workspace/workstreams/de` | ②证据 |  |

## `.workspace/deploy-ssh-gui/RUNBOOK.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 执行档：`.workspace/deploy-ssh-gui/`。约束遵守：**绝不执行 `npm/pnpm install` | `> 执行档：`.workspace/workstreams/deploy/deploy-ssh-gui/`。约束遵守：**绝不执行 `npm/pnpm install` | ②证据 |  |
| 20 | `cd .workspace/deploy-ssh-gui` | `cd .workspace/workstreams/deploy/deploy-ssh-gui` | **①实链** |  |
| 76 | `- 前置：`cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --apply`（官方` | `- 前置：`cd ~/dsh/.workspace/workstreams/deploy/deploy-slots && bash patch-official-slots.sh --apply`（官` | **①实链** |  |

## `.workspace/deploy-vision-prompt/APPLY.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 10 | `| `index.js` | 改后完整副本（= `.workspace/dsh-vision-adam-src/lib/index.js`，sha256 `54ac2548ff3215b0837185` | `| `index.js` | 改后完整副本（= `.workspace/workstreams/sources/dsh-vision-adam-src/lib/index.js`，sha256 `54` | ②证据 |  |
| 31 | `node --check .workspace/deploy-vision-prompt/index.js` | `node --check .workspace/workstreams/deploy/deploy-vision-prompt/index.js` | ②证据 |  |
| 34 | `cp .workspace/deploy-vision-prompt/index.js \` | `cp .workspace/workstreams/deploy/deploy-vision-prompt/index.js \` | ②证据 |  |

## `.workspace/deploy-vision-settings/btw/README.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 20 | `cp -r .workspace/deploy-vision-settings/btw/lib/* "$DST/lib/"` | `cp -r .workspace/workstreams/deploy/deploy-vision-settings/btw/lib/* "$DST/lib/"` | ②证据 |  |
| 22 | `cp -r .workspace/deploy-vision-settings/btw/src/* "$DST/src/"` | `cp -r .workspace/workstreams/deploy/deploy-vision-settings/btw/src/* "$DST/src/"` | ②证据 |  |
| 23 | `cp -r .workspace/deploy-vision-settings/btw/tests/* "$DST/tests/" 2>/dev/null || true` | `cp -r .workspace/workstreams/deploy/deploy-vision-settings/btw/tests/* "$DST/tests/" 2>/dev/null || ` | ②证据 |  |

## `.workspace/dsh-workerspace-research.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 42 | ``/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/repos/` 下：`dsh-ssh`（org）、`dsh-remote-ss` | ``/home/CNS2026495165/dsh/.workspace/workstreams/research/research-dsh-workerspace/repos/` 下：`dsh-ssh` | ②证据 |  |
| 285 | `- MCP 生态子报告：`/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/mcp-ecosystem-report.md`` | `- MCP 生态子报告：`/home/CNS2026495165/dsh/.workspace/workstreams/research/research-dsh-workerspace/mcp-ec` | ②证据 |  |
| 286 | `- 克隆仓库目录：`/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/repos/`` | `- 克隆仓库目录：`/home/CNS2026495165/dsh/.workspace/workstreams/research/research-dsh-workerspace/repos/`` | ②证据 |  |

## `.workspace/final-audit-d-distributed.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- 对照：`.workspace/distributed-control-exec.md`（执行档自裁决 pass）+ `.workspace/deploy-ssh-gui/` + 部署位 `~/.d` | `- 对照：`.workspace/reports/execs/distributed/distributed-control-exec.md`（执行档自裁决 pass）+ `.workspace/de` | ②证据 |  |
| 18 | ``cmp -s` 逐字节比对部署位 vs 源码位 `.workspace/deploy-ssh-gui/dsh-ssh-gui/`，**8 个文件全部 IDENTICAL**：` | ``cmp -s` 逐字节比对部署位 vs 源码位 `.workspace/workstreams/deploy/deploy-ssh-gui/dsh-ssh-gui/`，**8 个文件全部 IDENT` | ②证据 |  |
| 56 | `- **槽位 B 匹配**：部署树官方 ui-workspace `lib/client.js` 含 `renderSlot("sidebar.workspaces.remoteHosts", {})` | `- **槽位 B 匹配**：部署树官方 ui-workspace `lib/client.js` 含 `renderSlot("sidebar.workspaces.remoteHosts", {})` | ②证据 |  |

## `.workspace/goal-round-gap-audit.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 9 | `- 借鉴批次：`.workspace/deploy-015/patches/`、`upstream-015-diff.md`、`borrow-015-exec.md`、`borrow-015-grou` | `- 借鉴批次：`.workspace/workstreams/deploy/deploy-015/patches/`、`upstream-015-diff.md`、`borrow-015-exec.m` | ②证据 |  |
| 209 | `- 既有审计：`.workspace/upstream-015-diff/groups/G6-platform.md:63,125,153`（P0-A 误判处）` | `- 既有审计：`.workspace/workstreams/upstream-015-diff/groups/G6-platform.md:63,125,153`（P0-A 误判处）` | ②证据 |  |
| 210 | `- 已应用面：`.workspace/deploy-015/patches/dsh-goal-round-driver.attempt-attribution.patch`（671B，1 行）；`kn` | `- 已应用面：`.workspace/workstreams/deploy/deploy-015/patches/dsh-goal-round-driver.attempt-attribution.p` | ②证据 |  |

## `.workspace/hotreload-e-design.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 178 | `| E12 | 补丁面：32 包 225 .js；农场 @local 6 真实目录与工作区 diff 空；官方包全符号链接 | `.workspace/final-audit-a-patches.md` | `| E12 | 补丁面：32 包 225 .js；农场 @local 6 真实目录与工作区 diff 空；官方包全符号链接 | `.workspace/reports/audits/final/fin` | ②证据 |  |
| 179 | `| E13 | RUNBOOK 明文"重启（bundle/insert 生效）…HMR 不覆盖 host 装配变更，必须重启" | `.workspace/deploy-ssh-gui/RUNBOOK` | `| E13 | RUNBOOK 明文"重启（bundle/insert 生效）…HMR 不覆盖 host 装配变更，必须重启" | `.workspace/workstreams/deploy/dep` | ②证据 |  |
| 180 | `| E14 | client-connection 重连/心跳（被补丁加固的官方恢复面） | `…/dsh-client-connection/lib/client.js` L39-83；`.work` | `| E14 | client-connection 重连/心跳（被补丁加固的官方恢复面） | `…/dsh-client-connection/lib/client.js` L39-83；`.work` | ②证据 |  |

## `.workspace/lag-audit-diff.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 证据基线：npm 原厂 0.1.1-rc.2 tarball（自 registry.npmmirror.com 抓取，22 个包 sha512 全部对照 `~/.dsh/profiles/web/` | `> 证据基线：npm 原厂 0.1.1-rc.2 tarball（自 registry.npmmirror.com 抓取，22 个包 sha512 全部对照 `~/.dsh/profiles/web/` | ②证据 |  |
| 16 | `- 运行进程：沙箱无法观测宿主进程（bwrap unshare-pid）；按系统提示（harness checkout = 全局安装路径）与 9/8 execute-btw.md 记录（web → 共` | `- 运行进程：沙箱无法观测宿主进程（bwrap unshare-pid）；按系统提示（harness checkout = 全局安装路径）与 9/8 execute-btw.md 记录（web → 共` | ②证据 |  |
| 49 | `3. **未应用的 btw 补丁**：`.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch`（U-G` | `3. **未应用的 btw 补丁**：`.workspace/workstreams/deploy/deploy/patches/dsh-host-apiproxy.sessions-prompt-t` | ②证据 |  |

## `.workspace/lag-fix-runbook.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 依据：`.workspace/lag-audit-mechanism.md`（机制审计）、`.workspace/lag-audit-diff.md`（差异审计）、`.workspace/lag-` | `> 依据：`.workspace/reports/audits/lagfix/lag-audit-mechanism.md`（机制审计）、`.workspace/lag-audit-diff.md`（` | ②证据 |  |
| 10 | `cd /home/CNS2026495165/dsh/.workspace/deploy-lag` | `cd /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag` | **①实链** |  |
| 37 | `4. 若异常：`cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback && npx` | `4. 若异常：`cd /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag && bash replay-lag-fix.s` | **①实链** |  |

## `.workspace/p0b-settings-switch-exec.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `约束遵守：只改 `.workspace/dsh-usage-src/` 与 `dsh-btw/` 源码及报告；`~/.dsh` 部署位未触碰` | `约束遵守：只改 `.workspace/workstreams/sources/dsh-usage-src/` 与 `dsh-btw/` 源码及报告；`~/.dsh` 部署位未触碰` | ②证据 |  |
| 40 | `### dsh-usage（`.workspace/dsh-usage-src/`，6 个文件）` | `### dsh-usage（`.workspace/workstreams/sources/dsh-usage-src/`，6 个文件）` | ②证据 |  |
| 79 | `### dsh-usage（`cd .workspace/dsh-usage-src`）` | `### dsh-usage（`cd .workspace/workstreams/sources/dsh-usage-src`）` | **①实链** |  |

## `.workspace/plugin-restore/plugin-restore-exec-review.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `> 产出：`.workspace/plugin-restore/` 恢复包 + 本报告。日期：2026-09-12。` | `> 产出：`.workspace/workstreams/plugin-restore/` 恢复包 + 本报告。日期：2026-09-12。` | ②证据 |  |
| 28 | `- **证据**：包在场且可解析——`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/`（真实目录，lib 12 文件，v0.1.0）；node` | `- **证据**：包在场且可解析——`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/`（真实目录，lib 12 文件，v0.1.0）；node` | ②证据 |  |
| 62 | `## 2. 产物清单（`.workspace/plugin-restore/`）` | `## 2. 产物清单（`.workspace/workstreams/plugin-restore/`）` | ②证据 |  |

## `.workspace/upstream-borrow-validation.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 8 | `- 素净 0.1.1 参照：`.workspace/baseline-011/x/`（0.1.1-rc.2 tgz 解包，用于界定既有补丁面）` | `- 素净 0.1.1 参照：`.workspace/workstreams/baseline-011/x/`（0.1.1-rc.2 tgz 解包，用于界定既有补丁面）` | ②证据 |  |
| 14 | `- 重放脚本：`.workspace/deploy-lag/replay-lag-fix.sh`（sha256 锚点 + dry-run + rollback）` | `- 重放脚本：`.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh`（sha256 锚点 + dry-run + rollback）` | ②证据 |  |
| 132 | `- 既有补丁面：`.workspace/baseline-011/x/` vs 全局树 diff（agent-loop ②b、host-apiproxy mux/FrameQueue/图片变换、sub` | `- 既有补丁面：`.workspace/workstreams/baseline-011/x/` vs 全局树 diff（agent-loop ②b、host-apiproxy mux/FrameQu` | ②证据 |  |

## `.workspace/usage-chart-restart-acceptance.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 55 | `cd /home/CNS2026495165/dsh/.workspace/deploy-lag` | `cd /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag` | **①实链** |  |
| 113 | `| usage 客户端（配色/平滑/标签/补零） | `git -C /home/CNS2026495165/dsh checkout 3029012d -- .workspace/dsh-usage` | `| usage 客户端（配色/平滑/标签/补零） | `git -C /home/CNS2026495165/dsh checkout 3029012d -- .workspace/workstrea` | ②证据 |  |
| 116 | `| 全部 | 见上一批次的 `.workspace/RESTART-ACCEPTANCE.md` §3（已修正过的回滚表） |` | `| 全部 | 见上一批次的 `.workspace/reports/execs/acceptance/RESTART-ACCEPTANCE.md` §3（已修正过的回滚表） |` | ②证据 |  |

## `.workspace/btw-p0-exec.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 24 | `### 1.2 官方 dsh-subagent 补丁（交付于 `.workspace/deploy-p0/`，未改 live 安装）` | `### 1.2 官方 dsh-subagent 补丁（交付于 `.workspace/workstreams/deploy/deploy-p0/`，未改 live 安装）` | ②证据 |  |
| 79 | `1. **官方补丁**：`cd ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai && patch -` | `1. **官方补丁**：`cd ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai && patch -` | ②证据 |  |

## `.workspace/btw-v2-runbook.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 依据：`.workspace/btw-upgrade-impl-audit.md`（交付单元 U-A..U-N）、`.workspace/btw-upgrade-impl-exec.md`（执行+` | `> 依据：`.workspace/reports/audits/btw/btw-upgrade-impl-audit.md`（交付单元 U-A..U-N）、`.workspace/btw-upgrad` | ②证据 |  |
| 42 | `## 步骤 3b：面板呈现对齐验收（2026-09-12 新功能，实现自裁决 PASS：`.workspace/btw-ui-exec.md`）` | `## 步骤 3b：面板呈现对齐验收（2026-09-12 新功能，实现自裁决 PASS：`.workspace/reports/execs/btw/btw-ui-exec.md`）` | ②证据 |  |

## `.workspace/deploy-lag/patch-official-015.sh` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `# 规格：.workspace/upstream-015-diff.md §3（值得借鉴短清单）；.workspace/borrow-015-exec.md（本档执行报告）` | `# 规格：.workspace/reports/audits/upstream/upstream-015-diff.md §3（值得借鉴短清单）；.workspace/borrow-015-exec.` | ②证据 |  |
| 25 | `#   P015_DIR        补丁与锚点根目录（默认 .workspace/deploy-015，相对脚本位置解析）` | `#   P015_DIR        补丁与锚点根目录（默认 .workspace/workstreams/deploy/deploy-015，相对脚本位置解析）` | ②证据 |  |

## `.workspace/deploy-slots/patch-official-slots.sh` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `# 规格：.workspace/slot-mod-audit.md §7 落地单元 1/2/4（Path B：sidebar sidecar list 槽）` | `# 规格：.workspace/reports/audits/slots/slot-mod-audit.md §7 落地单元 1/2/4（Path B：sidebar sidecar list 槽）` | ②证据 |  |
| 172 | `fail "patch dry-run 未命中（live 官方文件可能已漂移，需重新锚定 .workspace/deploy-slots/patches），中止（未写任何文件）"` | `fail "patch dry-run 未命中（live 官方文件可能已漂移，需重新锚定 .workspace/workstreams/deploy/deploy-slots/patches），中止（` | ②证据 |  |

## `.workspace/deploy-subagent-model/smoke-client.mjs` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 1 | `// Bundle smoke for .workspace/deploy-subagent-model/lib/client.js` | `// Bundle smoke for .workspace/workstreams/deploy/deploy-subagent-model/lib/client.js` | ②证据 |  |
| 6 | `// Adapted from .workspace/dsh-vision-adam-src/smoke-client.mjs.` | `// Adapted from .workspace/workstreams/sources/dsh-vision-adam-src/smoke-client.mjs.` | ②证据 |  |

## `.workspace/deploy-workerspace/base/README.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `> PTY + ProxyJump + SFTP + bwrap 远端沙箱 + 审批门 + TOFU），见 `.workspace/workspace-plugins-deep-research.md` | `> PTY + ProxyJump + SFTP + bwrap 远端沙箱 + 审批门 + TOFU），见 `.workspace/reports/research/workspace-plugins` | ②证据 |  |
| 12 | `| `dsh-workspace-enhancement-0.1.2.tgz` | npm 官方 tarball（`npm pack dsh-workspace-enhancement@0.1.2`，` | `| `dsh-workspace-enhancement-0.1.2.tgz` | npm 官方 tarball（`npm pack dsh-workspace-enhancement@0.1.2`，` | ②证据 |  |

## `.workspace/deploy-workerspace/base/peer-deps-check-patched.mjs` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `* 判定口径（与 .workspace/research/local-facts.md §C 一致）：` | `* 判定口径（与 .workspace/workstreams/research/research/local-facts.md §C 一致）：` | ②证据 |  |
| 23 | `const BASE_DIR = "/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base";` | `const BASE_DIR = "/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-workerspace/base";` | ②证据 |  |

## `.workspace/deploy-workerspace/self-review.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 26 | `| 17 | 自复核 + 报告 | 本文 + `.workspace/workerspace-exec.md` | — | ✅ 通过 |` | `| 17 | 自复核 + 报告 | 本文 + `.workspace/reports/execs/workerspace/workerspace-exec.md` | — | ✅ 通过 |` | ②证据 |  |
| 47 | `cd .workspace/deploy-workerspace` | `cd .workspace/workstreams/deploy/deploy-workerspace` | **①实链** |  |

## `.workspace/deploy/vision-adam/CHANGES.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 基线 = 部署副本全文（248 行，逐函数对照改造），依据 = `.workspace/btw-upgrade-impl-audit.md` §2.2 / U-H 与方案契约 v2 裁决 R1-4` | `> 基线 = 部署副本全文（248 行，逐函数对照改造），依据 = `.workspace/reports/audits/btw/btw-upgrade-impl-audit.md` §2.2 / U` | ②证据 |  |
| 25 | `- **现 settings.yaml 值** `{model: glm-5.3-flash, maxTokens: 100000}` 若不做任何更新：model 显式覆盖为 glm-5.3-flas` | `- **现 settings.yaml 值** `{model: glm-5.3-flash, maxTokens: 100000}` 若不做任何更新：model 显式覆盖为 glm-5.3-flas` | ②证据 |  |

## `.workspace/dsh-usage-src/dev/render-tooltip-preview.py` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 7 | `# Outputs (light + dark) into .workspace/usage-tooltip-previews/:` | `# Outputs (light + dark) into .workspace/probes/previews/usage-tooltip/:` | ②证据 |  |
| 28 | `OUT = "/home/CNS2026495165/dsh/.workspace/usage-tooltip-previews"` | `OUT = "/home/CNS2026495165/dsh/.workspace/probes/previews/usage-tooltip"` | ②证据 |  |

## `.workspace/dsh-vision-adam-src/smoke-test.mjs` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 8 | `const NEW_MODULE_URL = 'file:///home/CNS2026495165/dsh/.workspace/dsh-vision-adam-src/lib/index.js'` | `const NEW_MODULE_URL = 'file:///home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-vision-ada` | ②证据 |  |
| 10 | `const PNG_PATH = '/home/CNS2026495165/dsh/.workspace/v4f-test.png'` | `const PNG_PATH = '/home/CNS2026495165/dsh/.workspace/probes/captures/v4f-test.png'` | ②证据 |  |

## `.workspace/hotreload-c-upstream.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 10 | `- 工作区既有借码体系 `.workspace/deploy-015/`、`borrow-015-exec.md`` | `- 工作区既有借码体系 `.workspace/workstreams/deploy/deploy-015/`、`borrow-015-exec.md`` | ②证据 |  |
| 202 | `- 既有借码：`.workspace/deploy-015/`（12 包）、`borrow-015-exec.md`、`deploy-lag/patch-official-015.sh`。` | `- 既有借码：`.workspace/workstreams/deploy/deploy-015/`（12 包）、`borrow-015-exec.md`、`deploy-lag/patch-offi` | ②证据 |  |

## `.workspace/master-runbook.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 77 | `(cd ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai && patch --batch -p0 -` | `(cd ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai && patch --batch -p0 -` | ②证据 |  |
| 80 | `cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback` | `cd /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag && bash replay-lag-fix.sh --roll` | **①实链** |  |

## `.workspace/side-deploy/REVIEW.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- **边界遵守**：全程只读 `~/.dsh`、只写 `.workspace/side-deploy/`；未使用 sandbox_permissions` | `- **边界遵守**：全程只读 `~/.dsh`、只写 `.workspace/workstreams/side-deploy/`；未使用 sandbox_permissions` | ②证据 |  |
| 10 | `## 1. 产物清单（全部在 `.workspace/side-deploy/`）` | `## 1. 产物清单（全部在 `.workspace/workstreams/side-deploy/`）` | ②证据 |  |

## `.workspace/slot-mod-audit.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 109 | `- 官方包补丁直接改 `.npm-global` DSH 全局安装树（profile 软链共用同一文件），备份归档在 `~/dsh-upgrade-backup/patched-official-fi` | `- 官方包补丁直接改 `.npm-global` DSH 全局安装树（profile 软链共用同一文件），备份归档在 `~/dsh-upgrade-backup/patched-official-fi` | ②证据 |  |
| 114 | `2. 归档条目加入 `patched-official-files.tgz` 清单与 `switch-web2-runbook.md` 的 replay 表（升级后重打）。` | `2. 归档条目加入 `patched-official-files.tgz` 清单与 `docs/runbooks/switch-web2-runbook.md` 的 replay 表（升级后重打）。` | ②证据 |  |

## `.workspace/upstream-015-diff/groups/G2-subagent.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- BASE = /home/CNS2026495165/dsh/.workspace/baseline-011/x/<pkg>（纯净 0.1.1）` | `- BASE = /home/CNS2026495165/dsh/.workspace/workstreams/baseline-011/x/<pkg>（纯净 0.1.1）` | ②证据 |  |
| 7 | `- DIFF = /home/CNS2026495165/dsh/.workspace/upstream-015-diff/pkgs/<pkg>.{combined,libjs,upstream,up` | `- DIFF = /home/CNS2026495165/dsh/.workspace/workstreams/upstream-015-diff/pkgs/<pkg>.{combined,libjs` | ②证据 |  |

## `.workspace/usage-heatmap-exec.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `工作区源码库（source of truth）：`/home/CNS2026495165/dsh/.workspace/dsh-usage-src/`（`cp -r` 自部署位，diff 验证逐字节一` | `工作区源码库（source of truth）：`/home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-usage-src/`（`cp ` | ②证据 |  |
| 62 | `- 产物：`/home/CNS2026495165/dsh/.workspace/dsh-usage-src/preview-light.png`、`preview-dark.png`（主代理目检用）` | `- 产物：`/home/CNS2026495165/dsh/.workspace/workstreams/sources/dsh-usage-src/preview-light.png`、`previ` | ②证据 |  |

## `.workspace/workerspace-exec.md` （2 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `- 目标：按用户裁决落地「底座 dsh-workspace-enhancement@0.1.2（rc.2 原生，<50 行适配）+ 自研薄插件 @local/dsh-workerspace（SoC 本` | `- 目标：按用户裁决落地「底座 dsh-workspace-enhancement@0.1.2（rc.2 原生，<50 行适配）+ 自研薄插件 @local/dsh-workerspace（SoC 本` | ②证据 |  |
| 16 | `## 2. 交付物清单（全部落 `.workspace/deploy-workerspace/`）` | `## 2. 交付物清单（全部落 `.workspace/workstreams/deploy/deploy-workerspace/`）` | ②证据 |  |

## `.workspace/RESTART-ACCEPTANCE.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 151 | `| btw 模型 | `cp -r .workspace/backup-btw-20260917-172915/* ~/.dsh/profiles/node_modules/@local/dsh-bt` | `| btw 模型 | `cp -r .workspace/backups/btw/20260917-172915/* ~/.dsh/profiles/node_modules/@local/dsh-b` | ②证据 |  |

## `.workspace/acceptance-probe/fact-baseurl-slash.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 154 | `- `/home/CNS2026495165/dsh/.workspace/NEXT_SESSION_PROMPT.txt:104`：「**踩坑**：`baseURL` 带尾斜杠会拼出 `//chat` | `- `/home/CNS2026495165/dsh/.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt:104`：「**踩坑**：`baseURL`` | ②证据 |  |

## `.workspace/acceptance-probe/live-subagent-model-client.js` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 10 | `// .workspace/subagent-model-gui-audit.md): provider / model selects fed` | `// .workspace/reports/audits/subagent-model/subagent-model-gui-audit.md): provider / model selects f` | ②证据 |  |

## `.workspace/acceptance-probe/live-vs-disk.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 279 | ``git status --short` 仅显示先前既有的 `?? .workspace/mmt-probe/pasted-2048.png`、`?? .workspace/push-log3.txt` | ``git status --short` 仅显示先前既有的 `?? .workspace/probes/mmt/pasted-2048.png`、`?? .workspace/push-log3.tx` | ②证据 |  |

## `.workspace/acceptance-probe/probe-channel-availability.sh` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 8 | `LOG=/home/CNS2026495165/dsh/.workspace/acceptance-probe/channel-availability.log` | `LOG=/home/CNS2026495165/dsh/.workspace/probes/acceptance/channel-availability.log` | ②证据 |  |

## `.workspace/acceptance-probe/probe-context-window-round2.sh` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 7 | `LOG=/home/CNS2026495165/dsh/.workspace/acceptance-probe/probe-context-window-round2.log` | `LOG=/home/CNS2026495165/dsh/.workspace/probes/acceptance/probe-context-window-round2.log` | ②证据 |  |

## `.workspace/acceptance-probe/probe-context-window.sh` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 16 | `LOG=/home/CNS2026495165/dsh/.workspace/acceptance-probe/probe-context-window.log` | `LOG=/home/CNS2026495165/dsh/.workspace/probes/acceptance/probe-context-window.log` | ②证据 |  |

## `.workspace/acceptance-probe/push-log3-GH001-archive.txt` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `2:remote: warning: File .workspace/tmp-ppt-research/raw/mgr.tgz is 51.08 MB; this is larger than Git` | `2:remote: warning: File .workspace/workstreams/research/tmp-ppt-research/raw/mgr.tgz is 51.08 MB; th` | ②证据 |  |

## `.workspace/audit-d-plugins.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 67 | `- **peer-deps-check-patched 实跑**（`/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/peer-de` | `- **peer-deps-check-patched 实跑**（`/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-worke` | ②证据 |  |

## `.workspace/btw-image-pipeline-audit.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 362 | `**报告路径**：`/home/CNS2026495165/dsh/.workspace/btw-image-pipeline-audit.md`` | `**报告路径**：`/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-image-pipeline-audit.md`` | ③自身档 | 是 |

## `.workspace/btw-ui-exec.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 依据：需求（用户已对齐，范围不得更改）+ 差距审计（`.workspace/btw-ui-gap-audit.md`，⑤ B 层实现面）+ 实时机制审计（`.workspace/btw-live-` | `> 依据：需求（用户已对齐，范围不得更改）+ 差距审计（`.workspace/btw-ui-gap-audit.md`，⑤ B 层实现面）+ 实时机制审计（`.workspace/reports/a` | ②证据 |  |

## `.workspace/btw-ui-previews/render-preview.py` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 151 | `CANVAS.save("/home/CNS2026495165/dsh/.workspace/btw-ui-previews/preview.png")` | `CANVAS.save("/home/CNS2026495165/dsh/.workspace/probes/previews/btw-ui/preview.png")` | ②证据 |  |

## `.workspace/deploy-lag/settings/settings-lag-fix.snippet.yaml` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 15 | `# [U-8] vision-adam 段整体替换（与已产出 .workspace/deploy/` | `# [U-8] vision-adam 段整体替换（与已产出 .workspace/workstreams/deploy/deploy/` | ②证据 |  |

## `.workspace/deploy-lag/settings/settings.yaml.diff` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 32 | `# 诊断脚本：.workspace/diag-piai-route.mjs（复刻 resolveRouteModels 解析，` | `# 诊断脚本：.workspace/probes/workflow-drivers/diag-piai-route.mjs（复刻 resolveRouteModels 解析，` | ②证据 |  |

## `.workspace/deploy-pptmaster/03-integration.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 12 | `- peer 会话（session-board 背景）有一条**未落地**的「vision-prompt 部署」计划（涉及给 btw 加 vision 能力），`.workspace/deploy-v` | `- peer 会话（session-board 背景）有一条**未落地**的「vision-prompt 部署」计划（涉及给 btw 加 vision 能力），`.workspace/workstre` | ②证据 |  |

## `.workspace/deploy-pptmaster/04-Runbook.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `> staging 根：`/home/CNS2026495165/dsh/.workspace/deploy-pptmaster/`（下文以 `$STAGE` 代指）。` | `> staging 根：`/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-pptmaster/`（下文以 `$STAGE` 代` | ②证据 |  |

## `.workspace/deploy-ssh-gui/dsh-ssh-gui/README.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 87 | `补丁声明，见 `.workspace/deploy-slots/`）→ 各节点展开：ssh = 目录浏览 + 「打开为工作区」` | `补丁声明，见 `.workspace/workstreams/deploy/deploy-slots/`）→ 各节点展开：ssh = 目录浏览 + 「打开为工作区」` | ②证据 |  |

## `.workspace/deploy-ssh-gui/dsh-ssh-gui/lib/client.js` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 17 | `// 见 .workspace/deploy-slots/）。数据走两个 loopback 通道：` | `// 见 .workspace/workstreams/deploy/deploy-slots/）。数据走两个 loopback 通道：` | ②证据 |  |

## `.workspace/deploy-ssh-gui/test/slots-registration.test.mjs` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 1 | `// client bundle 冒烟：槽位路径 B 接入后（.workspace/deploy-slots/slot-b-exec.md §3）：` | `// client bundle 冒烟：槽位路径 B 接入后（.workspace/workstreams/deploy/deploy-slots/slot-b-exec.md §3）：` | ②证据 |  |

## `.workspace/deploy-subagent-model/lib/client.js` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 10 | `// .workspace/subagent-model-gui-audit.md): provider / model selects fed` | `// .workspace/reports/audits/subagent-model/subagent-model-gui-audit.md): provider / model selects f` | ②证据 |  |

## `.workspace/deploy-vision-prompt/index.js` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 24 | `* 真实看图，见 .workspace/opencode-deepseek-v4-flash-probe.md），认证改为` | `* 真实看图，见 .workspace/reports/research/opencode-deepseek-v4-flash-probe.md），认证改为` | ②证据 |  |

## `.workspace/deploy-vision-settings/lib/index.js` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 24 | `* 真实看图，见 .workspace/opencode-deepseek-v4-flash-probe.md），认证改为` | `* 真实看图，见 .workspace/reports/research/opencode-deepseek-v4-flash-probe.md），认证改为` | ②证据 |  |

## `.workspace/deploy-workerspace/README.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 37 | `报告：`.workspace/workerspace-exec.md`。` | `报告：`.workspace/reports/execs/workerspace/workerspace-exec.md`。` | ②证据 |  |

## `.workspace/deploy-workerspace/RUNBOOK.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 交付物：`.workspace/deploy-workerspace/`（staging，不碰部署位；本 Runbook 是操作指引）。` | `> 交付物：`.workspace/workstreams/deploy/deploy-workerspace/`（staging，不碰部署位；本 Runbook 是操作指引）。` | ②证据 |  |

## `.workspace/deploy-workerspace/base/client-slots.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 33 | `依据：`.workspace/research/audit-workspace-enhancement.md` §5.4（rc.2 `dsh-cordis-client-runner/lib/clie` | `依据：`.workspace/workstreams/research/research/audit-workspace-enhancement.md` §5.4（rc.2 `dsh-cordis-c` | ②证据 |  |

## `.workspace/deploy-workerspace/base/load-test2.mjs` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `const root = "/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/loadtest/pkg";` | `const root = "/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-workerspace/base/loadtest` | ②证据 |  |

## `.workspace/deploy-workerspace/base/loadtest/ws-config-test.mjs` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 2 | `const root = "/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/loadtest/pkg-ws";` | `const root = "/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-workerspace/base/loadtest` | ②证据 |  |

## `.workspace/deploy-workerspace/base/loadtest/ws-load-test.mjs` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 1 | `const root = "/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/loadtest/pkg-ws";` | `const root = "/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-workerspace/base/loadtest` | ②证据 |  |

## `.workspace/deploy-workerspace/base/peer-deps-check.mjs` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `* 判定口径（与 .workspace/research/local-facts.md §C 一致）：` | `* 判定口径（与 .workspace/workstreams/research/research/local-facts.md §C 一致）：` | ②证据 |  |

## `.workspace/deploy/settings-vision-adam.snippet.yaml` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 12 | `#   （真实看图，证据 .workspace/opencode-deepseek-v4-flash-probe.md）。` | `#   （真实看图，证据 .workspace/reports/research/opencode-deepseek-v4-flash-probe.md）。` | ②证据 |  |

## `.workspace/deploy/vision-adam/lib/index.js` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 24 | `* 真实看图，见 .workspace/opencode-deepseek-v4-flash-probe.md），认证改为` | `* 真实看图，见 .workspace/reports/research/opencode-deepseek-v4-flash-probe.md），认证改为` | ②证据 |  |

## `.workspace/diag-settings-config.mjs` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 8 | `const data = JSON.parse(readFileSync('/home/CNS2026495165/dsh/.workspace/settings-snapshot.json', 'u` | `const data = JSON.parse(readFileSync('/home/CNS2026495165/dsh/.workspace/probes/settings-snapshots/s` | ②证据 |  |

## `.workspace/dsh-vision-adam-src/lib/index.js` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 24 | `* 真实看图，见 .workspace/opencode-deepseek-v4-flash-probe.md），认证改为` | `* 真实看图，见 .workspace/reports/research/opencode-deepseek-v4-flash-probe.md），认证改为` | ②证据 |  |

## `.workspace/dsh-vision-adam-src/smoke-client.mjs` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 1 | `// Bundle smoke for .workspace/dsh-vision-adam-src/lib/client.js` | `// Bundle smoke for .workspace/workstreams/sources/dsh-vision-adam-src/lib/client.js` | ②证据 |  |

## `.workspace/final-audit-a-patches.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 90 | `### 5.1 抽查 6 包 live vs `.workspace/deploy-015/<pkg>` 全文件 sha256（lean/组A/组C 各 2）` | `### 5.1 抽查 6 包 live vs `.workspace/workstreams/deploy/deploy-015/<pkg>` 全文件 sha256（lean/组A/组C 各 2）` | ②证据 |  |

## `.workspace/final-audit-b-plugins.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 53 | `- **槽位匹配**：`.workspace/deploy-slots/patched/dsh-client-ui-workspace/lib/client.js` 声明 `sidebar.works` | `- **槽位匹配**：`.workspace/workstreams/deploy/deploy-slots/patched/dsh-client-ui-workspace/lib/client.js` | ②证据 |  |

## `.workspace/hotreload-b-inventory.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 176 | `- 启动时间：web2 独立验收 runbook 用 `sleep 12` 后查日志（`switch-web2-runbook.md` §2），` | `- 启动时间：web2 独立验收 runbook 用 `sleep 12` 后查日志（`docs/runbooks/switch-web2-runbook.md` §2），` | ②证据 |  |

## `.workspace/incident-piai-model-selection.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 23 | `## 正反实验（`.workspace/diag-piai-route.mjs`，复刻 resolveRouteModels + 真实 catalog）` | `## 正反实验（`.workspace/probes/workflow-drivers/diag-piai-route.mjs`，复刻 resolveRouteModels + 真实 catalog）` | ②证据 |  |

## `.workspace/lag-fix-guard.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `> 范围：只写 `.workspace/deploy-lag/` 与本报告；未触碰 `~/.npm-global`、`~/.dsh`；未使用 sandbox_permissions。` | `> 范围：只写 `.workspace/workstreams/deploy/deploy-lag/` 与本报告；未触碰 `~/.npm-global`、`~/.dsh`；未使用 sandbox_pe` | ②证据 |  |

## `.workspace/mmt-probe/probe-image.sh` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 14 | `b64=base64.b64encode(open(__import__('os').path.join(__import__('os').path.dirname(out) if False els` | `b64=base64.b64encode(open(__import__('os').path.join(__import__('os').path.dirname(out) if False els` | ②证据 |  |

## `.workspace/p0a-patch-hmr-exec.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 101 | `- `.workspace/deploy-lag/README.md` 新增 **§9 运行时热载能力（P0-a 实测固化）**：支持矩阵、免重启操作清单（YAML 示例 + graph 验证命令）、` | `- `.workspace/workstreams/deploy/deploy-lag/README.md` 新增 **§9 运行时热载能力（P0-a 实测固化）**：支持矩阵、免重启操作清单（YAM` | ②证据 |  |

## `.workspace/plugin-restore/cordis.patch.yml` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `# plugin-restore 修正版（2026-09-12，产物 .workspace/plugin-restore/）` | `# plugin-restore 修正版（2026-09-12，产物 .workspace/workstreams/plugin-restore/）` | ②证据 |  |

## `.workspace/pptmaster-exec.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 数据时点：2026-09-14。全部产物落 `/home/CNS2026495165/dsh/.workspace/deploy-pptmaster/`（未碰部署位 ~/.dsh）。` | `> 数据时点：2026-09-14。全部产物落 `/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-pptmaster/`（未碰` | ②证据 |  |

## `.workspace/research-dsh-workerspace/.npm-cache/_logs/2026-09-14T02_57_30_278Z-eresolve-report.txt` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 2 | `/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/.npm-cache/_logs/2026-09-14T02_57_30_278` | `/home/CNS2026495165/dsh/.workspace/workstreams/research/research-dsh-workerspace/.npm-cache/_logs/20` | ②证据 |  |

## `.workspace/research-dsh-workerspace/mcp-ecosystem-report.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 75 | `- 三指定仓库源码：`/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/repos/{mcp-remote-access,MCP-` | `- 三指定仓库源码：`/home/CNS2026495165/dsh/.workspace/workstreams/research/research-dsh-workerspace/repos/{m` | ②证据 |  |

## `.workspace/research/audit-workspace-enhancement.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 7 | `> 克隆位置：`/home/CNS2026495165/dsh/.workspace/repos/dsh-workspace-enhancement`（`git clone --depth 50`）` | `> 克隆位置：`/home/CNS2026495165/dsh/.workspace/workstreams/research/repos/dsh-workspace-enhancement`（`gi` | ②证据 |  |

## `.workspace/side-deploy/DEPRECATED-web2.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 16 | ``.workspace/side-deploy/usage/` 留存了包副本后，可整目录删除本 profile。` | ``.workspace/workstreams/side-deploy/usage/` 留存了包副本后，可整目录删除本 profile。` | ②证据 |  |

## `.workspace/upstream-015-diff/groups/G1-streaming-session.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `调研方式：diff 产物在 `/home/CNS2026495165/dsh/.workspace/upstream-015-diff/pkgs/<pkg>.{combined,libjs,upstr` | `调研方式：diff 产物在 `/home/CNS2026495165/dsh/.workspace/workstreams/upstream-015-diff/pkgs/<pkg>.{combined` | ②证据 |  |

## `.workspace/upstream-015-diff/groups/G4-sse-gateway.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 112 | `## 证据行号索引（ARCH = ~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai；GLOB = ~/.np` | `## 证据行号索引（ARCH = ~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai；GLOB = ~/.np` | ②证据 |  |

## `.workspace/workspace-plugins-deep-research.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `- 约束遵守：全程只读 + 联网；npm 缓存目录只读，改走 `npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache`；未使用 s` | `- 约束遵守：全程只读 + 联网；npm 缓存目录只读，改走 `npm_config_cache=/home/CNS2026495165/dsh/.workspace/workstreams/npm-` | ②证据 |  |

## `DOC-STYLE.md` （8 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 6 | `见 `.workspace/research-luxweft-doc/zh-cn/`）。**未来所有 dsh-hub 文档按此约定写。**` | `见 `.workspace/workstreams/research/research-luxweft-doc/zh-cn/`）。**未来所有 dsh-hub 文档按此约定写。**` | ②证据 |  |
| 35 | `退出非零、绝不静默继续，`--rollback` 一键还原（来源：`.workspace/lag-fix-exec.md` U-9）；` | `退出非零、绝不静默继续，`--rollback` 一键还原（来源：`.workspace/reports/execs/lagfix/lag-fix-exec.md` U-9）；` | ②证据 |  |
| 36 | `- `cordis.patch.yml` 热载：刷新失败 → 整次回滚、无残留（来源：`.workspace/p0a-patch-hmr-exec.md` §0/§1）；` | `- `cordis.patch.yml` 热载：刷新失败 → 整次回滚、无残留（来源：`.workspace/reports/execs/p0-hotload/p0a-patch-hmr-exec.m` | ②证据 |  |
| 38 | `来源：`.workspace/workerspace-exec.md` §1-2 四道闸）；` | `来源：`.workspace/reports/execs/workerspace/workerspace-exec.md` §1-2 四道闸）；` | ②证据 |  |
| 40 | `（来源：`.workspace/vision-settings-capability-exec.md` §2 回退安全）。` | `（来源：`.workspace/reports/execs/vision/vision-settings-capability-exec.md` §2 回退安全）。` | ②证据 |  |
| 49 | ``.workspace/deploy-*/` 脚本复制），不允许示意性改写；环境相关部分用显式占位符` | ``.workspace/workstreams/deploy/deploy-*/` 脚本复制），不允许示意性改写；环境相关部分用显式占位符` | ②证据 |  |
| 100 | `- **Tier 3 · 参考与证据**：`.workspace/*-audit.md`、`*-exec.md`（审计结论、交付单元、自复核证据）、`.workspace/deploy-*/patch` | `- **Tier 3 · 参考与证据**：`.workspace/*-audit.md`、`*-exec.md`（审计结论、交付单元、自复核证据）、`.workspace/workstreams/de` | ②证据 |  |
| 117 | `（`.workspace/research-luxweft-doc/zh-cn/`）为准。` | `（`.workspace/workstreams/research/research-luxweft-doc/zh-cn/`）为准。` | ②证据 |  |

## `FEATURE-MAP.md` （31 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 25 | `| **dsh-btw 侧边对话 v2** | 已实现·实测（2026-09-12 部署；09-16 能力检测 + 行为开关；09-17 默认模型换 `deepseek-v4.1-flash` + s` | `| **dsh-btw 侧边对话 v2** | 已实现·实测（2026-09-12 部署；09-16 能力检测 + 行为开关；09-17 默认模型换 `deepseek-v4.1-flash` + s` | **①实链** |  |
| 26 | `| **dsh-usage 用量统计 + tooltip** | 已实现·实测（2026-09-14；2026-09-18 趋势图改造） | [usage-tooltip-exec.md](.work` | `| **dsh-usage 用量统计 + tooltip** | 已实现·实测（2026-09-14；2026-09-18 趋势图改造） | [usage-tooltip-exec.md](.work` | **①实链** |  |
| 27 | `| **行为开关（settings 值级热载）** | 已实现·实测（2026-09-16） | [p0b-settings-switch-exec.md](.workspace/p0b-settin` | `| **行为开关（settings 值级热载）** | 已实现·实测（2026-09-16） | [p0b-settings-switch-exec.md](.workspace/reports/ex` | **①实链** |  |
| 28 | `| **vision-adam 识图（2026-09-17 起走 adam 网关）** | 已实现·实测（2026-09-12 配置化；09-14 提示词；09-17 换网关） | [vision-p` | `| **vision-adam 识图（2026-09-17 起走 adam 网关）** | 已实现·实测（2026-09-12 配置化；09-14 提示词；09-17 换网关） | [vision-p` | **①实链** |  |
| 29 | `| **vision-adam 识图设置页** | 已实现·实测（2026-09-16 部署） | [deploy-vision-settings/README.md](.workspace/depl` | `| **vision-adam 识图设置页** | 已实现·实测（2026-09-16 部署） | [deploy-vision-settings/README.md](.workspace/work` | **①实链** |  |
| 30 | `| **dsh-subagent-model 子代理模型设置页** | 已实现·**已重启验收**（2026-09-17 部署；重启 17:45:39 后实测：boot 图含该插件、bundle HT` | `| **dsh-subagent-model 子代理模型设置页** | 已实现·**已重启验收**（2026-09-17 部署；重启 17:45:39 后实测：boot 图含该插件、bundle HT` | ②证据 |  |
| 31 | `| **图像能力检测（直传 vs 转文本）** | 已实现·**实测生效**（2026-09-16 实现；2026-09-17 声明并实测直传） | [vision-settings-capabili` | `| **图像能力检测（直传 vs 转文本）** | 已实现·**实测生效**（2026-09-16 实现；2026-09-17 声明并实测直传） | [vision-settings-capabili` | **①实链** |  |
| 32 | `| **dsh-pptmaster（skill + 插件）** | 已实现·实测（2026-09-14 部署） | [deploy-pptmaster/04-Runbook.md](.workspac` | `| **dsh-pptmaster（skill + 插件）** | 已实现·实测（2026-09-14 部署） | [deploy-pptmaster/04-Runbook.md](.workspac` | **①实链** |  |
| 33 | `| **dsh-workerspace 本地串口/烧录** | 已实现·**未真机**（2026-09-14；42 单测本地全绿） | [deploy-workerspace/RUNBOOK.md](` | `| **dsh-workerspace 本地串口/烧录** | 已实现·**未真机**（2026-09-14；42 单测本地全绿） | [deploy-workerspace/RUNBOOK.md](` | **①实链** |  |
| 34 | `| **分布式控制（dsh-ssh-gui v0.2.0）** | 已实现·**未真机**（2026-09-15；81/81 单测本地通过） | [deploy-ssh-gui/RUNBOOK.md]` | `| **分布式控制（dsh-ssh-gui v0.2.0）** | 已实现·**未真机**（2026-09-15；81/81 单测本地通过） | [deploy-ssh-gui/RUNBOOK.md]` | **①实链** |  |
| 35 | `| **dsh-taste / dsh-wallpaper-local / session-board** | 已实现·实测（基线启用） | [master-runbook.md](.workspac` | `| **dsh-taste / dsh-wallpaper-local / session-board** | 已实现·实测（基线启用） | [master-runbook.md](.workspac` | **①实链** |  |
| 41 | `| **lag-fix 5 补丁 + settings**（②b 子代理非流式 / mux 订阅过滤 seam / FrameQueue 有界 4096（应答帧永不丢弃）/ 图片变换 waterfal` | `| **lag-fix 5 补丁 + settings**（②b 子代理非流式 / mux 订阅过滤 seam / FrameQueue 有界 4096（应答帧永不丢弃）/ 图片变换 waterfal` | ②证据 |  |
| 42 | `| **0.1.5 借码批次（patch-official-015.sh）**：lean 12（P0：tool-web untrusted-notice、atomic-write Windows re` | `| **0.1.5 借码批次（patch-official-015.sh）**：lean 12（P0：tool-web untrusted-notice、atomic-write Windows re` | ②证据 |  |
| 43 | `| **goal 修复（P0-A + 方案 A）** | 已实现·**已活体验收**（2026-09-17；首次真实观测：等待期零 goal 轮注入、唤醒源为 `subagent-settled` 通` | `| **goal 修复（P0-A + 方案 A）** | 已实现·**已活体验收**（2026-09-17；首次真实观测：等待期零 goal 轮注入、唤醒源为 `subagent-settled` 通` | **①实链** |  |
| 44 | `| **subagent 模型 settings 默认层（dsh-tool-subagent P0' 补丁）** | 已实现·实测（2026-09-17；端到端双向真实派发：覆写→子代理实际跑 `gl` | `| **subagent 模型 settings 默认层（dsh-tool-subagent P0' 补丁）** | 已实现·实测（2026-09-17；端到端双向真实派发：覆写→子代理实际跑 `gl` | **①实链** |  |
| 45 | `| **槽位 B（sidebar.workspaces.remoteHosts）** | 已实现·实测（2026-09-15；48/48 单测） | [deploy-slots/patch-offic` | `| **槽位 B（sidebar.workspaces.remoteHosts）** | 已实现·实测（2026-09-15；48/48 单测） | [deploy-slots/patch-offic` | **①实链** |  |
| 46 | `| **btw P0 materialize（dsh-subagent 官方补丁）** | 已实现·实测（2026-09-12） | [deploy-p0/APPLY-P0.md](.workspac` | `| **btw P0 materialize（dsh-subagent 官方补丁）** | 已实现·实测（2026-09-12） | [deploy-p0/APPLY-P0.md](.workspac` | **①实链** |  |
| 47 | `| **未采纳 / 勿借（如实列出）**：P0-B `startsRequestSeries`；流式/传输层整族（api-gateway、remote.mux WS 重写、client-connect` | `| **未采纳 / 勿借（如实列出）**：P0-B `startsRequestSeries`；流式/传输层整族（api-gateway、remote.mux WS 重写、client-connect` | ②证据 |  |
| 53 | `| **context overflow 根因修复（adam 45 条 `contextWindow` 补齐）** | 已实现·**实测止血**（2026-09-17 18:04 热载，无需重启） |` | `| **context overflow 根因修复（adam 45 条 `contextWindow` 补齐）** | 已实现·**实测止血**（2026-09-17 18:04 热载，无需重启） |` | **①实链** |  |
| 54 | `| **vision-adam URL 拼接加固** | 已实现·实测（2026-09-17） | [acceptance-exec.md](.workspace/acceptance-exec.md` | `| **vision-adam URL 拼接加固** | 已实现·实测（2026-09-17） | [acceptance-exec.md](.workspace/reports/execs/acce` | **①实链** |  |
| 57 | `| **仓库瘦身 A 路线（停止跟踪 `.venv-ppt-test`）** | 已实现（2026-09-17） | [acceptance-exec.md](.workspace/acceptanc` | `| **仓库瘦身 A 路线（停止跟踪 `.venv-ppt-test`）** | 已实现（2026-09-17） | [acceptance-exec.md](.workspace/reports/e` | **①实链** |  |
| 58 | `| **btw 图像管线 D1/D2 修复** | 已实现·**待重启生效**（2026-09-18；类型检查通过、vitest 233 passed / 2 skipped，新增两条针对性测试） |` | `| **btw 图像管线 D1/D2 修复** | 已实现·**待重启生效**（2026-09-18；类型检查通过、vitest 233 passed / 2 skipped，新增两条针对性测试） |` | **①实链** |  |
| 66 | `| **patch 条目级热载** | 已实现·实测（2026-09-16，运行实例实测） | [deploy-lag/README.md](.workspace/deploy-lag/README.` | `| **patch 条目级热载** | 已实现·实测（2026-09-16，运行实例实测） | [deploy-lag/README.md](.workspace/deploy-lag/README.` | **①实链** |  |
| 67 | `| **settings 值级热载（行为开关）** | 已实现·实测（2026-09-16） | [p0b-settings-switch-exec.md](.workspace/p0b-settin` | `| **settings 值级热载（行为开关）** | 已实现·实测（2026-09-16） | [p0b-settings-switch-exec.md](.workspace/reports/ex` | **①实链** |  |
| 68 | `| **subagent 模型值级热载** | 已实现·**已重启验收**（2026-09-17；重启后实测 `dsh-subagent` 段缺失时全部子代理取 preset 路由 `deepseek` | `| **subagent 模型值级热载** | 已实现·**已重启验收**（2026-09-17；重启后实测 `dsh-subagent` 段缺失时全部子代理取 preset 路由 `deepseek` | **①实链** |  |
| 69 | `| **client bundle 热载** | 已实现·实测（机制） | [usage-tooltip-exec.md](.workspace/usage-tooltip-exec.md) §5 |` | `| **client bundle 热载** | 已实现·实测（机制） | [usage-tooltip-exec.md](.workspace/reports/execs/usage/usage-t` | **①实链** |  |
| 70 | `| **dsh-restart 自动重启** | 已实现·实测（2026-09-16；dry-run/防抖/daemon 生命周期全验证；真实重启由用户执行） | [deploy-lag/dsh-re` | `| **dsh-restart 自动重启** | 已实现·实测（2026-09-16；dry-run/防抖/daemon 生命周期全验证；真实重启由用户执行） | [deploy-lag/dsh-re` | **①实链** |  |
| 71 | `| **纯函数热载 B 通道** | **尚不可用**（闸门通过 · 未投产，2026-09-16） | [p1-hotswap-gate-exec.md](.workspace/p1-hotswap` | `| **纯函数热载 B 通道** | **尚不可用**（闸门通过 · 未投产，2026-09-16） | [p1-hotswap-gate-exec.md](.workspace/reports/ex` | **①实链** |  |
| 78 | `[deploy-workerspace/RUNBOOK.md](.workspace/deploy-workerspace/RUNBOOK.md) §5 实测后才算「已实现·实测」。` | `[deploy-workerspace/RUNBOOK.md](.workspace/workstreams/deploy/deploy-workerspace/RUNBOOK.md) §5 实测后才` | **①实链** |  |
| 80 | `[deploy-ssh-gui/RUNBOOK.md](.workspace/deploy-ssh-gui/RUNBOOK.md) 实测。` | `[deploy-ssh-gui/RUNBOOK.md](.workspace/workstreams/deploy/deploy-ssh-gui/RUNBOOK.md) 实测。` | **①实链** |  |
| 93 | `| **1 · 部署** | 怎么让这些能力上屏/生效？ | [master-runbook.md](.workspace/master-runbook.md) + 对应主题 Runbook（READ` | `| **1 · 部署** | 怎么让这些能力上屏/生效？ | [master-runbook.md](.workspace/reports/runbooks/master-runbook.md) + ` | **①实链** |  |

## `README.md` （33 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 10 | `**官方包补丁与重放脚本**（`.workspace/deploy-*/`）、**审计/执行/验证证据**（`.workspace/*-audit.md` / `*-exec.md`）。` | `**官方包补丁与重放脚本**（`.workspace/workstreams/deploy/deploy-*/`）、**审计/执行/验证证据**（`.workspace/*-audit.md` / `` | ②证据 |  |
| 52 | `| **部署后要重启 + 验收** | [总 Runbook](.workspace/master-runbook.md) → 对应主题 Runbook（见下方索引） |` | `| **部署后要重启 + 验收** | [总 Runbook](.workspace/reports/runbooks/master-runbook.md) → 对应主题 Runbook（见下方索引）` | **①实链** |  |
| 53 | `| **全局树重装后要补丁重放** | `.workspace/deploy-lag/replay-lag-fix.sh` → `patch-official-015.sh` → `patch-off` | `| **全局树重装后要补丁重放** | `.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh` → `patch-official-0` | ②证据 |  |
| 54 | `| **改插件/补丁代码后想生效** | 先判断冷热：插件 client bundle 替换 + 刷新浏览器即可；宿主 lib 代码 → `.workspace/deploy-lag/dsh-rest` | `| **改插件/补丁代码后想生效** | 先判断冷热：插件 client bundle 替换 + 刷新浏览器即可；宿主 lib 代码 → `.workspace/workstreams/deploy/` | ②证据 |  |
| 56 | `| **模型报 `CONTEXT_WINDOW_EXCEEDED` 但明明没到窗口** | [acceptance-exec.md](.workspace/acceptance-exec.md) §3` | `| **模型报 `CONTEXT_WINDOW_EXCEEDED` 但明明没到窗口** | [acceptance-exec.md](.workspace/reports/execs/acceptan` | **①实链** |  |
| 57 | `| **查热载能力 / 免重启清单** | [功能地图](FEATURE-MAP.md) 热载节 · `.workspace/deploy-lag/README.md` §9（P0-a 实测固化） |` | `| **查热载能力 / 免重启清单** | [功能地图](FEATURE-MAP.md) 热载节 · `.workspace/workstreams/deploy/deploy-lag/README.` | **①实链** |  |
| 60 | `| **回滚** | 各补丁脚本 `--rollback`（备份在 `.workspace/backup-*`、`.workspace/deploy-*/backup-*`、`~/.dsh/backu` | `| **回滚** | 各补丁脚本 `--rollback`（备份在 `.workspace/backup-*`、`.workspace/workstreams/deploy/deploy-*/back` | ②证据 |  |
| 70 | `（来源：`.workspace/deploy-lag/README.md` §0 分工表。）` | `（来源：`.workspace/workstreams/deploy/deploy-lag/README.md` §0 分工表。）` | ②证据 |  |
| 77 | `（来源：`.workspace/p0a-patch-hmr-exec.md`、`.workspace/p0b-settings-switch-exec.md`、` | `（来源：`.workspace/p0a-patch-hmr-exec.md`、`.workspace/reports/execs/p0-hotload/p0b-settings-switch-exec` | ②证据 |  |
| 78 | ``.workspace/usage-tooltip-exec.md` §5 生效方式。）` | ``.workspace/reports/execs/usage/usage-tooltip-exec.md` §5 生效方式。）` | ②证据 |  |
| 87 | `（来源：`.workspace/lag-fix-exec.md` U-9、`.workspace/borrow-015-exec.md` §3、` | `（来源：`.workspace/lag-fix-exec.md` U-9、`.workspace/reports/execs/borrow-015/borrow-015-exec.md` §3、` | ②证据 |  |
| 88 | ``.workspace/p0a-patch-hmr-exec.md` §0/§1、`.workspace/workerspace-exec.md` §1-2、` | ``.workspace/reports/execs/p0-hotload/p0a-patch-hmr-exec.md` §0/§1、`.workspace/workerspace-exec.md` §` | ②证据 |  |
| 89 | ``.workspace/vision-settings-capability-exec.md` §2。）` | ``.workspace/reports/execs/vision/vision-settings-capability-exec.md` §2。）` | ②证据 |  |
| 100 | `| [总 Runbook](.workspace/master-runbook.md) | 已部署清单、六项启动修复、事故记录、验收矩阵、回滚 |` | `| [总 Runbook](.workspace/reports/runbooks/master-runbook.md) | 已部署清单、六项启动修复、事故记录、验收矩阵、回滚 |` | **①实链** |  |
| 107 | `| `.workspace/deploy-*/patches/*.patch` | 官方包补丁的可应用 unified diff（即「可执行规范」，见下节） |` | `| `.workspace/workstreams/deploy/deploy-*/patches/*.patch` | 官方包补丁的可应用 unified diff（即「可执行规范」，见下节） |` | ②证据 |  |
| 117 | `cd .workspace/deploy-lag` | `cd .workspace/workstreams/deploy/deploy-lag` | **①实链** |  |
| 123 | `cd .workspace/deploy-slots && bash patch-official-slots.sh --apply   # 槽位 B` | `cd .workspace/workstreams/deploy/deploy-slots && bash patch-official-slots.sh --apply   # 槽位 B` | **①实链** |  |
| 124 | `cd .workspace/deploy-lag && ./dsh-restart.sh --yes                  # 重启使宿主 lib 生效 + 冒烟 200` | `cd .workspace/workstreams/deploy/deploy-lag && ./dsh-restart.sh --yes                  # 重启使宿主 lib 生` | **①实链** |  |
| 131 | `| 总 Runbook（本机基线 + 事故记录 + 验收矩阵） | [.workspace/master-runbook.md](.workspace/master-runbook.md) |` | `| 总 Runbook（本机基线 + 事故记录 + 验收矩阵） | [.workspace/reports/runbooks/master-runbook.md](.workspace/reports` | **①实链** |  |
| 132 | `| 卡顿修复（lag-fix 5 补丁 + settings） | [.workspace/lag-fix-runbook.md](.workspace/lag-fix-runbook.md) |` | `| 卡顿修复（lag-fix 5 补丁 + settings） | [.workspace/reports/runbooks/lag-fix-runbook.md](.workspace/report` | **①实链** |  |
| 133 | `| 紧急恢复合并（一次重启统一验证） | [.workspace/combined-restore-runbook.md](.workspace/combined-restore-runbook.md` | `| 紧急恢复合并（一次重启统一验证） | [.workspace/reports/runbooks/combined-restore-runbook.md](.workspace/reports/ru` | **①实链** |  |
| 134 | `| btw v2（图片管线/跳转/面板） | [.workspace/btw-v2-runbook.md](.workspace/btw-v2-runbook.md) |` | `| btw v2（图片管线/跳转/面板） | [.workspace/reports/runbooks/btw-v2-runbook.md](.workspace/reports/runbooks/b` | **①实链** |  |
| 135 | `| 分布式控制（ssh-gui v0.2.0，SSH/串口/TCP 串口） | [.workspace/deploy-ssh-gui/RUNBOOK.md](.workspace/deploy-ssh` | `| 分布式控制（ssh-gui v0.2.0，SSH/串口/TCP 串口） | [.workspace/workstreams/deploy/deploy-ssh-gui/RUNBOOK.md](.w` | **①实链** |  |
| 136 | `| 本地串口/烧录（workerspace，ws_serial_*/ws_flash） | [.workspace/deploy-workerspace/RUNBOOK.md](.workspace/` | `| 本地串口/烧录（workerspace，ws_serial_*/ws_flash） | [.workspace/workstreams/deploy/deploy-workerspace/RUNB` | **①实链** |  |
| 137 | `| ppt-master（skill + 插件） | [.workspace/deploy-pptmaster/04-Runbook.md](.workspace/deploy-pptmaster/0` | `| ppt-master（skill + 插件） | [.workspace/workstreams/deploy/deploy-pptmaster/04-Runbook.md](.workspace` | **①实链** |  |
| 138 | `| vision-adam 识图设置页 + 能力检测 | [.workspace/deploy-vision-settings/README.md](.workspace/deploy-vision-` | `| vision-adam 识图设置页 + 能力检测 | [.workspace/workstreams/deploy/deploy-vision-settings/README.md](.works` | **①实链** |  |
| 139 | `| 识图提示词（完整转录 + 审美分析） | [.workspace/deploy-vision-prompt/APPLY.md](.workspace/deploy-vision-prompt/AP` | `| 识图提示词（完整转录 + 审美分析） | [.workspace/workstreams/deploy/deploy-vision-prompt/APPLY.md](.workspace/work` | **①实链** |  |
| 140 | `| 0.1.5 借码补丁重放（脚本 `--help` 内嵌 Runbook） | [.workspace/deploy-lag/patch-official-015.sh](.workspace/de` | `| 0.1.5 借码补丁重放（脚本 `--help` 内嵌 Runbook） | [.workspace/workstreams/deploy/deploy-lag/patch-official-01` | **①实链** |  |
| 141 | `| 槽位 B（sidebar.workspaces.remoteHosts） | [.workspace/deploy-slots/REPLAY.md](.workspace/deploy-slots` | `| 槽位 B（sidebar.workspaces.remoteHosts） | [.workspace/workstreams/deploy/deploy-slots/REPLAY.md](.wor` | **①实链** |  |
| 142 | `| btw P0 materialize（dsh-subagent 官方补丁） | [.workspace/deploy-p0/APPLY-P0.md](.workspace/deploy-p0/AP` | `| btw P0 materialize（dsh-subagent 官方补丁） | [.workspace/workstreams/deploy/deploy-p0/APPLY-P0.md](.wor` | **①实链** |  |
| 143 | `| 重启辅助（dsh-restart，`--help` 内嵌 Runbook） | [.workspace/deploy-lag/dsh-restart.sh](.workspace/deploy-l` | `| 重启辅助（dsh-restart，`--help` 内嵌 Runbook） | [.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh](` | **①实链** |  |
| 144 | `| 运行时热载能力（P0-a 实测固化） | [.workspace/deploy-lag/README.md](.workspace/deploy-lag/README.md) §9 |` | `| 运行时热载能力（P0-a 实测固化） | [.workspace/workstreams/deploy/deploy-lag/README.md](.workspace/workstreams/d` | **①实链** |  |
| 149 | `**`.workspace/` 各 exec 报告与 `.workspace/deploy-*/patches/*.patch`**。` | `**`.workspace/` 各 exec 报告与 `.workspace/workstreams/deploy/deploy-*/patches/*.patch`**。` | ②证据 |  |

## `audit-btw-subagent.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 审计阶段子代理产出，独立于主 agent 冻结的 `audit-btw.md`，用于交叉验证。` | `> 审计阶段子代理产出，独立于主 agent 冻结的 `.workspace/reports/audits/btw/audit-btw.md`，用于交叉验证。` | ②证据 |  |
| 4 | `> 审计对象：Fork `@lukeknow0/dsh-side-chat` v0.4.0 + 补齐三处缺口（契约基线：`btw-wallpaper-plan.md`）。` | `> 审计对象：Fork `@lukeknow0/dsh-side-chat` v0.4.0 + 补齐三处缺口（契约基线：`.workspace/reports/plans/btw-wallpaper-` | ②证据 |  |
| 118 | `### 4.1 对契约基线（btw-wallpaper-plan.md）的验证` | `### 4.1 对契约基线（.workspace/reports/plans/btw-wallpaper-plan.md）的验证` | ②证据 |  |
| 216 | `## 7. 与主 agent 冻结版 audit-btw.md 的交叉验证（错误 / 遗漏清单）` | `## 7. 与主 agent 冻结版 .workspace/reports/audits/btw/audit-btw.md 的交叉验证（错误 / 遗漏清单）` | ②证据 |  |

## `audit-btw.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> ⚠️ **已被交叉验证版取代**：见 `audit-btw-subagent.md`（子代理源码级复核）。本报告三处错误已纠正：①缺口 3"白名单加 ask_user_question"无效（DE` | `> ⚠️ **已被交叉验证版取代**：见 `.workspace/reports/audits/btw/audit-btw-subagent.md`（子代理源码级复核）。本报告三处错误已纠正：①缺口 ` | ②证据 |  |

## `audit-local-customizations.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 173 | `| `audit-*.md` / `execute-*.md` / `review-*.md` / `execution-*.md` / `verify-runbook.md` / `wiring-p` | `| `audit-*.md` / `execute-*.md` / `review-*.md` / `execution-*.md` / `verify-runbook.md` / `wiring-p` | ②证据 |  |

## `audit-wallpaper.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 5 | `> 契约基线：`btw-wallpaper-plan.md`（壁纸节）。` | `> 契约基线：`.workspace/reports/plans/btw-wallpaper-plan.md`（壁纸节）。` | ②证据 |  |

## `examples/minimal-plugin/README.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 47 | `.workspace/deploy-lag/dsh-restart.sh --dry-run   # 先预览` | `.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh --dry-run   # 先预览` | ②证据 |  |
| 48 | `.workspace/deploy-lag/dsh-restart.sh --yes       # 一键优雅重启 + 冒烟 200` | `.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh --yes       # 一键优雅重启 + 冒烟 200` | ②证据 |  |
| 94 | `- 完整插件惯例见 `.workspace/deploy-workerspace/`（薄插件全量源码 + RUNBOOK）与` | `- 完整插件惯例见 `.workspace/workstreams/deploy/deploy-workerspace/`（薄插件全量源码 + RUNBOOK）与` | ②证据 |  |
| 95 | ``.workspace/deploy-ssh-gui/`（host+client 框架）。` | ``.workspace/workstreams/deploy/deploy-ssh-gui/`（host+client 框架）。` | ②证据 |  |

## `execute-btw.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 依据：`audit-btw-subagent.md`（交叉验证修正版，U0–U10）+ 用户执行指令（包名 `@local/dsh-btw`、五点核心纠正）。` | `> 依据：`.workspace/reports/audits/btw/audit-btw-subagent.md`（交叉验证修正版，U0–U10）+ 用户执行指令（包名 `@local/dsh-bt` | ②证据 |  |

## `execute-wallpaper.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 阶段：修订并执行（三阶段闭环第 2 阶段）。输入：`audit-wallpaper.md`（v2）+ 父代理三项裁决 + 父代理第二轮补充修正（peerDeps semver prerelease` | `> 阶段：修订并执行（三阶段闭环第 2 阶段）。输入：`.workspace/reports/audits/wallpaper/audit-wallpaper.md`（v2）+ 父代理三项裁决 + 父` | ②证据 |  |

## `execution-2b.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 39 | `cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback` | `cd /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag && bash replay-lag-fix.sh --roll` | **①实链** |  |

## `execution-btw-model.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `## 落地改动（9 单元，均按 audit-btw-model.md 实现）` | `## 落地改动（9 单元，均按 .workspace/reports/audits/btw/audit-btw-model.md 实现）` | ②证据 |  |

## `review-btw.md` （3 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 复核对象：`/home/CNS2026495165/dsh/dsh-btw/`（执行产物）对照 `audit-btw-subagent.md`（§5 方案 / §6 单元 U0–U10）与 `ex` | `> 复核对象：`/home/CNS2026495165/dsh/dsh-btw/`（执行产物）对照 `.workspace/reports/audits/btw/audit-btw-subagent.` | ②证据 |  |
| 38 | `| execute-btw.md 声称 | 代码实证 | 一致 |` | `| .workspace/reports/execs/btw/execute-btw.md 声称 | 代码实证 | 一致 |` | ②证据 |  |
| 114 | `1. **重启 `npx @deepseek-ai/dsh web`** 并执行 execute-btw.md U10 的 8 步手工验收（加载→问答→只读→反向提问→进行中摘要→闲置>30min→重` | `1. **重启 `npx @deepseek-ai/dsh web`** 并执行 .workspace/reports/execs/btw/execute-btw.md U10 的 8 步手工验收（加` | ②证据 |  |

## `review-wallpaper.md` （4 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 3 | `> 复核对象：`dsh-wallpaper-local/` 执行产物 + `execute-wallpaper.md` 自报。` | `> 复核对象：`dsh-wallpaper-local/` 执行产物 + `.workspace/reports/execs/wallpaper/execute-wallpaper.md` 自报。` | ②证据 |  |
| 4 | `> 基线：`audit-wallpaper.md`（v2）14 条交付单元（§6）、§5 修订方案、§7 签名复核、§8 风险、父代理三项裁决（MP4 全移除 / 9191 删除 / 图片落盘）与 C` | `> 基线：`.workspace/reports/audits/wallpaper/audit-wallpaper.md`（v2）14 条交付单元（§6）、§5 修订方案、§7 签名复核、§8 风险、` | ②证据 |  |
| 16 | `**附条件**：U14 的运行时端到端验收（GUI 内 12 项清单）因插件尚未安装激活（C3 裁决：与 btw 统一接线）尚未执行——这是已裁决的推迟，不构成返工理由，但闭环最终确认需父代理运行 `` | `**附条件**：U14 的运行时端到端验收（GUI 内 12 项清单）因插件尚未安装激活（C3 裁决：与 btw 统一接线）尚未执行——这是已裁决的推迟，不构成返工理由，但闭环最终确认需父代理运行 `` | ②证据 |  |
| 113 | `1. 按 C3 计划：btw 就绪后统一 `bash dsh-wallpaper-local/install.sh` + 重启，随后执行 execute-wallpaper.md §5 的 12 项手` | `1. 按 C3 计划：btw 就绪后统一 `bash dsh-wallpaper-local/install.sh` + 重启，随后执行 .workspace/reports/execs/wallpa` | ②证据 |  |

## `switch-web2-runbook.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 19 | `报告落盘：`port-vision-adam.md` / `port-wallpaper.md` / `port-taste.md` / `port-tokps-web2.md`（工作区 `/home` | `报告落盘：`.workspace/reports/ports/port-vision-adam.md` / `port-wallpaper.md` / `port-taste.md` / `port-` | ②证据 |  |

## `verify-runbook.md` （1 处）

| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |
| --- | --- | --- | --- | --- |
| 4 | `> 本 Runbook 合并 execute-btw.md U10（8 步）与 execute-wallpaper.md §5 U14（12 步）。` | `> 本 Runbook 合并 execute-btw.md U10（8 步）与 .workspace/reports/execs/wallpaper/execute-wallpaper.md §5 U` | ②证据 |  |
