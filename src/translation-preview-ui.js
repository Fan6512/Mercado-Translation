// Translation preview UI/runtime controller v2.
// Keeps the workspace compact: vendor selection stays in the header while free/official modes live in settings.
(function (global) {
  'use strict';

  const STORE_KEY = 'translator_translation_preview_settings_v1';
  const DEFAULT_SYSTEM_PROMPT = 'You are a professional e-commerce translator. Translate accurately and naturally. Preserve product names, model numbers, dimensions and units. Do not add explanations. Output only the translation.';
  const DEFAULT_USER_PROMPT = 'Translate the following text from {{from}} to {{to}}. Output only the translated text:\n\n{{text}}';
  const DEFAULT_AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';
  const DEFAULTS = Object.freeze({
    provider: 'auto',
    autoStrategy: 'free-first',
    timeoutSec: 6,
    google: {
      mode: 'auto',
      cloudApiKey: '',
    },
    microsoft: {
      mode: 'auto',
      azureEndpoint: DEFAULT_AZURE_ENDPOINT,
      azureKey: '',
      azureRegion: '',
    },
    baidu: { appId: '', secret: '' },
    ai: {
      mode: 'current',
      base: '',
      key: '',
      model: '',
      temperature: 0.2,
      maxTokens: 800,
      followCurrentProxy: true,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      userPrompt: DEFAULT_USER_PROMPT,
    },
  });

  let installed = false;
  let activeTab = 'general';

  function byId(id) { return document.getElementById(id); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function mergeSettings(raw) {
    const out = clone(DEFAULTS);
    if (!raw || typeof raw !== 'object') return out;
    if (['auto','google','microsoft','baidu','ai'].includes(raw.provider)) out.provider = raw.provider;
    if (['free-first','stable-first','china-first','ai-first'].includes(raw.autoStrategy)) out.autoStrategy = raw.autoStrategy;
    const timeout = Number(raw.timeoutSec);
    if (Number.isFinite(timeout)) out.timeoutSec = Math.min(30, Math.max(3, Math.round(timeout)));
    out.google = { ...out.google, ...(raw.google || {}) };
    if (!['auto','free','cloud'].includes(out.google.mode)) out.google.mode = 'auto';
    out.microsoft = { ...out.microsoft, ...(raw.microsoft || {}) };
    if (!['auto','bing','azure'].includes(out.microsoft.mode)) out.microsoft.mode = 'auto';
    out.microsoft.azureEndpoint = String(out.microsoft.azureEndpoint || DEFAULT_AZURE_ENDPOINT).trim().replace(/\/+$/, '') || DEFAULT_AZURE_ENDPOINT;
    out.baidu = { ...out.baidu, ...(raw.baidu || {}) };
    out.ai = { ...out.ai, ...(raw.ai || {}) };
    return out;
  }

  function loadSettings() {
    try { return mergeSettings(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); }
    catch (_) { return clone(DEFAULTS); }
  }

  function saveSettings(settings) {
    const normalized = mergeSettings(settings);
    localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function providerLabel(provider) {
    return global.TranslationPreviewProviders?.labels?.[provider] || provider;
  }

  function candidateLabel(candidate) {
    return global.TranslationPreviewProviders?.candidateLabels?.[candidate] || providerLabel(candidate);
  }

  function setHint(text, tone) {
    const hint = byId('gtHint');
    if (!hint) return;
    hint.textContent = text || '';
    hint.classList.remove('translation-hint-ok','translation-hint-error','translation-hint-busy');
    if (tone) hint.classList.add('translation-hint-' + tone);
  }

  function currentApiSummary() {
    try {
      const p = typeof global.getSettings === 'function' ? global.getSettings() : null;
      if (!p) return '当前 API 配置不可用';
      const name = p.name || '当前配置';
      const model = p.model || '未设置模型';
      const base = p.base || '未设置 Base URL';
      return `${name} · ${model} · ${base}`;
    } catch (_) {
      return '当前 API 配置不可用';
    }
  }

  function resolvedVendorSuffix(vendor, settings) {
    const adapters = global.TranslationPreviewProviders;
    const candidate = adapters?.resolveCandidates?.(vendor, settings)?.[0] || '';
    if (candidate === 'google-cloud') return 'Cloud';
    if (candidate === 'google-free') return '免费';
    if (candidate === 'microsoft-azure') return 'Azure';
    if (candidate === 'microsoft-bing') return 'Bing';
    return '';
  }

  function refreshProviderOptions(settings = loadSettings()) {
    const source = byId('gtProvider');
    if (!source) return;
    const selected = source.value || settings.provider || 'auto';
    const googleSuffix = resolvedVendorSuffix('google', settings);
    const microsoftSuffix = resolvedVendorSuffix('microsoft', settings);
    source.innerHTML = [
      ['auto','自动'],
      ['google',`Google${googleSuffix ? ' · ' + googleSuffix : ''}`],
      ['microsoft',`Microsoft${microsoftSuffix ? ' · ' + microsoftSuffix : ''}`],
      ['baidu','百度 API'],
      ['ai','AI 翻译'],
    ].map(([value,label]) => `<option value="${value}">${label}</option>`).join('');
    source.value = ['auto','google','microsoft','baidu','ai'].includes(selected) ? selected : 'auto';
  }

  function mountTopControls() {
    const target = byId('gtTargetLang');
    if (!target || byId('gtProvider')) return;
    const row = target.parentElement;
    if (!row) return;
    row.classList.add('translation-control-row');

    const sourceLabel = document.createElement('label');
    sourceLabel.className = 'translation-control-label';
    sourceLabel.setAttribute('for', 'gtProvider');
    sourceLabel.textContent = '翻译源';

    const source = document.createElement('select');
    source.id = 'gtProvider';
    source.className = 'translation-provider-select';
    row.append(sourceLabel, source);
    refreshProviderOptions(loadSettings());
    source.addEventListener('change', () => {
      const settings = loadSettings();
      settings.provider = source.value;
      saveSettings(settings);
    });

    const settingsButton = document.createElement('button');
    settingsButton.id = 'btnTranslationSettings';
    settingsButton.type = 'button';
    settingsButton.className = 'translation-settings-button';
    settingsButton.innerHTML = '<span aria-hidden="true">⚙</span><span>翻译设置</span>';
    settingsButton.addEventListener('click', () => openDrawer('general'));
    row.appendChild(settingsButton);
  }

  function drawerMarkup() {
    return `
      <div id="translationSettingsOverlay" class="translation-settings-overlay hidden" aria-hidden="true"></div>
      <aside id="translationSettingsDrawer" class="translation-settings-drawer hidden" aria-label="翻译设置">
        <div class="translation-settings-header">
          <div>
            <div class="translation-settings-eyebrow">TRANSLATION</div>
            <h2>翻译设置</h2>
            <p>厂商级设置：免费链路与正式 API 独立配置，自动模式按可用性和策略选择。</p>
          </div>
          <button id="btnCloseTranslationSettings" class="translation-drawer-close" type="button" aria-label="关闭">×</button>
        </div>

        <div class="translation-settings-tabs" role="tablist">
          <button type="button" data-translation-tab="general">通用</button>
          <button type="button" data-translation-tab="google">Google</button>
          <button type="button" data-translation-tab="microsoft">Microsoft</button>
          <button type="button" data-translation-tab="baidu">百度</button>
          <button type="button" data-translation-tab="ai">AI</button>
        </div>

        <div class="translation-settings-scroll">
          <section class="translation-settings-pane" data-translation-pane="general">
            <div class="translation-setting-card">
              <div class="translation-setting-head">
                <div><h3>自动模式</h3><p>不可用、限流或超时时自动尝试下一候选源；未配置的正式 API 直接跳过。</p></div>
              </div>
              <label class="translation-field">
                <span>优先策略</span>
                <select id="translationAutoStrategy">
                  <option value="free-first">免费优先 · Microsoft Bing → Google 免费 → 百度 → 正式 API → AI</option>
                  <option value="stable-first">稳定优先 · Google Cloud → Azure → 百度 → 免费源 → AI</option>
                  <option value="china-first">国内稳定优先 · 百度 → Microsoft → Google → AI</option>
                  <option value="ai-first">AI 优先 · AI → 正式 API → 百度 → 免费源</option>
                </select>
              </label>
              <label class="translation-field translation-field-compact">
                <span>单个源基础超时</span>
                <div class="translation-number-with-unit"><input id="translationTimeoutSec" type="number" min="3" max="30" step="1"><b>秒</b></div>
              </label>
            </div>
            <div class="translation-note-card">
              <strong>自动容错不会反复轰炸失败接口。</strong>
              <span>Google 免费遇到 429 会进入冷却；Microsoft Bing 网络失败短暂冷却；官方 API 的认证错误会用简洁状态提示，不会把 HTML 错误页直接塞进界面。</span>
            </div>
          </section>

          <section class="translation-settings-pane hidden" data-translation-pane="google">
            <div class="translation-setting-card">
              <div class="translation-setting-head">
                <div><h3>Google 翻译</h3><p>同一厂商保留免费实验链路与 Google Cloud Translation Basic v2。</p></div>
                <span class="translation-badge">Google</span>
              </div>
              <label class="translation-field">
                <span>模式</span>
                <select id="translationGoogleMode">
                  <option value="auto">自动 · 已配置 Cloud 时优先 Cloud，否则免费接口</option>
                  <option value="free">Google 免费接口</option>
                  <option value="cloud">Google Cloud Translation</option>
                </select>
              </label>
              <div class="translation-provider-info">
                <div><span>免费接口</span><strong>无需 Key · 可能 429</strong></div>
                <div><span>正式接口</span><strong>Cloud Translation Basic v2</strong></div>
                <div><span>网络</span><strong>跟随当前 API 代理</strong></div>
              </div>
              <p class="translation-small-note">Google 免费接口属于非正式兼容链路，IP 风控时会冷却；Cloud 模式使用官方 Basic v2 REST API。</p>

              <div id="translationGoogleCloudFields" class="translation-provider-official-fields">
                <label class="translation-field"><span>Google Cloud API Key</span><input id="translationGoogleCloudKey" type="password" autocomplete="new-password" placeholder="API Key 仅保存在本机"></label>
                <div class="translation-current-api">Endpoint · https://translation.googleapis.com/language/translate/v2</div>
              </div>
              <div class="translation-inline-actions">
                <button id="btnTestGoogleTranslation" type="button" class="translation-secondary-button">测试当前模式</button>
                <span id="translationGoogleStatus" class="translation-test-status"></span>
              </div>
            </div>
          </section>

          <section class="translation-settings-pane hidden" data-translation-pane="microsoft">
            <div class="translation-setting-card">
              <div class="translation-setting-head">
                <div><h3>Microsoft 翻译</h3><p>Bing 免费链路与 Azure Translator 正式 API 分开配置。</p></div>
                <span class="translation-badge">Microsoft</span>
              </div>
              <label class="translation-field">
                <span>模式</span>
                <select id="translationMicrosoftMode">
                  <option value="auto">自动 · 已配置 Azure 时优先 Azure，否则 Bing 免费</option>
                  <option value="bing">Bing 免费</option>
                  <option value="azure">Azure Translator</option>
                </select>
              </label>
              <div class="translation-provider-info">
                <div><span>Bing 免费</span><strong>无需 Key · Experimental</strong></div>
                <div><span>Azure</span><strong>Translator REST v3</strong></div>
                <div><span>网络</span><strong>跟随当前 API 代理</strong></div>
              </div>
              <p class="translation-small-note">Bing 免费模式在客户端通过 Native HTTP 调用；Azure 模式使用官方 Translator v3，Global 单服务资源可不填 Region。</p>

              <div id="translationMicrosoftAzureFields" class="translation-provider-official-fields">
                <label class="translation-field"><span>Endpoint</span><input id="translationMicrosoftAzureEndpoint" type="text" placeholder="https://api.cognitive.microsofttranslator.com"></label>
                <label class="translation-field"><span>Subscription Key</span><input id="translationMicrosoftAzureKey" type="password" autocomplete="new-password" placeholder="Azure Translator Key"></label>
                <label class="translation-field"><span>Region（可选）</span><input id="translationMicrosoftAzureRegion" type="text" autocomplete="off" placeholder="Global 单服务资源留空；regional / multi-service 填区域"></label>
              </div>
              <div class="translation-inline-actions">
                <button id="btnTestMicrosoftTranslation" type="button" class="translation-secondary-button">测试当前模式</button>
                <span id="translationMicrosoftStatus" class="translation-test-status"></span>
              </div>
            </div>
          </section>

          <section class="translation-settings-pane hidden" data-translation-pane="baidu">
            <div class="translation-setting-card">
              <div class="translation-setting-head">
                <div><h3>百度翻译 API</h3><p>官方通用文本翻译，国内网络环境下作为稳定备用。</p></div>
                <span class="translation-badge">官方 API</span>
              </div>
              <label class="translation-field"><span>APP ID</span><input id="translationBaiduAppId" type="text" autocomplete="off" placeholder="填写百度翻译 APP ID"></label>
              <label class="translation-field"><span>Secret Key</span><input id="translationBaiduSecret" type="password" autocomplete="new-password" placeholder="仅保存在本机"></label>
              <div class="translation-inline-actions">
                <button id="btnTestBaiduTranslation" type="button" class="translation-secondary-button">测试连接</button>
                <span id="translationBaiduStatus" class="translation-test-status"></span>
              </div>
            </div>
          </section>

          <section class="translation-settings-pane hidden" data-translation-pane="ai">
            <div class="translation-setting-card">
              <div class="translation-setting-head">
                <div><h3>AI 翻译</h3><p>OpenAI Compatible 接口，支持独立 Prompt，适合商品标题和短文本。</p></div>
                <span class="translation-badge">Prompt</span>
              </div>
              <label class="translation-field">
                <span>API 配置</span>
                <select id="translationAiMode">
                  <option value="current">使用当前 API 配置</option>
                  <option value="custom">使用独立翻译 API</option>
                </select>
              </label>
              <div id="translationCurrentApiSummary" class="translation-current-api"></div>
              <div id="translationAiCustomFields" class="translation-ai-custom hidden">
                <label class="translation-field"><span>Base URL</span><input id="translationAiBase" type="text" placeholder="https://api.example.com/v1"></label>
                <label class="translation-field"><span>API Key</span><input id="translationAiKey" type="password" autocomplete="new-password" placeholder="sk-... / 可为空"></label>
                <label class="translation-field"><span>模型</span><input id="translationAiModel" type="text" placeholder="gpt-5.6-luna / deepseek-chat / ..."></label>
                <div class="translation-two-col">
                  <label class="translation-field"><span>Temperature</span><input id="translationAiTemperature" type="number" min="0" max="2" step="0.1"></label>
                  <label class="translation-field"><span>Max Tokens</span><input id="translationAiMaxTokens" type="number" min="64" max="8000" step="64"></label>
                </div>
                <label class="translation-check"><input id="translationAiFollowProxy" type="checkbox"><span>独立接口沿用当前 API 配置的代理设置</span></label>
              </div>
            </div>
            <div class="translation-setting-card translation-prompt-card">
              <div class="translation-setting-head">
                <div><h3>翻译 Prompt</h3><p>支持 <code>{{text}}</code>、<code>{{from}}</code>、<code>{{to}}</code>。</p></div>
                <button id="btnResetTranslationPrompt" type="button" class="translation-link-button">恢复默认</button>
              </div>
              <label class="translation-field"><span>System Prompt</span><textarea id="translationAiSystemPrompt" rows="6"></textarea></label>
              <label class="translation-field"><span>User Prompt</span><textarea id="translationAiUserPrompt" rows="6"></textarea></label>
              <div class="translation-inline-actions">
                <button id="btnTestAiTranslation" type="button" class="translation-secondary-button">测试连接</button>
                <span id="translationAiStatus" class="translation-test-status"></span>
              </div>
            </div>
          </section>
        </div>

        <div class="translation-settings-footer">
          <span>密钥与配置仅保存在当前客户端本地，不写入仓库。</span>
          <div>
            <button id="btnCancelTranslationSettings" type="button" class="translation-secondary-button">取消</button>
            <button id="btnSaveTranslationSettings" type="button" class="translation-primary-button">保存设置</button>
          </div>
        </div>
      </aside>`;
  }

  function mountDrawer() {
    if (byId('translationSettingsDrawer')) return;
    const host = document.createElement('div');
    host.id = 'translationSettingsHost';
    host.innerHTML = drawerMarkup();
    document.body.appendChild(host);

    byId('btnCloseTranslationSettings').addEventListener('click', closeDrawer);
    byId('btnCancelTranslationSettings').addEventListener('click', closeDrawer);
    byId('translationSettingsOverlay').addEventListener('click', closeDrawer);
    byId('btnSaveTranslationSettings').addEventListener('click', saveDrawerSettings);
    byId('translationGoogleMode').addEventListener('change', syncGoogleMode);
    byId('translationMicrosoftMode').addEventListener('change', syncMicrosoftMode);
    byId('translationAiMode').addEventListener('change', syncAiMode);
    byId('btnResetTranslationPrompt').addEventListener('click', resetPrompts);
    byId('btnTestGoogleTranslation').addEventListener('click', () => testProvider('google'));
    byId('btnTestMicrosoftTranslation').addEventListener('click', () => testProvider('microsoft'));
    byId('btnTestBaiduTranslation').addEventListener('click', () => testProvider('baidu'));
    byId('btnTestAiTranslation').addEventListener('click', () => testProvider('ai'));
    document.querySelectorAll('[data-translation-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.translationTab));
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !byId('translationSettingsDrawer')?.classList.contains('hidden')) closeDrawer();
    });
  }

  function fillDrawer(settings) {
    byId('translationAutoStrategy').value = settings.autoStrategy;
    byId('translationTimeoutSec').value = String(settings.timeoutSec);
    byId('translationGoogleMode').value = settings.google.mode || 'auto';
    byId('translationGoogleCloudKey').value = settings.google.cloudApiKey || '';
    byId('translationMicrosoftMode').value = settings.microsoft.mode || 'auto';
    byId('translationMicrosoftAzureEndpoint').value = settings.microsoft.azureEndpoint || DEFAULT_AZURE_ENDPOINT;
    byId('translationMicrosoftAzureKey').value = settings.microsoft.azureKey || '';
    byId('translationMicrosoftAzureRegion').value = settings.microsoft.azureRegion || '';
    byId('translationBaiduAppId').value = settings.baidu.appId || '';
    byId('translationBaiduSecret').value = settings.baidu.secret || '';
    byId('translationAiMode').value = settings.ai.mode || 'current';
    byId('translationAiBase').value = settings.ai.base || '';
    byId('translationAiKey').value = settings.ai.key || '';
    byId('translationAiModel').value = settings.ai.model || '';
    byId('translationAiTemperature').value = String(settings.ai.temperature ?? 0.2);
    byId('translationAiMaxTokens').value = String(settings.ai.maxTokens ?? 800);
    byId('translationAiFollowProxy').checked = settings.ai.followCurrentProxy !== false;
    byId('translationAiSystemPrompt').value = settings.ai.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    byId('translationAiUserPrompt').value = settings.ai.userPrompt || DEFAULT_USER_PROMPT;
    byId('translationCurrentApiSummary').textContent = currentApiSummary();
    syncGoogleMode();
    syncMicrosoftMode();
    syncAiMode();
  }

  function readDrawerSettings() {
    const existing = loadSettings();
    return mergeSettings({
      ...existing,
      provider: byId('gtProvider')?.value || existing.provider,
      autoStrategy: byId('translationAutoStrategy').value,
      timeoutSec: Number(byId('translationTimeoutSec').value),
      google: {
        mode: byId('translationGoogleMode').value,
        cloudApiKey: byId('translationGoogleCloudKey').value.trim(),
      },
      microsoft: {
        mode: byId('translationMicrosoftMode').value,
        azureEndpoint: byId('translationMicrosoftAzureEndpoint').value.trim().replace(/\/+$/, '') || DEFAULT_AZURE_ENDPOINT,
        azureKey: byId('translationMicrosoftAzureKey').value.trim(),
        azureRegion: byId('translationMicrosoftAzureRegion').value.trim(),
      },
      baidu: {
        appId: byId('translationBaiduAppId').value.trim(),
        secret: byId('translationBaiduSecret').value.trim(),
      },
      ai: {
        ...existing.ai,
        mode: byId('translationAiMode').value,
        base: byId('translationAiBase').value.trim().replace(/\/+$/, ''),
        key: byId('translationAiKey').value.trim(),
        model: byId('translationAiModel').value.trim(),
        temperature: Number(byId('translationAiTemperature').value),
        maxTokens: Number(byId('translationAiMaxTokens').value),
        followCurrentProxy: byId('translationAiFollowProxy').checked,
        systemPrompt: byId('translationAiSystemPrompt').value.trim() || DEFAULT_SYSTEM_PROMPT,
        userPrompt: byId('translationAiUserPrompt').value.trim() || DEFAULT_USER_PROMPT,
      },
    });
  }

  function saveDrawerSettings() {
    const settings = saveSettings(readDrawerSettings());
    refreshProviderOptions(settings);
    if (byId('gtProvider')) byId('gtProvider').value = settings.provider;
    closeDrawer();
    if (typeof global.showToast === 'function') global.showToast('翻译设置已保存', 'success', 2200);
    else setHint('✓ 翻译设置已保存', 'ok');
  }

  function resetPrompts() {
    byId('translationAiSystemPrompt').value = DEFAULT_SYSTEM_PROMPT;
    byId('translationAiUserPrompt').value = DEFAULT_USER_PROMPT;
  }

  function syncGoogleMode() {
    const mode = byId('translationGoogleMode')?.value || 'auto';
    byId('translationGoogleCloudFields')?.classList.toggle('hidden', mode === 'free');
  }

  function syncMicrosoftMode() {
    const mode = byId('translationMicrosoftMode')?.value || 'auto';
    byId('translationMicrosoftAzureFields')?.classList.toggle('hidden', mode === 'bing');
  }

  function syncAiMode() {
    const custom = byId('translationAiMode')?.value === 'custom';
    byId('translationAiCustomFields')?.classList.toggle('hidden', !custom);
    byId('translationCurrentApiSummary')?.classList.toggle('hidden', custom);
  }

  function switchTab(tab) {
    activeTab = ['general','google','microsoft','baidu','ai'].includes(tab) ? tab : 'general';
    document.querySelectorAll('[data-translation-tab]').forEach(btn => {
      const active = btn.dataset.translationTab === activeTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-translation-pane]').forEach(pane => {
      pane.classList.toggle('hidden', pane.dataset.translationPane !== activeTab);
    });
  }

  function openDrawer(tab) {
    mountDrawer();
    fillDrawer(loadSettings());
    switchTab(tab || activeTab || 'general');
    const overlay = byId('translationSettingsOverlay');
    const drawer = byId('translationSettingsDrawer');
    overlay.classList.remove('hidden');
    drawer.classList.remove('hidden');
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      drawer.classList.add('is-open');
    });
  }

  function closeDrawer() {
    const overlay = byId('translationSettingsOverlay');
    const drawer = byId('translationSettingsDrawer');
    if (!overlay || !drawer) return;
    overlay.classList.remove('is-open');
    drawer.classList.remove('is-open');
    setTimeout(() => {
      overlay.classList.add('hidden');
      drawer.classList.add('hidden');
    }, 180);
  }

  function configurationTab(candidateOrProvider) {
    const value = String(candidateOrProvider || '');
    if (value.startsWith('google')) return 'google';
    if (value.startsWith('microsoft')) return 'microsoft';
    if (value === 'baidu') return 'baidu';
    if (value === 'ai') return 'ai';
    return 'general';
  }

  function conciseError(candidate, error) {
    const adapters = global.TranslationPreviewProviders;
    return adapters?.normalizeError?.(candidate, error)?.summary || String(error?.message || error || '未知错误').slice(0, 96);
  }

  async function translateWithSelection(text, targetLang, settings, selected) {
    const adapters = global.TranslationPreviewProviders;
    if (!adapters) throw new Error('翻译 Provider 尚未加载');
    const candidates = adapters.resolveCandidates?.(selected, settings) || [];
    const failures = [];
    const skipped = [];

    for (const candidate of candidates) {
      if (!adapters.isCandidateConfigured?.(candidate, settings)) {
        skipped.push({ candidate, reason: '未配置' });
        if (selected !== 'auto') {
          const e = new Error(`${candidateLabel(candidate)} 尚未配置`);
          e.candidate = candidate;
          e.unconfigured = true;
          throw e;
        }
        continue;
      }

      if (selected === 'auto') {
        const cooldown = adapters.cooldownInfo?.(candidate);
        if (cooldown) {
          skipped.push({ candidate, reason: `${cooldown.reason}，冷却中` });
          continue;
        }
      }

      const started = performance.now();
      try {
        const translated = await adapters.translateCandidate(candidate, text, targetLang, settings);
        adapters.noteSuccess?.(candidate);
        return {
          text: translated,
          candidate,
          elapsedMs: Math.round(performance.now() - started),
          failures,
          skipped,
        };
      } catch (error) {
        const normalized = adapters.noteFailure?.(candidate, error) || { summary: conciseError(candidate, error) };
        failures.push({ candidate, error, summary: normalized.summary });
        if (selected !== 'auto') {
          const e = new Error(normalized.summary);
          e.candidate = candidate;
          e.originalError = error;
          throw e;
        }
      }
    }

    const failedText = failures.map(x => `${candidateLabel(x.candidate)}：${x.summary}`).join('；');
    const skippedText = skipped.filter(x => x.reason !== '未配置').map(x => `${candidateLabel(x.candidate)}：${x.reason}`).join('；');
    const e = new Error([failedText, skippedText].filter(Boolean).join('；') || '没有可用的翻译源，请打开「翻译设置」完成配置');
    e.failures = failures;
    e.skipped = skipped;
    throw e;
  }

  function successHint(result) {
    const finalLabel = candidateLabel(result.candidate);
    const chain = [];
    result.skipped.filter(x => x.reason && x.reason !== '未配置').forEach(x => chain.push(`${candidateLabel(x.candidate)} ${x.reason}`));
    result.failures.forEach(x => chain.push(`${candidateLabel(x.candidate)} ${x.summary}`));
    if (chain.length) return `${chain.join(' → ')} → ${finalLabel} · ${result.elapsedMs}ms`;
    return `✓ ${finalLabel} · ${result.elapsedMs}ms`;
  }

  async function runTranslation() {
    const src = byId('gtSource')?.value || '';
    const target = byId('gtTargetLang')?.value || 'zh-CN';
    const out = byId('gtTarget');
    const button = byId('btnGTTranslate');
    if (!src.trim()) { setHint('请先输入原文', 'error'); return; }

    const settings = loadSettings();
    const selected = byId('gtProvider')?.value || settings.provider || 'auto';
    settings.provider = selected;
    saveSettings(settings);

    const oldText = button?.textContent || '🌐 翻译';
    if (button) { button.disabled = true; button.textContent = '翻译中…'; }
    setHint('正在选择翻译源…', 'busy');
    try {
      const result = await translateWithSelection(src, target, settings, selected);
      if (out) out.value = result.text;
      setHint(successHint(result), 'ok');
    } catch (error) {
      setHint('✗ ' + (error?.message || error), 'error');
      if (error?.unconfigured && error?.candidate) openDrawer(configurationTab(error.candidate));
    } finally {
      if (button) { button.disabled = false; button.textContent = oldText; }
    }
  }

  async function testProvider(provider) {
    const statusId = {
      google: 'translationGoogleStatus',
      microsoft: 'translationMicrosoftStatus',
      baidu: 'translationBaiduStatus',
      ai: 'translationAiStatus',
    }[provider];
    const status = byId(statusId);
    if (!status) return;
    const settings = readDrawerSettings();
    const adapters = global.TranslationPreviewProviders;
    const candidate = adapters.resolveCandidates?.(provider, settings)?.[0];
    status.textContent = '测试中…';
    status.className = 'translation-test-status is-busy';
    try {
      if (!candidate || !adapters.isCandidateConfigured?.(candidate, settings)) throw new Error('请先完成当前模式的必要配置');
      const started = performance.now();
      const result = await adapters.translateCandidate(candidate, 'Lightweight anti-theft travel wallet', 'zh-CN', settings);
      adapters.noteSuccess?.(candidate);
      status.textContent = `✓ ${candidateLabel(candidate)} · ${Math.round(performance.now() - started)}ms · ${String(result).slice(0, 28)}`;
      status.className = 'translation-test-status is-ok';
    } catch (error) {
      const normalized = candidate ? (adapters.noteFailure?.(candidate, error) || { summary: conciseError(candidate, error) }) : { summary: String(error?.message || error) };
      status.textContent = '✗ ' + normalized.summary;
      status.className = 'translation-test-status is-error';
    }
  }

  function interceptLegacyTranslateButton() {
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('#btnGTTranslate');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runTranslation();
    }, true);
  }

  function install() {
    if (installed) return true;
    if (!byId('gtTargetLang') || !byId('btnGTTranslate') || !global.TranslationPreviewProviders?.resolveCandidates) return false;
    installed = true;
    mountTopControls();
    mountDrawer();
    interceptLegacyTranslateButton();
    return true;
  }

  let tries = 0;
  const wait = () => {
    if (install()) return;
    if (++tries < 120) setTimeout(wait, 50);
  };
  wait();

  global.TranslationPreviewUI = Object.freeze({
    openSettings: openDrawer,
    loadSettings,
    runTranslation,
  });
})(window);
