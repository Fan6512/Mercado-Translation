from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
index = (root / "index.html").read_text(encoding="utf-8")
launcher = (root / "启动翻译工具.bat").read_text(encoding="utf-8")
compat = (root / "启动翻译工具(兼容模式).bat").read_text(encoding="utf-8")
css = root / "tailwind.min.css"

checks = {
    "runtime Tailwind CDN removed": "cdn.tailwindcss.com" not in index,
    "local Tailwind CSS linked": './tailwind.min.css' in index,
    "local Tailwind CSS exists": css.exists() and css.stat().st_size > 1000,
    "default launcher keeps Web Security": "--disable-web-security" not in launcher,
    "compat launcher is explicit opt-in": "--disable-web-security" in compat,
    "robust SSE parser present": "const consumeEvent = (rawEvent) =>" in index,
    "partial-result guard present": "部分语种生成失败，已保留成功结果" in index,
    "partial results not written to history": "跳过不完整结果，不写入历史记录" in index,
    "incremental render skips missing languages": "if (!item || !item.title) continue;" in index,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("OK   " if ok else "FAIL ") + name)
if failed:
    raise SystemExit("static validation failed: " + ", ".join(failed))

# Extract the inline application script and ask Node to parse it. This is a syntax-only
# check: DOM APIs are not executed, so it is safe in CI and catches broken edits early.
scripts = re.findall(r"<script(?:\s[^>]*)?>([\s\S]*?)</script>", index, flags=re.I)
inline = [s for s in scripts if s.strip()]
if not inline:
    raise SystemExit("no inline application script found")

with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
    f.write("\n".join(inline))
    temp_js = f.name

result = subprocess.run(["node", "--check", temp_js], text=True, capture_output=True)
if result.returncode != 0:
    print(result.stdout)
    print(result.stderr)
    raise SystemExit("JavaScript syntax validation failed")
print("OK   JavaScript syntax")
