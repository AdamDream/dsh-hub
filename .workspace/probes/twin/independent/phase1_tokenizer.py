"""Phase 1: tokenizer fingerprint via usage.prompt_tokens on controlled texts."""
import sys, json, hashlib, os
sys.path.insert(0,'.')
from probe_lib import post, save

MODELS = ["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]

TEXTS = {
 "t1_short_ascii": "Hello world.",
 "t2_medium_ascii": "The quick brown fox jumps over the lazy dog. " * 10,
 "t3_zh_short": "\u4f60\u597d\uff0c\u4e16\u754c\u3002",
 "t4_zh_medium": "\u4eba\u5de5\u667a\u80fd\u6b63\u5728\u6df1\u523b\u6539\u53d8\u6211\u4eec\u7684\u751f\u6d3b\u65b9\u5f0f\u3002" * 8,
 "t5_cjk_mixed": "\u7f16\u7801 coding \u6d4b\u8bd5 test \u6df7\u5408 mixed \u6587\u672c text 12345",
 "t6_numbers_code": "def f(x):\n    return x**2 + 1\nprint(f(42))",
 "t7_emoji_unicode": "Emoji \U0001F600\U0001F680\U0001F4A1 and symbols \u2192\u2260\u2211 \u00e9\u00e8\u00fc\u00f1",
 "t8_rare_unicode": "\u4f60\u597d\U0001F600\u4e16\u754c\u00a0\u2028\u200b\u0301\u0302\u0303\u0304",
}

# Each text must produce a deterministic, model-INDEPENDENT input prefix so that
# prompt_tokens differences reflect the tokenizer, not chat-template overhead.
# We measure two variants to separate template overhead from content encoding:
#   (a) raw text as the sole user message
#   (b) text repeated twice -> slope gives tokens-per-copy; intercept gives template cost
results = []
for m in MODELS:
    for name, txt in TEXTS.items():
        for rep in (1, 2):
            body = txt if rep == 1 else (txt + "\n" + txt)
            r = post("/chat/completions", {"model": m,
                     "messages":[{"role":"user","content": body}],
                     "temperature":0, "max_tokens": 8})
            rec = {"model": m, "text": name, "rep": rep,
                   "chars": len(body), "envelope_bytes": len(body.encode()),
                   "sha256_body": hashlib.sha256(body.encode()).hexdigest()[:16],
                   "status": r["status"], "elapsed": round(r["elapsed"],3),
                   "raw": r["raw"]}
            try:
                d = json.loads(r["raw"])
                rec["upstream_model"] = d.get("model")
                u = d.get("usage") or {}
                rec["prompt_tokens"] = u.get("prompt_tokens")
                rec["completion_tokens"] = u.get("completion_tokens")
            except Exception as e:
                rec["parse_error"] = repr(e)
            results.append(rec)
            print(m, name, "rep", rep, "pt=", rec.get("prompt_tokens"), "up=", rec.get("upstream_model"), flush=True)

save("raw_phase1_tokenizer.json", results)
print("saved", len(results))
