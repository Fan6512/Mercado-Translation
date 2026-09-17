from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
index_path = root / "index.html"
app_path = root / "src" / "app.js"
adapter_path = root / "src" / "api" / "provider-adapters.js"

html = index_path.read_text(encoding="utf-8")

# 1) Move the single large inline application script out of index.html.
if not app_path.exists():
    pattern = re.compile(r"\n<script>\n(?P<js>// ===== 默认全局 Prompt =====[\s\S]*?)\n</script>\n\n</body>", re.M)
    m = pattern.search(html)
    if not m:
        raise SystemExit("inline application script marker not found; refusing partial migration")
    app_path.parent.mkdir(parents=True, exist_ok=True)
    app_path.write_text(m.group("js").rstrip() + "\n", encoding="utf-8")
    replacement = '\n<script src="./src/api/provider-adapters.js"></script>\n<script src="./src/app.js"></script>\n\n</body>'
    html = html[:m.start()] + replacement + html[m.end():]
    index_path.write_text(html, encoding="utf-8")
else:
    if './src/app.js' not in html or './src/api/provider-adapters.js' not in html:
        raise SystemExit("src/app.js exists but index.html does not load both external scripts")

if not adapter_path.exists():
    raise SystemExit("provider adapter file missing")

app = app_path.read_text(encoding="utf-8")

# 2) Route the connection-test fallback through the same adapter as production calls.
old_test = "body: JSON.stringify({ model: p.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),"
new_test = "body: JSON.stringify(ProviderAdapters.buildChatRequest(p, { stream: false, maxTokens: 1, messages: [{ role: 'user', content: 'ping' }] })),"
if old_test in app:
    app = app.replace(old_test, new_test, 1)
elif new_test not in app:
    raise SystemExit("testConnection request body target not found")

# 3) Route normal chat/completions payload construction through provider adapter.
old_call = """body: JSON.stringify({
            model: s.model,
            temperature: opts.temperature ?? s.temp,
            max_tokens: opts.maxTokens ?? s.maxTokens,
            stream: useStream,
            messages,
          }),"""
new_call = """body: JSON.stringify(ProviderAdapters.buildChatRequest(s, {
            messages,
            stream: useStream,
            temperature: opts.temperature ?? s.temp,
            maxTokens: opts.maxTokens ?? s.maxTokens,
          })),"""
if old_call in app:
    app = app.replace(old_call, new_call, 1)
elif new_call not in app:
    raise SystemExit("callAI request body target not found")

app_path.write_text(app, encoding="utf-8")

# Final invariants.
checks = {
    "index loads adapter before app": html.find('./src/api/provider-adapters.js') < html.find('./src/app.js'),
    "inline app removed": '// ===== 默认全局 Prompt =====' not in html,
    "main request uses adapter": 'ProviderAdapters.buildChatRequest(s,' in app,
    "test request uses adapter": 'ProviderAdapters.buildChatRequest(p,' in app,
}
failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("OK   " if ok else "FAIL ") + name)
if failed:
    raise SystemExit("refactor validation failed: " + ", ".join(failed))
