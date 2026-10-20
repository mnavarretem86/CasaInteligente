/* Smart Home UdeM · Comunicación y navegación de la interfaz */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'esp32_ip';
  const CACHE_KEY = 'smarthome_last_status_v2';
  const DEFAULT_IP = '192.168.1.50';
  const CACHE_MAX_AGE_MS = 15000;
  const ONLINE_AGE_MS = 6500;
  const STATUS_TIMEOUT_MS = 4000;
  const COMMAND_TIMEOUT_MS = 9500;
  const FAILS_BEFORE_OFFLINE = 3;

  const menu = [
    ['dashboard', 'dashboard.html', '🏠', 'Resumen'],
    ['clima', 'clima.html', '🌡️', 'Temperatura y humedad'],
    ['planta', 'planta.html', '🌱', 'Mi Planta'],
    ['seguridad', 'seguridad.html', '🛡️', 'Seguridad'],
    ['lluvia', 'lluvia.html', '🌧️', 'Sensor de lluvia'],
    ['pronostico', 'pronostico.html', '🌦️', 'Pronóstico local'],
    ['actuadores', 'actuadores.html', '⚙️', 'Actuadores'],
    ['iluminacion', 'iluminacion.html', '💡', 'Iluminación RGB'],
    ['audio', 'audio.html', '🎵', 'Audio y alarma'],
    ['diagnostico', 'diagnostico.html', '🩺', 'Diagnóstico']
  ];

  const app = {
    last: null, lastOkAt: 0, fails: 0, timer: null,
    stopped: false, busy: false, refreshAfter: false,
    refresh: null, activeControllers: new Set(),
    pendingRequests: [], activeRequest: false,
    pendingStatus: null, pendingCommands: 0, reportedOffline: false
  };

  function getIp() {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_IP; }
    catch (_) { return DEFAULT_IP; }
  }

  function normalizeIp(value) {
    const ip = String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*(?::[0-9]{1,5})?$/.test(ip)) {
      throw new Error('Escribe la IP del ESP32, por ejemplo 192.168.1.50');
    }
    const host = ip.split(':')[0];
    const octets = host.split('.');
    if (octets.length === 4 && octets.every(x => /^\d+$/.test(x)) &&
        octets.some(x => Number(x) > 255)) {
      throw new Error('La dirección IPv4 contiene un número inválido.');
    }
    return ip;
  }

  function saveIp(value) {
    const ip = normalizeIp(value);
    if (ip !== getIp()) {
      app.last = null;
      app.lastOkAt = 0;
      try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
    }
    localStorage.setItem(STORAGE_KEY, ip);
    return ip;
  }

  function baseUrl() { return 'http://' + getIp(); }
  function $(id) { return document.getElementById(id); }
  function text(id, value) { const el = $(id); if (el) el.textContent = String(value); }
  function pill(id, label, tone) {
    const el = $(id);
    if (el) { el.textContent = label; el.className = 'pill ' + (tone || ''); }
  }
  function progress(id, value) {
    const el = $(id);
    if (el) el.style.width = Math.max(0, Math.min(100, Number(value) || 0)) + '%';
  }
  function number(value, fallback = '--') {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }
  function buttonState(id, active, yes = 'ACTIVO', no = 'INACTIVO') {
    const el = $(id);
    if (el) {
      el.textContent = active ? yes : no;
      el.className = 'btn ' + (active ? 'btn-green' : 'btn-soft');
    }
  }
  function connection(isOnline, message) {
    const el = $('connection-pill');
    if (!el) return;
    el.className = 'connection-pill ' + (isOnline === true ? 'online' : isOnline === false ? 'offline' : '');
    el.textContent = message || (isOnline === true ? 'ESP32 conectado' : isOnline === false ? 'Sin conexión' : 'Verificando ESP32…');
  }

  const COMMAND_MESSAGES = Object.freeze({
    led_on: 'Luz encendida',
    led_off: 'Luz apagada',
    win_open: 'Abriendo ventana',
    win_close: 'Cerrando ventana',
    fan_der: 'Ventilador a la derecha',
    fan_izq: 'Ventilador a la izquierda',
    fan_off: 'Ventilador detenido',
    rgb_red: 'Color rojo aplicado',
    rgb_green: 'Color verde aplicado',
    rgb_blue: 'Color azul aplicado',
    rgb_yellow: 'Color amarillo aplicado',
    rgb_purple: 'Color morado aplicado',
    rgb_cyan: 'Color cian aplicado',
    rgb_white: 'Luz blanca aplicada',
    rgb_off: 'Luces RGB apagadas',
    toggle_temp: 'Sensor de clima actualizado',
    toggle_gas: 'Sensor de gas actualizado',
    toggle_pir: 'Sensor de movimiento actualizado',
    toggle_rain: 'Sensor de lluvia actualizado',
    toggle_rfid: 'Lector RFID actualizado',
    toggle_autorain: 'Ventana automática actualizada',
    toggle_alarm: 'Alarma actualizada',
    play_jingle: 'Reproduciendo Navidad',
    play_starwars: 'Reproduciendo Star Wars',
    play_twinkle: 'Reproduciendo Estrellita',
    play_ode: 'Reproduciendo Himno a la alegría',
    play_birthday: 'Reproduciendo Cumpleaños feliz',
    stop_melody: 'Música detenida',
    rain_dry: 'Lectura en seco guardada',
    rain_wet: 'Lectura en mojado guardada',
    rain_reset: 'Calibración reiniciada'
  });

  function shortError(error) {
    const message = String(error?.message || error || '').trim();
    if (/tiempo de espera|timeout|abort/i.test(message)) return 'El ESP32 tardó demasiado';
    if (/failed to fetch|networkerror|load failed|network request failed|sin conexi[oó]n/i.test(message)) {
      return 'Sin conexión con el ESP32';
    }
    if (/alarma.*prioridad|prioridad.*alarma/i.test(message)) return 'La alarma tiene prioridad';
    if (/puerta eliminada/i.test(message)) return 'Solo está disponible la ventana';
    if (/comando desconocido|comando inv[aá]lido/i.test(message)) return 'Acción no disponible';
    if (/respuesta incompleta|json incompleto|respuesta no corresponde/i.test(message)) return 'Respuesta del ESP32 inválida';
    return 'No pudimos confirmar el cambio';
  }

  function validStatus(data) {
    return data && typeof data === 'object' &&
      typeof data.temp_active === 'boolean' &&
      typeof data.rain_active === 'boolean' &&
      typeof data.window === 'string';
  }

  function rememberStatus(data, ip = getIp()) {
    if (!validStatus(data)) return false;
    const at = Date.now();
    if (ip === getIp()) { app.last = data; app.lastOkAt = at; }
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ip, at, data })); }
    catch (_) {}
    return true;
  }

  function recentStatus() {
    try {
      const entry = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (!entry || entry.ip !== getIp() || !validStatus(entry.data)) return null;
      const age = Date.now() - entry.at;
      if (age < 0 || age > CACHE_MAX_AGE_MS) return null;
      app.last = entry.data;
      app.lastOkAt = entry.at;
      return entry;
    } catch (_) { return null; }
  }

  async function request(path, timeoutMs) {
    if (location.protocol === 'https:') throw new Error('Accede a Smart Home mediante HTTP local; el ESP32 utiliza HTTP.');
    if (app.stopped) throw new Error('Se cerró la página.');
    const controller = new AbortController();
    app.activeControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(baseUrl() + path, {
        method: 'GET', mode: 'cors', cache: 'no-store', signal: controller.signal
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error('El ESP32 devolvió una respuesta incompleta.'); }
      if (!response.ok || data.ok === false) {
        throw new Error(data.message || data.error || 'Error HTTP ' + response.status);
      }
      if (path === '/api/status') {
        if (!validStatus(data)) throw new Error('La respuesta no corresponde a la API Smart Home.');
        rememberStatus(data);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Tiempo de espera agotado. Comprueba el estado actual antes de repetir la acción.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      app.activeControllers.delete(controller);
    }
  }

  // Ejecuta una solicitud cada vez. Las órdenes pendientes se atienden antes de nuevos sondeos.
  function runQueue() {
    if (app.activeRequest || app.stopped) return;
    const job = app.pendingRequests.shift();
    if (!job) return;
    app.activeRequest = true;
    request(job.path, job.timeout).then(job.resolve, job.reject).finally(() => {
      app.activeRequest = false;
      runQueue();
    });
  }
  function api(path, timeout = STATUS_TIMEOUT_MS, priority = false) {
    if (app.stopped) return Promise.reject(new Error('Página cerrada.'));
    return new Promise((resolve, reject) => {
      const job = { path, timeout, resolve, reject };
      if (priority) app.pendingRequests.unshift(job);
      else app.pendingRequests.push(job);
      runQueue();
    });
  }
  function status() {
    if (app.pendingStatus) return app.pendingStatus;
    const task = api('/api/status');
    app.pendingStatus = task;
    task.finally(() => { if (app.pendingStatus === task) app.pendingStatus = null; }).catch(() => {});
    return task;
  }
  function diagnostics() { return api('/api/diagnostics'); }
  function sendCommand(command) {
    if (typeof command !== 'string' || !/^[a-z0-9_]+$/.test(command)) {
      return Promise.reject(new Error('Comando inválido.'));
    }
    // No reintentar automáticamente una orden que pudo haber sido ejecutada.
    app.pendingCommands += 1;
    clearTimeout(app.timer);
    return api('/api/cmd?c=' + encodeURIComponent(command), COMMAND_TIMEOUT_MS, true)
      .finally(() => {
        app.pendingCommands = Math.max(0, app.pendingCommands - 1);
        if (app.refresh) app.refresh();
      });
  }

  function setupShell(active) {
    const slot = $('site-shell');
    if (!slot) return;
    slot.innerHTML = `
      <div class="mobile-overlay" id="mobile-overlay" hidden></div>
      <aside class="sidebar" id="app-sidebar">
        <div class="sidebar-top">
          <a href="index.html" class="brand" aria-label="Volver al inicio">
            <span class="brand-icon">⌂</span><span><span class="brand-name">Smart Home</span><br><span class="brand-sub">UDEM · ROBÓTICA SI15A</span></span>
          </a>
          <button class="sidebar-close" id="sidebar-close" type="button" aria-label="Cerrar menú">✕</button>
        </div>
        <nav aria-label="Menú principal"><p class="nav-caption">NAVEGACIÓN</p><div class="menu" id="main-menu"></div></nav>
        <div class="sidebar-note"><b>🌱 ESP32 + MicroPython</b></div>
      </aside>
      <div class="content">
        <header class="topbar">
          <div class="topbar-head">
            <button class="menu-toggle" id="menu-toggle" type="button" aria-label="Abrir menú" aria-controls="app-sidebar" aria-expanded="false">☰</button>
            <div class="breadcrumb">UNIVERSIDAD DE MANAGUA / <strong id="current-section">DOMÓTICA</strong></div>
          </div>
          <div class="connection-tools">
            <span class="connection-pill" id="connection-pill" role="status" aria-live="polite">Verificando ESP32…</span>
            <form class="ip-control" id="ip-form"><label for="esp-ip" class="tiny-note">ESP32</label><input id="esp-ip" aria-label="Dirección IP del ESP32" autocomplete="off"><button type="submit">Guardar IP</button></form>
          </div>
        </header>
        <div id="page-content"></div>
        <footer class="page-footer">UDEM · Robótica SI15A · Sistema Domótico IoT</footer>
      </div>`;
    const container = $('main-menu');
    for (const [id, href, emoji, title] of menu) {
      const link = document.createElement('a');
      link.href = href;
      link.className = 'menu-link' + (id === active ? ' active' : '');
      if (id === active) link.setAttribute('aria-current', 'page');
      const icon = document.createElement('span');
      icon.className = 'menu-icon';
      icon.textContent = emoji;
      const label = document.createElement('span');
      label.textContent = title;
      link.append(icon, label);
      link.addEventListener('click', () => closeMobileMenu());
      container.appendChild(link);
      if (id === active) text('current-section', title.toUpperCase());
    }
    const activeLink = container.querySelector('.menu-link.active');
    if (activeLink) {
      requestAnimationFrame(() => {
        if (global.innerWidth <= 1080) {
          container.scrollLeft = Math.max(0, activeLink.offsetLeft - container.offsetLeft -
            (container.clientWidth - activeLink.clientWidth) / 2);
        }
      });
    }
    const sidebar = $('app-sidebar');
    const overlay = $('mobile-overlay');
    const toggle = $('menu-toggle');
    const closeButton = $('sidebar-close');

    function closeMobileMenu() {
      if (!sidebar || global.innerWidth > 1080) return;
      sidebar.classList.remove('open');
      document.body.classList.remove('menu-open');
      if (overlay) overlay.hidden = true;
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function openMobileMenu() {
      if (!sidebar || global.innerWidth > 1080) return;
      sidebar.classList.add('open');
      document.body.classList.add('menu-open');
      if (overlay) overlay.hidden = false;
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }

    if (toggle) toggle.addEventListener('click', () => {
      if (sidebar && sidebar.classList.contains('open')) closeMobileMenu();
      else openMobileMenu();
    });
    if (closeButton) closeButton.addEventListener('click', closeMobileMenu);
    if (overlay) overlay.addEventListener('click', closeMobileMenu);
    global.addEventListener('resize', () => {
      if (global.innerWidth > 1080) {
        sidebar?.classList.remove('open');
        document.body.classList.remove('menu-open');
        if (overlay) overlay.hidden = true;
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    });

    $('esp-ip').value = getIp();
    $('ip-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('ip-form').querySelector('button');
      try {
        const ip = normalizeIp($('esp-ip').value);
        if (ip === getIp()) return;
        button.disabled = true;
        button.textContent = 'Verificando…';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
        let data;
        try {
          const response = await fetch('http://' + ip + '/api/status', {
            method: 'GET', mode: 'cors', cache: 'no-store', signal: controller.signal
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          data = await response.json();
          if (!validStatus(data)) throw new Error('Esta dirección no corresponde a Smart Home.');
        } finally { clearTimeout(timeout); }
        saveIp(ip);
        rememberStatus(data, ip);
        global.location.reload();
      } catch (error) {
        global.SmartNotify?.error('No se pudo conectar a esa IP', {duration: 3500});
      } finally {
        button.disabled = false;
        button.textContent = 'Guardar IP';
      }
    });
  }

  function bootPage(config) {
    setupShell(config.active);
    const host = $('page-content'), template = $('page-template');
    if (host && template) host.appendChild(template.content.cloneNode(true));
    const interval = Math.max(1900, config.interval || 2600);

    function schedule(ms) {
      clearTimeout(app.timer);
      if (!app.stopped) app.timer = setTimeout(refresh, ms);
    }
    async function refresh() {
      if (app.stopped) return;
      if (app.busy) { app.refreshAfter = true; return; }
      if (document.hidden || app.pendingCommands > 0) { schedule(interval); return; }
      app.busy = true;
      clearTimeout(app.timer);
      try {
        const data = await status();
        if (app.stopped) return;
        app.fails = 0;
        connection(true, 'ESP32 conectado');
        if (app.reportedOffline) {
          app.reportedOffline = false;
          global.SmartNotify?.success('Conexión recuperada', {duration: 1800});
        }
        try { config.onData(data); }
        catch (renderError) {
          console.error('Error al actualizar la interfaz:', renderError);
          global.SmartNotify?.error('No se pudo actualizar la pantalla', {duration: 3500});
        }
      } catch (error) {
        if (app.stopped) return;
        app.fails += 1;
        const age = Date.now() - app.lastOkAt;
        const recent = app.lastOkAt > 0 && age < CACHE_MAX_AGE_MS;
        if (app.fails >= FAILS_BEFORE_OFFLINE) {
          connection(false, 'ESP32 sin respuesta');
          if (!app.reportedOffline) {
            app.reportedOffline = true;
            global.SmartNotify?.warning('El ESP32 no responde', {duration: 3200});
          }
          if (config.onError) config.onError(error);
        } else if (recent) {
          connection(age <= ONLINE_AGE_MS, age <= ONLINE_AGE_MS ?
            'ESP32 conectado' : 'Última lectura reciente');
        } else connection(null, 'Verificando ESP32…');
      } finally {
        app.busy = false;
        const next = app.refreshAfter ? 220 : interval;
        app.refreshAfter = false;
        schedule(next);
      }
    }
    app.refresh = refresh;
    const cached = recentStatus();
    if (cached) {
      const age = Date.now() - cached.at;
      connection(age <= ONLINE_AGE_MS, age <= ONLINE_AGE_MS ?
        'ESP32 conectado' : 'Última lectura reciente');
      try { config.onData(cached.data); }
      catch (error) { console.warn('Error al mostrar datos anteriores:', error); }
    } else connection(null, 'Verificando ESP32…');

    document.querySelectorAll('[data-cmd]').forEach(button => {
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          await sendCommand(button.dataset.cmd);
          global.SmartNotify?.success(COMMAND_MESSAGES[button.dataset.cmd] || '¡Listo!', {duration: 1800});
        } catch (error) {
          global.SmartNotify?.error(shortError(error), {duration: 3500});
        } finally { button.disabled = false; }
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule(150);
    });
    global.addEventListener('pagehide', () => {
      app.stopped = true;
      clearTimeout(app.timer);
      for (const controller of app.activeControllers) controller.abort();
      for (const job of app.pendingRequests.splice(0)) job.reject(new Error('Página cerrada.'));
    });
    global.addEventListener('pageshow', event => {
      if (event.persisted) { app.stopped = false; schedule(150); }
    });
    schedule(cached ? 160 : 80);
  }

  global.SmartHome = Object.freeze({
    getIp, saveIp, baseUrl, status, diagnostics, bootPage, sendCommand,
    rememberStatus, validStatus, $, text, pill, progress, number, buttonState, connection
  });
})(window);
