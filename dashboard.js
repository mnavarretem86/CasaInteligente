'use strict';

const HomeDashboard = (() => {
  let lastGoodAt = null;
  let ready = false;
  let failureStreak = 0;

  function setText(id, value) {
    SmartHome.text(id, value);
  }

  function status(id, value, tone = '') {
    const element = SmartHome.$(id);
    if (!element) return;
    element.textContent = value;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  }

  function syncInfo(state, title, subtitle) {
    const indicator = SmartHome.$('db-sync');
    if (indicator) indicator.dataset.state = state;
    setText('db-sync-title', title);
    setText('db-sync-time', subtitle);
  }

  function formatNumber(value, unit) {
    return Number.isFinite(value) ? String(Math.round(value * 10) / 10) + ' ' + unit : '-- ' + unit;
  }

  function uptime(seconds) {
    if (!Number.isFinite(seconds)) return '--';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    const remain = minutes % 60;
    return remain ? hours + ' h ' + remain + ' min' : hours + ' h';
  }

  function applyHero(type, title, description, label) {
    const hero = SmartHome.$('db-hero');
    if (hero) hero.dataset.state = type;
    setText('db-hero-title', title);
    setText('db-hero-copy', description);
    setText('db-hero-kicker', label);
  }

  function renderEnvironment(d) {
    const hasDht = d.dht_ok === true && Number.isFinite(d.temp) && Number.isFinite(d.hum);
    setText('db-temp', hasDht ? formatNumber(d.temp, '°C') : '-- °C');
    setText('db-hum', hasDht ? formatNumber(d.hum, '%') : '-- %');
    status('db-temp-state', !hasDht ? 'Sin lectura' : d.temp_active ? 'Activo' : 'En espera', hasDht ? d.temp_active ? 'good' : 'warn' : 'bad');
    status('db-hum-state', !hasDht ? 'Sin lectura' : d.temp_active ? 'Activo' : 'En espera', hasDht ? d.temp_active ? 'good' : 'warn' : 'bad');
    setText('db-temp-note', hasDht ? d.temp >= 30 ? 'Temperatura elevada' : d.temp < 20 ? 'Ambiente fresco' : 'Temperatura ambiental' : 'Sensor DHT11');

    const validRain = d.rain_ok === true && Number.isFinite(d.rain_val);
    const rainEnabled = d.rain_active === true;
    const raining = rainEnabled && validRain && d.rain_detected === true;
    const rainTitle = !rainEnabled ? 'Inactivo' : !validRain ? 'Sin lectura' : raining ? 'Lloviendo' : 'Sin lluvia';
    status('db-rain-state', !rainEnabled ? 'Desactivado' : !validRain ? 'Sin lectura' : raining ? 'Lluvia' : 'Seco', !rainEnabled ? '' : !validRain ? 'bad' : raining ? 'warn' : 'good');
    setText('db-rain', rainTitle);
    setText('db-rain-icon', raining ? '🌧️' : rainEnabled && validRain ? '☀️' : '🌦️');
    setText('db-rain-note', !rainEnabled ? 'Detección desactivada' : !validRain ? 'Revisar conexión del sensor' : 'Detección en tiempo real');

    const gasActive = d.gas_active === true;
    const pirActive = d.pir_active === true;
    const gasAlert = gasActive && d.gas_alert === true;
    const pirAlert = pirActive && d.pir_alert === true;
    const alertCount = Number(gasAlert) + Number(pirAlert);
    const monitored = gasActive || pirActive;
    let safetyTitle = 'Inactivo';
    let safetyDetail = 'Monitoreo desactivado';
    let safetyTone = '';
    if (alertCount) {
      safetyTitle = 'Alerta';
      safetyDetail = [gasAlert ? 'Gas detectado' : '', pirAlert ? 'Movimiento detectado' : ''].filter(Boolean).join(' · ');
      safetyTone = 'bad';
    } else if (monitored) {
      safetyTitle = 'Sin alertas';
      safetyDetail = gasActive && pirActive ? 'Gas y movimiento supervisados' : gasActive ? 'Solo gas supervisado' : 'Solo movimiento supervisado';
      safetyTone = 'good';
    }
    status('db-security-state', alertCount ? 'Atención' : monitored ? 'Supervisando' : 'Desactivado', safetyTone);
    setText('db-security', safetyTitle);
    setText('db-security-note', safetyDetail);
    setText('db-security-icon', alertCount ? '🚨' : '🛡️');
    return { hasDht, rainEnabled, validRain, raining, gasActive, pirActive, gasAlert, pirAlert, alertCount };
  }

  function renderDevices(d) {
    status('db-window', d.window || 'Sin datos', d.window === 'ABIERTA' ? 'info' : d.window === 'CERRADA' ? 'good' : 'warn');
    status('db-fan', d.fan === 'DER' ? 'Derecha' : d.fan === 'IZQ' ? 'Izquierda' : d.fan === 'OFF' ? 'Apagado' : 'Sin datos', d.fan && d.fan !== 'OFF' ? 'info' : '');
    status('db-led', d.led === true ? 'Encendida' : 'Apagada', d.led ? 'good' : '');
    status('db-rgb', d.rgb || 'Sin datos', d.rgb && d.rgb !== 'OFF' ? 'info' : '');
    const on = SmartHome.$('db-led-on');
    const off = SmartHome.$('db-led-off');
    if (on) on.classList.toggle('selected', d.led === true);
    if (off) off.classList.toggle('selected', d.led === false);

    const rainAutomationEnabled = d.auto_rain === true && d.rain_active === true;
    status('db-auto-rain', rainAutomationEnabled ? 'Activa' : 'Inactiva', rainAutomationEnabled ? 'good' : '');
    setText('db-auto-rain-note', !d.auto_rain ? 'Automatización desactivada' : !d.rain_active ? 'Requiere activar sensor de lluvia' : 'Abre en seco y cierra cuando llueve');
    status('db-auto-alarm', d.auto_alarm ? 'Habilitada' : 'Silenciada', d.auto_alarm ? 'good' : 'warn');
    status('db-pir', d.pir_active ? d.pir_alert ? 'Movimiento' : 'Activo' : 'Inactivo', d.pir_active ? d.pir_alert ? 'bad' : 'good' : '');
    status('db-rfid', d.rfid_active ? 'Activo' : 'Inactivo', d.rfid_active ? 'info' : '');
    setText('db-pir-note', d.pir_active ? 'Detección en funcionamiento' : 'Sensor PIR desactivado');
    setText('db-rfid-note', d.rfid_active ? d.rfid_access || 'Esperando credencial' : 'Lector desactivado');
  }

  function renderHero(d, situation) {
    const activeCount = ['temp_active', 'rain_active', 'gas_active', 'pir_active', 'rfid_active']
      .reduce((total, key) => total + Number(d[key] === true), 0);
    setText('db-active-count', activeCount + ' / 5');
    setText('db-alert-count', situation.alertCount);
    setText('db-uptime', uptime(d.uptime_s));

    if (situation.alertCount > 0) {
      applyHero('alert', 'Atención: evento de seguridad',
        'Se detectó ' + (situation.gasAlert && situation.pirAlert ? 'gas y movimiento' : situation.gasAlert ? 'gas' : 'movimiento') + '. Revisa la sección Seguridad y verifica el entorno.',
        'ALERTA ACTIVA');
    } else if (activeCount === 0) {
      applyHero('normal', 'Tu centro de control está disponible',
        'El ESP32 está conectado. Activa los sensores que deseas supervisar desde sus respectivos módulos.',
        'SISTEMA CONECTADO');
    } else if (activeCount < 5) {
      applyHero('normal', 'Tu hogar está conectado',
        'Recibes datos del ESP32. Algunos sensores están desactivados; puedes habilitarlos desde el menú lateral.',
        'MONITOREO EN CURSO');
    } else {
      applyHero('normal', 'Todos los sensores habilitados',
        'El sistema recibe información de tus dispositivos. Consulta los indicadores para revisar el estado de cada uno.',
        'MONITOREO EN CURSO');
    }
  }

  function onData(d) {
    ready = true;
    failureStreak = 0;
    const page = SmartHome.$('db-page');
    if (page) page.dataset.connection = 'live';
    lastGoodAt = new Date();
    syncInfo('live', 'Datos en tiempo real', 'Última actualización: ' + lastGoodAt.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const situation = renderEnvironment(d);
    renderDevices(d);
    renderHero(d, situation);
  }

  function onError() {
    failureStreak += 1;
    const lastUpdate = lastGoodAt ? 'Última actualización: ' + lastGoodAt.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Sin lecturas disponibles';
    if (failureStreak < 3) {
      syncInfo('waiting', 'Verificando conexión', lastUpdate);
      return;
    }
    const page = SmartHome.$('db-page');
    if (page) page.dataset.connection = 'lost';
    syncInfo('offline', 'Sin comunicación', lastUpdate);
    applyHero('offline', 'Esperando al ESP32', ready ? 'No se pudo actualizar la información. Los indicadores conservan la última lectura recibida.' : 'Comprueba la conexión Wi-Fi y la dirección IP del dispositivo.', 'CONEXIÓN INTERRUMPIDA');
    for (const id of ['db-led-on', 'db-led-off']) {
      const element = SmartHome.$(id);
      if (element) element.disabled = true;
    }
  }

  function init() {
    const note = document.querySelector('.sidebar-note');
    if (note) note.innerHTML = '<b>📡 Smart Home UDEM</b>';
  }

  return { onData, onError, init };
})();

SmartHome.bootPage({ active: 'dashboard', interval: 2600, onData: d => {
  HomeDashboard.onData(d);
  for (const id of ['db-led-on', 'db-led-off']) {
    const element = SmartHome.$(id);
    if (element && !element.dataset.commandBusy) element.disabled = false;
  }
}, onError: HomeDashboard.onError });
HomeDashboard.init();
