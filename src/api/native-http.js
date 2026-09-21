// Client-first network transport for translation preview and future desktop-only calls.
// Uses a guarded Tauri command in packaged Pake clients and falls back to browser fetch.
(function (global) {
  'use strict';

  function getInvoke() {
    const invoke = global.__TAURI__?.core?.invoke;
    return typeof invoke === 'function' ? invoke : null;
  }

  function isNativeAvailable() {
    return !!getInvoke();
  }

  function normalizeTimeout(timeoutMs) {
    const value = Number(timeoutMs);
    if (!Number.isFinite(value)) return 15000;
    return Math.min(120000, Math.max(2500, Math.round(value)));
  }

  function resolveUrl(profile, rawUrl) {
    const url = String(rawUrl || '');
    const proxy = profile?.proxy || {};
    if (proxy.enabled === true && proxy.mode === 'prefix' && proxy.url && typeof global.applyProxyPrefix === 'function') {
      return global.applyProxyPrefix(profile, url);
    }
    return url;
  }

  function nativeProxyOptions(profile) {
    const proxy = profile?.proxy || {};
    if (proxy.enabled === true && proxy.mode === 'system' && proxy.url) {
      return {
        proxyUrl: String(proxy.url).trim(),
        useSystemProxy: true,
      };
    }
    // Pake/tauri-plugin-http's reqwest build supports Windows/macOS system proxy by default.
    // When no explicit profile proxy is requested, keep that platform behavior intact.
    return {
      proxyUrl: null,
      useSystemProxy: true,
    };
  }

  function responseFacade(payload, transport) {
    const status = Number(payload?.status) || 0;
    const headerMap = {};
    for (const [key, value] of Object.entries(payload?.headers || {})) {
      headerMap[String(key).toLowerCase()] = String(value);
    }
    const body = String(payload?.body ?? '');
    return {
      ok: status >= 200 && status < 300,
      status,
      transport,
      headers: {
        get(name) {
          return headerMap[String(name || '').toLowerCase()] ?? null;
        },
      },
      async text() { return body; },
      async json() { return body ? JSON.parse(body) : {}; },
    };
  }

  async function browserRequest(url, init, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...(init || {}), signal: ctrl.signal });
      // Native and browser callers can inspect this non-standard field for diagnostics.
      try { Object.defineProperty(response, 'transport', { value: 'browser', configurable: true }); } catch (_) {}
      return response;
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
        e.timeout = true;
        e.transport = 'browser';
        throw e;
      }
      const e = new Error('网络请求失败：' + (err?.message || err));
      e.networkError = true;
      e.transport = 'browser';
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function nativeRequest(url, init, timeoutMs, profile) {
    const invoke = getInvoke();
    if (!invoke) throw new Error('客户端原生网络桥不可用');
    const method = String(init?.method || 'GET').toUpperCase();
    const headers = {};
    if (init?.headers) {
      const source = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
      for (const [key, value] of Object.entries(source || {})) {
        if (value == null) continue;
        headers[String(key)] = String(value);
      }
    }
    const proxy = nativeProxyOptions(profile);
    const payload = await invoke('native_http_request', {
      params: {
        url,
        method,
        headers,
        body: init?.body == null ? null : String(init.body),
        timeoutMs,
        proxyUrl: proxy.proxyUrl,
        useSystemProxy: proxy.useSystemProxy,
      },
    });
    return responseFacade(payload, 'native');
  }

  async function request(rawUrl, init = {}, options = {}) {
    const timeoutMs = normalizeTimeout(options.timeoutMs);
    const profile = options.profile || null;
    const url = resolveUrl(profile, rawUrl);
    if (isNativeAvailable() && options.forceBrowser !== true) {
      try {
        return await nativeRequest(url, init, timeoutMs, profile);
      } catch (err) {
        // Tauri command rejections may arrive as strings rather than Error instances.
        const nativeError = err instanceof Error ? err : new Error(String(err));
        nativeError.nativeTransportError = true;
        if (options.nativeOnly === true) throw nativeError;
        // Only fall back when the command itself is unavailable. Network/HTTP failures from
        // the native path should be surfaced/fallback at the provider layer, not reissued via CORS fetch.
        const message = String(nativeError.message || nativeError);
        const commandMissing = /native_http_request|unknown command|not found|does not exist/i.test(message);
        if (!commandMissing) throw nativeError;
      }
    }
    return browserRequest(url, init, timeoutMs);
  }

  function describe(profile) {
    const native = isNativeAvailable();
    const proxy = profile?.proxy || {};
    let proxyText = '系统网络';
    if (proxy.enabled === true && proxy.mode === 'prefix' && proxy.url) {
      proxyText = `Prefix 中转 · ${proxy.url}`;
    } else if (proxy.enabled === true && proxy.mode === 'system' && proxy.url) {
      proxyText = `显式代理 · ${proxy.url}`;
    } else if (proxy.enabled === true && proxy.mode === 'system') {
      proxyText = '系统代理';
    }
    return {
      native,
      transport: native ? '客户端原生网络' : '浏览器 fetch',
      proxyText,
    };
  }

  global.NativeHttpTransport = Object.freeze({
    isAvailable: isNativeAvailable,
    request,
    resolveUrl,
    describe,
  });
})(window);
