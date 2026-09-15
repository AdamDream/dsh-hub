#!/usr/bin/env python3
"""Cross-platform first-run preparation for PPT大师."""
import base64
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent


def executable(name):
    candidates = [name + ".cmd", name] if os.name == "nt" else [name]
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError(f"未找到 {name}，请先安装 Node.js 18+（安装包会同时提供 npm）。")


def run(command, cwd=None):
    subprocess.run(command, cwd=cwd, check=True)


def restore_project():
    project = SKILL_ROOT / "project"
    if (project / "package.json").is_file():
        return project

    archive = SKILL_ROOT / "project-runtime.tar.gz"
    temporary_name = None
    if not archive.is_file():
        parts = sorted(SKILL_ROOT.glob("project-runtime.part*.txt"))
        if not parts:
            raise RuntimeError("PPT大师运行资源缺失：未找到 project-runtime 文本分片。")
        with tempfile.NamedTemporaryFile(prefix="ppt-master-runtime-", suffix=".tar.gz", delete=False) as temporary:
            encoded = "".join(part.read_text(encoding="utf-8").strip() for part in parts)
            temporary.write(base64.b64decode(encoded, validate=True))
            temporary_name = temporary.name
        archive = Path(temporary_name)

    try:
        if project.exists():
            shutil.rmtree(project)
        root = SKILL_ROOT.resolve()
        with tarfile.open(archive, "r:gz") as bundle:
            for member in bundle.getmembers():
                target = (root / member.name).resolve()
                if root not in target.parents and target != root:
                    raise RuntimeError("PPT大师运行包包含不安全路径。")
                if member.issym() or member.islnk():
                    raise RuntimeError("PPT大师运行包不能包含符号链接。")
            if sys.version_info >= (3, 12):
                bundle.extractall(root, filter="data")
            else:
                bundle.extractall(root)
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)

    if not (project / "package.json").is_file():
        raise RuntimeError("PPT大师运行包恢复失败：未找到 project/package.json。")
    return project


def main():
    stage = "检查本地生成组件"
    try:
        print("PPT大师准备中 · 1/3 检查本地生成组件", flush=True)
        override = os.getenv("PPT_MASTER_PROJECT_ROOT", "").strip()
        project = Path(override).expanduser().resolve() if override else restore_project()
        package_file = project / "package.json"
        lock_file = project / "package-lock.json"
        if not package_file.is_file() or not lock_file.is_file():
            raise RuntimeError("PPT 运行目录缺少 package.json 或 package-lock.json。")

        npm = executable("npm")
        node = executable("node")
        node_modules = project / "node_modules"
        installed_lock = node_modules / ".package-lock.json"
        stage = "安装编辑与导出组件"
        if not node_modules.is_dir():
            print("PPT大师准备中 · 2/3 首次安装编辑与导出组件（只需一次）", flush=True)
            run([npm, "ci", "--prefer-offline", "--no-audit", "--no-fund", "--loglevel=error"], cwd=project)
        elif (not installed_lock.is_file()
              or package_file.stat().st_mtime > installed_lock.stat().st_mtime
              or lock_file.stat().st_mtime > installed_lock.stat().st_mtime):
            print("PPT大师准备中 · 2/3 更新本地组件", flush=True)
            run([npm, "install", "--prefer-offline", "--no-audit", "--no-fund", "--loglevel=error"], cwd=project)
        else:
            print("PPT大师准备中 · 2/3 本地组件已就绪", flush=True)

        stage = "自检运行组件"
        run([node, "-e", "require(process.argv[1])", str(project / "node_modules" / "react")], cwd=project)
        print("PPT大师准备中 · 3/3 本地 PPT 引擎已就绪", flush=True)
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError, tarfile.TarError, ValueError) as exc:
        detail = f"{exc}" if not isinstance(exc, subprocess.CalledProcessError) else "请检查网络、Node.js 18+ 和 npm 后重试。"
        print(f"PPT大师准备未完成：{stage}失败。{detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
