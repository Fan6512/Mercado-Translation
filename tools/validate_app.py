from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
index = (root / "index.html").read_text(encoding="utf-8")
launcher = (root / "启动翻译工具.bat").read_text(encoding="utf-8")
compat = (root / "启动翻译工具(兼容模式).bat").read_text(encoding="utf-8")
css = root / "tailwind.min.css"
app_path = root / "src" / "app.js"
adapter_path = root / "src" / "api" / "provider-adapters.js"
app = app_path.read_text(encoding="utf-8") if app_path.exists() else ""
adapter = adapter_path.read_text(encoding="utf-8") if adapter_path.exists() else ""

checks = {
    "runtime Tailwind CDN removed": "cdn.tailwindcss.com" not in index,
    "local Tailwind CSS linked": './tailwind.min.css' in index,
    "local Tailwind CSS exists": css.exists() and css.stat().st_size > 1000,
    "default launcher keeps Web Security": "--disable-web-security" not in launcher,
    "compat launcher is explicit opt-in": "--disable-web-security" in compat,
    "external app script loaded": './src/app.js' in index and app_path.exists(),
    "provider adapter loaded before app": index.find('./src/api/provider-adapters.js') < index.find('./src/app.js'),
    "inline application script removed": '// ===== 默认全局 Prompt =====' not in index,
    "robust SSE parser present": "const consumeEvent = (rawEvent) =>" in app,
    "partial-result guard present": "部分语种生成失败，已保留成功结果" in app,
    "partial results not written to history": "跳过不完整结果，不写入历史记录" in app,
    "incremental render skips missing languages": "if (!item || !item.title) continue;" in app,
    "main request uses provider adapter": "ProviderAdapters.buildChatRequest(s," in app,
    "connection test uses provider adapter": "ProviderAdapters.buildChatRequest(p," in app,
    "adapter exposes generic fallback": "return 'generic';" in adapter,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("OK   " if ok else "FAIL ") + name)
if failed:
    raise SystemExit("static validation failed: " + ", ".join(failed))

for js_path in (adapter_path, app_path):
    result = subprocess.run(["node", "--check", str(js_path)], text=True, capture_output=True)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        raise SystemExit(f"JavaScript syntax validation failed: {js_path}")
    print(f"OK   JavaScript syntax: {js_path.relative_to(root)}")
