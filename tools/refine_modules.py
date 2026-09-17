from pathlib import Path
import re

# Final one-shot dependency-boundary cleanup before merge.
ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'src' / 'app.js'
CLIENT = ROOT / 'src' / 'api' / 'client.js'
TRANSLATION = ROOT / 'src' / 'translation.js'

app = APP.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
translation = TRANSLATION.read_text(encoding='utf-8')


def find_function_block(src: str, name: str):
    m = re.search(r'(?m)^(?:async\s+)?function\s+' + re.escape(name) + r'\s*\(', src)
    if not m:
        return None

    i = m.end()
    paren_depth = 1
    state = 'code'
    quote = ''
    while i < len(src):
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if state == 'code':
            if c in ('"', "'"):
                state, quote = 'string', c
            elif c == '`':
                state = 'template'
            elif c == '/' and n == '/':
                state = 'line_comment'; i += 1
            elif c == '/' and n == '*':
                state = 'block_comment'; i += 1
            elif c == '(':
                paren_depth += 1
            elif c == ')':
                paren_depth -= 1
                if paren_depth == 0:
                    break
        elif state == 'string':
            if c == '\\': i += 1
            elif c == quote: state = 'code'
        elif state == 'template':
            if c == '\\': i += 1
            elif c == '`': state = 'code'
        elif state == 'line_comment':
            if c == '\n': state = 'code'
        elif state == 'block_comment':
            if c == '*' and n == '/': state = 'code'; i += 1
        i += 1

    brace = src.find('{', i + 1)
    if brace < 0:
        raise SystemExit(f'opening brace not found: {name}')

    i = brace
    depth = 0
    state = 'code'
    quote = ''
    while i < len(src):
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if state == 'code':
            if c in ('"', "'"):
                state, quote = 'string', c
            elif c == '`':
                state = 'template'
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
                    if end < len(src) and src[end] == '\r': end += 1
                    if end < len(src) and src[end] == '\n': end += 1
                    return m.start(), end, src[m.start():end]
        elif state == 'string':
            if c == '\\': i += 1
            elif c == quote: state = 'code'
        elif state == 'template':
            if c == '\\': i += 1
            elif c == '`': state = 'code'
        elif state == 'line_comment':
            if c == '\n': state = 'code'
        elif state == 'block_comment':
            if c == '*' and n == '/': state = 'code'; i += 1
        i += 1
    raise SystemExit(f'unclosed function: {name}')


# API response cleanup belongs to the API client, not the UI/orchestration layer.
app_strip = find_function_block(app, 'stripCodeFence')
client_strip = find_function_block(client, 'stripCodeFence')
if app_strip:
    start, end, block = app_strip
    app = app[:start] + app[end:]
    if not client_strip:
        marker = 'async function callAI('
        pos = client.find(marker)
        if pos < 0:
            raise SystemExit('client insertion marker not found for stripCodeFence')
        client = client[:pos] + block.rstrip() + '\n\n' + client[pos:]
elif not client_strip:
    raise SystemExit('stripCodeFence missing from both app and client')


# Language display names used by buildRoutePrompt belong to translation-domain helpers.
lang_re = re.compile(r'(?ms)^const LANG_EN_NAME\s*=\s*\{.*?^\};\s*\n?')
app_lang = lang_re.search(app)
translation_lang = lang_re.search(translation)
if app_lang:
    block = app_lang.group(0).rstrip()
    app = app[:app_lang.start()] + app[app_lang.end():]
    if not translation_lang:
        marker = 'function buildRoutePrompt('
        pos = translation.find(marker)
        if pos < 0:
            raise SystemExit('translation insertion marker not found for LANG_EN_NAME')
        translation = translation[:pos] + block + '\n\n' + translation[pos:]
elif not translation_lang:
    raise SystemExit('LANG_EN_NAME missing from both app and translation')

if 'stripCodeFence' in app:
    raise SystemExit('app still owns stripCodeFence')
if 'const LANG_EN_NAME' in app:
    raise SystemExit('app still owns LANG_EN_NAME')
if 'function stripCodeFence' not in client:
    raise SystemExit('client does not own stripCodeFence')
if 'const LANG_EN_NAME' not in translation:
    raise SystemExit('translation does not own LANG_EN_NAME')

APP.write_text(app, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRANSLATION.write_text(translation, encoding='utf-8')
print('final module dependency cleanup applied')
