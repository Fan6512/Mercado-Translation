from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
app_path = root / 'src' / 'app.js'
app = app_path.read_text(encoding='utf-8')

required = [
    "document.getElementById('btnTranslate').addEventListener('click'",
    'function renderOutput(',
    'function saveHistory(',
    '部分语种生成失败，已保留成功结果',
    '跳过不完整结果，不写入历史记录',
    'if (!item || !item.title) continue;',
]
missing = [marker for marker in required if marker not in app]
if missing:
    raise SystemExit('refusing repair: recovered app is incomplete: ' + ', '.join(missing))

# The known-good app predates the final dependency cleanup, so two declarations now
# correctly owned by lower-level modules must be removed from app.js after recovery.
strip_pattern = re.compile(
    r"\n?// 去除 markdown 代码块包裹:[\s\S]*?^function stripCodeFence\(text\) \{[\s\S]*?^\}\n?",
    re.MULTILINE,
)
app, strip_count = strip_pattern.subn('\n', app, count=1)
if strip_count != 1:
    raise SystemExit(f'expected exactly one stripCodeFence block, removed {strip_count}')

lang_pattern = re.compile(
    r"^const LANG_EN_NAME = \{ en: 'English', es: 'Español', pt: 'Português', zh: '中文' \};\n?",
    re.MULTILINE,
)
app, lang_count = lang_pattern.subn('', app, count=1)
if lang_count != 1:
    raise SystemExit(f'expected exactly one LANG_EN_NAME declaration, removed {lang_count}')

if 'function stripCodeFence' in app:
    raise SystemExit('stripCodeFence still present in app.js')
if 'const LANG_EN_NAME' in app:
    raise SystemExit('LANG_EN_NAME still present in app.js')

app_path.write_text(app, encoding='utf-8')
print('final app repair applied')
