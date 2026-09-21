// Translation Provider v2: vendor-level configuration, official APIs, free fallbacks,
// cooldowns and concise error classification. Loaded after the native-provider overlay.
(function (global) {
  'use strict';

  const base = global.TranslationPreviewProviders;
  const transport = global.NativeHttpTransport;
  if (!base || !transport) return;

  const LOGICAL_LABELS = Object.freeze({
    google: 'Google',
    microsoft: 'Microsoft',
    baidu: '百度',
    ai: 'AI',
  });

  const CANDIDATE_LABELS = Object.freeze({
    'google-free': 'Google 免费',
    'google-cloud': 'Google Cloud',
    'microsoft-bing': 'Microsoft Bing',
    'microsoft-azure': 'Azure Translator',
    baidu: '百度',
    ai: 'AI',
  });

  const GOOGLE_CLOUD_ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
  const AZURE_DEFAULT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';
  const GOOGLE_FREE_COOLDOWN_MS = 10 * 60 * 1000;
  const BING_NETWORK_COOLDOWN_MS = 60 * 1000;
  const AI_REGION_COOLDOWN_MS = 10 * 60 * 1000;
  const COOLDOWN_KEY = 'translator_translation_cooldowns_v1';
  const GOOGLE_FREE_CACHE_TTL_MS = 10 * 60 * 1000;
  const GOOGLE_FREE_CACHE_MAX = 100;

  const googleFreeCache = new Map();

  function currentProfile() {
    try { return typeof global.getSettings === 'function' ? global.getSettings() : null; }
    catch (_) { return null; }
  }

  function timeoutMs(settings, candidate) {
    const baseSeconds = Number(settings?.timeoutSec) || 6;
    if (candidate === 'ai') return Math.max(3000, baseSeconds * 1000 * 3);
    return Math.max(2500, baseSeconds * 1000);
  }

  function readCooldowns() {
    try {
      const value = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function writeCooldowns(value) {
    try { localStorage.setItem(COOLDOWN_KEY, JSON.stringify(value)); } catch (_) {}
  }

  function setCooldown(candidate, durationMs, reason) {
    const until = Date.now() + Math.max(1000, Number(durationMs) || 0);
    const all = readCooldowns();
    all[candidate] = { until, reason: String(reason || '暂时不可用') };
    writeCooldowns(all);
    return until;
  }

  function clearCooldown(candidate) {
    const all = readCooldowns();
    if (!all[candidate]) return;
    delete all[candidate];
    writeCooldowns(all);
  }

  function cooldownInfo(candidate) {
    const all = readCooldowns();
    const entry = all[candidate];
    if (!entry) return null;
    if (!Number.isFinite(Number(entry.until)) || Number(entry.until) <= Date.now()) {
      delete all[candidate];
      writeCooldowns(all);
      return null;
    }
    return {
      until: Number(entry.until),
      remainingMs: Number(entry.until) - Date.now(),
      reason: String(entry.reason || '暂时不可用'),
    };
  }

  function profileForTransport() {
    return currentProfile() || {};
  }

  async function request(url, init, settings, candidate) {
    return transport.request(url, init, {
      timeoutMs: timeoutMs(settings, candidate),
      profile: profileForTransport(),
    });
  }

  function makeHttpError(label, status, text, resp) {
    let detail = '';
    if (text) {
      try {
        const data = JSON.parse(text);
        detail = data?.error?.message || data?.message || data?.error_description || '';
      } catch (_) {}
    }
    const error = new Error(`${label} HTTP ${status}${detail ? ': ' + String(detail).slice(0, 220) : ''}`);
    error.status = Number(status) || 0;
    error.rawBody = String(text || '').slice(0, 1000);
    error.retryAfter = resp?.headers?.get?.('retry-after') || null;
    error.transport = resp?.transport;
    return error;
  }

  async function parseJsonResponse(resp, label) {
    const text = await resp.text().catch(() => '');
    if (!resp.ok) throw makeHttpError(label, resp.status, text, resp);
    try { return text ? JSON.parse(text) : {}; }
    catch (_) {
      const error = new Error(`${label} 返回格式无法解析`);
      error.transport = resp.transport;
      throw error;
    }
  }

  function mapGoogleCloudLang(code) {
    const key = String(code || '').toLowerCase();
    return ({ 'zh-cn': 'zh-CN', zh: 'zh-CN', 'zh-tw': 'zh-TW' })[key] || code;
  }

  function mapAzureLang(code) {
    const key = String(code || '').toLowerCase();
    return ({ 'zh-cn': 'zh-Hans', zh: 'zh-Hans', 'zh-tw': 'zh-Hant', en: 'en', es: 'es', pt: 'pt' })[key] || code;
  }

  function googleCloudConfigured(settings) {
    return !!String(settings?.google?.cloudApiKey || '').trim();
  }

  function azureConfigured(settings) {
    return !!String(settings?.microsoft?.azureKey || '').trim();
  }

  function googleManualCandidate(settings) {
    const mode = settings?.google?.mode || 'auto';
    if (mode === 'cloud') return 'google-cloud';
    if (mode === 'free') return 'google-free';
    return googleCloudConfigured(settings) ? 'google-cloud' : 'google-free';
  }

  function microsoftManualCandidate(settings) {
    const mode = settings?.microsoft?.mode || 'auto';
    if (mode === 'azure') return 'microsoft-azure';
    if (mode === 'bing') return 'microsoft-bing';
    return azureConfigured(settings) ? 'microsoft-azure' : 'microsoft-bing';
  }

  function candidateConfigured(candidate, settings) {
    if (candidate === 'google-free' || candidate === 'microsoft-bing') return true;
    if (candidate === 'google-cloud') return googleCloudConfigured(settings);
    if (candidate === 'microsoft-azure') return azureConfigured(settings);
    if (candidate === 'baidu' || candidate === 'ai') return base.isConfigured(candidate, settings);
    return false;
  }

  function logicalConfigured(provider, settings) {
    if (provider === 'google') return candidateConfigured(googleManualCandidate(settings), settings);
    if (provider === 'microsoft') return candidateConfigured(microsoftManualCandidate(settings), settings);
    if (provider === 'baidu' || provider === 'ai') return candidateConfigured(provider, settings);
    return false;
  }

  function uniqueConfigured(list, settings) {
    const seen = new Set();
    return list.filter(candidate => {
      if (seen.has(candidate) || !candidateConfigured(candidate, settings)) return false;
      seen.add(candidate);
      return true;
    });
  }

  function autoCandidates(strategy, settings) {
    let order;
    if (strategy === 'stable-first') {
      order = ['google-cloud', 'microsoft-azure', 'baidu', 'microsoft-bing', 'google-free', 'ai'];
    } else if (strategy === 'china-first') {
      order = ['baidu', 'microsoft-bing', 'microsoft-azure', 'google-cloud', 'google-free', 'ai'];
    } else if (strategy === 'ai-first') {
      order = ['ai', 'google-cloud', 'microsoft-azure', 'baidu', 'microsoft-bing', 'google-free'];
    } else {
      order = ['microsoft-bing', 'google-free', 'baidu', 'google-cloud', 'microsoft-azure', 'ai'];
    }
    return uniqueConfigured(order, settings);
  }

  function resolveCandidates(selected, settings) {
    if (selected === 'auto') return autoCandidates(settings?.autoStrategy || 'free-first', settings);
    if (selected === 'google') return [googleManualCandidate(settings)];
    if (selected === 'microsoft') return [microsoftManualCandidate(settings)];
    if (selected === 'baidu' || selected === 'ai') return [selected];
    return [];
  }

  function googleCacheKey(text, targetLang) {
    return `${String(targetLang)}\u0000${String(text)}`;
  }

  function getGoogleFreeCache(text, targetLang) {
    const key = googleCacheKey(text, targetLang);
    const entry = googleFreeCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > GOOGLE_FREE_CACHE_TTL_MS) {
      googleFreeCache.delete(key);
      return null;
    }
    googleFreeCache.delete(key);
    googleFreeCache.set(key, entry);
    return entry.value;
  }

  function setGoogleFreeCache(text, targetLang, value) {
    const key = googleCacheKey(text, targetLang);
    googleFreeCache.delete(key);
    googleFreeCache.set(key, { at: Date.now(), value });
    while (googleFreeCache.size > GOOGLE_FREE_CACHE_MAX) {
      googleFreeCache.delete(googleFreeCache.keys().next().value);
    }
  }

  async function googleFreeTranslate(text, targetLang, settings) {
    const cached = getGoogleFreeCache(text, targetLang);
    if (cached != null) return cached;
    const value = await base.translate('google', text, targetLang, settings);
    setGoogleFreeCache(text, targetLang, value);
    return value;
  }

  async function googleCloudTranslate(text, targetLang, settings) {
    const apiKey = String(settings?.google?.cloudApiKey || '').trim();
    if (!apiKey) {
      const error = new Error('Google Cloud 尚未配置 API Key');
      error.unconfigured = true;
      throw error;
    }
    const resp = await request(GOOGLE_CLOUD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({ q: String(text || ''), target: mapGoogleCloudLang(targetLang), format: 'text' }),
    }, settings, 'google-cloud');
    const data = await parseJsonResponse(resp, 'Google Cloud');
    const translated = data?.data?.translations?.[0]?.translatedText;
    if (!translated) throw new Error('Google Cloud 未返回译文');
    return String(translated).trim();
  }

  function azureTranslateUrl(settings, targetLang) {
    const endpoint = String(settings?.microsoft?.azureEndpoint || AZURE_DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') throw new Error('Azure Translator Endpoint 必须使用 HTTPS');
    const target = encodeURIComponent(mapAzureLang(targetLang));
    if (/\.cognitiveservices\.azure\.com$/i.test(parsed.hostname)) {
      return `${endpoint}/translator/text/v3.0/translate?api-version=3.0&to=${target}`;
    }
    return `${endpoint}/translate?api-version=3.0&to=${target}`;
  }

  async function microsoftAzureTranslate(text, targetLang, settings) {
    const key = String(settings?.microsoft?.azureKey || '').trim();
    if (!key) {
      const error = new Error('Azure Translator 尚未配置 Subscription Key');
      error.unconfigured = true;
      throw error;
    }
    let url;
    try { url = azureTranslateUrl(settings, targetLang); }
    catch (error) { throw new Error(error?.message || 'Azure Translator Endpoint 格式无效'); }
    const headers = {
      'Content-Type': 'application/json; charset=UTF-8',
      Accept: 'application/json',
      'Ocp-Apim-Subscription-Key': key,
    };
    const region = String(settings?.microsoft?.azureRegion || '').trim();
    if (region) headers['Ocp-Apim-Subscription-Region'] = region;
    const resp = await request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify([{ Text: String(text || '') }]),
    }, settings, 'microsoft-azure');
    const data = await parseJsonResponse(resp, 'Azure Translator');
    const translated = data?.[0]?.translations?.[0]?.text;
    if (!translated) throw new Error('Azure Translator 未返回译文');
    return String(translated).trim();
  }

  async function translateCandidate(candidate, text, targetLang, settings) {
    const fn = {
      'google-free': googleFreeTranslate,
      'google-cloud': googleCloudTranslate,
      'microsoft-bing': (value, lang, cfg) => base.translate('microsoft', value, lang, cfg),
      'microsoft-azure': microsoftAzureTranslate,
      baidu: (value, lang, cfg) => base.translate('baidu', value, lang, cfg),
      ai: (value, lang, cfg) => base.translate('ai', value, lang, cfg),
    }[candidate];
    if (!fn) throw new Error(`未知翻译候选源：${candidate}`);
    return fn(String(text || ''), targetLang, settings || {});
  }

  function retryAfterMs(error) {
    const raw = String(error?.retryAfter || '').trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw) * 1000;
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
  }

  function normalizeError(candidate, error) {
    const status = Number(error?.status) || 0;
    const raw = String(error?.message || error || '未知错误');
    const lower = raw.toLowerCase();
    if (status === 429) return { code: 'rate-limit', summary: '429 限流' };
    if (status === 401 || status === 403) return { code: 'auth', summary: '认证或权限错误' };
    if (candidate === 'ai' && (lower.includes('user location is not supported') || lower.includes('location is not supported'))) {
      return { code: 'region', summary: '当前地区不可用' };
    }
    if (error?.timeout || lower.includes('timeout') || lower.includes('超时')) return { code: 'timeout', summary: '请求超时' };
    if (error?.networkError || error?.nativeTransportError || lower.includes('failed to fetch') || lower.includes('error sending request') || lower.includes('network')) {
      return { code: 'network', summary: '网络不可达' };
    }
    if (status >= 500) return { code: 'server', summary: `服务端错误 ${status}` };
    if (status >= 400) return { code: 'http', summary: `HTTP ${status}` };
    const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { code: 'other', summary: clean.slice(0, 96) || '未知错误' };
  }

  function noteFailure(candidate, error) {
    const normalized = normalizeError(candidate, error);
    if (candidate === 'google-free' && normalized.code === 'rate-limit') {
      setCooldown(candidate, retryAfterMs(error) || GOOGLE_FREE_COOLDOWN_MS, normalized.summary);
    } else if (candidate === 'microsoft-bing' && (normalized.code === 'network' || normalized.code === 'timeout')) {
      setCooldown(candidate, BING_NETWORK_COOLDOWN_MS, normalized.summary);
    } else if (candidate === 'ai' && normalized.code === 'region') {
      setCooldown(candidate, AI_REGION_COOLDOWN_MS, normalized.summary);
    }
    return normalized;
  }

  function noteSuccess(candidate) {
    clearCooldown(candidate);
  }

  async function translate(provider, text, targetLang, settings) {
    const candidates = resolveCandidates(provider, settings || {});
    if (!candidates.length) throw new Error(`未知翻译源：${provider}`);
    const candidate = candidates[0];
    if (!candidateConfigured(candidate, settings)) {
      const error = new Error(`${CANDIDATE_LABELS[candidate] || candidate} 尚未配置`);
      error.unconfigured = true;
      error.candidate = candidate;
      throw error;
    }
    return translateCandidate(candidate, text, targetLang, settings);
  }

  global.TranslationPreviewProviders = Object.freeze({
    labels: LOGICAL_LABELS,
    candidateLabels: CANDIDATE_LABELS,
    isConfigured: logicalConfigured,
    isCandidateConfigured: candidateConfigured,
    resolveCandidates,
    translateCandidate,
    translate,
    cooldownInfo,
    clearCooldown,
    noteFailure,
    noteSuccess,
    normalizeError,
    md5: base.md5,
    runtime: base.runtime || Object.freeze({ mode: 'provider-v2' }),
    defaults: Object.freeze({
      googleCloudEndpoint: GOOGLE_CLOUD_ENDPOINT,
      azureEndpoint: AZURE_DEFAULT_ENDPOINT,
    }),
  });
})(window);
