#!/usr/bin/env python3
"""Generate mapping.json for the Track-D reorg (READ-ONLY against the repo).

The mapping is built from explicit tables below, then mechanically verified:
 - every root-level *.md in the repo appears exactly once,
 - every top-level entry of /.workspace/ appears exactly once,
 - every `from` exists on disk,
 - no duplicate `to`.
"""
import json, os, subprocess, sys

ROOT = "/home/CNS2026495165/dsh"
WS = ".workspace"

# ---------------------------------------------------------------- root docs
# file -> (target, renamed)
ROOT_DOCS = {
    # === Tier 3 evidence: audits ===
    "audit-btw.md":                      (f"{WS}/reports/audits/btw/audit-btw.md", False),
    "audit-btw-model.md":                (f"{WS}/reports/audits/btw/audit-btw-model.md", False),
    "audit-btw-subagent.md":             (f"{WS}/reports/audits/btw/audit-btw-subagent.md", False),
    "audit-subagent-arch-A.md":          (f"{WS}/reports/audits/subagent/audit-subagent-arch-A.md", False),
    "audit-subagent-arch-B.md":          (f"{WS}/reports/audits/subagent/audit-subagent-arch-B.md", False),
    "audit-wallpaper.md":                (f"{WS}/reports/audits/wallpaper/audit-wallpaper.md", False),
    "audit-upstream-upgrade.md":         (f"{WS}/reports/audits/upstream/audit-upstream-upgrade.md", False),
    "audit-local-customizations.md":     (f"{WS}/reports/audits/machine/audit-local-customizations.md", False),
    # === Tier 3 evidence: exec / review ===
    "execute-btw.md":                    (f"{WS}/reports/execs/btw/execute-btw.md", False),
    "execution-btw-model.md":            (f"{WS}/reports/execs/btw/execution-btw-model.md", False),
    "execute-wallpaper.md":              (f"{WS}/reports/execs/wallpaper/execute-wallpaper.md", False),
    "review-btw.md":                     (f"{WS}/reports/execs/btw/review-btw.md", False),
    "review-wallpaper.md":               (f"{WS}/reports/execs/wallpaper/review-wallpaper.md", False),
    "execution-2b.md":                   (f"{WS}/reports/execs/subagent/execution-2b.md", False),
    "execution-subagent-tokps.md":       (f"{WS}/reports/execs/subagent/execution-subagent-tokps.md", False),
    # === Tier 3 reference / plans ===
    "btw-wallpaper-plan.md":             (f"{WS}/reports/plans/btw-wallpaper-plan.md", False),
    "wiring-plan.md":                    (f"{WS}/reports/plans/wiring-plan.md", False),
    "local-api-surface.md":              (f"{WS}/reports/reference/local-api-surface.md", False),
    # === Tier 1 runbooks ===
    "switch-web2-runbook.md":            ("docs/runbooks/switch-web2-runbook.md", False),
    "verify-runbook.md":                 ("docs/runbooks/verify-runbook.md", False),
    # === port manuals: 用户裁决把 port-* 与 runbook 同归「手册层 docs/runbooks/」===
    # （准备档原方案曾放 reports/ports/ 作为"移植记录"证据；主 agent 按用户显式裁决纠正）
    "port-taste.md":                     ("docs/runbooks/port-taste.md", False),
    "port-tokps-web2.md":                ("docs/runbooks/port-tokps-web2.md", False),
    "port-vision-adam.md":               ("docs/runbooks/port-vision-adam.md", False),
    "port-wallpaper.md":                 ("docs/runbooks/port-wallpaper.md", False),
    # === stay at repo root (human entry points / capability index / style charter) ===
    "README.md":                         ("README.md", False),
    "FEATURE-MAP.md":                    ("FEATURE-MAP.md", False),
    "DOC-STYLE.md":                      ("DOC-STYLE.md", False),
}

# ------------------------------------------------------- .workspace top level
R = f"{WS}/reports"
P = f"{WS}/probes"
W = f"{WS}/workstreams"
B = f"{WS}/backups"

WS_ENTRIES = {
    # --- evidence .md -> reports/ ---
    "acceptance-exec.md":                 (f"{R}/execs/acceptance/acceptance-exec.md", False),
    "RESTART-ACCEPTANCE.md":              (f"{R}/execs/acceptance/RESTART-ACCEPTANCE.md", False),
    "audit-a-lagfix.md":                  (f"{R}/audits/lagfix/audit-a-lagfix.md", False),
    "audit-b-btw.md":                     (f"{R}/audits/btw/audit-b-btw.md", False),
    "audit-c-usage-vision.md":            (f"{R}/audits/usage-vision/audit-c-usage-vision.md", False),
    "audit-d-plugins.md":                 (f"{R}/audits/plugins/audit-d-plugins.md", False),
    "borrow-015-exec.md":                 (f"{R}/execs/borrow-015/borrow-015-exec.md", False),
    "borrow-015-groupA-exec.md":          (f"{R}/execs/borrow-015/borrow-015-groupA-exec.md", False),
    "borrow-015-groupB-exec.md":          (f"{R}/execs/borrow-015/borrow-015-groupB-exec.md", False),
    "borrow-015-groupC-exec.md":          (f"{R}/execs/borrow-015/borrow-015-groupC-exec.md", False),
    "btw-image-pipeline-audit.md":        (f"{R}/audits/btw/btw-image-pipeline-audit.md", False),
    "btw-live-stream-audit.md":           (f"{R}/audits/btw/btw-live-stream-audit.md", False),
    "btw-model-v41-exec.md":              (f"{R}/execs/btw/btw-model-v41-exec.md", False),
    "btw-open-p0-diagnosis.md":           (f"{R}/diagnostics/btw/btw-open-p0-diagnosis.md", False),
    "btw-p0-exec.md":                     (f"{R}/execs/btw/btw-p0-exec.md", False),
    "btw-request-images-explained.md":    (f"{R}/reference/btw-request-images-explained.md", False),
    "btw-ui-batch-exec.md":               (f"{R}/execs/btw/btw-ui-batch-exec.md", False),
    "btw-ui-exec.md":                     (f"{R}/execs/btw/btw-ui-exec.md", False),
    "btw-ui-gap-audit.md":                (f"{R}/audits/btw/btw-ui-gap-audit.md", False),
    "btw-upgrade-audit.md":               (f"{R}/audits/btw/btw-upgrade-audit.md", False),
    "btw-upgrade-impl-audit.md":          (f"{R}/audits/btw/btw-upgrade-impl-audit.md", False),
    "btw-upgrade-impl-exec.md":           (f"{R}/execs/btw/btw-upgrade-impl-exec.md", False),
    "btw-upgrade-impl-exec-patches.md":   (f"{R}/execs/btw/btw-upgrade-impl-exec-patches.md", False),
    "btw-upgrade-plan.md":                (f"{R}/plans/btw/btw-upgrade-plan.md", False),
    "btw-usage-ui-audit.md":              (f"{R}/audits/btw/btw-usage-ui-audit.md", False),
    "btw-v2-runbook.md":                  (f"{R}/runbooks/btw-v2-runbook.md", False),
    "combined-restore-runbook.md":        (f"{R}/runbooks/combined-restore-runbook.md", False),
    "distributed-control-exec.md":        (f"{R}/execs/distributed/distributed-control-exec.md", False),
    "doc-restructure-exec.md":            (f"{R}/execs/docs/doc-restructure-exec.md", False),
    "dsh-workerspace-research.md":        (f"{R}/research/dsh-workerspace-research.md", False),
    "final-audit-a-patches.md":           (f"{R}/audits/final/final-audit-a-patches.md", False),
    "final-audit-b-plugins.md":           (f"{R}/audits/final/final-audit-b-plugins.md", False),
    "final-audit-c-config.md":            (f"{R}/audits/final/final-audit-c-config.md", False),
    "final-audit-d-distributed.md":       (f"{R}/audits/final/final-audit-d-distributed.md", False),
    "glm53-flash-image-smoke.md":         (f"{R}/research/glm53-flash-image-smoke.md", False),
    "goal-p0a-exec.md":                   (f"{R}/execs/goal/goal-p0a-exec.md", False),
    "goal-pending-subagent-exec.md":      (f"{R}/execs/goal/goal-pending-subagent-exec.md", False),
    "goal-round-gap-audit.md":            (f"{R}/audits/goal/goal-round-gap-audit.md", False),
    "hotreload-a-loader.md":              (f"{R}/research/hotreload/hotreload-a-loader.md", False),
    "hotreload-b-inventory.md":           (f"{R}/research/hotreload/hotreload-b-inventory.md", False),
    "hotreload-c-upstream.md":            (f"{R}/research/hotreload/hotreload-c-upstream.md", False),
    "hotreload-e-design.md":              (f"{R}/research/hotreload/hotreload-e-design.md", False),
    "incident-piai-model-selection.md":   (f"{R}/incidents/incident-piai-model-selection.md", False),
    "lag-audit-diff.md":                  (f"{R}/audits/lagfix/lag-audit-diff.md", False),
    "lag-audit-mechanism.md":             (f"{R}/audits/lagfix/lag-audit-mechanism.md", False),
    "lag-fix-audit.md":                   (f"{R}/audits/lagfix/lag-fix-audit.md", False),
    "lag-fix-exec.md":                    (f"{R}/execs/lagfix/lag-fix-exec.md", False),
    "lag-fix-guard.md":                   (f"{R}/execs/lagfix/lag-fix-guard.md", False),
    "lag-fix-runbook.md":                 (f"{R}/runbooks/lag-fix-runbook.md", False),
    "lowrisk-fix-exec.md":                (f"{R}/execs/lagfix/lowrisk-fix-exec.md", False),
    "master-runbook.md":                  (f"{R}/runbooks/master-runbook.md", False),
    "opencode-deepseek-v4-flash-probe.md": (f"{R}/research/opencode-deepseek-v4-flash-probe.md", False),
    "p0a-patch-hmr-exec.md":              (f"{R}/execs/p0-hotload/p0a-patch-hmr-exec.md", False),
    "p0b-settings-switch-exec.md":        (f"{R}/execs/p0-hotload/p0b-settings-switch-exec.md", False),
    "p0c-restart-helper-exec.md":         (f"{R}/execs/p0-hotload/p0c-restart-helper-exec.md", False),
    "p1-hotswap-gate-exec.md":            (f"{R}/execs/p0-hotload/p1-hotswap-gate-exec.md", False),
    "pptmaster-exec.md":                  (f"{R}/execs/pptmaster/pptmaster-exec.md", False),
    "pptmaster-research.md":              (f"{R}/research/pptmaster/pptmaster-research.md", False),
    "pptmaster-skill-research.md":        (f"{R}/research/pptmaster/pptmaster-skill-research.md", False),
    "slot-mod-audit.md":                  (f"{R}/audits/slots/slot-mod-audit.md", False),
    "ssh-gui-audit.md":                   (f"{R}/audits/ssh-gui/ssh-gui-audit.md", False),
    "ssh-gui-exec.md":                    (f"{R}/execs/ssh-gui/ssh-gui-exec.md", False),
    "subagent-model-gui-audit.md":        (f"{R}/audits/subagent-model/subagent-model-gui-audit.md", False),
    "subagent-model-settings-exec.md":    (f"{R}/execs/subagent-model/subagent-model-settings-exec.md", False),
    "upstream-015-diff.md":               (f"{R}/audits/upstream/upstream-015-diff.md", False),
    "upstream-borrow-validation.md":      (f"{R}/audits/upstream/upstream-borrow-validation.md", False),
    "usage-chart-audit.md":               (f"{R}/audits/usage/usage-chart-audit.md", False),
    "usage-chart-restart-acceptance.md":  (f"{R}/execs/acceptance/usage-chart-restart-acceptance.md", False),
    "usage-heatmap-exec.md":              (f"{R}/execs/usage/usage-heatmap-exec.md", False),
    "usage-tooltip-exec.md":              (f"{R}/execs/usage/usage-tooltip-exec.md", False),
    "vision-exp-probe.md":                (f"{R}/research/vision/vision-exp-probe.md", False),
    "vision-flash-test.md":               (f"{R}/research/vision/vision-flash-test.md", False),
    "vision-prompt-exec.md":              (f"{R}/execs/vision/vision-prompt-exec.md", False),
    "vision-settings-capability-exec.md": (f"{R}/execs/vision/vision-settings-capability-exec.md", False),
    "workerspace-exec.md":                (f"{R}/execs/workerspace/workerspace-exec.md", False),
    "workspace-plugins-deep-research.md": (f"{R}/research/workspace-plugins-deep-research.md", False),
    # --- handoff / logs ---
    "NEXT_SESSION_PROMPT.txt":            (f"{R}/handoff/NEXT_SESSION_PROMPT.txt", False),
    "push-log.txt":                       (f"{R}/push-logs/push-log.txt", False),
    "push-log2.txt":                      (f"{R}/push-logs/push-log2.txt", False),
    # --- one-shot probe captures (was loose at .workspace/ root) ---
    "glm53_image.json":                   (f"{P}/captures/glm53_image.json", False),
    "glm53_text.json":                    (f"{P}/captures/glm53_text.json", False),
    "models_fresh.json":                  (f"{P}/captures/models_fresh.json", False),
    "models_list.json":                   (f"{P}/captures/models_list.json", False),
    "oc_models.json":                     (f"{P}/captures/oc_models.json", False),
    "oc_models_v41_probe.json":           (f"{P}/captures/oc_models_v41_probe.json", False),
    "oc_req_v41_image.json":              (f"{P}/captures/oc_req_v41_image.json", False),
    "oc_req_v41_text.json":               (f"{P}/captures/oc_req_v41_text.json", False),
    "oc_req_vexp2_image.json":            (f"{P}/captures/oc_req_vexp2_image.json", False),
    "oc_req_vexp_image.json":             (f"{P}/captures/oc_req_vexp_image.json", False),
    "oc_req_vexp_text.json":              (f"{P}/captures/oc_req_vexp_text.json", False),
    "oc_resp_v41_image.json":             (f"{P}/captures/oc_resp_v41_image.json", False),
    "oc_resp_v41_text.json":              (f"{P}/captures/oc_resp_v41_text.json", False),
    "oc_resp_vexp2_image.json":           (f"{P}/captures/oc_resp_vexp2_image.json", False),
    "oc_resp_vexp_image.json":            (f"{P}/captures/oc_resp_vexp_image.json", False),
    "oc_resp_vexp_text.json":             (f"{P}/captures/oc_resp_vexp_text.json", False),
    "req1_image.json":                    (f"{P}/captures/req1_image.json", False),
    "req1b_bigbudget.json":               (f"{P}/captures/req1b_bigbudget.json", False),
    "req2_text.json":                     (f"{P}/captures/req2_text.json", False),
    "req_a_rawb64.json":                  (f"{P}/captures/req_a_rawb64.json", False),
    "req_b_image.json":                   (f"{P}/captures/req_b_image.json", False),
    "req_gem_ctrl.json":                  (f"{P}/captures/req_gem_ctrl.json", False),
    "req_vexp_ctrl.json":                 (f"{P}/captures/req_vexp_ctrl.json", False),
    "req_vexp_image.json":                (f"{P}/captures/req_vexp_image.json", False),
    "req_vexp_text.json":                 (f"{P}/captures/req_vexp_text.json", False),
    "resp1_raw.json":                     (f"{P}/captures/resp1_raw.json", False),
    "resp1b.json":                        (f"{P}/captures/resp1b.json", False),
    "resp2_raw.json":                     (f"{P}/captures/resp2_raw.json", False),
    "resp_a.json":                        (f"{P}/captures/resp_a.json", False),
    "resp_b.json":                        (f"{P}/captures/resp_b.json", False),
    "resp_gem_ctrl.json":                 (f"{P}/captures/resp_gem_ctrl.json", False),
    "resp_vexp_ctrl.json":                (f"{P}/captures/resp_vexp_ctrl.json", False),
    "resp_vexp_image.json":               (f"{P}/captures/resp_vexp_image.json", False),
    "resp_vexp_text.json":                (f"{P}/captures/resp_vexp_text.json", False),
    "v4f-test.png":                       (f"{P}/captures/v4f-test.png", False),
    # --- settings snapshots ---
    "settings-after-fix.json":            (f"{P}/settings-snapshots/settings-after-fix.json", False),
    "settings-fixed-test.json":           (f"{P}/settings-snapshots/settings-fixed-test.json", False),
    "settings-live-check.json":           (f"{P}/settings-snapshots/settings-live-check.json", False),
    "settings-live-final.json":           (f"{P}/settings-snapshots/settings-live-final.json", False),
    "settings-sim-final.json":            (f"{P}/settings-snapshots/settings-sim-final.json", False),
    "settings-sim-new.json":              (f"{P}/settings-snapshots/settings-sim-new.json", False),
    "settings-sim-old.json":              (f"{P}/settings-snapshots/settings-sim-old.json", False),
    "settings-snapshot.json":             (f"{P}/settings-snapshots/settings-snapshot.json", False),
    # --- one-shot workflow drivers / diagnostics ---
    "btw-wf-v2.cjs":                      (f"{P}/workflow-drivers/btw-wf-v2.cjs", False),
    "btw-wf-v2.mjs":                      (f"{P}/workflow-drivers/btw-wf-v2.mjs", False),
    "lag-fix-wf.mjs":                     (f"{P}/workflow-drivers/lag-fix-wf.mjs", False),
    "workflow-2phase-template.mjs":       (f"{P}/workflow-drivers/workflow-2phase-template.mjs", False),
    "diag-piai-route.mjs":                (f"{P}/workflow-drivers/diag-piai-route.mjs", False),
    "diag-settings-config.mjs":           (f"{P}/workflow-drivers/diag-settings-config.mjs", False),
    # --- legacy test debris (tracked) ---
    ".review-tmp":                        (f"{P}/legacy/review-tmp", True),
    ".tmp-boot3080.html":                 (f"{P}/legacy/tmp-boot3080.html", True),
    ".tmp-boot3080-plugin-restore.html":  (f"{P}/legacy/tmp-boot3080-plugin-restore.html", True),
    ".tmp-cordis.js":                     (f"{P}/legacy/tmp-cordis.js", True),
    ".tmp-inventory.js":                  (f"{P}/legacy/tmp-inventory.js", True),
    "dsh-index.html":                     (f"{P}/legacy/dsh-index.html", False),
    # --- probe / preview / lab directories ---
    "acceptance-probe":                   (f"{P}/acceptance", True),
    "mmt-probe":                          (f"{P}/mmt", True),
    "twin-probe":                         (f"{P}/twin", True),
    "heat-check":                         (f"{P}/heat-check", False),
    "p1-hotswap-lab":                     (f"{P}/hotswap-lab", True),
    "btw-ui-previews":                    (f"{P}/previews/btw-ui", True),
    "usage-tooltip-previews":             (f"{P}/previews/usage-tooltip", True),
    # appeared at 15:12 during this reorg (another track's vision capability probe)
    "vision-test":                        (f"{P}/vision-test", True),
    # --- backups: 14 currently-loose backup-* dirs (all gitignored) ---
    "backup-batch-20260914-142844":       (f"{B}/plugins/20260914-142844-batch", True),
    "backup-batch2-20260914-142947":      (f"{B}/plugins/20260914-142947-batch2", True),
    "backup-btw-20260917-170146":         (f"{B}/btw/20260917-170146", True),
    "backup-btw-20260917-172915":         (f"{B}/btw/20260917-172915", True),
    "backup-btw-deploy-20260912-165932":  (f"{B}/btw/20260912-165932-deploy", True),
    "backup-btw-deploy-20260912-180420-lib": (f"{B}/btw/20260912-180420-deploy-lib", True),
    "backup-config":                      (f"{B}/config", False),
    "backup-methodology-20260912-164548": (f"{B}/methodology/20260912-164548", True),
    "backup-methodology-20260912-164933": (f"{B}/methodology/20260912-164933", True),
    "backup-patched":                     (f"{B}/patched", False),
    "backup-plugins":                     (f"{B}/plugins/plugins", True),
    "backup-subagent-model-20260917-165928": (f"{B}/subagent-model/20260917-165928", True),
    "backup-usage-heatmap-20260914-094352":  (f"{B}/usage-heatmap/20260914-094352", True),
    "backup-ws-20260914-145449":          (f"{B}/workspace/20260914-145449", True),
    # --- workstreams: deploy batches (moved together to preserve ../sibling refs) ---
    "deploy":                             (f"{W}/deploy/deploy", False),
    "deploy-015":                         (f"{W}/deploy/deploy-015", False),
    "deploy-lag":                         (f"{W}/deploy/deploy-lag", False),
    "deploy-p0":                          (f"{W}/deploy/deploy-p0", False),
    "deploy-pptmaster":                   (f"{W}/deploy/deploy-pptmaster", False),
    "deploy-slots":                       (f"{W}/deploy/deploy-slots", False),
    "deploy-ssh-gui":                     (f"{W}/deploy/deploy-ssh-gui", False),
    "deploy-subagent-model":              (f"{W}/deploy/deploy-subagent-model", False),
    "deploy-vision-prompt":               (f"{W}/deploy/deploy-vision-prompt", False),
    "deploy-vision-settings":             (f"{W}/deploy/deploy-vision-settings", False),
    "deploy-workerspace":                 (f"{W}/deploy/deploy-workerspace", False),
    # --- workstreams: misc ---
    "baseline-011":                       (f"{W}/baseline-011", False),
    "dsh-usage-src":                      (f"{W}/sources/dsh-usage-src", True),
    "dsh-vision-adam-src":                (f"{W}/sources/dsh-vision-adam-src", True),
    "plugin-restore":                     (f"{W}/plugin-restore", False),
    "side-deploy":                        (f"{W}/side-deploy", False),
    "upstream-015-diff":                  (f"{W}/upstream-015-diff", False),
    "tmp-tgz-audit":                      (f"{W}/tmp-tgz-audit", False),
    "repos":                              (f"{W}/research/repos", True),
    "research-dsh-workerspace":           (f"{W}/research/research-dsh-workerspace", True),
    "research-luxweft-doc":               (f"{W}/research/research-luxweft-doc", True),
    "research":                           (f"{W}/research/research", True),
    "tmp-ppt-research":                   (f"{W}/research/tmp-ppt-research", True),
    "npm-cache":                          (f"{W}/npm-cache", False),
    # --- NOT MOVED in this phase ---
    # settings-lag/  : live workstream of another track (read-only reference for us)
    # lag-fix/       : live workstream of another track
    # docs-reorg/    : this task's own staging dir, deleted by the main agent after the move
}

KEEP_IN_PLACE = {
    f"{WS}/settings-lag": "另一条执行线正在使用的活动工作目录（本阶段只读参考，不移动）",
    f"{WS}/lag-fix": "另一条执行线正在使用的活动工作目录（不移动）",
    f"{WS}/docs-reorg": "本次 Track D 的暂存/交付目录；主 agent 搬移完成后自行删除",
}

# ------------------------------------------------------------------- verify
def build():
    rows = []
    for src, (dst, ren) in ROOT_DOCS.items():
        rows.append({"from": src, "to": dst, "kind": "root-doc", "renamed": ren})
    for src, (dst, ren) in WS_ENTRIES.items():
        rows.append({"from": f"{WS}/{src}", "to": dst, "kind": "workspace", "renamed": ren})
    for src, why in KEEP_IN_PLACE.items():
        rows.append({"from": src, "to": src, "kind": "keep", "renamed": False, "reason": why})
    return rows


def check(rows):
    problems = []
    # 1. every root *.md covered exactly once
    on_disk_root = sorted(f for f in os.listdir(ROOT)
                          if f.endswith(".md") and os.path.isfile(os.path.join(ROOT, f)))
    mapped_root = sorted(r["from"] for r in rows if r["kind"] == "root-doc")
    if on_disk_root != mapped_root:
        problems.append(f"root .md mismatch:\n  on disk only: {sorted(set(on_disk_root)-set(mapped_root))}\n"
                        f"  mapped only:  {sorted(set(mapped_root)-set(on_disk_root))}")
    # 2. every .workspace top-level entry covered exactly once
    on_disk_ws = sorted(os.listdir(os.path.join(ROOT, WS)))
    mapped_ws = sorted(os.path.basename(r["from"]) for r in rows if r["kind"] in ("workspace", "keep"))
    if on_disk_ws != mapped_ws:
        problems.append(f".workspace entry mismatch:\n  on disk only: {sorted(set(on_disk_ws)-set(mapped_ws))}\n"
                        f"  mapped only:  {sorted(set(mapped_ws)-set(on_disk_ws))}")
    # 3. every `from` exists
    for r in rows:
        if not os.path.exists(os.path.join(ROOT, r["from"])):
            problems.append(f"from does not exist: {r['from']}")
    # 4. no duplicate `to`
    seen = {}
    for r in rows:
        if r["kind"] == "keep":
            continue
        seen.setdefault(r["to"], []).append(r["from"])
    for dst, srcs in seen.items():
        if len(srcs) > 1:
            problems.append(f"duplicate to: {dst} <= {srcs}")
    # 5. no `to` that collides with an existing tracked path or an unmoved neighbour
    for r in rows:
        if r["kind"] == "keep" or r["to"] == r["from"]:
            continue
        if os.path.lexists(os.path.join(ROOT, r["to"])):
            problems.append(f"to already exists on disk: {r['to']}")
    return problems


def tracked(from_path):
    out = subprocess.run(["git", "ls-files", "--", from_path], cwd=ROOT,
                         capture_output=True, text=True).stdout
    return len([l for l in out.splitlines() if l.strip()])


if __name__ == "__main__":
    rows = build()
    for r in rows:
        if r["kind"] == "keep" or r["from"] == r["to"]:
            r["trackedFiles"] = tracked(r["from"])
            r["moveCmd"] = "none"
        else:
            n = tracked(r["from"])
            r["trackedFiles"] = n
            r["moveCmd"] = "git mv" if n > 0 else "mv"
    probs = check(rows)
    out = {"generatedFrom": "tools/gen_mapping.py", "repoRoot": ROOT, "entries": rows}
    with open(os.path.join(ROOT, WS, "docs-reorg", "mapping.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"entries: {len(rows)}  (root-doc {sum(1 for r in rows if r['kind']=='root-doc')}, "
          f"workspace {sum(1 for r in rows if r['kind']=='workspace')}, keep {sum(1 for r in rows if r['kind']=='keep')})")
    print(f"git mv: {sum(1 for r in rows if r['moveCmd']=='git mv')}   plain mv: {sum(1 for r in rows if r['moveCmd']=='mv')}"
          f"   keep/noop: {sum(1 for r in rows if r['moveCmd']=='none')}")
    if probs:
        print("PROBLEMS:")
        for p in probs:
            print(" -", p)
        sys.exit(1)
    print("VERIFY: OK (coverage complete, no duplicate targets, all sources exist)")
