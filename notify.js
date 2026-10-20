/* Notificaciones globales. Toastify JS con respaldo local sin ventanas bloqueantes. */
(function (global) {
  'use strict';
  const CDN = 'https://cdn.jsdelivr.net/npm/toastify-js@1.12.0';
  const lastMessages = new Map();
  const colors = {success:'#168668', error:'#b83d4b', warning:'#b3771d', info:'#276cbd'};
  const icons = {success:'✓', error:'!', warning:'!', info:'i'};

  function loadLibrary() {
    if (!document.querySelector('link[data-sh-toastify]')) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = CDN + '/src/toastify.min.css';
      stylesheet.dataset.shToastify = '1';
      document.head.appendChild(stylesheet);
    }
    if (typeof global.Toastify !== 'function' && !document.querySelector('script[data-sh-toastify]')) {
      const script = document.createElement('script');
      script.src = CDN + '/src/toastify.min.js';
      script.async = true;
      script.dataset.shToastify = '1';
      document.head.appendChild(script);
    }
  }

  function fallbackToast(text, kind, duration) {
    let region = document.getElementById('sh-toast-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'sh-toast-region';
      region.className = 'sh-toast-region';
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-label', 'Notificaciones');
      document.body.appendChild(region);
    }
    const toast = document.createElement('div');
    toast.className = 'sh-toast-fallback sh-toast-' + kind;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const badge = document.createElement('span');
    badge.className = 'sh-toast-icon';
    badge.textContent = icons[kind];
    const body = document.createElement('span');
    body.className = 'sh-toast-message';
    body.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sh-toast-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Cerrar aviso');
    let timer;
    function remove() { clearTimeout(timer); toast.remove(); }
    close.addEventListener('click', remove);
    toast.append(badge, body, close);
    region.appendChild(toast);
    while (region.children.length > 4) region.firstElementChild.remove();
    if (duration > 0) timer = setTimeout(remove, duration);
  }

  function notify(message, kind = 'info', options = {}) {
    const text = String(message || '').trim();
    if (!text) return;
    kind = Object.prototype.hasOwnProperty.call(colors, kind) ? kind : 'info';
    const now = Date.now();
    const previous = lastMessages.get(kind + text) || 0;
    if (!options.allowRepeat && now - previous < 1700) return;
    lastMessages.set(kind + text, now);
    const duration = options.duration ?? (kind === 'error' ? 6500 : 3800);
    if (typeof global.Toastify === 'function') {
      try {
        global.Toastify({
          text: icons[kind] + '  ' + text,
          duration,
          close: true,
          gravity: 'top',
          position: 'right',
          stopOnFocus: true,
          escapeMarkup: true,
          className: 'sh-toast sh-toast-' + kind,
          style: {background: colors[kind], borderRadius: '14px'},
          offset: {x: 12, y: 12},
          ariaLive: kind === 'error' ? 'assertive' : 'polite'
        }).showToast();
        return;
      } catch (error) { console.warn('Toastify no disponible:', error); }
    }
    fallbackToast(text, kind, duration);
  }

  const api = Object.freeze({
    show: notify,
    success: (m,o) => notify(m, 'success', o),
    error: (m,o) => notify(m, 'error', o),
    warning: (m,o) => notify(m, 'warning', o),
    info: (m,o) => notify(m, 'info', o)
  });
  global.SmartNotify = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadLibrary, {once:true});
  else loadLibrary();
})(window);
