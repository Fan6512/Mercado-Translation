// ===== 渲染配置 UI =====
function renderProfileSelect() {
  const data = loadProfilesStore();
  const opts = data.profiles.map(p =>
    `<option value="${p.id}" ${p.id === data.activeId ? 'selected' : ''}>${escapeHtml(p.name)}${p.model ? ' · ' + escapeHtml(p.model) : ''}</option>`
  ).join('');
  document.getElementById('profileSelect').innerHTML = opts;
  document.getElementById('profileQuickSwitch').innerHTML = opts;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

function loadProfileToForm(profileId) {
  const data = loadProfilesStore();
  const p = data.profiles.find(x => x.id === profileId) || data.profiles[0];
  document.getElementById('profileName').value = p.name || '';
  document.getElementById('apiBase').value = p.base || '';
  document.getElementById('apiKey').value = p.key || '';
  document.getElementById('apiModel').value = p.model || '';
  document.getElementById('apiTemp').value = p.temp ?? 0.7;
  document.getElementById('apiMaxTokens').value = p.maxTokens ?? 4000;
  document.getElementById('charLimit').value = p.charLimit ?? 55;
  document.getElementById('charLimitCN').value = p.charLimitCN ?? 60;
  document.getElementById('reqTimeout').value = p.timeout ?? 120;
  document.getElementById('reqRetry').value = p.retry ?? 2;
  document.getElementById('useStream').checked = p.stream !== false;
  const px = p.proxy || {};
  document.getElementById('useProxy').checked = px.enabled === true;
  document.getElementById('proxyMode').value = px.mode || 'system';
  document.getElementById('proxyUrl').value = px.url || '';
  updateProxyUI();
  const scope = data.shortenScope || { en: true, es: true, pt: true, zh: true };
  document.getElementById('shortenEn').checked = scope.en !== false;
  document.getElementById('shortenEs').checked = scope.es !== false;
  document.getElementById('shortenPt').checked = scope.pt !== false;
  document.getElementById('shortenZh').checked = scope.zh !== false;
}

function loadSettings() {
  const data = loadProfilesStore();
  renderProfileSelect();
  loadProfileToForm(data.activeId);
}

// 把表单内容收集成配置对象（保存 / 测试连接 / 获取模型 三处共用）
function readFormToProfile() {
  const num = (id, dft) => {
    const v = parseFloat(document.getElementById(id).value);
    return Number.isFinite(v) ? v : dft;
  };
  return {
    name: document.getElementById('profileName').value.trim() || '未命名配置',
    base: document.getElementById('apiBase').value.trim().replace(/\/+$/, ''),
    key: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('apiModel').value.trim(),
    temp: num('apiTemp', 0.7),
    maxTokens: Math.round(num('apiMaxTokens', 4000)),
    charLimit: Math.round(num('charLimit', 55)),
    charLimitCN: Math.round(num('charLimitCN', 60)),
    timeout: Math.max(0, Math.round(num('reqTimeout', 120))),
    retry: Math.min(5, Math.max(0, Math.round(num('reqRetry', 2)))),
    stream: document.getElementById('useStream').checked,
    proxy: {
      enabled: document.getElementById('useProxy').checked,
      mode: document.getElementById('proxyMode').value,
      url: document.getElementById('proxyUrl').value.trim().replace(/\/+$/, ''),
    },
  };
}

function saveSettings() {
  try {
    const data = loadProfilesStore();
    const p = data.profiles.find(x => x.id === data.activeId);
    if (!p) { showError('未找到当前配置'); return; }
    Object.assign(p, readFormToProfile());
    data.shortenScope = {
      en: document.getElementById('shortenEn').checked,
      es: document.getElementById('shortenEs').checked,
      pt: document.getElementById('shortenPt').checked,
      zh: document.getElementById('shortenZh').checked,
    };
    saveProfilesStore(data);
    renderProfileSelect();
    flash('已保存：' + p.name);
  } catch (err) {
    showError('保存失败：' + (err.message || err));
  }
}

function switchProfile(id) {
  try {
    const data = loadProfilesStore();
    if (!data.profiles.find(p => p.id === id)) return;
    data.activeId = id;
    saveProfilesStore(data);
    loadProfileToForm(id);
    renderProfileSelect();
    const p = data.profiles.find(x => x.id === id);
    flash('已切换到：' + p.name);
  } catch (err) {
    showError('切换失败：' + (err.message || err));
  }
}

// 生成不与现有配置重名的名称
function uniqueProfileName(data, base) {
  if (!data.profiles.some(p => p.name === base)) return base;
  let i = 2;
  while (data.profiles.some(p => p.name === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function newProfile() {
  const presetNames = Object.keys(PROFILE_PRESETS);
  const presetChoice = prompt(`选择预设模板（输入序号）：\n${presetNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`, '1');
  if (presetChoice === null) return;
  const idx = parseInt(presetChoice) - 1;
  const presetName = presetNames[idx] || '空白';
  const preset = PROFILE_PRESETS[presetName];
  try {
    const data = loadProfilesStore();
    const id = genId();
    const name = uniqueProfileName(data, presetName);
    // 名称、接口地址等细节可直接在表单里继续改
    data.profiles.push(normalizeProfile({ id, name, ...preset }, data));
    data.activeId = id;
    saveProfilesStore(data);
    loadProfileToForm(id);
    renderProfileSelect();
    flash('已新建：' + name);
  } catch (err) {
    showError('新建失败：' + (err.message || err));
  }
}

// ===== 代理 UI =====
// 开启代理后显示模式与地址；system 模式额外提供 proxy.txt 下载（供网页版启动器读取）
function updateProxyUI() {
  const on = document.getElementById('useProxy').checked;
  const mode = document.getElementById('proxyMode').value;
  document.getElementById('proxyFields').classList.toggle('hidden', !on);
  document.getElementById('proxyHint').classList.toggle('hidden', !on);
  document.getElementById('btnExportProxy').classList.toggle('hidden', !(on && mode === 'system'));
  if (!on) return;
  document.getElementById('proxyHint').innerHTML = mode === 'prefix'
    ? '中转模式：请求会发往「代理地址 + 接口地址」。需要你自己有一个能转发请求的中转服务（one-api 网关、cors 代理等）。本机 Clash 这类正向代理<b>不适用</b>此模式。'
    : '本机 / 系统代理：<b>网页版</b>请点下方按钮下载 <code>proxy.txt</code> 放到工具目录，启动器会自动加 <code>--proxy-server</code>；<b>客户端版</b>默认走系统代理，也可在打包时用 <code>--proxy-url</code> 固定代理。';
}

function downloadProxyTxt() {
  const url = document.getElementById('proxyUrl').value.trim();
  if (!url) { showError('请先填写代理地址'); return; }
  try {
    downloadTextFile('proxy.txt', url + '\n', 'text/plain');
    flash('已下载 proxy.txt，请放到工具目录下');
  } catch (err) {
    showError('下载失败：' + (err.message || err));
  }
}

// 一次 GET/POST 请求：带空闲超时 + 429/5xx 重试（复用请求层的闸门与退避原语）。
// 失败抛出的 error 上带 status（HTTP 状态码），供调用方判断分支；响应体不是 JSON 时返回 {}。
// ===== 获取模型列表 =====
async function fetchModels() {
  const p = readFormToProfile();
  if (!p.base) { showError('请先填写接口地址'); return; }
  if (!p.key) { showError('请先填写 API Key'); return; }
  const btn = document.getElementById('btnFetchModels');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '获取中...';
  try {
    const data = await fetchJsonWithRetry(
      buildApiUrl(p, '/models'),
      { headers: { 'Authorization': 'Bearer ' + p.key } },
      { timeoutMs: (p.timeout ?? 120) * 1000, retry: 1 },
    );
    const ids = (Array.isArray(data.data) ? data.data : [])
      .map(m => m && (m.id || m.name)).filter(Boolean).sort();
    if (!ids.length) { showToast('接口未返回任何模型', 'info'); return; }
    document.getElementById('modelOptions').innerHTML =
      ids.map(id => `<option value="${escapeHtml(id)}"></option>`).join('');
    const input = document.getElementById('apiModel');
    if (!input.value.trim()) input.value = ids[0];
    showToast(`已获取 ${ids.length} 个模型，点输入框可选择`, 'success', 3000);
  } catch (err) {
    showError('获取模型列表失败：' + (err.message || err));
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

// ===== 测试连接 =====
// 先试 GET /models（不耗 token），接口不支持时回退一次 1-token 对话
async function testConnection() {
  const p = readFormToProfile();
  if (!p.base) { showError('请先填写接口地址'); return; }
  if (!p.key) { showError('请先填写 API Key'); return; }
  const btn = document.getElementById('btnTestProfile');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '测试中...';
  // 测试连接要的是「真实一次往返」，所以不重试（重试会让延迟数字失真）
  const opts = { timeoutMs: (p.timeout ?? 120) * 1000, retry: 0 };
  try {
    const t0 = Date.now();
    try {
      const data = await fetchJsonWithRetry(buildApiUrl(p, '/models'), { headers: { 'Authorization': 'Bearer ' + p.key } }, opts);
      const n = Array.isArray(data.data) ? data.data.length : 0;
      flash(`连接正常 · ${Date.now() - t0}ms${n ? ` · 共 ${n} 个模型` : ''}`);
      return;
    } catch (e) {
      // 部分服务不提供 /models，回退一次最小对话
      if ([400, 403, 404, 405, 501].includes(e.status)) {
        if (!p.model) { showError('接口未提供 /models，请先填默认模型再测试'); return; }
        const t1 = Date.now();
        await fetchJsonWithRetry(buildApiUrl(p, '/chat/completions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + p.key },
          body: JSON.stringify(ProviderAdapters.buildChatRequest(p, { stream: false, maxTokens: 1, messages: [{ role: 'user', content: 'ping' }] })),
        }, opts);
        flash(`连接正常 · ${Date.now() - t1}ms（该接口不提供 /models）`);
        return;
      }
      throw e;
    }
  } catch (err) {
    showError('连接失败：' + (err.message || err));
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

function duplicateProfile() {
  const data = loadProfilesStore();
  const p = data.profiles.find(x => x.id === data.activeId);
  if (!p) return;
  try {
    const id = genId();
    const copy = normalizeProfile({ ...p, id, name: uniqueProfileName(data, p.name + ' 副本') }, data);
    data.profiles.push(copy);
    data.activeId = id;
    saveProfilesStore(data);
    loadProfileToForm(id);
    renderProfileSelect();
    flash('已复制：' + copy.name);
  } catch (err) {
    showError('复制失败：' + (err.message || err));
  }
}

function deleteProfile() {
  const data = loadProfilesStore();
  if (data.profiles.length <= 1) {
    showError('至少保留一个配置，无法删除');
    return;
  }
  const p = data.profiles.find(x => x.id === data.activeId);
  if (!p) return;
  if (!confirm(`确认删除配置「${p.name}」？此操作不可撤销。`)) return;
  try {
    data.profiles = data.profiles.filter(x => x.id !== data.activeId);
    data.activeId = data.profiles[0].id;
    saveProfilesStore(data);
    loadProfileToForm(data.activeId);
    renderProfileSelect();
    flash('已删除：' + p.name);
  } catch (err) {
    showError('删除失败：' + (err.message || err));
  }
}

// 旧版 Prompt 里的「逐字符数一遍」+【字符计数示范】会让模型真的去逐字数数，是主要延迟来源。
// 这里做一次无损清理：只摘掉这两个拖慢速度的片段，用户其余的 Prompt 自定义内容原样保留。
function migrateGlobalPrompt(p) {
  if (!p) return p;
  // 未命中旧片段就原样返回，绝不改动用户已自定义的 Prompt
  if (!/逐字符数一遍|【字符计数示范】/.test(p)) return p;
  // 1) 删掉「逐字符数一遍」那一整条
  let out = p.split('\n').filter(line => !/逐字符数一遍/.test(line)).join('\n');
  // 2) 删掉整段【字符计数示范】
  out = out.replace(/【字符计数示范】[\s\S]*?\n\n/, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
function loadGlobalPrompt() {
  const raw = localStorage.getItem(STORE.globalPrompt) || DEFAULT_GLOBAL_PROMPT;
  const p = migrateGlobalPrompt(raw);
  document.getElementById('globalPrompt').value = p;
  // 迁移生效则落盘，避免每次进来重复处理
  if (p !== raw) {
    try { localStorage.setItem(STORE.globalPrompt, p); } catch {}
    console.info('[prompt] 已自动清理旧版 Prompt 中拖慢速度的「逐字符数一遍」/「字符计数示范」片段');
  }
}
function saveGlobalPrompt() {
  try {
    localStorage.setItem(STORE.globalPrompt, document.getElementById('globalPrompt').value);
    flash('全局 Prompt 已保存');
  } catch (err) {
    showError('保存失败：' + (err.message || err));
  }
}
function resetGlobalPrompt() {
  try {
    document.getElementById('globalPrompt').value = DEFAULT_GLOBAL_PROMPT;
    localStorage.removeItem(STORE.globalPrompt);
    flash('已恢复默认 Prompt');
  } catch (err) {
    showError('恢复失败：' + (err.message || err));
  }
}

function flash(msg) {
  showToast(msg, 'success');
}
function showError(msg) {
  showToast(msg, 'error');
}

// ===== Toast 系统 =====
function ensureToastContainer() {
  let c = document.getElementById('toastContainer');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toastContainer';
    c.className = 'fixed top-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(c);
  }
  return c;
}
function showToast(msg, type = 'success', duration = 2200) {
  const c = ensureToastContainer();
  const t = document.createElement('div');
  const cfg = {
    success: { bg: 'bg-emerald-600', icon: '✓' },
    error:   { bg: 'bg-rose-600',    icon: '✗' },
    info:    { bg: 'bg-slate-700',   icon: 'ℹ' },
  }[type] || { bg: 'bg-slate-700', icon: '•' };
  t.className = `pointer-events-auto ${cfg.bg} text-white px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 text-sm min-w-[200px] max-w-[360px] transition-all duration-300 transform translate-x-4 opacity-0`;
  t.innerHTML = `<span class="text-base leading-none">${cfg.icon}</span><span class="flex-1 break-words">${escapeHtml(String(msg))}</span>`;
  c.appendChild(t);
  requestAnimationFrame(() => {
    t.classList.remove('translate-x-4', 'opacity-0');
  });
  setTimeout(() => {
    t.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ===== 字符计数 =====
// 英文/西语/葡语：原始长度（含空格）
// 中文：一个汉字算 2 字符（按中文平台惯例）
// ===== Prompt 注释预处理 =====
// 以 // 或 #! 开头的行（允许前置空白）会被剥掉再发给 AI
// ===== 请求地址构造（含代理） =====
// mode=prefix 时把原始地址拼在代理地址之后，交给中转服务转发；
// mode=system 时地址不变，由启动器（--proxy-server）或系统代理接管。
// ===== 请求闸门：空闲超时 + 外部取消 =====
// 超时按「多久没收到数据」计算（每收到内容 bump() 一次自动重置），所以流式长任务不会被误杀。
// 必须把 cleanup() 放进 finally，否则定时器会一直挂着。
// 把 fetch / AbortController 抛出的原始错误转成中文，并标注「取消 / 超时 / 网络错误」
// 指数退避 + 抖动（避免多路并发同时重试撞在一起）；优先遵守服务端的 Retry-After
// 可被取消打断的等待
// 判断一次失败是否值得重试：429 / 5xx / 网络中断可重试；用户取消、空闲超时、其余 4xx 不重试
// opts: { temperature, maxTokens, messages, stream, signal, timeout, retry, onRetry }
// 不传则用配置里的默认值；请求失败会按 429/5xx/网络错误自动重试（指数退避）
// 去除 markdown 代码块包裹：```json\n{...}\n``` → {...}
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
const LANG_EN_NAME = { en: 'English', es: 'Español', pt: 'Português', zh: '中文' };
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

document.getElementById('btnGTTranslate').addEventListener('click', async () => {
  const src = document.getElementById('gtSource').value;
  const target = document.getElementById('gtTargetLang').value;
  const hint = document.getElementById('gtHint');
  const out = document.getElementById('gtTarget');
  if (!src.trim()) { hint.textContent = '请先输入原文'; return; }
  hint.textContent = '翻译中...';
  try {
    const t0 = Date.now();
    const result = await googleTranslate(src, target);
    out.value = result;
    hint.textContent = `✓ 完成 (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
    setTimeout(() => hint.textContent = '', 2500);
  } catch (e) {
    hint.textContent = '✗ ' + e.message + '（若为 Failed to fetch，多为跨域被拦：检查网络/代理，或改用启动器版 Chrome）';
  }
});

document.getElementById('btnApplyToOriginal').addEventListener('click', () => {
  const src = document.getElementById('gtSource').value.trim();
  if (!src) { document.getElementById('gtHint').textContent = '原文为空'; return; }
  const target = document.getElementById('inputTitle');
  target.value = src;
  target.focus();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const hint = document.getElementById('gtHint');
  hint.textContent = '✓ 已应用到原始标题';
  setTimeout(() => hint.textContent = '', 2500);
});

document.getElementById('btnClearGT').addEventListener('click', () => {
  document.getElementById('gtSource').value = '';
  document.getElementById('gtTarget').value = '';
  document.getElementById('gtHint').textContent = '';
});

// 快捷键：Ctrl+Enter 在源框中触发翻译
document.getElementById('gtSource').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btnGTTranslate').click();
  }
});

// ===== 初始化 =====
loadSettings();
loadGlobalPrompt();
document.getElementById('fastMode').checked = localStorage.getItem('translator_fast_mode') === '1';
