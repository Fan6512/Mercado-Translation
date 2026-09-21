// Translation preview provider layer: Google, Bing/Microsoft keyless, Baidu API,
// and OpenAI-compatible AI translation. Kept separate from title/description generation.
(function (global) {
  'use strict';

  const PROVIDER_LABELS = Object.freeze({
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

  let bingAuth = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function timeoutMs(settings, provider) {
    const base = Number(settings?.timeoutSec) || 6;
    if (provider === 'ai') return Math.max(3000, base * 1000 * 3);
    return Math.max(2500, base * 1000);
  }

  function currentProfile() {
    try { return typeof global.getSettings === 'function' ? global.getSettings() : null; }
    catch (_) { return null; }
  }

  function withCurrentProxy(url) {
    const profile = currentProfile();
    try {
      if (profile && typeof global.applyProxyPrefix === 'function') {
        return global.applyProxyPrefix(profile, url);
      }
    } catch (_) {}
    return url;
  }

  async function fetchWithTimeout(url, init, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...(init || {}), signal: ctrl.signal });
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error(`请求超时（${Math.round(ms / 1000)}s）`);
        e.timeout = true;
        throw e;
      }
      const e = new Error('网络请求失败：' + (err?.message || err));
      e.networkError = true;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function responseJson(resp, provider) {
    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
      const e = new Error(`${PROVIDER_LABELS[provider] || provider} HTTP ${resp.status}${text ? ': ' + text.slice(0, 180) : ''}`);
      e.status = resp.status;
      throw e;
    }
    try { return text ? JSON.parse(text) : {}; }
    catch (_) { throw new Error(`${PROVIDER_LABELS[provider] || provider} 返回格式无法解析`); }
  }

  function mapLang(table, code) {
    const key = String(code || '').toLowerCase();
    return table[key] || code;
  }

  async function googleTranslate(text, targetLang, settings) {
    const tl = mapLang(GOOGLE_LANG, targetLang);
    const raw = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t' +
      '&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(text);
    const resp = await fetchWithTimeout(withCurrentProxy(raw), { method: 'GET' }, timeoutMs(settings, 'google'));
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
    const raw = 'https://www.bing.com/translator';
    const resp = await fetchWithTimeout(withCurrentProxy(raw), { method: 'GET' }, timeoutMs(settings, 'microsoft'));
    if (!resp.ok) throw new Error('Microsoft 鉴权页 HTTP ' + resp.status);
    bingAuth = parseBingAuth(await resp.text());
    return bingAuth;
  }

  async function microsoftTranslate(text, targetLang, settings, retried) {
    const auth = await getBingAuth(settings, false);
    const raw = 'https://www.bing.com/ttranslatev3?isVertical=1&IG=' + encodeURIComponent(auth.ig) +
      '&IID=' + encodeURIComponent(auth.iid);
    const body = new URLSearchParams({
      fromLang: 'auto-detect',
      to: mapLang(BING_LANG, targetLang),
      text,
      token: auth.token,
      key: auth.key,
    }).toString();
    const resp = await fetchWithTimeout(withCurrentProxy(raw), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    }, timeoutMs(settings, 'microsoft'));
    const rawText = await resp.text().catch(() => '');
    let data = null;
    try { data = rawText ? JSON.parse(rawText) : null; } catch (_) {}
    const translated = data?.[0]?.translations?.[0]?.text;
    if (resp.ok && translated) return String(translated).trim();
    if (!retried) {
      await getBingAuth(settings, true);
      return microsoftTranslate(text, targetLang, settings, true);
    }
    if (!resp.ok) throw new Error(`Microsoft HTTP ${resp.status}${rawText ? ': ' + rawText.slice(0, 160) : ''}`);
    throw new Error('Microsoft 未返回有效译文');
  }

  // Compact MD5 implementation for Baidu's legacy appid+q+salt+secret signature.
  function md5(input) {
    function add(x, y) { return (((x & 0xffff) + (y & 0xffff)) + ((((x >>> 16) + (y >>> 16)) & 0xffff) << 16)) | 0; }
    function rol(x, n) { return (x << n) | (x >>> (32 - n)); }
    function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
    function ff(a,b,c,d,x,s,t){ return cmn((b & c) | (~b & d),a,b,x,s,t); }
    function gg(a,b,c,d,x,s,t){ return cmn((b & d) | (c & ~d),a,b,x,s,t); }
    function hh(a,b,c,d,x,s,t){ return cmn(b ^ c ^ d,a,b,x,s,t); }
    function ii(a,b,c,d,x,s,t){ return cmn(c ^ (b | ~d),a,b,x,s,t); }
    const bytes = new TextEncoder().encode(String(input));
    const len = bytes.length;
    const words = [];
    for (let i = 0; i < len; i++) words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
    words[len >> 2] = (words[len >> 2] || 0) | (0x80 << ((len % 4) * 8));
    words[(((len + 8) >> 6) + 1) * 16 - 2] = len * 8;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < words.length; i += 16) {
      const oa=a, ob=b, oc=c, od=d;
      a=ff(a,b,c,d,words[i]||0,7,-680876936); d=ff(d,a,b,c,words[i+1]||0,12,-389564586); c=ff(c,d,a,b,words[i+2]||0,17,606105819); b=ff(b,c,d,a,words[i+3]||0,22,-1044525330);
      a=ff(a,b,c,d,words[i+4]||0,7,-176418897); d=ff(d,a,b,c,words[i+5]||0,12,1200080426); c=ff(c,d,a,b,words[i+6]||0,17,-1473231341); b=ff(b,c,d,a,words[i+7]||0,22,-45705983);
      a=ff(a,b,c,d,words[i+8]||0,7,1770035416); d=ff(d,a,b,c,words[i+9]||0,12,-1958414417); c=ff(c,d,a,b,words[i+10]||0,17,-42063); b=ff(b,c,d,a,words[i+11]||0,22,-1990404162);
      a=ff(a,b,c,d,words[i+12]||0,7,1804603682); d=ff(d,a,b,c,words[i+13]||0,12,-40341101); c=ff(c,d,a,b,words[i+14]||0,17,-1502002290); b=ff(b,c,d,a,words[i+15]||0,22,1236535329);
      a=gg(a,b,c,d,words[i+1]||0,5,-165796510); d=gg(d,a,b,c,words[i+6]||0,9,-1069501632); c=gg(c,d,a,b,words[i+11]||0,14,643717713); b=gg(b,c,d,a,words[i]||0,20,-373897302);
      a=gg(a,b,c,d,words[i+5]||0,5,-701558691); d=gg(d,a,b,c,words[i+10]||0,9,38016083); c=gg(c,d,a,b,words[i+15]||0,14,-660478335); b=gg(b,c,d,a,words[i+4]||0,20,-405537848);
      a=gg(a,b,c,d,words[i+9]||0,5,568446438); d=gg(d,a,b,c,words[i+14]||0,9,-1019803690); c=gg(c,d,a,b,words[i+3]||0,14,-187363961); b=gg(b,c,d,a,words[i+8]||0,20,1163531501);
      a=gg(a,b,c,d,words[i+13]||0,5,-1444681467); d=gg(d,a,b,c,words[i+2]||0,9,-51403784); c=gg(c,d,a,b,words[i+7]||0,14,1735328473); b=gg(b,c,d,a,words[i+12]||0,20,-1926607734);
      a=hh(a,b,c,d,words[i+5]||0,4,-378558); d=hh(d,a,b,c,words[i+8]||0,11,-2022574463); c=hh(c,d,a,b,words[i+11]||0,16,1839030562); b=hh(b,c,d,a,words[i+14]||0,23,-35309556);
      a=hh(a,b,c,d,words[i+1]||0,4,-1530992060); d=hh(d,a,b,c,words[i+4]||0,11,1272893353); c=hh(c,d,a,b,words[i+7]||0,16,-155497632); b=hh(b,c,d,a,words[i+10]||0,23,-1094730640);
      a=hh(a,b,c,d,words[i+13]||0,4,681279174); d=hh(d,a,b,c,words[i]||0,11,-358537222); c=hh(c,d,a,b,words[i+3]||0,16,-722521979); b=hh(b,c,d,a,words[i+6]||0,23,76029189);
      a=hh(a,b,c,d,words[i+9]||0,4,-640364487); d=hh(d,a,b,c,words[i+12]||0,11,-421815835); c=hh(c,d,a,b,words[i+15]||0,16,530742520); b=hh(b,c,d,a,words[i+2]||0,23,-995338651);
      a=ii(a,b,c,d,words[i]||0,6,-198630844); d=ii(d,a,b,c,words[i+7]||0,10,1126891415); c=ii(c,d,a,b,words[i+14]||0,15,-1416354905); b=ii(b,c,d,a,words[i+5]||0,21,-57434055);
      a=ii(a,b,c,d,words[i+12]||0,6,1700485571); d=ii(d,a,b,c,words[i+3]||0,10,-1894986606); c=ii(c,d,a,b,words[i+10]||0,15,-1051523); b=ii(b,c,d,a,words[i+1]||0,21,-2054922799);
      a=ii(a,b,c,d,words[i+8]||0,6,1873313359); d=ii(d,a,b,c,words[i+15]||0,10,-30611744); c=ii(c,d,a,b,words[i+6]||0,15,-1560198380); b=ii(b,c,d,a,words[i+13]||0,21,1309151649);
      a=ii(a,b,c,d,words[i+4]||0,6,-145523070); d=ii(d,a,b,c,words[i+11]||0,10,-1120210379); c=ii(c,d,a,b,words[i+2]||0,15,718787259); b=ii(b,c,d,a,words[i+9]||0,21,-343485551);
      a=add(a,oa); b=add(b,ob); c=add(c,oc); d=add(d,od);
    }
    return [a,b,c,d].map(n => [0,8,16,24].map(s => ((n >>> s) & 255).toString(16).padStart(2,'0')).join('')).join('');
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
    const sign = md5(appid + text + salt + secret);
    const body = new URLSearchParams({
      q: text,
      from: 'auto',
      to: mapLang(BAIDU_LANG, targetLang),
      appid,
      salt,
      sign,
    }).toString();
    const raw = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
    const resp = await fetchWithTimeout(withCurrentProxy(raw), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    }, timeoutMs(settings, 'baidu'));
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

    const endpoint = (typeof global.applyProxyPrefix === 'function')
      ? global.applyProxyPrefix(profile, profile.base + '/chat/completions')
      : profile.base + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (profile.key) headers.Authorization = 'Bearer ' + profile.key;
    const requestBody = (global.ProviderAdapters?.buildChatRequest)
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
    const resp = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    }, timeoutMs(settings, 'ai'));
    const data = await responseJson(resp, 'ai');
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
    const out = String(content || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!out) throw new Error('AI 接口未返回译文');
    return out;
  }

  function isConfigured(provider, settings) {
    if (provider === 'google' || provider === 'microsoft') return true;
    if (provider === 'baidu') return !!(settings?.baidu?.appId && settings?.baidu?.secret);
    if (provider === 'ai') {
      const p = aiProfile(settings);
      return !!(p.base && p.model);
    }
    return false;
  }

  async function translate(provider, text, targetLang, settings) {
    const fn = {
      google: googleTranslate,
      microsoft: microsoftTranslate,
      baidu: baiduTranslate,
      ai: aiTranslate,
    }[provider];
    if (!fn) throw new Error('未知翻译源：' + provider);
    return await fn(String(text || ''), targetLang, settings || {});
  }

  global.TranslationPreviewProviders = Object.freeze({
    labels: PROVIDER_LABELS,
    isConfigured,
    translate,
    md5,
  });
})(window);
