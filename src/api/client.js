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

// ===== 用户确认压缩 =====
const LANG_LABEL = { en: '英语', es: '西语', pt: '葡语', zh: '中文' };
// round: 已压缩轮次；signal: 本次运行的取消信号（点「✕ 取消」时立即以 false 收尾，避免流程卡在对话框上）
function askUserShorten(overLangs, round, signal) {
  return new Promise((resolve) => {
    const box = document.getElementById('shortenPrompt');
    const detail = overLangs.map(it =>
      `<span class="inline-block px-2 py-0.5 bg-white border border-amber-300 rounded text-xs mr-1.5 mb-1">${LANG_LABEL[it.lang]} <span class="text-red-600 font-semibold">${it.count}/${it.limit}</span></span>`
    ).join('');
    const roundHint = round === 0 ? '' : `<span class="text-xs text-amber-700 ml-2">（已压缩 ${round} 轮，仍未达标）</span>`;
    box.innerHTML = `
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="flex-1 min-w-[280px]">
          <div class="font-medium text-amber-900 mb-1.5">⚠️ 检测到 ${overLangs.length} 条标题超出字符上限${roundHint}</div>
          <div class="flex flex-wrap">${detail}</div>
          <div class="text-xs text-amber-700 mt-1.5">是否调用 AI 压缩重写？压缩会保留所有核心信息词，仅删除次要修饰词。</div>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <button id="btnAcceptShorten" class="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium">✓ 压缩重写</button>
          <button id="btnRejectShorten" class="px-4 py-2 text-sm bg-white border border-slate-300 rounded-lg hover:bg-slate-100">保持现状</button>
        </div>
      </div>
    `;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // 只允许结算一次：「取消」与「点按钮」两条路径都可能触发
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(val);
    };
    const onAbort = () => finish(false);

    if (signal) {
      if (signal.aborted) { finish(false); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    document.getElementById('btnAcceptShorten').onclick = () => finish(true);
    document.getElementById('btnRejectShorten').onclick = () => finish(false);
  });
}
function hideShortenPrompt() {
  document.getElementById('shortenPrompt').classList.add('hidden');
}
function listOverLimit(result, charLimit, charLimitCN, scope) {
  const over = [];
  for (const lang of ['en', 'es', 'pt', 'zh']) {
    if (scope && scope[lang] === false) continue;
    const isCN = lang === 'zh';
    const limit = isCN ? charLimitCN : charLimit;
    const title = result[lang]?.title || '';
    const count = countChars(title, isCN);
    if (count > limit) over.push({ lang, title, count, limit, isCN });
  }
  return over;
}

// ===== 自动压缩超限标题 =====
// 压缩轮次硬上限：超过就停手交还用户，避免无限循环
const MAX_SHORTEN_ROUNDS = 2;
// 返回 { merged, ok }：ok=false 表示压缩请求失败/未产生改动，调用方应保留原结果并提示
// opts 是第 5 个参数：{ signal, onRetry, onProgress }
async function shortenOverLimit(result, charLimit, charLimitCN, scope, opts = {}) {
  const overItems = listOverLimit(result, charLimit, charLimitCN, scope);
  if (!overItems.length) return { merged: result, ok: true };

  if (typeof opts.onProgress === 'function') opts.onProgress(`检测到 ${overItems.length} 条超限，正在压缩重写...`);

  const langName = { en: '英语', es: '西语', pt: '葡语', zh: '中文' };
  const taskList = overItems.map(it =>
    `- ${langName[it.lang]}（当前 ${it.count} 字符，必须 ≤ ${it.limit}，需删减至少 ${it.count - it.limit + 3} 字符以预留余量）\n  原标题: "${it.title}"`
  ).join('\n');

  const shortenPrompt = `以下标题超出字符上限，需要重写到上限内。请严格遵守规则：

${taskList}

【硬性禁令 — 违反任何一条都不算合格】
1. ❌ 禁止省略核心信息词（如 Handle 手柄、Stainless Steel 不锈钢、Mason Jar 等核心类目/材质/功能词）。如果原标题写了 Handle 而压缩后没有，意思就变了，**坚决不允许**。
2. ❌ 禁止用同义词"暗示"被省略的词（例如不能省略 Handle 然后用 Boca Ancha 来暗指）。每个核心词都必须显式保留。
3. ❌ 禁止截断单词（不能写 "Stainl" 代替 "Stainless"，不能写 "Adj." 代替 "Adjustable"）。

【允许的压缩手段】
✓ 删除可有可无的修饰词：Premium、Best、Quality、New、Hot Sale、Fashion、Top、Super 等
✓ 删除单件数量单位（1 Pcs、1 Pza、1 Un、1件装、1个装 这类对单件商品无意义的尾缀）
✓ 合并冗余表达：如 "Sharp Jaw Nails Cutter Trimmers" → "Sharp Nail Cutter"
✓ 改用更短但同义的核心词（必须是同义，不是暗示）：例如 "Stainless Steel" → "Steel"（如果材质本就突出钢质）
✓ 调整语序压缩空格
✓ 删除可推断的卖点形容词（如 Travel、Portable 二选一）

【字符规则】中文按汉字=2字符、其他=1字符；其他语言按原始长度（含空格）。每条至少留 3 字符余量。

【输出】只返回 JSON，不要 markdown 不要代码块：
{
${overItems.map(it => `  "${it.lang}": { "title": "...", "analysis": "保留了哪些核心词，删了哪些次要词" }`).join(',\n')}
}`;

  // 复用 callAI：走流式（防代理长连接被掐断、可显示进度），并统一 JSON 容错解析
  let fix;
  try {
    fix = await callAI(null, null, null, {
      temperature: 0.2,
      messages: [{ role: 'user', content: shortenPrompt }],
      signal: opts.signal,
      onRetry: opts.onRetry,
    });
  } catch (err) {
    return { merged: result, ok: false };
  }
  // 合并修正
  const merged = { ...result };
  let changed = false;
  for (const it of overItems) {
    if (fix[it.lang]?.title) {
      merged[it.lang] = { ...merged[it.lang], ...fix[it.lang] };
      changed = true;
    }
  }
  return { merged, ok: changed };
}

// ===== 分路 Prompt =====
// 在全局 Prompt 之后追加「本次输出范围」，收窄单次请求需要输出的语种，减少输出 token
// ===== 运行控制（取消）=====
// 同一时刻只允许一次生成；取消时 abort 掉所有在途请求，已渲染的部分结果保留。
let activeRun = null;

function beginRun() {
  if (activeRun) activeRun.controller.abort();
  const run = { controller: new AbortController(), cancelled: false };
  run.signal = run.controller.signal;
  activeRun = run;
  return run;
}
function endRun(run) {
  if (activeRun === run) activeRun = null;
}
function isRunCancelled(run) {
  return !!(run && (run.cancelled || run.signal.aborted));
}
function cancelRun() {
  if (!activeRun || activeRun.cancelled) return;
  activeRun.cancelled = true;
  activeRun.controller.abort();
}

// ===== 主流程 =====
document.getElementById('btnTranslate').addEventListener('click', async () => {
  const input = document.getElementById('inputTitle').value.trim();
  if (!input) { showError('请输入原始标题'); return; }

  const s = getSettings();
  const charLimit = s.charLimit ?? 55;
  const charLimitCN = s.charLimitCN ?? 60;

  let globalPrompt = (localStorage.getItem(STORE.globalPrompt) || DEFAULT_GLOBAL_PROMPT)
    .replace(/\{CHAR_LIMIT\}/g, charLimit)
    .replace(/\{CHAR_LIMIT_CN\}/g, charLimitCN);

  const sessionPrompt = document.getElementById('sessionPrompt').value.trim();
  let systemPrompt = globalPrompt;
  if (sessionPrompt) {
    systemPrompt += '\n\n【本次会话额外要求】\n' + sessionPrompt;
  }
  // 剥掉以 // 或 #! 开头的注释行
  systemPrompt = stripPromptComments(systemPrompt);

  const btn = document.getElementById('btnTranslate');
  const btnCancel = document.getElementById('btnCancel');
  const loading = document.getElementById('loadingHint');
  btn.disabled = true;
  btnCancel.classList.remove('hidden');
  loading.classList.remove('hidden');
  document.getElementById('errorHint').classList.add('hidden');

  // 本次运行的取消信号，所有在途请求共用
  const run = beginRun();
  const callOpts = { signal: run.signal };

  // 实时计时器（用 stage 控制显示阶段，避免被覆盖）
  const startTs = Date.now();
  let stage = { label: 'AI 生成中', detail: '' };
  const setStage = (label, detail = '') => { stage = { label, detail }; };
  let timerId = setInterval(() => {
    const sec = ((Date.now() - startTs) / 1000).toFixed(1);
    const extra = stage.detail ? ` · ${stage.detail}` : '';
    loading.innerHTML = `<span class="spinner align-middle"></span> ${stage.label}${extra} · ${sec}s`;
  }, 100);

  try {
    // ===== 两路并发生成：A = 英/中（无 analysis），B = 西/葡（含 analysis）=====
    // 输出 token 是延迟主因。拆两路后墙钟时间 ≈ 较慢那一路；谁先回来先渲染谁。
    const ROUTES = [
      { langs: ['en', 'zh'], label: '英/中' },
      { langs: ['es', 'pt'], label: '西/葡' },
    ];
    const merged = {};
    const gotChars = {};
    const tick = () => {
      const got = Object.keys(gotChars).length;
      const chars = Object.values(gotChars).reduce((a, b) => a + b, 0);
      setStage('AI 生成中', `${got}/${ROUTES.length} 路 · ${chars} 字符`);
    };

    const settled = await Promise.allSettled(ROUTES.map(async (route) => {
      const part = await callAI(
        buildRoutePrompt(systemPrompt, route.langs),
        `原始标题：\n${input}`,
        (text) => { gotChars[route.label] = text.length; tick(); },
        {
          ...callOpts,
          onRetry: ({ attempt, maxRetry, waitMs, why }) => {
            gotChars[route.label] = 0;
            setStage(`${route.label} 重试 ${attempt}/${maxRetry}`, `${why} · ${(waitMs / 1000).toFixed(1)}s 后重试`);
          },
        },
      );
      Object.assign(merged, part);
      // 增量渲染：哪一路先回来就先出它的卡片
      renderOutput(merged, input, charLimit, charLimitCN);
      return part;
    }));

    // 用户点了取消：保留已生成的部分结果，不写历史、不进压缩流程
    if (isRunCancelled(run)) throw new Error('已取消');

    const failed = settled.filter(r => r.status === 'rejected');
    if (failed.length === ROUTES.length) throw failed[0].reason;
    if (failed.length) {
      // 保留已经生成的卡片，但本次不进入压缩、不写历史，也不提示“完成”。
      showToast(`部分语种生成失败，已保留成功结果：${failed[0].reason?.message || failed[0].reason}`, 'error', 5000);
      return;
    }
    if (!Object.keys(merged).length) throw new Error('AI 未返回任何内容，请检查配置或重试');

    // 最终渲染 + 校验字符数
    setStage('解析完成', '正在校验字符数');
    renderOutput(merged, input, charLimit, charLimitCN);

    // 快速模式：跳过自动压缩
    const fastMode = document.getElementById('fastMode').checked;
    localStorage.setItem('translator_fast_mode', fastMode ? '1' : '0');

    if (fastMode) {
      saveHistory({ input, sessionPrompt, result: merged, ts: Date.now() });
    } else {
      // 取得当前压缩范围
      const profData = loadProfilesStore();
      const scope = profData.shortenScope || { en: true, es: true, pt: true, zh: true };
      // 用户确认驱动的循环压缩（最多 MAX_SHORTEN_ROUNDS 轮）
      let current = merged;
      let round = 0;
      while (true) {
        if (isRunCancelled(run)) { hideShortenPrompt(); break; }
        const overLangs = listOverLimit(current, charLimit, charLimitCN, scope);
        if (!overLangs.length) {
          hideShortenPrompt();
          break;
        }
        if (round >= MAX_SHORTEN_ROUNDS) {
          hideShortenPrompt();
          showToast(`已压缩 ${round} 轮仍有 ${overLangs.length} 条超限，请手动微调`, 'info', 3500);
          break;
        }
        const accept = await askUserShorten(overLangs, round, run.signal);
        hideShortenPrompt();
        if (!accept || isRunCancelled(run)) break;
        round++;
        loading.classList.remove('hidden');
        setStage(`第 ${round} 轮压缩`, `处理 ${overLangs.length} 条超限`);
        const res = await shortenOverLimit(current, charLimit, charLimitCN, scope, {
          ...callOpts,
          onRetry: ({ attempt, maxRetry, waitMs, why }) => {
            setStage(`压缩重试 ${attempt}/${maxRetry}`, `${why} · ${(waitMs / 1000).toFixed(1)}s 后重试`);
          },
        });
        if (!res.ok) {
          loading.classList.add('hidden');
          if (!isRunCancelled(run)) showError('压缩请求失败，已保留原结果（可重试或手动调整）');
          break;
        }
        current = res.merged;
        renderOutput(current, input, charLimit, charLimitCN);
        loading.classList.add('hidden');
      }
      if (isRunCancelled(run)) throw new Error('已取消');
      saveHistory({ input, sessionPrompt, result: current, ts: Date.now() });
    }

    const totalSec = ((Date.now() - startTs) / 1000).toFixed(1);
    flash(`完成（耗时 ${totalSec}s）`);
  } catch (err) {
    if (isRunCancelled(run)) {
      showToast('已取消（已生成的部分结果保留在下方）', 'info', 3000);
    } else {
      showError(err.message);
    }
  } finally {
    clearInterval(timerId);
    btn.disabled = false;
    btnCancel.classList.add('hidden');
    loading.classList.add('hidden');
    endRun(run);
  }
});

document.getElementById('btnCancel').addEventListener('click', cancelRun);

// ===== 渲染输出 =====
const LANG_META = {
  en: { name: 'English', flag: '🇺🇸🇪🇺', desc: '全球 / 北美 / 跨境大盘', isCN: false },
  es: { name: 'Español', flag: '🇲🇽🇨🇱🇨🇴', desc: '墨西哥 / 智利 / 哥伦比亚', isCN: false },
  pt: { name: 'Português', flag: '🇧🇷', desc: '巴西站', isCN: false },
  zh: { name: '中文', flag: '🇨🇳', desc: '淘宝 / 拼多多 / 虾皮台湾', isCN: true },
};

// 复制到剪贴板：异步 API 在 WebView2 / 非安全上下文下可能被拒绝，
// 失败时回退到 execCommand；两者都失败返回 false（调用方必须给出明确提示，不能假装成功）
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 落到下面的兜底方案 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

function renderOutput(result, input, charLimit, charLimitCN) {
  const out = document.getElementById('outputArea');
  out.innerHTML = '';
  out.classList.remove('hidden');

  for (const lang of ['en', 'es', 'pt', 'zh']) {
    const meta = LANG_META[lang];
    const item = result[lang];
    if (!item || !item.title) continue;
    const title = item.title;
    const showAnalysis = (lang === 'es' || lang === 'pt');
    const analysis = showAnalysis ? (item.analysis || '') : '';
    const limit = meta.isCN ? charLimitCN : charLimit;
    const count = countChars(title, meta.isCN);
    let charClass = 'char-ok';
    if (count > limit) charClass = 'char-over';
    else if (count > limit * 0.95) charClass = 'char-warn';

    const card = document.createElement('div');
    card.className = 'lang-card bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md';
    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class="text-lg">${meta.flag}</span>
          <span class="font-semibold text-slate-900">${meta.name}</span>
          <span class="text-xs text-slate-400">${meta.desc}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs ${charClass}">${count} / ${limit} 字符</span>
          <button class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">复制</button>
        </div>
      </div>
      <div class="font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-2 break-all select-all"></div>
      ${analysis ? `<details class="mt-2" ${(lang === 'es' || lang === 'pt') ? 'open' : ''}><summary class="text-xs text-slate-500 hover:text-slate-800">📊 流量解析</summary><div class="text-xs text-slate-600 mt-1 leading-relaxed whitespace-pre-wrap"></div></details>` : ''}
    `;
    card.querySelector('.font-mono').textContent = title;
    if (analysis) card.querySelector('details div').textContent = analysis;
    card.querySelector('button').addEventListener('click', async () => {
      if (await copyText(title)) flash(`${meta.name} 已复制`);
      else showError('复制失败，请手动选中文本复制');
    });
    out.appendChild(card);
  }
}

// ===== 历史 =====
function saveHistory(record) {
  const result = record && record.result;
  const complete = result && ['en', 'es', 'pt', 'zh'].every(lang => result[lang]?.title);
  if (!complete) {
    console.warn('[history] 跳过不完整结果，不写入历史记录');
    return false;
  }
  const hist = JSON.parse(localStorage.getItem(STORE.history) || '[]');
  hist.unshift(record);
  if (hist.length > 50) hist.length = 50;
  localStorage.setItem(STORE.history, JSON.stringify(hist));
  return true;
}
function clearHistory() {
  if (!confirm('确认清空所有历史记录？')) return;
  localStorage.removeItem(STORE.history);
  renderHistory();
}
function renderHistory() {
  const list = document.getElementById('historyList');
  const hist = JSON.parse(localStorage.getItem(STORE.history) || '[]');
  if (!hist.length) {
    list.innerHTML = '<p class="text-sm text-slate-400 text-center py-8">暂无历史</p>';
    return;
  }
  list.innerHTML = hist.map((h, i) => {
    const t = new Date(h.ts).toLocaleString('zh-CN');
    const preview = (h.input || '').slice(0, 60);
    return `<div class="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 cursor-pointer" data-i="${i}">
      <div class="text-xs text-slate-400 mb-1">${t}</div>
      <div class="text-sm text-slate-700 truncate">${escapeHtml(preview)}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-i]').forEach(el => {
    el.addEventListener('click', () => {
      const h = hist[parseInt(el.dataset.i)];
      document.getElementById('inputTitle').value = h.input;
      document.getElementById('sessionPrompt').value = h.sessionPrompt || '';
      const s = getSettings();
      renderOutput(h.result, h.input, s.charLimit ?? 55, s.charLimitCN ?? 60);
      toggleHistory();
    });
  });
}
function toggleHistory() {
  const d = document.getElementById('historyDrawer');
  d.classList.toggle('hidden');
  if (!d.classList.contains('hidden')) renderHistory();
}

// ===== 配置导出 / 导入 =====
// 导出为 JSON 文件，用于换电脑、清缓存前的备份。
// ⚠️ 文件里含明文 API Key，只能自己保管，不要外传。
const CONFIG_EXPORT_TYPE = 'ecom-translator-profiles';
const PROFILE_FIELDS = ['name', 'base', 'key', 'model', 'temp', 'maxTokens', 'stream', 'charLimit', 'charLimitCN', 'timeout', 'retry'];

function downloadTextFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 只保留已知字段，避免导入文件里的多余键（含 __proto__ 之类）混进 localStorage
function pickProfileFields(p) {
  const out = {};
  for (const k of PROFILE_FIELDS) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  const px = (p.proxy && typeof p.proxy === 'object') ? p.proxy : {};
  out.proxy = {
    enabled: px.enabled === true,
    mode: px.mode === 'prefix' ? 'prefix' : 'system',
    url: typeof px.url === 'string' ? px.url : '',
  };
  return out;
}

function exportProfiles() {
  try {
    const data = loadProfilesStore();
    const payload = {
      app: 'ecom-translator',
      type: CONFIG_EXPORT_TYPE,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      charLimit: data.charLimit,
      charLimitCN: data.charLimitCN,
      shortenScope: data.shortenScope || { en: true, es: true, pt: true, zh: true },
      activeId: data.activeId,
      // 只导「用户自己存过」的 Prompt；没存过（用默认值）就导 null，导入时不会覆盖对方 Prompt
      globalPrompt: localStorage.getItem(STORE.globalPrompt) || null,
      // 带上 id 只为让「覆盖导入」能定位导出时选中的那套；导入时仍会重新分配 id
      profiles: data.profiles.map(p => ({ id: p.id, ...pickProfileFields(p) })),
    };
    const d = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    downloadTextFile(`translator-config-${stamp}.json`, JSON.stringify(payload, null, 2));
    const extra = payload.globalPrompt ? '，含全局 Prompt' : '';
    showToast(`已导出 ${data.profiles.length} 套配置${extra}（含明文 Key，请妥善保管）`, 'success', 3600);
  } catch (err) {
    showError('导出失败：' + (err.message || err));
  }
}

// 兼容多种格式：完整导出包 / {data:{profiles}} / 裸 store / 单套配置 / 配置数组
function parseImportPayload(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch { throw new Error('不是合法的 JSON 文件'); }
  let store = null;
  if (Array.isArray(obj)) store = { profiles: obj };
  else if (obj && Array.isArray(obj.profiles)) store = obj;
  else if (obj && obj.data && Array.isArray(obj.data.profiles)) store = obj.data;
  else if (obj && (obj.base || obj.key || obj.model)) store = { profiles: [obj] };
  const list = ((store && store.profiles) || [])
    .filter(p => p && typeof p === 'object' && !Array.isArray(p));
  if (!list.length) throw new Error('文件里没有找到任何配置');
  return { ...(store || {}), profiles: list };
}

function triggerImportFile() {
  const el = document.getElementById('importFile');
  el.value = '';   // 允许连续选同一个文件
  el.click();
}

async function onImportFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const store = parseImportPayload(await file.text());
    openImportDialog(store, file.name);
  } catch (err) {
    showError('读取失败：' + (err.message || err));
  }
}

function openImportDialog(store, fileName) {
  const data = loadProfilesStore();
  const names = store.profiles.map(p => escapeHtml(p.name || '未命名配置')).join('、');
  const box = document.getElementById('importDialog');
  const promptText = typeof store.globalPrompt === 'string' ? store.globalPrompt.trim() : '';
  const promptBlock = promptText ? `
        <label class="flex items-start gap-2 mt-2 text-xs text-amber-900 cursor-pointer select-none">
          <input type="checkbox" id="chkImportPrompt" class="w-4 h-4 mt-0.5 accent-amber-600"/>
          <span>同时导入文件里的<b>全局 Prompt</b>（会覆盖当前 Prompt，覆盖后仍可在下方编辑 / 恢复默认）</span>
        </label>
        <div class="text-xs text-amber-700 mt-1 opacity-75 break-all leading-snug">${escapeHtml(promptText.slice(0, 90))}${promptText.length > 90 ? ' …' : ''}</div>` : '';
  box.innerHTML = `
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="flex-1 min-w-[280px]">
        <div class="font-medium text-amber-900 mb-1">📥 读取到 ${store.profiles.length} 套配置</div>
        <div class="text-xs text-amber-800 break-all mb-0.5">${escapeHtml(fileName || '')}</div>
        <div class="text-xs text-amber-700 break-all">${names}</div>
        <div class="text-xs text-amber-700 mt-1.5">当前已有 <b>${data.profiles.length}</b> 套。合并＝追加（重名自动加序号）；覆盖＝清空现有配置后再导入。</div>${promptBlock}
      </div>
      <div class="flex gap-2 flex-shrink-0 flex-wrap">
        <button id="btnImportMerge" class="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium">合并导入</button>
        <button id="btnImportReplace" class="px-4 py-2 text-sm bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50">覆盖导入</button>
        <button id="btnImportCancel" class="px-4 py-2 text-sm bg-white border border-slate-300 rounded-lg hover:bg-slate-100">取消</button>
      </div>
    </div>
  `;
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('btnImportMerge').onclick = () => applyImport(store, 'merge');
  document.getElementById('btnImportReplace').onclick = () => applyImport(store, 'replace');
  document.getElementById('btnImportCancel').onclick = closeImportDialog;
}

function closeImportDialog() {
  const box = document.getElementById('importDialog');
  box.classList.add('hidden');
  box.innerHTML = '';
}

function applyImport(store, mode) {
  // 勾选框还没被 closeImportDialog 清掉，先取出来
  const promptEl = document.getElementById('chkImportPrompt');
  const wantPrompt = !!(promptEl && promptEl.checked);
  try {
    const data = loadProfilesStore();
    const incoming = store.profiles.map(pickProfileFields);
    let count = 0;
    if (mode === 'replace') {
      // 全部重新分配 id，避免与旧记录串号
      const mapped = incoming.map(p => normalizeProfile({ ...p, id: genId() }, store));
      const idx = store.profiles.findIndex(p => p.id && p.id === store.activeId);
      data.profiles = mapped;
      data.activeId = mapped[idx >= 0 ? idx : 0].id;
      if (store.shortenScope) data.shortenScope = { ...data.shortenScope, ...store.shortenScope };
      count = mapped.length;
    } else {
      for (const p of incoming) {
        const id = genId();
        const name = uniqueProfileName(data, p.name || '未命名配置');
        data.profiles.push(normalizeProfile({ ...p, id, name }, data));
      }
      // 合并模式保持当前选中项不变
      if (!data.profiles.some(x => x.id === data.activeId)) data.activeId = data.profiles[data.profiles.length - 1].id;
      count = incoming.length;
    }
    saveProfilesStore(data);

    // 全局 Prompt：仅当用户勾选且文件里确实带了才覆盖
    let promptDone = false;
    if (wantPrompt && typeof store.globalPrompt === 'string' && store.globalPrompt.trim()) {
      localStorage.setItem(STORE.globalPrompt, migrateGlobalPrompt(store.globalPrompt));
      promptDone = true;
    }

    closeImportDialog();
    renderProfileSelect();
    loadProfileToForm(data.activeId);
    if (promptDone) loadGlobalPrompt();
    const tip = (mode === 'replace' ? `已覆盖导入 ${count} 套配置` : `已合并导入 ${count} 套配置`) + (promptDone ? ' + 全局 Prompt' : '');
    showToast(tip, 'success');
  } catch (err) {
    showError('导入失败：' + (err.message || err));
  }
}

// ===== 事件绑定 =====
document.getElementById('btnSettings').addEventListener('click', () => {
  document.getElementById('settingsPanel').classList.toggle('hidden');
});
document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
document.getElementById('btnHistory').addEventListener('click', toggleHistory);

document.getElementById('profileSelect').addEventListener('change', (e) => switchProfile(e.target.value));
document.getElementById('profileQuickSwitch').addEventListener('change', (e) => switchProfile(e.target.value));
document.getElementById('btnNewProfile').addEventListener('click', newProfile);
document.getElementById('btnDuplicateProfile').addEventListener('click', duplicateProfile);
document.getElementById('btnDeleteProfile').addEventListener('click', deleteProfile);

// API Key 明文 / 密文切换
document.getElementById('btnToggleKey').addEventListener('click', () => {
  const el = document.getElementById('apiKey');
  el.type = el.type === 'password' ? 'text' : 'password';
});
document.getElementById('btnFetchModels').addEventListener('click', fetchModels);
document.getElementById('btnTestProfile').addEventListener('click', testConnection);
document.getElementById('btnExportProxy').addEventListener('click', downloadProxyTxt);
document.getElementById('btnExportProfile').addEventListener('click', exportProfiles);
document.getElementById('btnImportProfile').addEventListener('click', triggerImportFile);
document.getElementById('importFile').addEventListener('change', onImportFileChange);
document.getElementById('useProxy').addEventListener('change', updateProxyUI);
document.getElementById('proxyMode').addEventListener('change', updateProxyUI);

// ===== 利润计算器 =====
const CALC_STORE = 'translator_calc_params_v1';

function loadCalcParams() {
  const p = JSON.parse(localStorage.getItem(CALC_STORE) || '{}');
  if (p.margin != null) document.getElementById('calcMargin').value = p.margin;
  if (p.rate != null) document.getElementById('calcRate').value = p.rate;
  if (p.other != null) document.getElementById('calcOther').value = p.other;
  updateCalcSummary();
}
function saveCalcParams() {
  try {
    const p = {
      margin: parseFloat(document.getElementById('calcMargin').value) || 0,
      rate: parseFloat(document.getElementById('calcRate').value) || 0,
      other: parseFloat(document.getElementById('calcOther').value) || 0,
    };
    localStorage.setItem(CALC_STORE, JSON.stringify(p));
    flash('计算器参数已保存');
    updateCalcSummary();
    recalcProfit();
  } catch (err) {
    showError('保存失败：' + (err.message || err));
  }
}
function updateCalcSummary() {
  const m = parseFloat(document.getElementById('calcMargin').value) || 0;
  const r = parseFloat(document.getElementById('calcRate').value) || 0;
  const o = parseFloat(document.getElementById('calcOther').value) || 0;
  document.getElementById('calcSummary').textContent = `利润率 ${m}% · 汇率 ${r} · 其他费 ¥${o}`;
}
function recalcProfit() {
  const cost = parseFloat(document.getElementById('calcCost').value);
  const marginPct = parseFloat(document.getElementById('calcMargin').value);
  const rate = parseFloat(document.getElementById('calcRate').value);
  const other = parseFloat(document.getElementById('calcOther').value) || 0;
  const usdEl = document.getElementById('calcUsd');
  const profitEl = document.getElementById('calcProfit');

  if (isNaN(cost) || isNaN(marginPct) || isNaN(rate) || rate <= 0) {
    usdEl.textContent = '$ --';
    profitEl.textContent = '¥ --';
    return;
  }
  const margin = marginPct / 100;
  if (margin >= 1) {
    usdEl.textContent = '利润率 ≥ 100%，无法计算';
    profitEl.textContent = '¥ --';
    return;
  }
  const totalCost = cost + other;
  const netRevenue = totalCost / (1 - margin); // ¥
  const usdPrice = netRevenue / rate;          // $
  const profit = usdPrice * rate - totalCost;  // ¥

  usdEl.textContent = '$ ' + usdPrice.toFixed(2);
  profitEl.textContent = '¥ ' + profit.toFixed(2);
}

// 输入变化即时重算
['calcCost', 'calcMargin', 'calcRate', 'calcOther'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    recalcProfit();
    if (id !== 'calcCost') updateCalcSummary();
  });
});
document.getElementById('btnSaveCalcParams').addEventListener('click', saveCalcParams);

// 最小化 / 恢复
const FLOAT_CALC_STATE = 'translator_calc_floating_state';
document.getElementById('btnCalcMinimize').addEventListener('click', () => {
  document.getElementById('floatingCalc').classList.add('hidden');
  document.getElementById('calcRestoreBtn').classList.remove('hidden');
  localStorage.setItem(FLOAT_CALC_STATE, 'minimized');
});
document.getElementById('calcRestoreBtn').addEventListener('click', () => {
  document.getElementById('floatingCalc').classList.remove('hidden');
  document.getElementById('calcRestoreBtn').classList.add('hidden');
  localStorage.setItem(FLOAT_CALC_STATE, 'open');
});
// 恢复上次状态
if (localStorage.getItem(FLOAT_CALC_STATE) === 'minimized') {
  document.getElementById('floatingCalc').classList.add('hidden');
  document.getElementById('calcRestoreBtn').classList.remove('hidden');
}

loadCalcParams();

// ===== Google 翻译预检 =====
async function googleTranslate(text, targetLang) {
  if (!text.trim()) return '';
  // 免费 endpoint，无需 key（依赖浏览器跨域放行；启动器版 Chrome 可用）
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
  // 跟随当前配置的代理：system 模式由浏览器/系统接管，prefix 模式走中转
  const s = getSettings();
  const external = activeRun ? activeRun.signal : null;
  const gate = makeRequestGate({ timeoutMs: Math.max(0, (s.timeout ?? 120) * 1000), signal: external });
  try {
    const resp = await fetch(applyProxyPrefix(s, url), { signal: gate.signal });
    gate.bump();
    if (!resp.ok) throw new Error('谷歌翻译请求失败 ' + resp.status);
    const data = await resp.json();
    // 返回结构：[[["译文片段1","原文片段1",...],["译文片段2",...]],null,"src_lang"]
    const chunks = data[0] || [];
    return chunks.map(c => c[0]).join('');
  } catch (err) {
    // 只翻译「取消 / 超时」这两类，其余保留原始错误（调用方要提示 CORS 排查）
    const norm = normalizeFetchError(err, gate, external);
    if (norm.cancelled || norm.timeout) throw norm;
    throw err;
  } finally {
    gate.cleanup();
  }
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
