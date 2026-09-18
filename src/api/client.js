// Network transport layer: URL/proxy, timeout, retry, SSE and AI calls.

function applyProxyPrefix(profile, fullUrl) {
  const px = (profile && profile.proxy) || {};
  if (px.enabled && px.mode === 'prefix' && px.url) {
    return px.url.replace(/\/+$/, '') + '/' + fullUrl;
  }
  return fullUrl;
}

function buildApiUrl(profile, path) {
  const base = ((profile && profile.base) || '').replace(/\/+$/, '');
  return applyProxyPrefix(profile, base + path);
}

function makeRequestGate({ timeoutMs = 0, signal: external = null } = {}) {
  const ctrl = new AbortController();
  let state = { reason: null };
  let timer = null;
  const bump = () => {
    if (!timeoutMs) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      state.reason = 'timeout';
      ctrl.abort(new Error(`请求超过 ${Math.round(timeoutMs / 1000)} 秒没有收到数据`));
    }, timeoutMs);
  };
  const onExternalAbort = () => {
    state.reason = 'cancel';
    ctrl.abort(new Error('已取消'));
  };
  if (external) {
    if (external.aborted) onExternalAbort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  bump();
  return {
    signal: ctrl.signal,
    bump,
    reason: () => state.reason,
    cleanup() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (external) external.removeEventListener('abort', onExternalAbort);
    },
  };
}

function normalizeFetchError(err, gate, externalSignal) {
  const reason = gate ? gate.reason() : null;
  if (reason === 'cancel' || (externalSignal && externalSignal.aborted)) {
    const e = new Error('已取消');
    e.cancelled = true;
    return e;
  }
  if (reason === 'timeout') {
    const e = new Error((err?.message || '请求超时') + '（可到「API 配置」调大「请求超时」，或检查网络 / 代理）');
    e.timeout = true;
    return e;
  }
  if (err && err.name === 'AbortError') {
    const e = new Error('请求已中止');
    e.cancelled = true;
    return e;
  }
  const e = new Error('网络请求失败：' + (err?.message || err) + '（检查网络或代理设置）');
  e.networkError = true;
  return e;
}

function backoffDelayMs(attempt, retryAfterSec) {
  if (retryAfterSec > 0) return Math.min(retryAfterSec * 1000, 30000);
  return Math.min(1000 * Math.pow(2, attempt - 1), 8000) + Math.floor(Math.random() * 300);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new Error('已取消')); return; }
    const onAbort = () => { done(); const e = new Error('已取消'); e.cancelled = true; reject(e); };
    const done = () => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); };
    const t = setTimeout(() => { done(); resolve(); }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function shouldRetry(err, cancelled) {
  if (cancelled || err?.cancelled || err?.timeout) return null;
  const status = err?.status;
  if (status === 429) return '接口限流 429';
  if (typeof status === 'number' && status >= 500 && status <= 599) return `服务端错误 ${status}`;
  if (err?.networkError) return '网络中断';
  return null;
}

async function fetchJsonWithRetry(url, init = {}, { timeoutMs = 0, retry = 0 } = {}) {
  let attempt = 0;
  while (true) {
    const gate = makeRequestGate({ timeoutMs });
    try {
      const resp = await fetch(url, { ...init, signal: gate.signal });
      gate.bump();
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        const e = new Error(`${resp.status} ${body.slice(0, 160)}`.trim());
        e.status = resp.status;
        const ra = parseInt(resp.headers.get('retry-after') || '', 10);
        if (Number.isFinite(ra) && ra > 0) e.retryAfter = ra;
        throw e;
      }
      return (await resp.json().catch(() => ({}))) || {};
    } catch (err) {
      const e = err.status !== undefined ? err : normalizeFetchError(err, gate, null);
      const why = shouldRetry(e, false);
      if (!why || attempt >= retry) throw e;
      attempt++;
      await sleep(backoffDelayMs(attempt, e.retryAfter), null);
    } finally {
      gate.cleanup();
    }
  }
}

function stripCodeFence(text) {
  if (!text) return text;
  let t = text.trim();
  // 去 ```json 或 ``` 开头
  t = t.replace(/^```(?:json|JSON)?\s*\n?/, '');
  // 去结尾的 ```
  t = t.replace(/\n?```\s*$/, '');
  return t.trim();
}

async function callAI(systemPrompt, userMessage, onProgress, opts = {}) {
  const s = getSettings();
  if (!s.base || !s.key || !s.model) {
    throw new Error('请先在「设置」中填写 API 配置');
  }
  const messages = opts.messages || [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  const useStream = opts.stream ?? (s.stream !== false);
  const timeoutMs = Math.max(0, (opts.timeout ?? s.timeout ?? 120) * 1000);
  const maxRetry = Math.max(0, Math.min(5, opts.retry ?? s.retry ?? 2));
  const externalSignal = opts.signal || null;

  let attempt = 0;
  while (true) {
    try {
      return await requestOnce();
    } catch (err) {
      const cancelled = !!(externalSignal && externalSignal.aborted) || err.cancelled === true;
      const why = shouldRetry(err, cancelled);
      if (!why || attempt >= maxRetry) throw err;
      attempt++;
      const waitMs = backoffDelayMs(attempt, err.retryAfter);
      if (opts.onRetry) opts.onRetry({ attempt, maxRetry, waitMs, why });
      await sleep(waitMs, externalSignal);
    }
  }

  async function requestOnce() {
    const gate = makeRequestGate({ timeoutMs, signal: externalSignal });
    try {
      let resp;
      try {
        resp = await fetch(buildApiUrl(s, '/chat/completions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + s.key,
          },
          body: JSON.stringify(ProviderAdapters.buildChatRequest(s, {
            messages,
            stream: useStream,
            temperature: opts.temperature ?? s.temp,
            maxTokens: opts.maxTokens ?? s.maxTokens,
          })),
          signal: gate.signal,
        });
      } catch (err) {
        throw normalizeFetchError(err, gate, externalSignal);
      }
      gate.bump();   // 拿到响应头也算「有数据回来」

      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        const e = new Error(`API 错误 ${resp.status}: ${t.slice(0, 200)}`);
        e.status = resp.status;
        const ra = parseInt(resp.headers.get('retry-after') || '', 10);
        if (Number.isFinite(ra) && ra > 0) e.retryAfter = ra;
        throw e;
      }

      let fullText = '';
      try {
        if (useStream) {
          // 流式读取（SSE）：按完整 event（空行）解析，兼容 CRLF / 多行 data / 末尾无空行。
          const reader = resp.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          const consumeEvent = (rawEvent) => {
            const dataLines = rawEvent
              .split(/\r?\n/)
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trimStart());
            if (!dataLines.length) return;
            const data = dataLines.join('\n').trim();
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
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || '';
            for (const event of events) consumeEvent(event);
          }
          buffer += decoder.decode();
          if (buffer.trim()) consumeEvent(buffer);
        } else {
          // 非流式：一次性取回完整响应
          const data = await resp.json();
          fullText = data.choices?.[0]?.message?.content || '';
          if (onProgress) onProgress(fullText);
        }
      } catch (err) {
        const norm = normalizeFetchError(err, gate, externalSignal);
        if (norm.cancelled || norm.timeout) throw norm;
        // 已经吐出部分内容说明连接本来是通的，整体重试会造成重复输出，故不重试
        if (fullText) {
          const e = new Error('连接中断（已收到部分内容，未重试）：' + (err?.message || err));
          throw e;
        }
        throw norm;
      }

      // 解析 JSON（容错）
      let parsed;
      const cleaned = stripCodeFence(fullText);
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // 尝试提取首尾大括号
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) {
          throw new Error('AI 返回非 JSON 或被截断（建议把 Max Tokens 调到 4000+）：\n' + fullText.slice(0, 300));
        }
        try {
          parsed = JSON.parse(m[0]);
        } catch (e) {
          throw new Error('JSON 解析失败（输出可能被截断，请把 Max Tokens 调大）：' + e.message + '\n内容片段：' + cleaned.slice(0, 300));
        }
      }
      return parsed;
    } finally {
      gate.cleanup();
    }
  }
}
