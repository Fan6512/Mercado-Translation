# Medium-granularity module refinement: keep responsibilities clear without over-splitting.
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'src' / 'app.js'
INDEX = ROOT / 'index.html'
CORE = ROOT / 'src' / 'core' / 'config.js'
API = ROOT / 'src' / 'api' / 'client.js'
TRANS = ROOT / 'src' / 'translation.js'

app = APP.read_text(encoding='utf-8')
index = INDEX.read_text(encoding='utf-8')

# Idempotent: if the target files and script tags already exist, just validate.
if CORE.exists() and API.exists() and TRANS.exists() and './src/core/config.js' in index and './src/api/client.js' in index and './src/translation.js' in index:
    print('medium-granularity module split already applied')
    raise SystemExit(0)

# 1) Move configuration constants/store/model code as one contiguous block.
marker = '// ===== 渲染配置 UI ====='
pos = app.find(marker)
if pos < 0:
    raise SystemExit('config split marker not found')
core_text = app[:pos].rstrip() + '\n'
app = app[pos:]
CORE.parent.mkdir(parents=True, exist_ok=True)
CORE.write_text(core_text, encoding='utf-8')

# Helpers for safely extracting top-level function declarations by name.
def find_function_block(src: str, name: str):
    m = re.search(r'(?m)^(?:async\s+)?function\s+' + re.escape(name) + r'\s*\(', src)
    if not m:
        raise SystemExit(f'function not found: {name}')
    start = m.start()
    # Find the function-body brace after the closing parameter paren. This avoids
    # mistaking default-object params such as `({ timeoutMs = 0 } = {})` for the body.
    body = re.search(r'\)\s*\{', src[m.end():])
    if not body:
        raise SystemExit(f'opening brace not found: {name}')
    brace = m.end() + body.end() - 1

    i = brace
    depth = 0
    state = 'code'
    quote = ''
    template_expr_depth = 0
    while i < len(src):
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if state == 'code':
            if c in ('\"', "'"):
                state, quote = 'string', c
            elif c == '`':
                state, quote = 'template', c
            elif c == '/' and n == '/':
                state = 'line_comment'; i += 1
            elif c == '/' and n == '*':
                state = 'block_comment'; i += 1
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    while end < len(src) and src[end] in ' \t': end += 1
                    if end < len(src) and src[end] == ';': end += 1
                    while end < len(src) and src[end] in '\r\n': end += 1
                    return start, end, src[start:end].rstrip() + '\n'
        elif state == 'string':
            if c == '\\':
                i += 1
            elif c == quote:
                state = 'code'
        elif state == 'template':
            if c == '\\':
                i += 1
            elif c == '`' and template_expr_depth == 0:
                state = 'code'
            elif c == '$' and n == '{':
                template_expr_depth += 1; i += 1
            elif c == '}' and template_expr_depth > 0:
                template_expr_depth -= 1
        elif state == 'line_comment':
            if c in '\r\n': state = 'code'
        elif state == 'block_comment':
            if c == '*' and n == '/': state = 'code'; i += 1
        i += 1
    raise SystemExit(f'unclosed function: {name}')


def extract_functions(src: str, names):
    blocks = []
    spans = []
    for name in names:
        start, end, text = find_function_block(src, name)
        spans.append((start, end, name))
        blocks.append((name, text))
    # Remove from back to front so positions remain valid.
    for start, end, _ in sorted(spans, reverse=True):
        src = src[:start] + src[end:]
    ordered = '\n'.join(text for _, text in blocks).rstrip() + '\n'
    return src, ordered

# 2) Network transport/retry/SSE concerns live together.
api_names = [
    'applyProxyPrefix', 'buildApiUrl', 'makeRequestGate', 'normalizeFetchError',
    'backoffDelayMs', 'sleep', 'shouldRetry', 'fetchJsonWithRetry', 'callAI',
]
app, api_text = extract_functions(app, api_names)
API.write_text('// Network transport layer: URL/proxy, timeout, retry, SSE and AI calls.\n\n' + api_text, encoding='utf-8')

# 3) Pure translation helpers live together; DOM orchestration stays in app.js.
translation_names = ['countChars', 'stripPromptComments', 'buildRoutePrompt']
app, translation_text = extract_functions(app, translation_names)
TRANS.write_text('// Translation-domain helpers kept DOM-free for easier testing and reuse.\n\n' + translation_text, encoding='utf-8')

APP.write_text(app.lstrip(), encoding='utf-8')

old_tags = '<script src="./src/api/provider-adapters.js"></script>\n<script src="./src/app.js"></script>'
new_tags = '''<script src="./src/core/config.js"></script>
<script src="./src/api/provider-adapters.js"></script>
<script src="./src/api/client.js"></script>
<script src="./src/translation.js"></script>
<script src="./src/app.js"></script>'''
if old_tags not in index:
    raise SystemExit('index script tag anchor not found')
index = index.replace(old_tags, new_tags, 1)
INDEX.write_text(index, encoding='utf-8')

print('medium-granularity module split applied')
