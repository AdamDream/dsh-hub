# 04-Runbook —— pptmaster 组合部署与运维手册

> 部署对象：① ppt-master skill（pn1024 6.1.0 直拷，`~/.dsh/skills/ppt-master`）＋ ② dsh-pptmaster 插件（dsh-workbuddy-ppt 0.1.0 port，`@local/dsh-pptmaster`）。
> 基线：DSH 0.1.1-rc.2（`dsh --version`）、Node v22.23.2、Python 3.12.3 + pip 24.0、profile `web`。
> staging 根：`/home/CNS2026495165/dsh/.workspace/deploy-pptmaster/`（下文以 `$STAGE` 代指）。

## 0. install 顺序总览

```
预检 → ① skill（install-skill.sh） → ② 插件（copy + 依赖 + cordis.patch） → 验证 → 重启 dsh web
```

一键方式：`$STAGE/scripts/deploy.sh --profile web`（内部严格按 skill → 插件顺序）。
下文为手工步骤（含每条验证命令）。

---

## 1. 预检

```bash
dsh --version                          # 期望 0.1.1-rc.2
node --version                         # 期望 v22.23.2（插件要求 ^22.19 || >=24）
python3 -m pip --version               # 期望 24.0
python3 -c "import pptx"               # 期望失败（本机未装）——第 2 步装
grep -c "ppt" ~/.dsh/skills/ 2>/dev/null || true   # 确认目前无 ppt skill
```

## 2. ① skill 主线（A）：ppt-master

```bash
# 完整安装（幂等：旧目录备份为 ~/.dsh/skills/ppt-master.bak-<ts>；guard 部署前后双冒烟；pip 装依赖）
$STAGE/scripts/install-skill.sh --python python3
# 可选：--pip-args "--user"（用户级安装）；或先建 venv：
#   python3 -m venv ~/.venvs/ppt-master && ~/.venvs/ppt-master/bin/pip install -r $STAGE/skills/ppt-master/requirements.txt
```

**验证（skill 可用性）**
```bash
# guard 完整性门禁（部署位实跑，exit 0 才算过）
python3 ~/.dsh/skills/ppt-master/scripts/attribution_guard.py && echo OK
# 或复用脚本的 verify-only：
$STAGE/scripts/install-skill.sh --verify-only --python python3
# python-pptx 可用（核心导出硬依赖）
python3 -c "import pptx; print(pptx.__version__)"
# SKILL.md 元数据（DSH 要求 name+description，kebab-case）
head -8 ~/.dsh/skills/ppt-master/SKILL.md
# 冒烟帮助
python3 ~/.dsh/skills/ppt-master/scripts/svg_to_pptx.py --help | head
```

**生效**：skill-filesystem 热发现 `~/.dsh/skills/`，无需重启即可进目录；重启更稳妥。新会话 `<available_skills>` 应含 `ppt-master`。

## 3. ② 插件辅线（B）：@local/dsh-pptmaster

### 3.1 拷贝进 profile（二选一）

```bash
# 方式 A（推荐，dsh CLI 转发 pnpm）：
dsh plugin --profile web add $STAGE/plugin/dsh-pptmaster

# 方式 B（手工，与现有 @local/dsh-btw 一致）：
mkdir -p ~/.dsh/profiles/node_modules/@local
cp -r $STAGE/plugin/dsh-pptmaster ~/.dsh/profiles/node_modules/@local/dsh-pptmaster
```

### 3.2 运行时依赖（profile node_modules 实测缺 pptxgenjs / @aiden0z/pptx-renderer / typescript）

```bash
cd ~/.dsh/profiles/web && pnpm install --no-frozen-lockfile
# 或只装缺的：
cd ~/.dsh/profiles/web && pnpm add pptxgenjs@^4.0.1 @aiden0z/pptx-renderer@1.2.4 typescript@^6.0.3
# 验证：
node -e "console.log(require.resolve('pptxgenjs'))"        # 期望命中 profile node_modules
node -e "console.log(require.resolve('@aiden0z/pptx-renderer'))"
```

### 3.3 cordis.patch.yml 追加（若 CLI 未自动写入）

```bash
# 先备份，再追加（等价内容）：
cp ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/profiles/web/cordis.patch.yml.bak-pptmaster-$(date +%Y%m%d-%H%M%S)
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<'EOF'
- insert:
    - id: dsh-pptmaster
      name: '@local/dsh-pptmaster'
      config:
        root: !!js dshHomePath('office-ppt')
EOF
```

### 3.4 验证（插件）

```bash
node --check ~/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/index.js
node --check ~/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/client.js
node --check ~/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/invariant.js
node -e "import('file://' + process.env.HOME + '/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/index.js').then(() => console.log('plugin module loads'))"
grep -n "name: 'dsh-pptmaster'\|name: '@local/dsh-pptmaster'" ~/.dsh/profiles/web/cordis.patch.yml
```

## 4. 端到端验证（重启后）

1. 重启 dsh web（`web` profile），新开会话。
2. **skill 侧**：确认 `<available_skills>` 目录含 `ppt-master`；用 `skill` 工具按名加载返回 `{name, provider, resourceBase, content}`；按 SKILL.md 纪律首跑 `attribution_guard.py`。
3. **插件侧**：模型提示词应含 `pptmaster_scene_check` / `pptmaster_scene_create` / `pptmaster_list_templates` / `pptmaster_get_template_pages` / `pptmaster_create` / `pptmaster_update_slide`；目录含 `workbuddy-ppt` / `ppt-template-fidelity` 内置 skill。
4. **图片衔接**：btw（或其它生图工具）产图落工作区 `images/` → 场景 `assets.source_path` 指该文件 → check/create 通过（hash 绑定防篡改）。
5. **产物**：`{工作区}/{safeTitle}.pptx` 可见；`~/.dsh/office-ppt/` 有 session 隔离的中间工程。
6. （可选）`dsh-pptd screenshot` 出 SVG/PNG 无头预览。

## 5. settings 键说明（插件 Config schema，lib/index.js L81953-81982）

| 键 | 默认 | 说明 |
|---|---|---|
| `root` | `dshHomePath('office-ppt')`（cordis.patch 注入） | 状态/工程根（session 隔离的 decks/projects/outputs） |
| `maxUploadBytes` | 32 MiB | 上传（模板/素材）上限 |
| `maxZipEntries` | 4000 | OOXML 解包条目上限 |
| `maxZipEntryBytes` | 4 MiB | 单条目解包上限 |
| `maxUncompressedBytes` | 256 MiB | 解包总膨胀上限 |
| `maxSlides` | 40 | 单 deck 页数上限 |
| `maxDecksPerSession` | 50 | 会话 deck 数上限 |
| `maxTemplatesPerSession` | 20 | 会话模板数上限 |
| `maxActivities` | 200 | 活动记录上限 |
| `workbuddyRuntimeRoot` | `<root>/runtime` | SlideP/Tencent 运行时根（**默认不要求**） |
| `requireWorkbuddyRuntime` | false | 为 true 时启动即 `assertAvailable()` |
| `workbuddyNodeExecutable` | `node` | 子进程 node |
| `workbuddyPreferredPort` | 39099 | SlideP 端口 |
| `workbuddyPortScanAttempts` | 100 | 端口扫描上限 |
| `workbuddyReadinessTimeoutMs` | 60000 / `workbuddyValidationTimeoutMs` 30000 / `workbuddyRenderTimeoutMs` 180000 / `workbuddySubprocessGraceMs` 2000 | 子进程超时族 |
| `workbuddyOutputMaxBytes` | 4 MiB / `workbuddyValidationConcurrency` 4 | 输出上限 / 并发 |
| `workbuddyEditorCorsOrigins` | `[]` | 编辑器 CORS |
| `workbuddyMaxJsxBytesPerPage` | 256 KiB / `workbuddyMaxStoryBytes` 256 KiB / `workbuddyMaxDesignBytes` 256 KiB / `workbuddyMaxAssetBytes` 16 MiB / `workbuddyMaxTotalAssetBytes` 128 MiB | 工程字节上限族 |
| `workbuddyPptSkillRoot` | 内置 `skills/workbuddy-ppt`（env `DSH_WORKBUDDY_PPT_SKILL_ROOT` 可覆盖） | 写作 skill 根 |
| `pptDesignSystemRoot` | 未设置（env `DSH_PPT_DESIGN_SYSTEM_ROOT` 可覆盖） | 设计系统库根（operator 用 `scripts/stage-design-systems.mjs` 编排后才启用 `ppt-design-systems`/`ppt-style-*`） |

> PPTD 路由开箱即用，无需任何 settings 变更；Slides（tencent-pptx）路由默认关闭（runtime 未 staging、`requireWorkbuddyRuntime=false`）。

## 6. 回滚

### 6.1 skill
```bash
# 备份目录已由 install-skill.sh 生成：~/.dsh/skills/ppt-master.bak-<ts>
rm -rf ~/.dsh/skills/ppt-master
mv ~/.dsh/skills/ppt-master.bak-<ts> ~/.dsh/skills/ppt-master   # 恢复旧版
# 或整体删除（回到无 skill 状态）
rm -rf ~/.dsh/skills/ppt-master
```

### 6.2 插件
```bash
# 移除 cordis insert 行（用第 3.3 步的备份还原）
cp ~/.dsh/profiles/web/cordis.patch.yml.bak-pptmaster-<ts> ~/.dsh/profiles/web/cordis.patch.yml
# 移除插件目录
rm -rf ~/.dsh/profiles/node_modules/@local/dsh-pptmaster
# 如需卸载其引入的依赖：cd ~/.dsh/profiles/web && pnpm install --no-frozen-lockfile（按 lock 收敛）
```

### 6.3 状态数据（可选清理）
```bash
rm -rf ~/.dsh/office-ppt   # 插件中间工程（回滚可不删，不影响恢复）
```

## 7. 备注与边界

- skill 是 guard 锁定内容：**不可本地改任何 gate 文件/SKILL.md 标记行/LICENSE**，否则自停（升级=整体重拷整目录）。
- 双 DSL 不互通：同一 deck 勿混用 skill 的 SVG/design_spec 与插件的 PPTD 场景。
- 与 btw 的 imageDir 约定见 `03-integration.md`（btw vision 管线未落地，当前生效的是工作区图片消费侧）。
- 明确排除项（不装）：`@ljwei-stak/ppt-master-for-mgr`（peer 与 0.1.1-rc.2 冲突）、SkillHub 付费 `PPT可编辑大师`（Proprietary+计费）、`zbsph/dsh-ppt-studio`（基线 0.1.5-rc.2）。
