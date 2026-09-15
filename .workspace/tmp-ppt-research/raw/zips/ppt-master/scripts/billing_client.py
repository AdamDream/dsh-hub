#!/usr/bin/env python3
"""WorkBuddy PPT billing client, Python 3.10+ standard library only."""
import argparse
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib


class ClientError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def credential_dir():
    override = os.getenv("PPT_MASTER_CONFIG_DIR", "").strip()
    return Path(override).expanduser() if override else Path.home() / ".ppt-master"


def credential_file():
    return credential_dir() / "credentials.json"


def preference_file():
    return credential_dir() / "preferences.json"


def validate_api_key(value):
    key = str(value or "").strip()
    if not key.startswith("pcw_") or not key.isascii() or not 20 <= len(key) <= 100 or any(c.isspace() for c in key):
        raise ClientError("使用密钥格式不正确，请回到密钥页面重新复制。")
    return key


def api_key_source():
    if os.getenv("WRITER_API_KEY", "").strip():
        return "environment"
    if credential_file().is_file():
        return "local_config"
    return "none"


def api_key_status():
    try:
        return {
            "key_configured": bool(load_api_key()),
            "key_source": api_key_source(),
            "key_error": None,
        }
    except ClientError as exc:
        return {
            "key_configured": False,
            "key_source": api_key_source(),
            "key_error": str(exc),
        }


def welcome_seen():
    try:
        payload = json.loads(preference_file().read_text(encoding="utf-8"))
        return payload.get("welcome_seen") is True
    except (FileNotFoundError, OSError, UnicodeError, ValueError, json.JSONDecodeError):
        return False


def load_api_key():
    environment_key = os.getenv("WRITER_API_KEY", "").strip()
    if environment_key:
        return validate_api_key(environment_key)
    try:
        payload = json.loads(credential_file().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ""
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        raise ClientError("本机账号连接信息不可读，请重新运行 PPT大师连接向导。") from None
    return validate_api_key(payload.get("api_key", ""))


def save_api_key(value):
    key = validate_api_key(value)
    target_dir = credential_dir()
    target = credential_file()
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    target_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.chmod(target_dir, 0o700)
    except OSError:
        pass
    temporary.write_text(json.dumps({"api_key": key}, ensure_ascii=False) + "\n", encoding="utf-8")
    try:
        os.chmod(temporary, 0o600)
    except OSError:
        pass
    os.replace(temporary, target)
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass
    return target


def service_config():
    config = Path(__file__).resolve().parent.parent / "service.json"
    return json.loads(config.read_text(encoding="utf-8")) if config.exists() else {}


def checked_url(value):
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 for c in value):
        raise ClientError("服务地址格式不正确。")
    url = urllib.parse.urlparse(value)
    if not url.hostname or (url.scheme != "https" and not (
        url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost"}
    )):
        raise ClientError("服务地址必须是 HTTPS；只有本机测试地址可以使用 HTTP。")
    if (url.username or url.password or url.query or url.fragment
            or not re.fullmatch(r"(?:/[A-Za-z0-9_-]+)*/?", url.path)):
        raise ClientError("服务地址不能带凭据、查询参数、片段或不安全的路径。")
    try:
        url.port
    except ValueError:
        raise ClientError("服务地址端口不正确。") from None
    return value


def base_url():
    default = service_config().get("base_url", "http://127.0.0.1:8765")
    return checked_url(os.getenv("WRITER_BASE_URL", default)).rstrip("/")


def account_urls(base):
    config = service_config()
    configured = config.get("website_url") if base == str(config.get("base_url", "")).rstrip("/") else None
    fallback = base + ("/" if urllib.parse.urlparse(base).path else "/recharge")
    recharge = checked_url(os.getenv("WRITER_WEBSITE_URL", configured or fallback))
    return recharge + "#keys", recharge


def request(base, path, payload=None, api_key=None):
    keys_url, recharge_url = account_urls(base)
    key = validate_api_key(api_key) if api_key is not None else load_api_key()
    if not key:
        raise ClientError(
            "PPT大师已经安装成功，还差一次账号连接即可开始。"
            "请打开 PPT大师本机连接向导，按页面完成注册、创建密钥和测试连接。"
            f"也可以先到 {recharge_url} 注册，再到 {keys_url} 创建使用密钥。"
            "密钥只保存在自己的电脑上，不要发到聊天、日志或公开 Skill 中。"
        )
    req = urllib.request.Request(base + path, headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }, data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        messages = {
            401: f"API Key 无效或已撤销，请到 {keys_url} 检查。",
            402: f"当前点数不足。本次没有继续生成或重复扣点，请到 {recharge_url} 查看余额和充值方案后再试。",
            403: "没有执行此操作的权限。",
            404: "记录不存在或不属于当前账户。",
            409: "原报价、任务或交付文件状态冲突，请查询原任务；不要自动新建扣点任务。",
            413: "文件过大，未接受本次请求。",
            422: "页数、文件或请求不符合已确认的规则，本次未结算。",
            429: "请求过于频繁或未完成任务过多，请稍后查询原任务。",
            503: "PPT 计费服务尚未开放，请联系服务管理员。",
        }
        raise ClientError(f"HTTP {exc.code}：" + messages.get(exc.code, "服务响应异常，请查询原任务状态。")) from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise ClientError("网络或响应状态不明。请查询原任务，或用原报价、原幂等键重试；不能据此判断已扣点或已退点。") from None


def read_goal(path):
    goal_path = Path(path)
    if goal_path.stat().st_size > 2_000_000:
        raise ClientError("goal.json 过大，请先检查文件。")
    goal = json.loads(goal_path.read_text(encoding="utf-8"))
    if not isinstance(goal, dict):
        raise ClientError("最终 goal.json 顶层必须是对象。")
    delivery = goal.get("delivery")
    if delivery is not None:
        if not isinstance(delivery, dict):
            raise ClientError("goal.json 的 delivery 必须是对象。")
        unknown = sorted(set(delivery) - {"watermark"})
        if unknown:
            raise ClientError("goal.json 的 delivery 包含未知字段：" + "、".join(unknown))
    return goal


def goal_pages(path):
    goal = read_goal(path)
    slides = goal.get("slides")
    page_count = goal.get("pageCount")
    if not isinstance(slides, list) or not slides or type(page_count) is not int:
        raise ClientError("最终 goal.json 必须包含非空 slides 和整数 pageCount。")
    if page_count != len(slides):
        raise ClientError("goal.json 的 pageCount 与 slides 实际数量不一致。")
    if not 1 <= page_count <= 100:
        raise ClientError("PPT 页数必须在1至100之间。")
    return page_count


def expected_html_watermark(path):
    goal = read_goal(path)
    delivery = goal.get("delivery") or {}
    watermark = delivery.get("watermark", True)
    if type(watermark) is not bool:
        raise ClientError("goal.json 的 delivery.watermark 必须为 true 或 false。")
    return "show" if watermark else "hide"


class DeckHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.deck_depth = None
        self.deck_count = 0
        self.slide_count = 0
        self.watermark = ""

    def handle_starttag(self, tag, attrs):
        normalized = tag.lower()
        values = {str(key).lower(): value or "" for key, value in attrs}
        if normalized == "html":
            self.watermark = values.get("data-ppt-master-watermark", "").lower()
        if values.get("id") == "deck":
            self.deck_count += 1
            self.deck_depth = len(self.stack)
        if (self.deck_depth is not None and len(self.stack) == self.deck_depth + 1
                and normalized == "section"
                and "slide" in values.get("class", "").split()):
            self.slide_count += 1
        self.stack.append(normalized)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack:
            self.stack.pop()

    def handle_endtag(self, tag):
        normalized = tag.lower()
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index] == normalized:
                del self.stack[index:]
                break


def read_text_artifact(path):
    artifact = Path(path).resolve()
    if not artifact.is_file() or artifact.is_symlink():
        raise ClientError("交付文件不存在或不允许使用符号链接。")
    if artifact.stat().st_size > 50_000_000:
        raise ClientError("HTML 交付文件超过50MB，请先精简或改用带资源目录的版本。")
    return artifact.read_text(encoding="utf-8")


def validate_html_artifact(path):
    artifact = Path(path).resolve()
    source = read_text_artifact(artifact)
    parser = DeckHTMLParser()
    parser.feed(source)
    parser.close()
    if parser.deck_count != 1 or parser.slide_count < 1:
        raise ClientError("HTML 必须包含唯一的 #deck，且页面必须是它的直接 slide 子节点。")
    if parser.watermark not in {"show", "hide"}:
        raise ClientError("HTML 缺少有效的水印策略标记，请重新渲染。")
    verify_html_local_assets(source, artifact.parent)
    return {"pages": parser.slide_count, "watermark": parser.watermark}


def verify_html_local_assets(source, root):
    candidates = re.findall(
        r'''\b(?:src|href|poster)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)''',
        source,
        flags=re.I,
    )
    for match in candidates:
        value = unescape(next((item for item in match if item), "")).strip().replace("\\/", "/")
        if not value or re.match(r"^(?:data:|blob:|https?:|#|mailto:|tel:)", value, re.I):
            continue
        value = urllib.parse.unquote(value.split("?", 1)[0].split("#", 1)[0]).lstrip("/")
        while value.startswith("./"):
            value = value[2:]
        if not value.startswith(("assets/", "images/", "uploads/")):
            continue
        parts = Path(value).parts
        if ".." in parts:
            raise ClientError("HTML 包含不安全的本地资源路径。")
        target = root.joinpath(*parts)
        if not target.is_file() or target.is_symlink():
            raise ClientError(f"HTML 引用的本地资源缺失：{value}")


def validate_pptx_artifact(path):
    artifact = Path(path).resolve()
    if not artifact.is_file() or artifact.is_symlink() or not zipfile.is_zipfile(artifact):
        raise ClientError("PPTX 不是有效的 Office 演示文件。")
    try:
        with zipfile.ZipFile(artifact) as archive:
            if artifact.stat().st_size > 250_000_000 or sum(item.file_size for item in archive.infolist()) > 500_000_000:
                raise ClientError("PPTX 文件过大或解压后体积异常，请先精简内容。")
            names = set(archive.namelist())
            required = {"[Content_Types].xml", "ppt/presentation.xml"}
            if not required.issubset(names):
                raise ClientError("PPTX 缺少必要的演示结构。")
            slides = sorted(name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name))
            if not slides:
                raise ClientError("PPTX 中没有幻灯片页面。")
            bad_member = archive.testzip()
            if bad_member:
                raise ClientError(f"PPTX 压缩内容损坏：{bad_member}")
            watermark_hits = sum(
                archive.read(name).decode("utf-8", errors="ignore").count("PPT大师")
                for name in slides
            )
    except (OSError, zipfile.BadZipFile, RuntimeError):
        raise ClientError("PPTX 文件损坏或无法读取。") from None
    return {"pages": len(slides), "watermark_hits": watermark_hits}


def inflated_pdf_streams(source):
    for match in re.finditer(rb"stream\r?\n([\s\S]*?)\r?\nendstream", source):
        header = source[max(0, match.start() - 500):match.start()]
        if b"/FlateDecode" not in header:
            continue
        try:
            yield zlib.decompress(match.group(1))
        except zlib.error:
            continue


def validate_pdf_artifact(path):
    artifact = Path(path).resolve()
    if not artifact.is_file() or artifact.is_symlink():
        raise ClientError("PDF 交付文件不存在或不允许使用符号链接。")
    if artifact.stat().st_size > 250_000_000:
        raise ClientError("PDF 文件超过250MB，请先精简内容。")
    source = artifact.read_bytes()
    if not source.startswith(b"%PDF-") or b"%%EOF" not in source[-4096:]:
        raise ClientError("PDF 不是有效的 PDF 文件。")
    page_pattern = re.compile(rb"/Type\s*/Page(?!s)\b")
    pages = len(page_pattern.findall(source))
    for stream in inflated_pdf_streams(source):
        pages += len(page_pattern.findall(stream))
    if pages < 1:
        raise ClientError("无法确认 PDF 的真实页数，请使用 PPT大师重新导出。")
    return {"pages": pages}


def raw_file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def delivery_report_path(path):
    return Path(str(Path(path).resolve()) + ".ppt-master.json")


def validate_delivery_report(path, kind, pages, expected_watermark):
    report_path = delivery_report_path(path)
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ClientError(
            f"{kind.upper()} 缺少 PPT大师导出校验清单，请从预览页或官方导出命令重新导出。"
        ) from None
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        raise ClientError("PPT大师导出校验清单损坏，请重新导出。") from None
    if (report.get("version") != 1
            or report.get("artifact_kind") != kind
            or report.get("pages") != pages
            or report.get("watermark") != expected_watermark
            or report.get("file_sha256") != raw_file_sha256(path)):
        raise ClientError("导出校验清单与交付文件不一致，请重新导出后再结算。")
    return report


def validate_task_authorization(task_id, pages, allowed_billing=("reserved", "settled")):
    if not task_id or len(str(task_id)) > 200:
        raise ClientError("无水印正式交付需要有效的本次计费任务 ID。")
    safe_task = urllib.parse.quote(str(task_id), safe="")
    receipt = request(base_url(), "/api/tasks/" + safe_task)
    if (receipt.get("service_type") != "ppt"
            or receipt.get("billing") not in set(allowed_billing)
            or receipt.get("state") not in {"awaiting_content", "succeeded"}):
        raise ClientError("本次任务尚未成功预留或结算，不能生成无水印正式交付件。")
    for field in ("actual_pages", "reserved_pages", "quoted_pages", "pages", "page_count"):
        value = receipt.get(field)
        if type(value) is int and value != pages:
            raise ClientError("计费任务页数与 goal.json 不一致，请取消原任务后重新报价。")
    return receipt


def artifact_kind(path):
    suffix = Path(path).suffix.lower()
    kinds = {".html": "html", ".pptx": "pptx", ".pdf": "pdf"}
    if suffix not in kinds:
        raise ClientError("交付文件只能是 HTML、PPTX 或 PDF。")
    return kinds[suffix]


def artifact_sha256(path):
    artifact = Path(path).resolve()
    if not artifact.is_file() or artifact.is_symlink():
        raise ClientError("交付文件不存在或不允许使用符号链接。")
    digest = hashlib.sha256()
    files = [artifact]
    root = artifact.parent
    if artifact.suffix.lower() == ".html":
        assets = root / "assets"
        if assets.exists():
            if assets.is_symlink() or not assets.is_dir():
                raise ClientError("HTML 资源目录不安全。")
            files.extend(p for p in sorted(assets.rglob("*")) if p.is_file())
    total = 0
    for file in files:
        if file.is_symlink():
            raise ClientError("交付内容中不允许使用符号链接。")
        size = file.stat().st_size
        total += size
        if total > 250_000_000:
            raise ClientError("交付文件总大小超过250MB，请先精简资源。")
        relative = file.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(size.to_bytes(8, "big"))
        with file.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def inspect_artifact(goal, artifact, task_id=None, verify_task=True):
    expected_pages = goal_pages(goal)
    expected_watermark = expected_html_watermark(goal)
    kind = artifact_kind(artifact)
    if kind == "html":
        details = validate_html_artifact(artifact)
    elif kind == "pptx":
        details = validate_pptx_artifact(artifact)
        validate_delivery_report(artifact, kind, details["pages"], expected_watermark)
    else:
        details = validate_pdf_artifact(artifact)
        validate_delivery_report(artifact, kind, details["pages"], expected_watermark)
    if details["pages"] != expected_pages:
        raise ClientError("交付文件真实页数与 goal.json 不一致，请重新渲染或导出。")
    if kind == "html" and details["watermark"] != expected_watermark:
        raise ClientError("HTML 的水印策略与 goal.json 不一致，请重新渲染后再结算。")
    if kind == "pptx":
        if expected_watermark == "hide" and details["watermark_hits"]:
            raise ClientError("PPTX 仍包含固定“PPT大师”水印，请重新导出。")
        if expected_watermark == "show" and details["watermark_hits"] < expected_pages:
            raise ClientError("PPTX 未完整保留每页品牌水印，请重新导出。")
    if expected_watermark == "hide" and verify_task:
        validate_task_authorization(task_id, expected_pages)
    return {
        "pages": expected_pages,
        "artifact_sha256": artifact_sha256(artifact),
        "artifact_kind": kind,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="WorkBuddy 本地 PPT 生成、墨序后台计费客户端")
    sub = parser.add_subparsers(dest="command", required=True)
    quote = sub.add_parser("quote", help="只报 PPT 页数，获取单价和预留点数，不扣点")
    quote.add_argument("--pages", type=int)
    reserve = sub.add_parser("reserve", aliases=["submit"], help="用户确认费用后预留点数")
    reserve.add_argument("--quote", required=True)
    reserve.add_argument("--idempotency-key", required=True)
    reserve.add_argument("--confirm", action="store_true", required=True)
    for name in ("status", "result", "cancel"):
        command = sub.add_parser(name)
        command.add_argument("--task", required=True)
        if name == "cancel":
            command.add_argument("--confirm", action="store_true", required=True)
    for name in ("inspect", "settle", "deliver"):
        command = sub.add_parser(name)
        command.add_argument("--goal", required=True, help="最终 goal.json")
        command.add_argument("--artifact", required=True, help="最终 index.html、.pptx 或 .pdf")
        if name != "inspect":
            command.add_argument("--task", required=True)
        else:
            command.add_argument("--task", help="无水印正式交付对应的已预留任务 ID")
        if name == "settle":
            command.add_argument("--confirm", action="store_true", required=True)
    sub.add_parser("balance")
    sub.add_parser("info", help="显示服务与充值入口，不显示 API Key")
    authorize = sub.add_parser("authorize", help="渲染无水印正式交付件前核对已预留任务")
    authorize.add_argument("--goal", required=True)
    authorize.add_argument("--task")
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect":
            result = inspect_artifact(args.goal, args.artifact, args.task)
        else:
            base = base_url()
            if args.command == "info":
                keys_url, recharge_url = account_urls(base)
                result = {
                    "service": base,
                    "keys_url": keys_url,
                    "recharge_url": recharge_url,
                    **api_key_status(),
                    "welcome_seen": welcome_seen(),
                    "generation_location": "workbuddy",
                    "service_type": "ppt",
                }
            elif args.command == "authorize":
                pages = goal_pages(args.goal)
                if expected_html_watermark(args.goal) == "show":
                    result = {"authorized": True, "paid_task_required": False, "pages": pages, "watermark": "show"}
                else:
                    receipt = validate_task_authorization(args.task, pages, allowed_billing=("reserved",))
                    result = {
                        "authorized": True,
                        "paid_task_required": True,
                        "task": str(args.task),
                        "pages": pages,
                        "watermark": "hide",
                        "billing": receipt.get("billing"),
                        "state": receipt.get("state"),
                    }
            elif args.command == "quote":
                result = request(base, "/api/ppt/quotes", {"pages": args.pages})
            elif args.command in {"reserve", "submit"}:
                result = request(base, "/api/tasks", {
                    "quote_id": args.quote,
                    "idempotency_key": args.idempotency_key,
                    "confirmed": True,
                })
            elif args.command == "balance":
                result = request(base, "/api/me")
            else:
                path = "/api/tasks/" + urllib.parse.quote(args.task, safe="")
                if args.command == "cancel":
                    result = request(base, path + "/cancel", {"confirmed": True})
                elif args.command == "settle":
                    result = request(base, path + "/settle-ppt", inspect_artifact(args.goal, args.artifact, args.task))
                elif args.command == "deliver":
                    checked = inspect_artifact(args.goal, args.artifact, args.task)
                    receipt = request(base, path + "/result")
                    if (receipt.get("billing") != "settled" or receipt.get("state") != "succeeded"
                            or receipt.get("service_type") != "ppt"
                            or receipt.get("actual_pages") != checked["pages"]
                            or receipt.get("content_sha256") != checked["artifact_sha256"]
                            or receipt.get("artifact_kind") != checked["artifact_kind"]):
                        raise ClientError("尚未结算或本地 PPT 与已结算交付件不同，不能交付。")
                    result = {"verified": True, "artifact": str(Path(args.artifact).resolve()), **checked}
                else:
                    result = request(base, path + ("/result" if args.command == "result" else ""))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ClientError, OSError, UnicodeError, ValueError, KeyError, json.JSONDecodeError) as exc:
        message = str(exc) if isinstance(exc, ClientError) else "配置、goal.json 或交付文件不可读，请检查路径和 UTF-8 编码。"
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
