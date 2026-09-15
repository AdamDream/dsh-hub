#!/usr/bin/env python3
"""Cross-platform PPT大师 render entrypoint."""
import os
from pathlib import Path
import shutil
import subprocess
import sys


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent


def executable(name):
    candidates = [name + ".cmd", name] if os.name == "nt" else [name]
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError(f"未找到 {name}，请先安装 Node.js 18+。")


def run(command, cwd=None, env=None):
    subprocess.run(command, cwd=cwd, env=env, check=True)


def main(argv=None):
    args = list(argv or sys.argv[1:])
    if len(args) not in {2, 3}:
        print("Usage: render_goal_deck.py <goal-spec.json> <output/ppt/index.html> [billing-task-id]", file=sys.stderr)
        return 2

    caller = Path.cwd()
    spec = (caller / args[0]).resolve() if not Path(args[0]).is_absolute() else Path(args[0]).resolve()
    output = (caller / args[1]).resolve() if not Path(args[1]).is_absolute() else Path(args[1]).resolve()
    task_id = args[2] if len(args) == 3 else ""
    stage = "核对水印与计费任务"
    try:
        authorize = [sys.executable, str(SCRIPT_DIR / "billing_client.py"), "authorize", "--goal", str(spec)]
        if task_id:
            authorize.extend(["--task", task_id])
        run(authorize)

        stage = "准备本地 PPT 引擎"
        run([sys.executable, str(SCRIPT_DIR / "prepare_runtime.py")])
        override = os.getenv("PPT_MASTER_PROJECT_ROOT", "").strip()
        project = Path(override).expanduser().resolve() if override else SKILL_ROOT / "project"
        npm = executable("npm")
        env = {**os.environ, "INIT_CWD": str(caller)}

        output.parent.mkdir(parents=True, exist_ok=True)
        stage = "检查内容结构"
        print("PPT大师生成中 · 1/5 检查页面内容", flush=True)
        run([npm, "run", "props:safe", "--", "--goal", str(spec), "--write"], cwd=project, env=env)
        run([npm, "run", "validate:goal-spec", "--", str(spec)], cwd=project, env=env)
        stage = "生成可编辑演示"
        print("PPT大师生成中 · 2/5 组合页面与视觉风格", flush=True)
        run([npm, "run", "render:goal", "--", str(spec), str(output)], cwd=project, env=env)
        stage = "检查交付质量"
        print("PPT大师生成中 · 3/5 检查页面和素材", flush=True)
        run([npm, "run", "validate:swiss", "--", str(output)], cwd=project, env=env)
        run([npm, "run", "validate:goal-copy", "--", str(spec), str(output)], cwd=project, env=env)
        stage = "启动本机预览"
        print("PPT大师生成中 · 4/5 启动本机编辑预览", flush=True)
        port = os.getenv("PPT_MASTER_PREVIEW_PORT", "5580")
        run([npm, "run", "preview:start", "--", str(output.parent), port], cwd=project, env=env)
        print("PPT大师生成中 · 5/5 已完成，可在上方地址预览和导出", flush=True)
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        detail = f"{exc}" if not isinstance(exc, subprocess.CalledProcessError) else "请根据上方提示处理后重试。"
        print(f"PPT大师生成未完成：{stage}失败。若本次已预留点数，请释放原任务预留后再重试。{detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
