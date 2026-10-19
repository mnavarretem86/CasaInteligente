'use strict';
/* Smart Home UDEM: pronostico local + referencia meteorologica de Managua.
   Solo consume /api/status y el comando toggle_rain del firmware existente.
   El clima de Managua se consulta directamente desde el navegador a Open-Meteo. */
const WeatherView = (() => {
  const MANAGUA_URL = 'https://api.open-meteo.com/v1/forecast?' +
    'latitude=12.1364&longitude=-86.2514' +
    '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day' +
    '&daily=precipitation_probability_max' +
    '&timezone=America%2FManagua&forecast_days=1';
  const FETCH_INTERVAL_MS = 10 * 60 * 1000;
  let webBusy = false;

  const get = id => document.getElementById(id);
  const set = (id, value) => {
    const el = get(id);
    if (el) el.textContent = String(value);
  };
  const goodNumber = n => typeof n === 'number' && Number.isFinite(n);
  const measure = (n, unit, digits = 0) => goodNumber(n) ? n.toFixed(digits).replace(/\.0$/, '') + ' ' + unit : '— ' + unit;

  function label(id, value, mode) {
    const el = get(id);
    if (!el) return;
    el.textContent = value;
    el.className = 'wx-data-state' + (mode ? ' ' + mode : '');
  }

  function initEffects() {
    const layer = get('rain-layer');
    if (layer && layer.dataset.ready !== '1') {
      document.body.appendChild(layer);
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 105; i++) {
        const drop = document.createElement('span');
        drop.className = 'rain-streak';
        drop.style.setProperty('--left', (Math.random() * 120).toFixed(1) + '%');
        drop.style.setProperty('--length', (55 + Math.random() * 100).toFixed(0) + 'px');
        drop.style.setProperty('--speed', (0.6 + Math.random() * 1.0).toFixed(2) + 's');
        drop.style.setProperty('--delay', (-Math.random() * 3).toFixed(2) + 's');
        fragment.appendChild(drop);
      }
      for (let i = 0; i < 16; i++) {
        const ripple = document.createElement('span');
        ripple.className = 'rain-splash';
        ripple.style.setProperty('--left', (Math.random() * 100).toFixed(1) + '%');
        ripple.style.setProperty('--bottom', (Math.random() * 20).toFixed(1) + '%');
        ripple.style.setProperty('--size', (8 + Math.random() * 15).toFixed(0) + 'px');
        ripple.style.setProperty('--speed', (1 + Math.random() * 1.2).toFixed(2) + 's');
        ripple.style.setProperty('--delay', (-Math.random() * 4).toFixed(2) + 's');
        fragment.appendChild(ripple);
      }
      layer.appendChild(fragment);
      layer.dataset.ready = '1';
    }
    const sun = get('wx-sun-layer');
    if (sun && sun.parentNode !== document.body) document.body.appendChild(sun);
  }

  function animate(mode) {
    get('rain-layer')?.classList.toggle('active', mode === 'rain');
    get('wx-sun-layer')?.classList.toggle('active', mode === 'sun');
    const stage = get('weather-stage');
    if (stage) stage.className = 'wx-stage is-' + mode;
  }

  function updateLocal(d) {
    const sensorEnabled = d.rain_active === true;
    const rainValid = d.rain_ok === true && goodNumber(d.rain_val);
    const raining = sensorEnabled && rainValid && d.rain_detected === true;
    const dhtValid = d.dht_ok === true && goodNumber(d.temp) && goodNumber(d.hum);
    const temp = dhtValid ? d.temp : null;
    const humidity = dhtValid ? d.hum : null;
    const mode = !sensorEnabled ? 'off' : !rainValid ? 'unknown' : raining ? 'rain' : 'sun';

    SmartHome.buttonState('btn-weather-rain', sensorEnabled, 'Detector activo', 'Activar detector');
    set('weather-temperature', measure(temp, '°C'));
    set('weather-humidity', measure(humidity, '%'));
    set('weather-rain-summary', !sensorEnabled ? 'Inactivo' : !rainValid ? 'Sin datos' : raining ? 'Lloviendo' : 'Sin lluvia');
    set('weather-rain-note', !sensorEnabled ? 'Activa el sensor para consultar lluvia' : rainValid ? 'Detección por contacto con agua' : 'Revisa la conexión de la placa');

    set('local-compare-temp', measure(temp, '°C'));
    set('local-compare-humidity', measure(humidity, '%'));
    set('local-compare-rain', !sensorEnabled ? 'Inactivo' : !rainValid ? '—' : raining ? 'Sí' : 'No');
    label('local-source-state', !sensorEnabled ? 'Sensor apagado' : !rainValid ? 'Sin lectura' : 'En directo', !sensorEnabled || !rainValid ? 'wait' : '');
    const condition = get('local-compare-condition');
    if (condition) {
      condition.replaceChildren(document.createTextNode(!sensorEnabled ? 'Detección pausada' : !rainValid ? 'Sin lectura de lluvia' : raining ? 'Agua detectada' : 'Sin agua detectada'));
      const small = document.createElement('span');
      small.textContent = 'Lectura del sensor físico';
      condition.appendChild(small);
    }

    if (!sensorEnabled) {
      set('weather-status', 'DETECTOR DE LLUVIA DESACTIVADO');
      set('weather-title', 'Tu estación está lista');
      set('weather-description', 'Activa el detector para ver si está lloviendo y disfrutar los efectos del clima en pantalla.');
    } else if (!rainValid) {
      set('weather-status', 'SIN LECTURA DE LLUVIA');
      set('weather-title', 'Revisando el sensor');
      set('weather-description', 'El ESP32 está conectado, pero todavía no hay una lectura válida de la placa de lluvia.');
    } else if (raining) {
      set('weather-status', '● LLUVIA DETECTADA POR EL ESP32');
      set('weather-title', '¡Está lloviendo! 🌧️');
      set('weather-description', 'La placa detecta agua en tu estación. Las gotas aparecen por toda la pantalla mientras dure la detección.');
    } else {
      set('weather-status', '● SIN LLUVIA EN TU ESTACIÓN');
      set('weather-title', 'No se detecta lluvia ☀️');
      set('weather-description', 'El sensor está activo y no detecta agua. La animación solar indica que la placa está seca.');
    }
    animate(mode);
  }

  function localOffline() {
    animate('unknown');
    label('local-source-state', 'Sin conexión', 'error');
    set('weather-status', 'ESP32 SIN RESPUESTA');
    set('weather-title', 'Esperando tu estación');
    set('weather-description', 'Comprueba la conexión Wi-Fi y la IP del ESP32. No se muestra un estado de lluvia sin datos recientes.');
    set('weather-rain-summary', 'Sin datos');
    set('weather-rain-note', 'Conexión con ESP32 interrumpida');
    set('local-compare-rain', '—');
  }

  function wmoInfo(code, isDay) {
    const day = isDay === 1;
    if ([95, 96, 99].includes(code)) return ['Tormenta eléctrica', '⛈️'];
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ['Lluvias', '🌧️'];
    if ([71, 73, 75, 77, 85, 86].includes(code)) return ['Nieve', '❄️'];
    if ([45, 48].includes(code)) return ['Neblina', '🌫️'];
    if (code === 3) return ['Nublado', '☁️'];
    if (code === 2) return ['Parcialmente nublado', '⛅'];
    if (code === 1) return ['Mayormente despejado', day ? '🌤️' : '🌙'];
    if (code === 0) return ['Despejado', day ? '☀️' : '🌙'];
    return ['Condiciones disponibles', '🌤️'];
  }

  function setInternetError(reason) {
    label('managua-source-state', 'No disponible', 'error');
    set('managua-temp', '— °C');
    set('managua-humidity', '— %');
    set('managua-rain', '— mm');
    set('managua-wind', '— km/h');
    set('managua-probability', '— %');
    set('managua-condition', 'No se pudo consultar');
    set('managua-time', 'Revisa tu conexión a internet');
    set('managua-updated', reason);
    set('managua-icon', '📡');
  }

  async function refreshManagua() {
    if (webBusy) return;
    if (document.hidden) return;
    webBusy = true;
    const button = get('btn-web-refresh');
    if (button) button.disabled = true;
    label('managua-source-state', 'Actualizando...', 'wait');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9500);
    try {
      const response = await fetch(MANAGUA_URL, { method: 'GET', mode: 'cors', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      const current = payload.current;
      if (!current || !goodNumber(current.temperature_2m) || !goodNumber(current.relative_humidity_2m)) {
        throw new Error('El proveedor no entregó datos meteorológicos válidos.');
      }
      const [description, emoji] = wmoInfo(current.weather_code, current.is_day);
      set('managua-temp', measure(current.temperature_2m, '°C', 1));
      set('managua-humidity', measure(current.relative_humidity_2m, '%'));
      set('managua-rain', measure(current.precipitation, 'mm', 1));
      set('managua-wind', measure(current.wind_speed_10m, 'km/h', 1));
      const prob = payload.daily && payload.daily.precipitation_probability_max;
      set('managua-probability', Array.isArray(prob) ? measure(prob[0], '%') : '— %');
      set('managua-condition', description);
      set('managua-icon', emoji);
      // Open-Meteo devuelve la hora en America/Managua por la zona solicitada.
      const validAt = typeof current.time === 'string' && current.time.includes('T') ? current.time.split('T')[1].slice(0, 5) : '';
      set('managua-time', validAt ? 'Datos para las ' + validAt + ' (Managua)' : 'Datos del modelo meteorológico');
      label('managua-source-state', 'Internet activo', '');
      const updatedAt = new Date().toLocaleTimeString('es-NI', {hour: '2-digit', minute: '2-digit', timeZone: 'America/Managua'});
      set('managua-updated', 'Consulta realizada a las ' + updatedAt + ' · próxima en 10 min');
    } catch (error) {
      const explanation = error.name === 'AbortError' ? 'Tiempo de espera agotado. Pulsa Actualizar internet.' : 'No disponible por internet. Pulsa Actualizar para reintentar.';
      setInternetError(explanation);
    } finally {
      clearTimeout(timeout);
      webBusy = false;
      if (button) button.disabled = false;
    }
  }

  function initialize() {
    initEffects();
    get('btn-web-refresh')?.addEventListener('click', refreshManagua);
    refreshManagua();
    const interval = setInterval(refreshManagua, FETCH_INTERVAL_MS);
    window.addEventListener('pagehide', () => clearInterval(interval), {once:true});
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !webBusy) refreshManagua();
    });
  }
  return { updateLocal, localOffline, initialize };
})();

SmartHome.bootPage({
  active: 'pronostico',
  interval: 2100,
  onData: WeatherView.updateLocal,
  onError: WeatherView.localOffline
});
WeatherView.initialize();
