from pathlib import Path

INDEX = Path("index.html")
text = INDEX.read_text(encoding="utf-8")
original = text

old = '<script src="https://cdn.tailwindcss.com"></script>'
new = '<link rel="stylesheet" href="./tailwind.min.css">'
if old in text:
    text = text.replace(old, new, 1)

old = '''          // 流式读取（SSE）
          const reader = resp.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            gate.bump();
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content || '';
                if (delta) {
                  fullText += delta;
                  if (onProgress) onProgress(fullText);
                }
              } catch {}
            }
          }'''
new = '''          // 流式读取（SSE）：按完整 event（空行）解析，兼容 CRLF / 多行 data / 末尾无空行。
          const reader = resp.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          const consumeEvent = (rawEvent) => {
            const dataLines = rawEvent
              .split(/\\r?\\n/)
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trimStart());
            if (!dataLines.length) return;
            const data = dataLines.join('\\n').trim();
            if (!data || data === '[DONE]') return;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '';
              if (typeof delta === 'string' && delta) {
                fullText += delta;
                if (onProgress) onProgress(fullText);
              }
            } catch {
              // 忽略非 JSON 的 SSE 心跳/元数据 event；最终 JSON 校验仍由下方统一处理。
            }
          };
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            gate.bump();
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\\r?\\n\\r?\\n/);
            buffer = events.pop() || '';
            for (const event of events) consumeEvent(event);
          }
          buffer += decoder.decode();
          if (buffer.trim()) consumeEvent(buffer);'''
if old not in text:
    raise SystemExit("SSE target block not found; aborting without write")
text = text.replace(old, new, 1)

old = '''    const failed = settled.filter(r => r.status === 'rejected');
    if (failed.length === ROUTES.length) throw failed[0].reason;
    if (failed.length) {
      showToast(`部分语种生成失败：${failed[0].reason?.message || failed[0].reason}`, 'error', 4000);
    }
    if (!Object.keys(merged).length) throw new Error('AI 未返回任何内容，请检查配置或重试');'''
new = '''    const failed = settled.filter(r => r.status === 'rejected');
    if (failed.length === ROUTES.length) throw failed[0].reason;
    if (failed.length) {
      // 保留已经生成的卡片，但本次不进入压缩、不写历史，也不提示“完成”。
      showToast(`部分语种生成失败，已保留成功结果：${failed[0].reason?.message || failed[0].reason}`, 'error', 5000);
      return;
    }
    if (!Object.keys(merged).length) throw new Error('AI 未返回任何内容，请检查配置或重试');'''
if old not in text:
    raise SystemExit("partial-result target block not found; aborting without write")
text = text.replace(old, new, 1)

old = '''  for (const lang of ['en', 'es', 'pt', 'zh']) {
    const meta = LANG_META[lang];
    const item = result[lang] || {};
    const title = item.title || '(无)';'''
new = '''  for (const lang of ['en', 'es', 'pt', 'zh']) {
    const meta = LANG_META[lang];
    const item = result[lang];
    if (!item || !item.title) continue;
    const title = item.title;'''
if old not in text:
    raise SystemExit("render target block not found; aborting without write")
text = text.replace(old, new, 1)

old = '''function saveHistory(record) {
  const hist = JSON.parse(localStorage.getItem(STORE.history) || '[]');'''
new = '''function saveHistory(record) {
  const result = record && record.result;
  const complete = result && ['en', 'es', 'pt', 'zh'].every(lang => result[lang]?.title);
  if (!complete) {
    console.warn('[history] 跳过不完整结果，不写入历史记录');
    return false;
  }
  const hist = JSON.parse(localStorage.getItem(STORE.history) || '[]');'''
if old not in text:
    raise SystemExit("history target block not found; aborting without write")
text = text.replace(old, new, 1)

old = '''  localStorage.setItem(STORE.history, JSON.stringify(hist));
}'''
new = '''  localStorage.setItem(STORE.history, JSON.stringify(hist));
  return true;
}'''
pos = text.find('function saveHistory(record)')
endpos = text.find(old, pos)
if endpos == -1:
    raise SystemExit("history return target not found; aborting without write")
text = text[:endpos] + text[endpos:].replace(old, new, 1)

if text == original:
    raise SystemExit("no changes applied")
INDEX.write_text(text, encoding="utf-8", newline="\n")
print("stability patch applied")
