(() => {
  'use strict';

  const MAX_TITLE_COUNT = 4;
  const TITLE_COUNT_KEY = 'translator_title_count';
  const LANG_META = {
    en: { label: 'EN', name: 'English', isCN: false },
    es: { label: 'ES', name: 'Español', isCN: false },
    pt: { label: 'PT', name: 'Português', isCN: false },
    zh: { label: 'ZH', name: '中文', isCN: true },
  };
  const LANG_EN_NAME_LOCAL = { en: 'English', es: 'Español', pt: 'Português', zh: '中文' };

  let initialized = false;

  function byId(id) { return document.getElementById(id); }
  function clampTitleCount(value) {
    return Math.min(MAX_TITLE_COUNT, Math.max(1, Number.parseInt(value, 10) || 1));
  }

  function countTitleChars(text, isCN) {
    if (!text) return 0;
    if (!isCN) return text.length;
    let n = 0;
    for (const ch of text) n += /[一-鿿　-〿＀-￯]/.test(ch) ? 2 : 1;
    return n;
  }

  function getVersions(result) {
    if (!result || typeof result !== 'object') return [];
    if (Array.isArray(result.versions)) {
      return result.versions.filter(v => v && typeof v === 'object' && !Array.isArray(v));
    }
    return [result];
  }

  async function copyTextSafe(text) {
    if (!text) return false;
    try {
      if (typeof window.copyText === 'function') return await window.copyText(text);
    } catch (_) {}
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function copiedState(button, normalText) {
    if (!button) return;
    button.classList.add('is-copied');
    button.textContent = '✓';
    setTimeout(() => {
      button.classList.remove('is-copied');
      button.textContent = normalText;
    }, 900);
  }

  function copiedLabelState(button, normalText) {
    if (!button) return;
    button.classList.add('is-copied');
    button.textContent = 'Copied ✓';
    setTimeout(() => {
      button.classList.remove('is-copied');
      button.textContent = normalText;
    }, 1100);
  }

  function showCopyError() {
    if (typeof window.showError === 'function') window.showError('复制失败，请手动复制');
  }

  function buildFourTitleRoutePrompt(basePrompt, langs, titleCount = 1) {
    const count = clampTitleCount(titleCount);
    const pair = langs.map(l => {
      const needAnalysis = l === 'es' || l === 'pt';
      return `    "${l}": { "title": "..."${needAnalysis ? ', "analysis": "..."' : ''} }`;
    }).join(',\n');

    if (count === 1) {
      return basePrompt + `\n\n【本次输出范围 — 优先于上文所有语种要求】\n本次只需输出：${langs.map(l => `${l}（${LANG_EN_NAME_LOCAL[l]}）`).join('、')}。其余语种字段直接省略，不要出现在 JSON 中。\n只返回如下 JSON，不要 markdown 代码块：\n{\n${pair.replace(/^    /gm, '  ')}\n}`;
    }

    const versions = Array.from({ length: count }, (_, i) => `  {\n    "version": ${i + 1},\n${pair}\n  }`).join(',\n');

    return basePrompt + `\n\n【本次输出数量与范围 — 优先于上文输出格式要求】\n本次需要生成 ${count} 套标题版本。这里只规定数量与 JSON 结构；每套标题的内容规则、SEO规则、字符规则仍严格遵守上文 Prompt。\n每套都只输出：${langs.map(l => `${l}（${LANG_EN_NAME_LOCAL[l]}）`).join('、')}。其余语种字段直接省略。\n${count} 套标题应彼此有合理差异，但不得为了差异而添加原商品没有的信息。\n只返回如下 JSON，不要 markdown 代码块：\n{\n  "versions": [\n${versions}\n  ]\n}`;
  }

  function installFourTitleCompatibility() {
    // Existing functions call these globals at click/run time, so replacing them here
    // extends the current pipeline without duplicating API/request logic.
    if (typeof window.normalizeTitleCount === 'function') {
      window.normalizeTitleCount = clampTitleCount;
    }
    if (typeof window.getRequestedTitleCount === 'function') {
      window.getRequestedTitleCount = () => clampTitleCount(byId('titleCount')?.value || 1);
    }
    if (typeof window.buildRoutePrompt === 'function') {
      window.buildRoutePrompt = buildFourTitleRoutePrompt;
    }
  }

  function mountTitleCountSegmented() {
    const select = byId('titleCount');
    if (!select || byId('appleTitleSegmented')) return;

    if (!select.querySelector('option[value="4"]')) {
      const option = document.createElement('option');
      option.value = '4';
      option.textContent = '4 个';
      select.appendChild(option);
    }

    select.classList.add('apple-title-count-source');
    const label = select.closest('label');
    if (!label) return;
    label.classList.add('apple-title-count-control');
    const labelText = label.querySelector('span');
    if (labelText) labelText.textContent = '生成数量';

    const segmented = document.createElement('div');
    segmented.id = 'appleTitleSegmented';
    segmented.className = 'apple-title-segmented';
    segmented.setAttribute('role', 'group');
    segmented.setAttribute('aria-label', '标题生成数量');

    for (let i = 1; i <= MAX_TITLE_COUNT; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.count = String(i);
      btn.textContent = String(i);
      btn.title = `生成 ${i} 套标题版本`;
      btn.addEventListener('click', () => {
        select.value = String(i);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      });
      segmented.appendChild(btn);
    }
    label.appendChild(segmented);

    const saved = clampTitleCount(localStorage.getItem(TITLE_COUNT_KEY) || select.value || 1);
    select.value = String(saved);

    function sync() {
      const current = clampTitleCount(select.value);
      select.value = String(current);
      segmented.querySelectorAll('button').forEach(btn => {
        const active = Number(btn.dataset.count) === current;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    select.addEventListener('change', sync);
    sync();
  }

  function formatWholeVersion(version) {
    return ['en','es','pt','zh']
      .filter(lang => version?.[lang]?.title)
      .map(lang => `${LANG_META[lang].label}: ${version[lang].title}`)
      .join('\n');
  }

  function makeCopyMenu(version, menuButton) {
    const menu = document.createElement('div');
    menu.className = 'apple-title-copy-menu';
    const items = [
      ['复制西语', version?.es?.title || ''],
      ['复制葡语', version?.pt?.title || ''],
      ['复制中文', version?.zh?.title || ''],
      ['复制整组', formatWholeVersion(version)],
    ];
    for (const [label, text] of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.disabled = !text;
      btn.addEventListener('click', async () => {
        if (!text) return;
        if (!(await copyTextSafe(text))) return showCopyError();
        menu.classList.remove('is-open');
        copiedState(menuButton, '•••');
      });
      menu.appendChild(btn);
    }
    return menu;
  }

  function appleRenderOutput(result, input, charLimit, charLimitCN) {
    const out = byId('outputArea');
    if (!out) return;
    out.innerHTML = '';
    out.classList.remove('hidden');
    out.classList.add('apple-title-output');

    const versions = getVersions(result);
    versions.forEach((version, versionIndex) => {
      const card = document.createElement('section');
      card.className = 'apple-title-version';

      const head = document.createElement('div');
      head.className = 'apple-title-version-head';
      const name = document.createElement('div');
      name.className = 'apple-title-version-name';
      name.innerHTML = `<strong>Title V${versionIndex + 1}</strong><span>第 ${versionIndex + 1} / ${versions.length} 套</span>`;

      const actions = document.createElement('div');
      actions.className = 'apple-title-version-actions';
      const copyEnglish = document.createElement('button');
      copyEnglish.type = 'button';
      copyEnglish.className = 'apple-copy-english';
      copyEnglish.textContent = 'Copy English';
      copyEnglish.disabled = !version?.en?.title;
      copyEnglish.addEventListener('click', async () => {
        if (!version?.en?.title) return;
        if (!(await copyTextSafe(version.en.title))) return showCopyError();
        copiedLabelState(copyEnglish, 'Copy English');
      });

      const menuButton = document.createElement('button');
      menuButton.type = 'button';
      menuButton.className = 'apple-title-menu-button';
      menuButton.textContent = '•••';
      menuButton.title = '更多复制选项';
      const menu = makeCopyMenu(version, menuButton);
      menuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        document.querySelectorAll('.apple-title-copy-menu.is-open').forEach(el => {
          if (el !== menu) el.classList.remove('is-open');
        });
        menu.classList.toggle('is-open');
      });

      actions.append(copyEnglish, menuButton, menu);
      head.append(name, actions);
      card.appendChild(head);

      for (const lang of ['en','es','pt','zh']) {
        const item = version?.[lang];
        if (!item?.title) continue;
        const meta = LANG_META[lang];
        const limit = meta.isCN ? charLimitCN : charLimit;
        const count = countTitleChars(item.title, meta.isCN);

        const wrapper = document.createElement('div');
        wrapper.className = 'apple-title-item';
        const row = document.createElement('div');
        row.className = 'apple-title-row';

        const langCell = document.createElement('div');
        langCell.className = 'apple-title-lang';
        const langText = document.createElement('span');
        langText.textContent = meta.label;
        langText.title = meta.name;
        langCell.appendChild(langText);

        const analysisText = typeof item.analysis === 'string' ? item.analysis.trim() : '';
        let analysisBox = null;
        if (analysisText) {
          const info = document.createElement('button');
          info.type = 'button';
          info.className = 'apple-title-info';
          info.textContent = 'i';
          info.title = '查看 SEO / 流量解析';
          analysisBox = document.createElement('div');
          analysisBox.className = 'apple-title-analysis';
          analysisBox.textContent = analysisText;
          info.addEventListener('click', () => analysisBox.classList.toggle('is-open'));
          langCell.appendChild(info);
        }

        const title = document.createElement('div');
        title.className = 'apple-title-text';
        title.textContent = item.title;
        title.title = item.title;

        const counter = document.createElement('div');
        counter.className = 'apple-title-count';
        counter.textContent = `${count}/${limit}`;
        if (count > limit) counter.classList.add('is-over');
        else if (count > limit * .95) counter.classList.add('is-warn');

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'apple-title-copy';
        copy.textContent = '⧉';
        copy.title = `复制 ${meta.name} 标题`;
        copy.addEventListener('click', async () => {
          if (!(await copyTextSafe(item.title))) return showCopyError();
          copiedState(copy, '⧉');
        });

        row.append(langCell, title, counter, copy);
        wrapper.appendChild(row);
        if (analysisBox) wrapper.appendChild(analysisBox);
        card.appendChild(wrapper);
      }

      out.appendChild(card);
    });
  }

  function installCompactRenderer() {
    if (typeof window.renderOutput === 'function') window.renderOutput = appleRenderOutput;
  }

  function decoratePage() {
    document.body.classList.add('apple-workspace');

    const settings = byId('settingsPanel');
    const main = settings?.parentElement;
    const shell = main?.parentElement;
    if (shell) shell.classList.add('apple-shell');
    if (main) main.classList.add('apple-main');
    const header = main?.querySelector('header');
    if (header) header.classList.add('apple-header');

    main?.querySelectorAll(':scope > section').forEach(section => section.classList.add('apple-card'));
    const gtSection = byId('gtSource')?.closest('section');
    if (gtSection) gtSection.classList.add('apple-secondary-card');

    const workflow = byId('btnTranslate')?.closest('section');
    if (workflow) workflow.classList.add('apple-workflow-card');
    const raw = byId('productRawData');
    if (raw) raw.closest('.mb-4')?.classList.add('apple-product-area');
    const descriptionButton = byId('btnGenerateDescription');
    if (descriptionButton) descriptionButton.closest('.mt-5')?.classList.add('apple-description-task');
    byId('btnTranslate')?.parentElement?.classList.add('apple-title-actions');

    const promptTitleTab = byId('btnPromptTabTitle');
    if (promptTitleTab) promptTitleTab.parentElement?.classList.add('apple-prompt-segment');
    byId('btnResetPromptDrawer')?.parentElement?.classList.add('apple-prompt-actions');
    byId('btnResetDescriptionPrompt')?.parentElement?.classList.add('apple-prompt-actions');
  }

  function dockProfitCalculator() {
    const floating = byId('floatingCalc');
    if (!floating) return;
    const aside = floating.closest('aside');
    if (!aside) return;
    aside.classList.add('apple-profit-dock');
    floating.parentElement?.classList.add('apple-profit-inner');
    // Deliberately do not bind or replace any calculator events/functions here.
  }

  function closeCopyMenusOnOutsideClick() {
    document.addEventListener('click', event => {
      if (event.target.closest('.apple-title-version-actions')) return;
      document.querySelectorAll('.apple-title-copy-menu.is-open').forEach(el => el.classList.remove('is-open'));
    });
  }

  function initialize() {
    if (initialized) return;
    const ready = byId('btnTranslate') && byId('productRawData') && byId('btnPrompts') && typeof window.renderOutput === 'function';
    if (!ready) return false;
    initialized = true;

    installFourTitleCompatibility();
    decoratePage();
    dockProfitCalculator();
    mountTitleCountSegmented();
    installCompactRenderer();
    closeCopyMenusOnOutsideClick();
    return true;
  }

  function waitForWorkspace() {
    let tries = 0;
    const tick = () => {
      if (initialize()) return;
      if (++tries < 80) setTimeout(tick, 50);
      else console.warn('[apple-workspace] workspace initialization timed out');
    };
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(waitForWorkspace, 0), { once: true });
  } else {
    setTimeout(waitForWorkspace, 0);
  }
})();
