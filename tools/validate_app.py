from pathlib import Path
import re
import subprocess
import tempfile

# Permanent CI guard for the security baseline and the final five-module structure.
# Keep this validator as the long-lived merge gate after one-shot migration tooling is removed.
# Any architecture change should update these invariants together with the code.
root = Path(__file__).resolve().parents[1]
index = (root / "index.html").read_text(encoding="utf-8")
launcher = (root / "启动翻译工具.bat").read_text(encoding="utf-8")
compat = (root / "启动翻译工具(兼容模式).bat").read_text(encoding="utf-8")
css = root / "tailwind.min.css"

core_path = root / "src" / "core" / "config.js"
adapter_path = root / "src" / "api" / "provider-adapters.js"
client_path = root / "src" / "api" / "client.js"
translation_path = root / "src" / "translation.js"
app_path = root / "src" / "app.js"

paths = [core_path, adapter_path, client_path, translation_path, app_path]
core = core_path.read_text(encoding="utf-8") if core_path.exists() else ""
adapter = adapter_path.read_text(encoding="utf-8") if adapter_path.exists() else ""
client = client_path.read_text(encoding="utf-8") if client_path.exists() else ""
translation = translation_path.read_text(encoding="utf-8") if translation_path.exists() else ""
app = app_path.read_text(encoding="utf-8") if app_path.exists() else ""

script_order = [
    './src/core/config.js',
    './src/api/provider-adapters.js',
    './src/api/client.js',
    './src/translation.js',
    './src/app.js',
]
script_positions = [index.find(src) for src in script_order]

# Never ship repository-provided credentials in the desktop/web bundle.
# User API keys must only enter via localStorage at runtime after the user types/imports them.
runtime_text = index + "\n" + "\n".join(p.read_text(encoding="utf-8") for p in paths if p.exists())
secret_patterns = {
    "OpenAI/OpenRouter/Anthropic-style API key": re.compile(r"\bsk-(?:ant-|or-v1-)?[A-Za-z0-9_-]{20,}\b"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    "GitHub token": re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
}
secret_hits = [name for name, pattern in secret_patterns.items() if pattern.search(runtime_text)]
nonempty_preset_key = re.search(r"\bkey\s*:\s*(['\"])(?!\1)[^'\"\r\n]+\1", core)
api_key_has_default_value = bool(re.search(r'id=["\']apiKey["\'][^>]*\bvalue\s*=\s*["\'][^"\']+', index))

checks = {
    "runtime Tailwind CDN removed": "cdn.tailwindcss.com" not in index,
    "local Tailwind CSS linked": './tailwind.min.css' in index,
    "local Tailwind CSS exists": css.exists() and css.stat().st_size > 1000,
    "default launcher keeps Web Security": "--disable-web-security" not in launcher,
    "compat launcher is explicit opt-in": "--disable-web-security" in compat,
    "all five scripts loaded": all(pos >= 0 for pos in script_positions) and all(p.exists() for p in paths),
    "five scripts load in dependency order": all(a < b for a, b in zip(script_positions, script_positions[1:])),
    "inline application script removed": '// ===== 默认全局 Prompt =====' not in index,
    "configuration lives in core": "const STORE =" in core and "const PROFILE_PRESETS =" in core,
    "repository presets contain no API key": nonempty_preset_key is None,
    "API key input has no bundled default value": not api_key_has_default_value,
    "runtime bundle contains no high-confidence secret pattern": not secret_hits,
    "adapter exposes generic fallback": "return 'generic';" in adapter,
    "robust SSE parser lives in client": "const consumeEvent = (rawEvent) =>" in client,
    "main request uses provider adapter": "ProviderAdapters.buildChatRequest(s," in client,
    "connection test uses provider adapter": "ProviderAdapters.buildChatRequest(p," in app,
    "API cleanup helper lives in client": "function stripCodeFence" in client and "function stripCodeFence" not in app,
    "language names live in translation": "const LANG_EN_NAME" in translation and "const LANG_EN_NAME" not in app,
    "translation entrypoint present": "document.getElementById('btnTranslate').addEventListener('click'" in app,
    "output renderer present": "function renderOutput(" in app,
    "history writer present": "function saveHistory(" in app,
    "compression flow present": "function shortenOverLimit(" in app and "MAX_SHORTEN_ROUNDS" in app,
    "run cancellation present": "function cancelRun(" in app and "AbortController" in app,
    "partial-result guard present": "部分语种生成失败，已保留成功结果" in app,
    "partial results not written to history": "跳过不完整结果，不写入历史记录" in app,
    "incremental render skips missing languages": "if (!item || !item.title) continue;" in app,
    "title count selector present": 'id="titleCount"' in index and '<option value="3">3 个</option>' in index,
    "route prompt supports title count": "function buildRoutePrompt(basePrompt, langs, titleCount = 1)" in translation and '"versions": [' in translation,
    "multi-title result compatibility present": "function getResultVersions(" in app and "function mergeRouteVersions(" in app,
    "multi-title history completeness guarded": "isCompleteTitleResult(result, record.titleCount ?? null)" in app,
    "desktop updater UI present": 'id="btnCheckUpdate"' in index and 'id="updateDialog"' in index,
    "desktop updater version placeholder present": "const APP_RELEASE_VERSION = '__APP_VERSION__';" in app,
    "desktop updater checks GitHub releases": "RELEASE_LATEST_API" in app and "checkForDesktopUpdate" in app,
    "desktop updater invokes native installer bridge": "download_and_install_update" in app,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("OK   " if ok else "FAIL ") + name)
if secret_hits:
    print("Secret scanner matched: " + ", ".join(secret_hits))
if failed:
    raise SystemExit("static validation failed: " + ", ".join(failed))

# Check every file independently first.
for js_path in paths:
    result = subprocess.run(["node", "--check", str(js_path)], text=True, capture_output=True)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        raise SystemExit(f"JavaScript syntax validation failed: {js_path}")
    print(f"OK   JavaScript syntax: {js_path.relative_to(root)}")

# Classic <script> files share one browser global lexical environment. Concatenating them
# in load order catches cross-file duplicate `const`/`let` declarations that individual
# node --check calls cannot see.
with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
    for js_path in paths:
        f.write(f"\n// ---- {js_path.relative_to(root)} ----\n")
        f.write(js_path.read_text(encoding="utf-8"))
        f.write("\n")
    combined_js = f.name

combined = subprocess.run(["node", "--check", combined_js], text=True, capture_output=True)
if combined.returncode != 0:
    print(combined.stdout)
    print(combined.stderr)
    raise SystemExit("Combined classic-script syntax validation failed")
print("OK   Combined classic-script syntax")
