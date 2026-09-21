// Translation settings network diagnostics.
// Keeps proxy configuration single-sourced from the active API profile and only shows effective state here.
(function (global) {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function getProfile() {
    try { return typeof global.getSettings === 'function' ? global.getSettings() : null; }
    catch (_) { return null; }
  }

  function statusMarkup() {
    return `
      <div id="translationNativeNetworkCard" class="translation-setting-card">
        <div class="translation-setting-head">
          <div>
            <h3>客户端网络</h3>
            <p>翻译预检统一跟随当前 API 配置的代理；客户端优先使用原生 HTTP，源码模式才使用浏览器 fetch。</p>
          </div>
          <span id="translationNativeBadge" class="translation-badge">检测中</span>
        </div>
        <div class="translation-provider-info">
          <div><span>运输层</span><strong id="translationNativeTransport">检测中</strong></div>
          <div><span>代理</span><strong id="translationNativeProxy">检测中</strong></div>
          <div><span>跨域</span><strong id="translationNativeCors">检测中</strong></div>
        </div>
        <p id="translationNativeNote" class="translation-small-note"></p>
      </div>`;
  }

  function updateStatus() {
    const transport = global.NativeHttpTransport;
    const profile = getProfile();
    const info = transport?.describe ? transport.describe(profile) : {
      native: false,
      transport: '浏览器 fetch',
      proxyText: '未知',
    };
    const badge = byId('translationNativeBadge');
    const transportText = byId('translationNativeTransport');
    const proxyText = byId('translationNativeProxy');
    const corsText = byId('translationNativeCors');
    const note = byId('translationNativeNote');
    if (!badge || !transportText || !proxyText || !corsText || !note) return;

    badge.textContent = info.native ? 'Native' : 'Browser';
    badge.classList.toggle('translation-badge-warn', !info.native);
    transportText.textContent = info.transport;
    proxyText.textContent = info.proxyText;
    corsText.textContent = info.native ? '不受浏览器 CORS 限制' : '受浏览器 CORS 限制';
    note.textContent = info.native
      ? 'Google / Microsoft / 百度 / AI 翻译会优先经过客户端原生网络层；当前 API 配置启用“本机 / 系统代理”且填写代理地址时，会显式传给原生 HTTP 客户端。'
      : '当前是源码 / 浏览器兼容模式。Google 可能可用，但 Microsoft 免费网页接口可能因 CORS 显示 Failed to fetch；正式客户端会改走原生网络。';
  }

  function install() {
    const general = document.querySelector('[data-translation-pane="general"]');
    if (!general || byId('translationNativeNetworkCard')) return false;
    const host = document.createElement('div');
    host.innerHTML = statusMarkup().trim();
    const card = host.firstElementChild;
    const firstCard = general.querySelector('.translation-setting-card');
    if (firstCard?.nextSibling) general.insertBefore(card, firstCard.nextSibling);
    else general.appendChild(card);

    const microsoftNote = document.querySelector('[data-translation-pane="microsoft"] .translation-small-note');
    if (microsoftNote) {
      microsoftNote.textContent = '这是 Bing 网页翻译链路而不是 Azure Translator 正式 API。客户端优先通过原生 HTTP 调用以绕开浏览器 CORS；页面结构变化或服务限流时，自动模式仍会继续尝试百度或 AI。';
    }

    byId('btnTranslationSettings')?.addEventListener('click', () => setTimeout(updateStatus, 0));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateStatus();
    });
    updateStatus();
    return true;
  }

  if (!install()) {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (install() || tries >= 80) clearInterval(timer);
    }, 100);
  }
})(window);
