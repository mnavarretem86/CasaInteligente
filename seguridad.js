'use strict';
/*
  Smart Home UDEM - Seguridad rediseñada.
  Solo usa /api/status a través de SmartHome.bootPage.
  Los botones conservan exactamente los comandos originales:
  toggle_gas, toggle_pir y toggle_rfid.
  Nunca manda comandos a puertas, ventanas ni otros sensores.
*/
const SecurityScreen = (() => {
  let effectsReady = false;
  let firstRfidSample = true;
  let lastUid = null;
  let flashTimeout = null;

  const el = id => SmartHome.$(id);
  const setText = (id, value) => {
    const target = el(id);
    if (target && target.textContent !== String(value)) target.textContent = String(value);
  };
  const toggle = (id, className, enabled) => {
    const target = el(id);
    if (target) target.classList.toggle(className, Boolean(enabled));
  };
  const mode = (id, value) => {
    const target = el(id);
    if (target) target.dataset.mode = value;
  };

  function buildParticles(targetId, className, count) {
    const host = el(targetId);
    if (!host || host.dataset.ready === '1') return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('span');
      particle.className = className;
      particle.style.setProperty('--left', (Math.random() * 105).toFixed(1) + '%');
      particle.style.setProperty('--size', (26 + Math.random() * 86).toFixed(0) + 'px');
      particle.style.setProperty('--duration', (4.8 + Math.random() * 6.2).toFixed(2) + 's');
      particle.style.setProperty('--delay', (-Math.random() * 11).toFixed(2) + 's');
      if (className === 'sec-gas-speck') {
        particle.style.setProperty('--top', (Math.random() * 100).toFixed(1) + '%');
        particle.style.setProperty('--size', (2 + Math.random() * 7).toFixed(0) + 'px');
        particle.style.setProperty('--duration', (2.2 + Math.random() * 4).toFixed(2) + 's');
      }
      if (className === 'sec-wave') {
        particle.style.setProperty('--top', (Math.random() * 100).toFixed(1) + '%');
      }
      fragment.appendChild(particle);
    }
    host.appendChild(fragment);
    host.dataset.ready = '1';
  }

  function prepareVisuals() {
    if (effectsReady) return;
    // Se extraen del template para que cubran también la barra lateral,
    // igual que el efecto completo de lluvia.
    for (const id of ['sec-gas-overlay', 'sec-pir-overlay', 'sec-alert-bubble']) {
      const node = el(id);
      if (node) document.body.appendChild(node);
    }
    buildParticles('sec-gas-overlay', 'sec-full-puff', 46);
    buildParticles('sec-gas-overlay', 'sec-gas-speck', 58);
    buildParticles('sec-pir-overlay', 'sec-wave', 5);
    const gasVisual = el('sec-gas-visual');
    if (gasVisual) {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 13; i++) {
        const puff = document.createElement('span');
        puff.className = 'sec-gas-puff';
        puff.style.setProperty('--left', (8 + Math.random() * 84).toFixed(1) + '%');
        puff.style.setProperty('--sz', (18 + Math.random() * 40).toFixed(0) + 'px');
        puff.style.setProperty('--dur', (2.7 + Math.random() * 3).toFixed(2) + 's');
        puff.style.setProperty('--delay', (-Math.random() * 4).toFixed(2) + 's');
        fragment.appendChild(puff);
      }
      gasVisual.appendChild(fragment);
    }
    effectsReady = true;
  }

  function clearScreenEffects() {
    toggle('sec-gas-overlay', 'is-visible', false);
    toggle('sec-pir-overlay', 'is-visible', false);
    toggle('sec-alert-bubble', 'is-visible', false);
    setText('sec-alert-bubble', '');
  }

  function heroPresentation(scene, eyebrow, title, subtitle, icon) {
    const hero = el('sec-hero');
    if (hero) hero.dataset.scene = scene;
    setText('sec-hero-eyebrow', eyebrow);
    setText('sec-hero-title', title);
    setText('sec-hero-subtitle', subtitle);
    setText('sec-shield-icon', icon);
  }

  function renderGasMeter(d, active, danger) {
    const panel = el('sec-gas-meter');
    const fill = el('sec-gas-meter-fill');
    const track = el('sec-gas-meter-track');
    const hasAnalog = d.gas_analog_enabled === true && d.gas_analog_ok === true &&
      d.gas_analog_ready === true && typeof d.gas_level === 'number' && Number.isFinite(d.gas_level);
    const digitalMode = !hasAnalog;
    const level = !active ? 0 : hasAnalog ? Math.min(100, Math.max(0, d.gas_level)) : danger ? 100 : 0;
    if (panel) { panel.dataset.mode = digitalMode ? 'digital' : 'analog'; panel.dataset.alert = danger ? 'yes' : 'no'; }
    if (fill) fill.style.setProperty('--gas-width', level + '%');
    if (track) {
      track.setAttribute('aria-valuenow', String(Math.round(level)));
      track.setAttribute('aria-valuetext', !active ? 'Sensor inactivo' :
        hasAnalog ? 'Respuesta relativa: ' + Math.round(level) + ' de 100' : danger ? 'Umbral digital activado' : 'Umbral digital sin activar');
    }
    setText('sec-gas-meter-title', hasAnalog ? 'Respuesta relativa del sensor' : 'Señal de detección');
    setText('sec-gas-reading', !active ? '—' : hasAnalog ? Math.round(level) + '/100' : danger ? 'ALERTA' : 'NORMAL');
    setText('sec-gas-meter-detail', !active ? 'Activa el detector de gas.' :
      hasAnalog ? 'Escala relativa, no equivale a % de gas ni a ppm.' :
      d.gas_analog_enabled === true ?
        (d.gas_analog_ok === false ? 'Sin lectura analógica. Se mantiene el aviso digital.' : 'Preparando lectura analógica. El aviso digital sigue funcionando.') :
        'Modo digital: muestra si se superó el umbral del módulo; no mide concentración.');
  }

  function presentGas(d) {
    const active = d.gas_active === true;
    const danger = active && d.gas_alert === true;
    renderGasMeter(d, active, danger);
    SmartHome.buttonState('btn-gas', active, 'ON', 'OFF');
    el('btn-gas')?.classList.add('sec-toggle');
    mode('sec-gas-card', !active ? 'disabled' : danger ? 'danger' : 'ready');
    toggle('sec-gas-visual', 'is-active', active);
    toggle('sec-gas-visual', 'is-danger', danger);
    SmartHome.pill('gas-status', !active ? 'APAGADO' : danger ? '¡PELIGRO GAS!' : 'SIN ALERTA',
      !active ? '' : danger ? 'bad' : 'good');
    setText('sec-gas-phrase', !active ? 'Sensor desactivado' : danger ? '¡Gas detectado!' : 'Monitoreando gas');
    setText('sec-gas-mini', !active ? 'Inactivo' : danger ? 'Alerta de gas' : 'Sin alerta');
    setText('sec-gas-visual-label', !active ? 'MONITOREO APAGADO' : danger ? '⚠ ALERTA DETECTADA' : 'LECTURA DIGITAL ACTIVA');
    return danger;
  }

  function presentPir(d) {
    const active = d.pir_active === true;
    const motion = active && d.pir_alert === true;
    const warmingUp = active && typeof d.uptime_s === 'number' && d.uptime_s < 30;
    SmartHome.buttonState('btn-pir', active, 'ON', 'OFF');
    el('btn-pir')?.classList.add('sec-toggle');
    mode('sec-pir-card', !active ? 'disabled' : motion ? 'motion' : 'ready');
    toggle('sec-pir-visual', 'is-active', active);
    toggle('sec-pir-visual', 'is-danger', motion);
    SmartHome.pill('pir-status', !active ? 'APAGADO' : motion ? '¡MOVIMIENTO!' : warmingUp ? 'ESTABILIZANDO' : 'SIN MOVIMIENTO',
      !active ? '' : motion ? 'warn' : warmingUp ? 'info' : 'good');
    setText('sec-pir-phrase', !active ? 'Sensor desactivado' : motion ? '¡Movimiento detectado!' : warmingUp ? 'Calibrando sensor' : 'Radar monitoreando');
    setText('sec-pir-mini', !active ? 'Inactivo' : motion ? 'Movimiento' : warmingUp ? 'Calibrando' : 'Sin movimiento');
    setText('sec-pir-visual-label', !active ? 'RADAR APAGADO' : motion ? '⚠ MOVIMIENTO DETECTADO' : warmingUp ? 'INICIANDO SENSOR PIR' : 'BARRIDO DE VIGILANCIA');
    return motion;
  }

  function flashRfid() {
    const reader = el('sec-reader-display');
    if (!reader) return;
    if (flashTimeout !== null) clearTimeout(flashTimeout);
    reader.classList.remove('is-flash');
    // Reiniciar la transición CSS en un cambio real de UID.
    void reader.offsetWidth;
    reader.classList.add('is-flash');
    flashTimeout = setTimeout(() => {
      reader.classList.remove('is-flash');
      flashTimeout = null;
    }, 1100);
  }

  function presentRfid(d) {
    const active = d.rfid_active === true;
    const available = d.rfid_available !== false;
    const uid = d.rfid_uid && d.rfid_uid !== 'Ninguna' ? String(d.rfid_uid) : null;
    const result = typeof d.rfid_access === 'string' ? d.rfid_access : 'Esperando...';
    const granted = active && available && uid !== null && result === 'Acceso OK';
    const denied = active && available && uid !== null && result === 'Denegado';
    const state = !active ? 'disabled' : !available ? 'unavailable' : granted ? 'granted' : denied ? 'denied' : 'waiting';

    SmartHome.buttonState('btn-rfid', active, 'ON', 'OFF');
    el('btn-rfid')?.classList.add('sec-toggle');
    mode('sec-rfid-panel', state);
    toggle('sec-reader-display', 'is-active', active && available);
    toggle('sec-reader-display', 'is-granted', granted);
    toggle('sec-reader-display', 'is-denied', denied);
    SmartHome.pill('rfid-status', !active ? 'APAGADO' : !available ? 'NO DISPONIBLE' : granted ? 'ACCESO OK' : denied ? 'DENEGADO' : 'ESPERANDO TARJETA',
      !active ? '' : !available || denied ? 'bad' : granted ? 'good' : 'info');
    SmartHome.pill('sec-rfid-reader-state', !active ? 'Sin escaneo' : !available ? 'Comprueba el módulo I2C' : 'Lector en vigilancia',
      active && available ? 'info' : '');
    setText('rfid-uid', active && uid ? uid : '—');
    setText('sec-rfid-mini', !active ? 'Inactivo' : !available ? 'Sin lector' : granted ? 'Autorizado' : denied ? 'Denegado' : 'En espera');
    setText('sec-reader-caption', !active ? 'ACTIVA EL LECTOR PARA ESCANEAR' : !available ? 'MÓDULO RFID NO DISPONIBLE' : granted ? '✓ CREDENCIAL AUTORIZADA' : denied ? '✕ CREDENCIAL NO AUTORIZADA' : 'ACERCA UNA TARJETA RFID');

    if (!active || !available) {
      firstRfidSample = true;
      lastUid = null;
      return;
    }
    // El estado API contiene únicamente el último UID; no un evento por lectura.
    // Animamos solo si el UID cambia, sin simular lecturas nuevas cada sondeo.
    if (firstRfidSample) {
      lastUid = uid;
      firstRfidSample = false;
    } else if (uid && uid !== lastUid) {
      lastUid = uid;
      flashRfid();
    }
  }

  function updateScene(d, gasDanger, pirMotion) {
    const gas = d.gas_active === true;
    const pir = d.pir_active === true;
    const rfid = d.rfid_active === true;
    const count = Number(gas) + Number(pir) + Number(rfid);
    setText('sec-enabled-count', `${count} ${count === 1 ? 'sensor activo' : 'sensores activos'}`);
    setText('sec-last-reading', 'Datos recibidos · ' + new Date().toLocaleTimeString('es-NI', {hour: '2-digit', minute: '2-digit', second: '2-digit'}));
    SmartHome.buttonState('btn-alarm-sec', d.auto_alarm === true, 'Silenciar alarma', 'Activar alarma');
    SmartHome.pill('alarm-mode', d.auto_alarm === true ? 'ALARMA HABILITADA' : 'ALARMA SILENCIADA',
      d.auto_alarm === true ? 'info' : 'warn');

    clearScreenEffects();
    if (gasDanger) {
      toggle('sec-gas-overlay', 'is-visible', true);
      heroPresentation('danger', '⚠ ALERTA DE GAS', '¡Atención! Sensor de gas activado',
        'El sensor detectó una señal de gas. ' + (d.auto_alarm === true ? 'La alarma está habilitada.' : 'Activa la alarma sonora si la necesitas.'), '🚨');
      const banner = el('sec-alert-bubble');
      if (banner) banner.dataset.tone = 'gas';
      setText('sec-alert-bubble', pirMotion ? '🚨 Alerta de gas y movimiento detectados' : '🚨 ¡ALERTA! Sensor de gas activado');
      toggle('sec-alert-bubble', 'is-visible', true);
      return;
    }
    if (pirMotion) {
      toggle('sec-pir-overlay', 'is-visible', true);
      heroPresentation('motion', '● MOVIMIENTO DETECTADO', '¡Se detectó movimiento!',
        'El radar PIR ha detectado actividad. El efecto de ondas se activa en toda la pantalla.', '📡');
      const banner = el('sec-alert-bubble');
      if (banner) banner.dataset.tone = 'motion';
      setText('sec-alert-bubble', '📡 Movimiento detectado por el sensor PIR');
      toggle('sec-alert-bubble', 'is-visible', true);
      return;
    }
    if (count === 0) {
      heroPresentation('idle', 'MONITOREO EN ESPERA', 'Activa los sensores para comenzar',
        'El sistema está conectado, pero ninguno de los tres sensores de seguridad está habilitado.', '🛡️');
    } else {
      heroPresentation('idle', 'MONITOREO ACTIVO', 'Sin alertas en los sensores activos',
        'No se reportan alertas digitales de gas o movimiento en los sensores habilitados. Las lecturas se actualizan automáticamente.', '🛡️');
    }
  }

  function onData(d) {
    if (!effectsReady) prepareVisuals();
    const gasDanger = presentGas(d);
    const pirMotion = presentPir(d);
    presentRfid(d);
    updateScene(d, gasDanger, pirMotion);
  }

  function onError() {
    clearScreenEffects();
    toggle('sec-gas-visual', 'is-active', false);
    toggle('sec-pir-visual', 'is-active', false);
    toggle('sec-reader-display', 'is-active', false);
    heroPresentation('offline', 'SIN DATOS RECIENTES', 'Reconectando con el ESP32…',
      'Se perdió una respuesta de red. Los últimos estados visualizados pueden no estar actualizados; comprueba la conexión antes de sacar conclusiones.', '📶');
    setText('sec-last-reading', 'Esperando respuesta…');
    setText('sec-gas-mini', 'Sin datos recientes');
    setText('sec-gas-reading', '—');
    setText('sec-gas-meter-detail', 'Sin datos recientes del ESP32.');
    const meter = el('sec-gas-meter');
    if (meter) meter.dataset.alert = 'no';
    const fill = el('sec-gas-meter-fill');
    if (fill) fill.style.setProperty('--gas-width', '0%');
    setText('sec-pir-mini', 'Sin datos recientes');
    setText('sec-rfid-mini', 'Sin datos recientes');
    // No cambiar los botones ni mandar órdenes por una pérdida de conexión.
  }

  function dispose() {
    if (flashTimeout !== null) clearTimeout(flashTimeout);
  }
  window.addEventListener('pagehide', dispose);
  return { onData, onError };
})();

SmartHome.bootPage({
  active: 'seguridad',
  interval: 2500,
  onData: SecurityScreen.onData,
  onError: SecurityScreen.onError
});
