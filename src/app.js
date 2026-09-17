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
