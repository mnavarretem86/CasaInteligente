'use strict';

(() => {
  const form = document.getElementById('start-form');
  const input = document.getElementById('setup-ip');
  const button = document.getElementById('start-button');
  const message = document.getElementById('connection-message');
  const statusLine = document.getElementById('connection-line');
  if (!form || !input || !button || !statusLine) return;

  const STORAGE_KEY = 'esp32_ip';
  const REQUEST_TIMEOUT_MS = 7000;
  let working = false;

  // Se reutiliza la misma IP que emplean las demás páginas.
  input.value = (window.SmartHome && SmartHome.getIp()) ||
    localStorage.getItem(STORAGE_KEY) || '';

  function setStatus(kind, text) {
    statusLine.className = 'entry-connection' + (kind ? ' ' + kind : '');
    message.textContent = text;
  }

  function setWorking(enabled) {
    working = enabled;
    input.disabled = enabled;
    button.disabled = enabled;
    button.classList.toggle('is-loading', enabled);
    button.setAttribute('aria-busy', String(enabled));
  }

  function normalizeAddress(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('Ingresa la dirección IP que aparece en tu ESP32.');
    if (/^https:\/\//i.test(raw)) {
      throw new Error('El servidor ESP32 usa HTTP. Escribe solo la IP, sin HTTPS.');
    }

    let parsed;
    try {
      parsed = new URL(/^http:\/\//i.test(raw) ? raw : 'http://' + raw);
    } catch (_) {
      throw new Error('La dirección no es válida. Ejemplo: 192.168.1.50');
    }

    if (parsed.protocol !== 'http:' || parsed.username || parsed.password ||
        parsed.pathname !== '/' || parsed.search || parsed.hash || !parsed.hostname ||
        parsed.hostname.includes(':')) {
      throw new Error('Escribe únicamente la dirección IP del ESP32, sin rutas ni contraseñas.');
    }

    const host = parsed.hostname;
    const ipv4 = host.split('.');
    if (ipv4.length === 4 && ipv4.every(part => /^\d+$/.test(part))) {
      if (ipv4.some(part => +part > 255) || ipv4.every(part => +part === 0)) {
        throw new Error('La dirección IPv4 no es válida. Revisa la IP de la pantalla LCD.');
      }
    } else if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(host)) {
      throw new Error('Ingresa una dirección IPv4 válida o un nombre de red local.');
    }
    return parsed.host;
  }

  async function checkEsp32(ip) {
    if (location.protocol === 'https:') {
      throw new Error('Abre esta aplicación por HTTP local. El ESP32 no acepta conexiones HTTPS.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('http://' + ip + '/api/status', {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error('El ESP32 respondió con HTTP ' + response.status + '.');
      }
      let data;
      try {
        data = await response.json();
      } catch (_) {
        throw new Error('El dispositivo respondió, pero no devolvió un JSON válido.');
      }
      if (!data || typeof data !== 'object' ||
          typeof data.temp_active !== 'boolean' ||
          typeof data.rain_active !== 'boolean' ||
          typeof data.window !== 'string') {
        throw new Error('La dirección respondió, pero no corresponde a la API Smart Home del ESP32.');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('El ESP32 no respondió a tiempo. Verifica que esté encendido y conectado al Wi-Fi.');
      }
      if (error instanceof TypeError) {
        throw new Error('No fue posible llegar al ESP32. Comprueba la IP, la red Wi-Fi y que la opción App IoT esté ejecutándose.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function showNotice(icon, title, text) {
    if (window.Swal && typeof Swal.fire === 'function') {
      await Swal.fire({
        icon,
        title,
        text,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#287ee0',
        background: '#ffffff',
        color: '#16344d',
        customClass: { popup: 'entry-swal-popup' }
      });
      return;
    }
    const dialog = document.getElementById('notice-fallback');
    document.getElementById('notice-title').textContent = title;
    document.getElementById('notice-text').textContent = text;
    document.getElementById('notice-icon').textContent = icon === 'warning' ? '!' : '×';
    if (dialog && typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      window.alert(title + '\n' + text);
    }
  }

  function openLoadingNotice() {
    if (!window.Swal || typeof Swal.fire !== 'function') return;
    Swal.fire({
      title: 'Conectando al ESP32',
      text: 'Verificando el servidor de Smart Home…',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
      background: '#ffffff',
      color: '#16344d'
    });
  }

  input.addEventListener('input', () => {
    if (!working) setStatus('', 'Listo para verificar la conexión.');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (working) return;

    let ip;
    try {
      ip = normalizeAddress(input.value);
    } catch (error) {
      setStatus('error', error.message);
      await showNotice('warning', 'Revisa la dirección IP', error.message);
      return;
    }

    setWorking(true);
    setStatus('checking', 'Comprobando comunicación con el ESP32…');
    openLoadingNotice();

    try {
      await checkEsp32(ip);
      // Se guarda la IP únicamente DESPUÉS de comprobar el endpoint real.
      if (window.SmartHome && typeof SmartHome.saveIp === 'function') {
        SmartHome.saveIp(ip);
      } else {
        localStorage.setItem(STORAGE_KEY, ip);
      }
      setStatus('success', 'ESP32 conectado. Abriendo panel…');
      if (window.Swal) {
        Swal.close();
        await Swal.fire({
          icon: 'success',
          title: 'Conexión establecida',
          text: 'El ESP32 está disponible.',
          showConfirmButton: false,
          timer: 850,
          timerProgressBar: true,
          background: '#ffffff',
          color: '#16344d'
        });
      }
      window.location.assign('dashboard.html');
    } catch (error) {
      if (window.Swal) Swal.close();
      setStatus('error', 'No se pudo verificar la conexión.');
      await showNotice('error', 'No se pudo conectar', error.message);
    } finally {
      setWorking(false);
    }
  });
})();
