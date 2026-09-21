'use strict';

const assert = require('node:assert/strict');

// Minimal browser/runtime shims. No real credentials or network calls are used.
global.window = global;
const store = new Map();
global.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
};
global.getSettings = () => ({ proxy: { enabled: false, mode: 'system', url: '' } });

let queuedResponse = null;
let lastRequest = null;
function response(status, body, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    transport: 'test-native',
    headers: { get(name) { return normalized[String(name).toLowerCase()] ?? null; } },
    async text() { return String(body ?? ''); },
  };
}

global.NativeHttpTransport = {
  request: async (url, init, options) => {
    lastRequest = { url, init: init || {}, options: options || {} };
    if (!queuedResponse) throw new Error('No mocked response queued');
    const out = queuedResponse;
    queuedResponse = null;
    return out;
  },
};

const baseProvider = {
  labels: { google: 'Google', microsoft: 'Microsoft', baidu: '百度', ai: 'AI' },
  isConfigured(provider, settings) {
    if (provider === 'baidu') return !!(settings?.baidu?.appId && settings?.baidu?.secret);
    if (provider === 'ai') return !!settings?.ai?.configured;
    return true;
  },
  async translate(provider) {
    if (provider === 'microsoft') return '微软测试译文';
    if (provider === 'google') return '谷歌测试译文';
    throw new Error('Unexpected base provider call: ' + provider);
  },
  md5(value) { return String(value); },
  runtime: Object.freeze({ mode: 'test' }),
};
global.TranslationPreviewProviders = baseProvider;

require('../src/translation-provider-v2.js');
const providers = global.TranslationPreviewProviders;

(async () => {
  const empty = {
    autoStrategy: 'free-first',
    google: { mode: 'auto', cloudApiKey: '' },
    microsoft: { mode: 'auto', azureEndpoint: 'https://api.cognitive.microsofttranslator.com', azureKey: '', azureRegion: '' },
    baidu: { appId: '', secret: '' },
    ai: { configured: false },
  };

  assert.deepEqual(
    providers.resolveCandidates('auto', empty),
    ['microsoft-bing', 'google-free'],
    'free-first must prefer Bing then Google free when official sources are unconfigured',
  );

  const official = {
    ...empty,
    autoStrategy: 'stable-first',
    google: { mode: 'auto', cloudApiKey: 'google-test-key' },
    microsoft: {
      mode: 'auto',
      azureEndpoint: 'https://api.cognitive.microsofttranslator.com',
      azureKey: 'azure-test-key',
      azureRegion: '',
    },
  };
  assert.deepEqual(
    providers.resolveCandidates('auto', official),
    ['google-cloud', 'microsoft-azure', 'microsoft-bing', 'google-free'],
    'stable-first must prefer configured official APIs before free fallbacks',
  );

  queuedResponse = response(200, JSON.stringify({
    data: { translations: [{ translatedText: '轻便防盗旅行钱包' }] },
  }));
  const googleResult = await providers.translateCandidate('google-cloud', 'Lightweight anti-theft travel wallet', 'zh-CN', official);
  assert.equal(googleResult, '轻便防盗旅行钱包');
  assert.equal(lastRequest.url, 'https://translation.googleapis.com/language/translate/v2');
  assert.equal(lastRequest.init.headers['X-Goog-Api-Key'], 'google-test-key');
  assert.ok(!lastRequest.url.includes('google-test-key'), 'Google API key must never be placed in the URL');
  assert.equal(JSON.parse(lastRequest.init.body).target, 'zh-CN');

  queuedResponse = response(200, JSON.stringify([{ translations: [{ text: '轻便防盗旅行钱包' }] }]));
  const azureResult = await providers.translateCandidate('microsoft-azure', 'Lightweight anti-theft travel wallet', 'zh-CN', official);
  assert.equal(azureResult, '轻便防盗旅行钱包');
  assert.equal(
    lastRequest.url,
    'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans',
  );
  assert.equal(lastRequest.init.headers['Ocp-Apim-Subscription-Key'], 'azure-test-key');
  assert.ok(!('Ocp-Apim-Subscription-Region' in lastRequest.init.headers), 'Global Translator resource must not require Region');

  const regional = {
    ...official,
    microsoft: {
      mode: 'azure',
      azureEndpoint: 'https://demo-resource.cognitiveservices.azure.com',
      azureKey: 'azure-test-key',
      azureRegion: 'eastus',
    },
  };
  queuedResponse = response(200, JSON.stringify([{ translations: [{ text: '钱包' }] }]));
  await providers.translateCandidate('microsoft-azure', 'wallet', 'zh-CN', regional);
  assert.equal(
    lastRequest.url,
    'https://demo-resource.cognitiveservices.azure.com/translator/text/v3.0/translate?api-version=3.0&to=zh-Hans',
  );
  assert.equal(lastRequest.init.headers['Ocp-Apim-Subscription-Region'], 'eastus');

  const insecure = {
    ...official,
    microsoft: { ...official.microsoft, azureEndpoint: 'http://example.com' },
  };
  await assert.rejects(
    () => providers.translateCandidate('microsoft-azure', 'wallet', 'zh-CN', insecure),
    /必须使用 HTTPS/,
  );

  providers.clearCooldown('google-free');
  const rateLimit = new Error('Google HTTP 429: <html>Sorry...</html>');
  rateLimit.status = 429;
  rateLimit.retryAfter = '2';
  const normalized = providers.noteFailure('google-free', rateLimit);
  assert.equal(normalized.code, 'rate-limit');
  assert.equal(normalized.summary, '429 限流');
  const cooldown = providers.cooldownInfo('google-free');
  assert.ok(cooldown && cooldown.remainingMs > 0 && cooldown.remainingMs <= 2100, 'Retry-After must drive Google cooldown');
  providers.clearCooldown('google-free');

  assert.equal(providers.normalizeError('ai', new Error('User location is not supported for the API use.')).summary, '当前地区不可用');

  console.log('OK   translation provider v2 routing, auth headers, HTTPS guard and cooldowns');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
