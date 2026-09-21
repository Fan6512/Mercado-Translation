// Native-client provider overlay.
// In packaged Pake clients, all translation preview providers use the guarded Rust HTTP bridge.
// In normal browser/source mode, the existing browser providers remain the compatibility fallback.
(function (global) {
  'use strict';

  const legacy = global.TranslationPreviewProviders;
  const transport = global.NativeHttpTransport;
  if (!legacy || !transport) return;

  const PROVIDER_LABELS = legacy.labels || Object.freeze({
    google: 'Google',
    microsoft: 'Microsoft',
    baidu: '百度',
    ai: 'AI',
  });
  const GOOGLE_LANG = Object.freeze({ 'zh-cn': 'zh-CN', zh: 'zh-CN', 'zh-tw': 'zh-TW' });
  const BING_LANG = Object.freeze({ 'zh-cn': 'zh-Hans', zh: 'zh-Hans', 'zh-tw': 'zh-Hant' });
  const BAIDU_LANG = Object.freeze({ 'zh-cn': 'zh', zh: 'zh', 'zh-tw': 'cht', es: 'spa', pt: 'pt', en: 'en' });
  const TARGET_NAMES = Object.freeze({
    'zh-CN': 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese',
    en: 'English',
    es: 'Spanish',
    pt: 'Brazilian Portuguese',
  });
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
  const MICROSOFT_SEGMENT_LIMIT = 950;

  let bingAuth = null;

  function currentProfile() {
    try { return typeof global.getSettings === 'function' ? global.getSettings() : null; }
    catch (_) { return null; }
  }

  function timeoutMs(settings, provider) {
    const base = Number(settings?.timeoutSec) || 6;
    if (provider === 'ai') return Math.max(3000, base * 1000 * 3);
    return Math.max(2500, base * 1000);
  }

  function mapLang(table, code) {
    const key = String(code || '').toLowerCase();
    return table[key] || code;
  }

  async function request(rawUrl, init, settings, provider, profile) {
    return transport.request(rawUrl, init, {
      timeoutMs: timeoutMs(settings, provider),
      profile: profile || currentProfile(),
    });
  }

  async function responseJson(resp, provider) {
    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
      const e = new Error(`${PROVIDER_LABELS[provider] || provider} HTTP ${resp.status}${text ? ': ' + text.slice(0, 180) : ''}`);
      e.status = resp.status;
      e.transport = resp.transport;
      throw e;
    }
    try { return text ? JSON.parse(text) : {}; }
    catch (_) {
      const e = new Error(`${PROVIDER_LABELS[provider] || provider} 返回格式无法解析`);
      e.transport = resp.transport;
      throw e;
    }
  }

  async function googleTranslate(text, targetLang, settings) {
    const tl = mapLang(GOOGLE_LANG, targetLang);
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t' +
      '&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(text);
    const resp = await request(url, {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain,*/*' },
    }, settings, 'google');
    const data = await responseJson(resp, 'google');
    const chunks = Array.isArray(data?.[0]) ? data[0] : [];
    const out = chunks.map(part => Array.isArray(part) ? (part[0] || '') : '').join('').trim();
    if (!out) throw new Error('Google 未返回译文');
    return out;
  }

  function parseBingAuth(html) {
    const ig = /IG:\"([^\"]+)\"/.exec(html) || /IG:"([^"]+)"/.exec(html);
    const iid = /data-iid=\"([^\"]+)\"/.exec(html) || /data-iid="([^"]+)"/.exec(html);
    const token = /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*["']([^"']+)["']\s*,\s*(\d+)\s*\]/.exec(html);
    if (!ig || !token) throw new Error('Microsoft 免费接口鉴权参数解析失败');
    return {
      ig: ig[1],
      iid: iid ? iid[1] : 'translator.5028',
      key: token[1],
      token: token[2],
      ttl: Number.parseInt(token[3], 10) || 3600000,
      at: Date.now(),
    };
  }

  async function getBingAuth(settings, force) {
    if (!force && bingAuth && Date.now() - bingAuth.at < bingAuth.ttl) return bingAuth;
    const resp = await request('https://www.bing.com/translator', {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': BROWSER_UA,
      },
    }, settings, 'microsoft');
    if (!resp.ok) throw new Error('Microsoft 鉴权页 HTTP ' + resp.status);
    bingAuth = parseBingAuth(await resp.text());
    return bingAuth;
  }

  function splitMicrosoftText(text, limit = MICROSOFT_SEGMENT_LIMIT) {
    const input = String(text || '').trim();
    if (!input) return [];
    const parts = [];
    let rest = input;
    const preferred = /[\n。！？!?；;\.，,：:]\s*|\s+/g;
    while (rest.length > limit) {
      const windowText = rest.slice(0, limit + 1);
      let splitAt = -1;
      let match;
      preferred.lastIndex = 0;
      while ((match = preferred.exec(windowText))) {
        const candidate = match.index + match[0].length;
        if (candidate >= Math.floor(limit * 0.55) && candidate <= limit) splitAt = candidate;
      }
      if (splitAt < 1) splitAt = limit;
      const part = rest.slice(0, splitAt).trim();
      if (part) parts.push(part);
      rest = rest.slice(splitAt).trimStart();
    }
    if (rest.trim()) parts.push(rest.trim());
    return parts;
  }

  async function microsoftTranslateOne(text, targetLang, settings, retried) {
    const auth = await getBingAuth(settings, false);
    const url = 'https://www.bing.com/ttranslatev3?isVertical=1&IG=' + encodeURIComponent(auth.ig) +
      '&IID=' + encodeURIComponent(auth.iid);
    const body = new URLSearchParams({
      fromLang: 'auto-detect',
      to: mapLang(BING_LANG, targetLang),
      text: String(text || ''),
      token: auth.token,
      key: auth.key,
    }).toString();
    const resp = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://www.bing.com/translator',
        'User-Agent': BROWSER_UA,
      },
      body,
    }, settings, 'microsoft');
    const rawText = await resp.text().catch(() => '');
    let data = null;
    try { data = rawText ? JSON.parse(rawText) : null; } catch (_) {}
    const translated = data?.[0]?.translations?.[0]?.text;
    if (resp.ok && translated) return String(translated).trim();
    if (!retried) {
      bingAuth = null;
      await getBingAuth(settings, true);
      return microsoftTranslateOne(text, targetLang, settings, true);
    }
    if (!resp.ok) throw new Error(`Microsoft HTTP ${resp.status}${rawText ? ': ' + rawText.slice(0, 160) : ''}`);
    throw new Error('Microsoft 未返回有效译文');
  }

  async function microsoftTranslate(text, targetLang, settings) {
    const segments = splitMicrosoftText(text);
    if (!segments.length) return '';
    const translated = [];
    for (const segment of segments) {
      translated.push(await microsoftTranslateOne(segment, targetLang, settings, false));
    }
    return translated.join('\n').trim();
  }

  async function baiduTranslate(text, targetLang, settings) {
    const appid = String(settings?.baidu?.appId || '').trim();
    const secret = String(settings?.baidu?.secret || '').trim();
    if (!appid || !secret) {
      const e = new Error('百度翻译尚未配置 APP ID / Secret Key');
      e.unconfigured = true;
      throw e;
    }
    const salt = String(Date.now()) + String(Math.floor(Math.random() * 10000));
    const sign = legacy.md5(appid + text + salt + secret);
    const body = new URLSearchParams({
      q: text,
      from: 'auto',
      to: mapLang(BAIDU_LANG, targetLang),
      appid,
      salt,
      sign,
    }).toString();
    const resp = await request('https://fanyi-api.baidu.com/api/trans/vip/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    }, settings, 'baidu');
    const data = await responseJson(resp, 'baidu');
    if (data?.error_code) throw new Error(`百度翻译错误 ${data.error_code}: ${data.error_msg || 'unknown'}`);
    const rows = Array.isArray(data?.trans_result) ? data.trans_result : [];
    const out = rows.map(row => row?.dst || '').filter(Boolean).join('\n').trim();
    if (!out) throw new Error('百度翻译未返回译文');
    return out;
  }

  function replaceAll(template, token, value) {
    return String(template || '').split(token).join(value);
  }

  function aiProfile(settings) {
    const ai = settings?.ai || {};
    if (ai.mode !== 'custom') {
      const current = currentProfile() || {};
      return { ...current, _source: 'current' };
    }
    const inheritedProxy = ai.followCurrentProxy !== false ? (currentProfile()?.proxy || {}) : { enabled: false };
    return {
      base: String(ai.base || '').trim().replace(/\/+$/, ''),
      key: String(ai.key || '').trim(),
      model: String(ai.model || '').trim(),
      temp: Number.isFinite(Number(ai.temperature)) ? Number(ai.temperature) : 0.2,
      maxTokens: Math.max(64, Math.round(Number(ai.maxTokens) || 800)),
      proxy: inheritedProxy,
      _source: 'custom',
    };
  }

  async function aiTranslate(text, targetLang, settings) {
    const profile = aiProfile(settings);
    if (!profile.base || !profile.model) {
      const e = new Error(profile._source === 'current' ? '当前 API 配置缺少接口地址或模型' : 'AI 翻译尚未填写 Base URL / 模型');
      e.unconfigured = true;
      throw e;
    }
    const ai = settings?.ai || {};
    const to = TARGET_NAMES[targetLang] || targetLang;
    const from = 'Auto-detected source language';
    const systemTemplate = ai.systemPrompt || 'You are a professional e-commerce translator. Translate accurately and naturally. Preserve product names, model numbers, dimensions and units. Do not add explanations. Output only the translation.';
    const userTemplate = ai.userPrompt || 'Translate the following text from {{from}} to {{to}}. Output only the translated text:\n\n{{text}}';
    let systemPrompt = replaceAll(systemTemplate, '{{to}}', to);
    systemPrompt = replaceAll(systemPrompt, '{{from}}', from);
    let userPrompt = replaceAll(userTemplate, '{{text}}', text);
    userPrompt = replaceAll(userPrompt, '{{to}}', to);
    userPrompt = replaceAll(userPrompt, '{{from}}', from);

    const headers = { 'Content-Type': 'application/json' };
    if (profile.key) headers.Authorization = 'Bearer ' + profile.key;
    const requestBody = global.ProviderAdapters?.buildChatRequest
      ? global.ProviderAdapters.buildChatRequest(profile, {
          stream: false,
          temperature: Number.isFinite(Number(ai.temperature)) ? Number(ai.temperature) : (profile.temp ?? 0.2),
          maxTokens: Math.max(64, Math.round(Number(ai.maxTokens) || profile.maxTokens || 800)),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        })
      : {
          model: profile.model,
          stream: false,
          temperature: Number(ai.temperature) || 0.2,
          max_tokens: Math.max(64, Math.round(Number(ai.maxTokens) || 800)),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        };

    const resp = await request(profile.base + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    }, settings, 'ai', profile);
    const data = await responseJson(resp, 'ai');
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
    const out = String(content || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!out) throw new Error('AI 接口未返回译文');
    return out;
  }

  function isConfigured(provider, settings) {
    return legacy.isConfigured(provider, settings);
  }

  async function translate(provider, text, targetLang, settings) {
    // Source/browser mode keeps the known browser implementation unchanged.
    if (!transport.isAvailable()) {
      return legacy.translate(provider, text, targetLang, settings);
    }
    const fn = {
      google: googleTranslate,
      microsoft: microsoftTranslate,
      baidu: baiduTranslate,
      ai: aiTranslate,
    }[provider];
    if (!fn) throw new Error('未知翻译源：' + provider);
    return fn(String(text || ''), targetLang, settings || {});
  }

  global.TranslationPreviewProviders = Object.freeze({
    labels: PROVIDER_LABELS,
    isConfigured,
    translate,
    md5: legacy.md5,
    runtime: Object.freeze({
      mode: 'client-first',
      isNativeAvailable: transport.isAvailable,
      describe: transport.describe,
    }),
  });
})(window);
