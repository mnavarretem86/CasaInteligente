/* Smart Home UDEM: API compartida, una sola petición por vez y reintentos suaves.
   No envía comandos a sensores que el usuario no haya elegido. */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'esp32_ip';
  const DEFAULT_IP = '192.168.1.50';
  const menu = [
    ['dashboard', 'dashboard.html', '🏠', 'Resumen'],
    ['clima', 'clima.html', '🌡️', 'Temperatura y humedad'],
    ['seguridad', 'seguridad.html', '🛡️', 'Seguridad'],
    ['lluvia', 'lluvia.html', '🌧️', 'Sensor de lluvia'],
    ['pronostico', 'pronostico.html', '🌦️', 'Pronóstico local'],
    ['actuadores', 'actuadores.html', '⚙️', 'Actuadores'],
    ['iluminacion', 'iluminacion.html', '💡', 'Iluminación RGB'],
    ['audio', 'audio.html', '🎵', 'Audio y alarma'],
    ['diagnostico', 'diagnostico.html', '🩺', 'Diagnóstico']
  ];
  const app = {
    last: null, busy: false, timer: null, refresh: null,
    refreshAfter: false, fails: 0, stopped: false,
    pollController: null, toastTimer: null
  };
  let requestQueue = Promise.resolve();

  function getIp() { return localStorage.getItem(STORAGE_KEY) || DEFAULT_IP; }
  function normalizeIp(value) {
    const raw = String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const match = raw.match(/^([^:]+)(?::(\d{1,5}))?$/);
    if (!match) {
      throw new Error('Escribe la IP mostrada en la LCD, por ejemplo 192.168.1.50');
    }
    const host = match[1];
    const port = match[2] ? Number(match[2]) : null;
    if (port !== null && (port < 1 || port > 65535)) {
      throw new Error('El puerto debe estar entre 1 y 65535.');
    }
    const ipv4Parts = host.split('.');
    const isIpv4Candidate = ipv4Parts.every(part => /^\d+$/.test(part));
    if (isIpv4Candidate) {
      if (ipv4Parts.length !== 4 || ipv4Parts.some(p => Number(p) < 0 || Number(p) > 255)) {
        throw new Error('Dirección IPv4 no válida. Ejemplo: 192.168.1.50');
      }
    } else if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*[a-zA-Z0-9]$/.test(host) && host !== 'localhost') {
      throw new Error('Escribe la IP o nombre de host válido, por ejemplo 192.168.1.50');
    }
    return raw;
  }
  function saveIp(value) {
    const ip = normalizeIp(value);
    localStorage.setItem(STORAGE_KEY, ip);
    return ip;
  }
  function baseUrl() { return 'http://' + getIp(); }
  function $(id) { return document.getElementById(id); }
  function text(id, value) { const e = $(id); if (e) e.textContent = String(value ?? ''); }
  function pill(id, label, tone) {
    const e = $(id);
    if (e) {
      e.textContent = String(label ?? '--');
      e.className = 'pill' + (tone ? ' ' + tone : '');
    }
  }
  function progress(id, percentage) {
    const e = $(id);
    if (e) e.style.width = Math.max(0, Math.min(100, Number(percentage) || 0)) + '%';
  }
  function number(value, fallback = '--') {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }
  function buttonState(id, active, yes = 'ACTIVO', no = 'INACTIVO') {
    const e = $(id);
    if (e) {
      e.textContent = active ? yes : no;
      e.className = 'btn ' + (active ? 'btn-green' : 'btn-soft');
    }
  }
  function connection(isOnline, message) {
    const el = $('connection-pill');
    if (!el) return;
    el.className = 'connection-pill' + (isOnline === true ? ' online' : isOnline === false ? ' offline' : '');
    el.textContent = message || (isOnline ? 'ESP32 conectado' : 'Sin conexión');
  }
  function notify(message, tone = 'bad') {
    let toast = $('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'toast-notice';
      toast.setAttribute('role', 'alert');
      document.body.appendChild(toast);
    }
    toast.textContent = String(message || '');
    toast.className = 'toast-notice show ' + (tone || '');
    clearTimeout(app.toastTimer);
    app.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3800);
  }

  async function request(path, timeoutMs, isPoll = false) {
    if (location.protocol === 'https:') {
      throw new Error('Abre la interfaz por HTTP local; el ESP32 usa HTTP.');
    }
    const controller = new AbortController();
    if (isPoll) app.pollController = controller;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(baseUrl() + path, {
        method: 'GET', mode: 'cors', cache: 'no-store', signal: controller.signal
      });
      let data = null;
      try { data = await response.json(); }
      catch (_) { throw new Error('El ESP32 devolvió JSON incompleto.'); }
      if (!response.ok || data.ok === false) {
        throw new Error(data.message || data.error || 'HTTP ' + response.status);
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Tiempo de espera agotado. Comprueba Wi-Fi y la alimentación del ESP32.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      if (isPoll && app.pollController === controller) {
        app.pollController = null;
      }
    }
  }

  // Las conexiones HTTP simultáneas pueden saturar el pequeño servidor ESP32.
  function api(path, timeoutMs = 3600, isPoll = false) {
    const task = () => request(path, timeoutMs, isPoll);
    const result = requestQueue.then(task, task);
    requestQueue = result.catch(() => {});
    return result;
  }
  function status() { return api('/api/status', 3400, true); }
  function diagnostics() { return api('/api/diagnostics', 3800, false); }
  function sendCommand(command) {
    // Si hay un sondeo de estado en curso, lo abortamos para dar prioridad al comando del usuario
    if (app.pollController) {
      app.pollController.abort();
    }
    const cmdTimeout = app.fails >= 3 ? 2400 : 4200;
    return api('/api/cmd?c=' + encodeURIComponent(command), cmdTimeout, false).then(result => {
      if (app.refresh) app.refresh();
      return result;
    });
  }

  function setupShell(active) {
    const slot = $('site-shell');
    if (!slot) return;
    slot.innerHTML = `
      <aside class="sidebar">
        <a href="index.html" class="brand" aria-label="Ir al inicio">
          <span class="brand-icon">⌂</span><span><span class="brand-name">Smart Home</span><br><span class="brand-sub">UDEM · ROBÓTICA SI15A</span></span>
        </a>
        <nav aria-label="Menú principal"><p class="nav-caption">NAVEGACIÓN</p><div class="menu" id="main-menu"></div></nav>
        <div class="sidebar-note"><b>🌱 ESP32 + MicroPython</b></div>
      </aside>
      <div class="content">
        <header class="topbar">
          <div class="breadcrumb">UNIVERSIDAD DE MANAGUA / <strong id="current-section">DOMÓTICA</strong></div>
          <div class="connection-tools">
            <span class="connection-pill" id="connection-pill" role="status" aria-live="polite">Conectando…</span>
            <form class="ip-control" id="ip-form"><label for="esp-ip" class="tiny-note">ESP32</label><input id="esp-ip" aria-label="Dirección IP del ESP32" autocomplete="off"><button type="submit">Guardar IP</button></form>
          </div>
        </header>
        <div id="page-content"></div>
        <footer class="page-footer">UDEM · Robótica SI15A · Sistema Domótico IoT</footer>
      </div>`;
    const container = $('main-menu');
    for (const [id, href, emoji, title] of menu) {
      const a = document.createElement('a');
      a.href = href;
      a.className = 'menu-link' + (id === active ? ' active' : '');
      if (id === active) a.setAttribute('aria-current', 'page');
      const icon = document.createElement('span');
      icon.className = 'menu-icon'; icon.textContent = emoji;
      const label = document.createElement('span'); label.textContent = title;
      a.append(icon, label); container.appendChild(a);
      if (id === active) text('current-section', title.toUpperCase());
    }
    const ipInput = $('esp-ip');
    const ipForm = $('ip-form');
    if (ipInput) ipInput.value = getIp();
    if (ipForm && ipInput) {
      ipForm.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
          saveIp(ipInput.value);
          window.location.reload();
        } catch (err) {
          notify(err.message, 'bad');
        }
      });
    }
  }

  function bootPage(config) {
    setupShell(config.active);
    const host = $('page-content'), template = $('page-template');
    if (host && template) host.appendChild(template.content.cloneNode(true));
    const interval = Math.max(1900, config.interval || 2600);
    async function refresh() {
      if (app.stopped) return;
      if (app.busy) { app.refreshAfter = true; return; }
      if (document.hidden) { schedule(interval); return; }
      app.busy = true;
      clearTimeout(app.timer);
      try {
        const data = await status();
        app.fails = 0;
        app.last = data;
        connection(true, 'ESP32 conectado');
        config.onData(data);
      } catch (err) {
        app.fails += 1;
        // Una sola respuesta perdida no significa que el Wi-Fi haya caído.
        connection(app.fails >= 3 ? false : null,
                   app.fails >= 3 ? 'ESP32 sin respuesta' : 'Reintentando conexión…');
        if (config.onError) config.onError(err);
      } finally {
        app.busy = false;
        const next = app.refreshAfter ? 200 : interval;
        app.refreshAfter = false;
        schedule(next);
      }
    }
    function schedule(ms) {
      clearTimeout(app.timer);
      if (!app.stopped) app.timer = setTimeout(refresh, ms);
    }
    app.refresh = refresh;
    document.querySelectorAll('[data-cmd]').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await sendCommand(button.dataset.cmd);
        } catch (err) {
          notify('No se pudo ejecutar la acción: ' + err.message, 'bad');
        } finally {
          button.disabled = false;
        }
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule(100);
    });
    window.addEventListener('pagehide', () => {
      app.stopped = true;
      clearTimeout(app.timer);
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        app.stopped = false;
        schedule(100);
      }
    });
    refresh();
  }

  global.SmartHome = Object.freeze({
    getIp, saveIp, baseUrl, status, diagnostics,
    bootPage, sendCommand, $, text, pill, progress,
    number, buttonState, connection, notify
  });
})(window);
