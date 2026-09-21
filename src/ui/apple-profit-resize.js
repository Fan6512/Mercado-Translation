(() => {
  'use strict';

  const BASE_WIDTH = 340;
  const BASE_HEIGHT = 340;
  const MIN_SCALE = 0.9;
  const MAX_SCALE = 1.4;
  const EDGE_GAP = 16;
  const CONTENT_GAP = 18;
  const SCALE_KEY = 'translator_profit_calc_scale';

  let installed = false;
  let currentScale = readScale();
  let topLocked = false;
  let resizeState = null;

  function byId(id) { return document.getElementById(id); }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readScale() {
    const value = Number.parseFloat(localStorage.getItem(SCALE_KEY) || '1');
    return Number.isFinite(value) ? clamp(value, MIN_SCALE, MAX_SCALE) : 1;
  }

  function saveScale() {
    try { localStorage.setItem(SCALE_KEY, currentScale.toFixed(3)); } catch (_) {}
  }

  function getDock() {
    const floating = byId('floatingCalc');
    const aside = floating?.closest('aside');
    const main = document.querySelector('.apple-main') || byId('settingsPanel')?.parentElement;
    return { floating, aside, main };
  }

  function setImportant(el, property, value) {
    el.style.setProperty(property, value, 'important');
  }

  function getMainRight(main) {
    return main?.getBoundingClientRect().right || 0;
  }

  function getCenteredTop(scale) {
    return Math.max(EDGE_GAP, (window.innerHeight - BASE_HEIGHT * scale) / 2);
  }

  function getMaxScale(left, top) {
    const widthMax = (window.innerWidth - left - EDGE_GAP) / BASE_WIDTH;
    const heightMax = (window.innerHeight - top - EDGE_GAP) / BASE_HEIGHT;
    return Math.max(0.1, Math.min(MAX_SCALE, widthMax, heightMax));
  }

  function getCenteredMaxScale(left) {
    const widthMax = (window.innerWidth - left - EDGE_GAP) / BASE_WIDTH;
    const heightMax = (window.innerHeight - EDGE_GAP * 2) / BASE_HEIGHT;
    return Math.max(0.1, Math.min(MAX_SCALE, widthMax, heightMax));
  }

  function applySize(aside, floating) {
    const width = Math.round(BASE_WIDTH * currentScale);
    const height = Math.round(BASE_HEIGHT * currentScale);
    setImportant(aside, 'width', `${width}px`);
    setImportant(aside, 'height', `${height}px`);
    setImportant(floating, 'height', '100%');
    setImportant(floating, 'position', 'relative');

    const body = byId('calcBody');
    if (body) {
      body.style.maxHeight = 'calc(100% - 44px)';
      body.style.overflowY = 'auto';
      body.style.overscrollBehavior = 'contain';
    }
  }

  function alignDock({ preserveTop = topLocked } = {}) {
    const { floating, aside, main } = getDock();
    if (!floating || !aside || !main || window.innerWidth < 1200) return;

    const left = getMainRight(main) + CONTENT_GAP;
    setImportant(aside, 'left', `${Math.round(left)}px`);
    setImportant(aside, 'right', 'auto');

    if (!preserveTop) {
      const maxScale = getCenteredMaxScale(left);
      currentScale = clamp(currentScale, Math.min(MIN_SCALE, maxScale), maxScale);
      setImportant(aside, 'top', '50%');
      setImportant(aside, 'transform', 'translateY(-50%)');
    } else {
      const rect = aside.getBoundingClientRect();
      let top = rect.top;
      const maxScale = getMaxScale(left, top);
      currentScale = clamp(currentScale, Math.min(MIN_SCALE, maxScale), maxScale);
      const height = BASE_HEIGHT * currentScale;
      top = clamp(top, EDGE_GAP, Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP));
      setImportant(aside, 'top', `${Math.round(top)}px`);
      setImportant(aside, 'transform', 'none');
    }

    applySize(aside, floating);
  }

  function freezeTopLeft() {
    const { aside, main } = getDock();
    if (!aside || !main) return null;
    const rect = aside.getBoundingClientRect();
    const left = getMainRight(main) + CONTENT_GAP;
    topLocked = true;
    setImportant(aside, 'left', `${Math.round(left)}px`);
    setImportant(aside, 'right', 'auto');
    setImportant(aside, 'top', `${Math.round(rect.top)}px`);
    setImportant(aside, 'transform', 'none');
    return { left, top: rect.top };
  }

  function projectedScaleDelta(dx, dy) {
    const denominator = BASE_WIDTH * BASE_WIDTH + BASE_HEIGHT * BASE_HEIGHT;
    return (dx * BASE_WIDTH + dy * BASE_HEIGHT) / denominator;
  }

  function beginResize(event, handle) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const anchor = freezeTopLeft();
    const { aside } = getDock();
    if (!anchor || !aside) return;

    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScale: currentScale,
      left: anchor.left,
      top: anchor.top,
    };

    handle.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add('apple-profit-resizing');
  }

  function moveResize(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    event.preventDefault();

    const dx = event.clientX - resizeState.startX;
    const dy = event.clientY - resizeState.startY;
    const wanted = resizeState.startScale + projectedScaleDelta(dx, dy);
    const maxScale = getMaxScale(resizeState.left, resizeState.top);
    currentScale = clamp(wanted, Math.min(MIN_SCALE, maxScale), maxScale);

    const { aside, floating } = getDock();
    if (!aside || !floating) return;
    applySize(aside, floating);
  }

  function endResize(event, handle) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    resizeState = null;
    try { handle.releasePointerCapture?.(event.pointerId); } catch (_) {}
    document.documentElement.classList.remove('apple-profit-resizing');
    saveScale();
  }

  function resetSize() {
    currentScale = 1;
    topLocked = false;
    saveScale();
    alignDock({ preserveTop: false });
  }

  function createHandle(floating) {
    if (byId('appleProfitResizeHandle')) return byId('appleProfitResizeHandle');
    const handle = document.createElement('button');
    handle.id = 'appleProfitResizeHandle';
    handle.type = 'button';
    handle.setAttribute('aria-label', '等比例调整利润计算器大小');
    handle.title = '拖拽等比例缩放；双击恢复默认大小';
    handle.innerHTML = '<span></span><span></span><span></span>';
    handle.addEventListener('pointerdown', event => beginResize(event, handle));
    handle.addEventListener('pointermove', moveResize);
    handle.addEventListener('pointerup', event => endResize(event, handle));
    handle.addEventListener('pointercancel', event => endResize(event, handle));
    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      resetSize();
    });
    floating.appendChild(handle);
    return handle;
  }

  function installStyles() {
    if (byId('appleProfitResizeStyles')) return;
    const style = document.createElement('style');
    style.id = 'appleProfitResizeStyles';
    style.textContent = `
      #appleProfitResizeHandle {
        position: absolute;
        right: 7px;
        bottom: 7px;
        z-index: 5;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 7px;
        background: rgba(245,245,247,.9);
        cursor: nwse-resize;
        touch-action: none;
        opacity: .78;
        transition: opacity .15s ease, background .15s ease;
      }
      #appleProfitResizeHandle:hover {
        opacity: 1;
        background: #ededf0;
      }
      #appleProfitResizeHandle span {
        position: absolute;
        display: block;
        height: 1.5px;
        border-radius: 999px;
        background: #8e8e93;
        transform: rotate(-45deg);
        transform-origin: right center;
      }
      #appleProfitResizeHandle span:nth-child(1) { width: 7px; right: 5px; bottom: 6px; }
      #appleProfitResizeHandle span:nth-child(2) { width: 11px; right: 5px; bottom: 9px; }
      #appleProfitResizeHandle span:nth-child(3) { width: 15px; right: 5px; bottom: 12px; }
      html.apple-profit-resizing, html.apple-profit-resizing * {
        cursor: nwse-resize !important;
        user-select: none !important;
      }
      body.apple-workspace #calcBody {
        scrollbar-gutter: stable;
      }
    `;
    document.head.appendChild(style);
  }

  function handleWindowResize() {
    if (window.innerWidth < 1200) return;
    alignDock({ preserveTop: topLocked });
  }

  function install() {
    if (installed) return true;
    const { floating, aside, main } = getDock();
    if (!floating || !aside || !main || !aside.classList.contains('apple-profit-dock')) return false;

    installed = true;
    installStyles();
    createHandle(floating);
    alignDock({ preserveTop: false });
    window.addEventListener('resize', handleWindowResize, { passive: true });
    return true;
  }

  let tries = 0;
  const wait = () => {
    if (install()) return;
    if (++tries < 120) setTimeout(wait, 50);
  };
  wait();
})();
