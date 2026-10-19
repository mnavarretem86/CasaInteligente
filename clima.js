'use strict';

const ClimateView = (() => {
  const $ = id => SmartHome.$(id);
  const CIRCUMFERENCE = 2 * Math.PI * 56;
  const previous = { temp: null, hum: null };
  const animations = { temp: 0, hum: 0 };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (number, min, max) => Math.min(max, Math.max(min, number));
  const format = n => Number.isInteger(n) ? String(n) : n.toFixed(1);

  function animateNumber(id, value, key) {
    const target = $(id);
    if (!target) return;
    if (animations[key]) cancelAnimationFrame(animations[key]);
    if (!Number.isFinite(value)) {
      previous[key] = null;
      target.textContent = '--';
      return;
    }
    const startValue = Number.isFinite(previous[key]) ? previous[key] : value;
    previous[key] = value;
    if (reduceMotion || startValue === value) {
      target.textContent = format(value);
      return;
    }
    const begin = performance.now();
    const duration = 650;
    const tick = now => {
      const t = clamp((now - begin) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      target.textContent = format(startValue + (value - startValue) * eased);
      if (t < 1) animations[key] = requestAnimationFrame(tick);
    };
    animations[key] = requestAnimationFrame(tick);
  }

  function renderMode(active) {
    const button = $('btn-temp');
    if (button) {
      button.classList.toggle('on', active);
      button.textContent = active ? '●  ACTIVO' : '○  INACTIVO';
      button.setAttribute('aria-pressed', String(active));
      button.title = active ? 'Desactivar control DHT11' : 'Activar control DHT11';
    }
    SmartHome.text('cl-mode', active ? 'Activado' : 'Desactivado');
    SmartHome.text('cl-mode-note', active ? 'Supervisión habilitada' : 'Medición de fondo disponible');
    SmartHome.text('cl-control-hint', active ? 'Supervisión del DHT11 activa' : 'Activar supervisión del DHT11');
  }

  function classifyTemp(temp) {
    if (temp < 20) return ['Ambiente fresco', 'Temperatura baja'];
    if (temp < 27) return ['Temperatura templada', 'Ambiente moderado'];
    if (temp < 32) return ['Ambiente cálido', 'Temperatura elevada'];
    return ['Ambiente muy cálido', 'Temperatura alta'];
  }

  function classifyHum(hum) {
    if (hum < 30) return ['Aire seco', 'Humedad baja'];
    if (hum <= 60) return ['Humedad equilibrada', 'Nivel moderado'];
    if (hum <= 75) return ['Humedad elevada', 'Nivel alto'];
    return ['Aire muy húmedo', 'Humedad muy alta'];
  }

  function update(d) {
    const active = d.temp_active === true;
    const valid = d.dht_ok === true && Number.isFinite(d.temp) && Number.isFinite(d.hum);
    renderMode(active);
    const badge = $('cl-live');
    if (badge) {
      badge.classList.toggle('live', valid);
      badge.classList.toggle('warn', !valid);
    }
    SmartHome.text('cl-live-text', valid ? 'Lecturas en tiempo real' : 'Sensor sin lectura');

    if (!valid) {
      animateNumber('temp-value', NaN, 'temp');
      animateNumber('hum-value', NaN, 'hum');
      SmartHome.text('temp-note', 'Esperando datos del DHT11');
      SmartHome.text('cl-hum-caption', 'Esperando datos del DHT11');
      SmartHome.text('cl-temp-label', 'Sin lectura');
      SmartHome.text('cl-hum-label', 'Sin lectura');
      SmartHome.text('cl-headline', 'Tu ambiente, en tiempo real.');
      SmartHome.text('cl-description', 'El sensor DHT11 no ha entregado mediciones válidas. Comprueba su conexión en GPIO 17.');
      SmartHome.text('cl-condition', 'Sin datos ambientales');
      SmartHome.text('cl-condition-note', 'Verifica el sensor y su alimentación');
      SmartHome.text('cl-reading-status', 'Pendiente de una lectura válida');
      const ring = $('cl-ring-progress');
      if (ring) ring.style.strokeDashoffset = String(CIRCUMFERENCE);
      const marker = $('cl-temp-marker');
      if (marker) marker.style.setProperty('--marker', '0%');
      const tube = $('cl-temp-fill');
      if (tube) tube.style.setProperty('--fill', '0%');
      SmartHome.progress('hum-progress', 0);
      return;
    }

    animateNumber('temp-value', d.temp, 'temp');
    animateNumber('hum-value', d.hum, 'hum');
    const temp = classifyTemp(d.temp);
    const hum = classifyHum(d.hum);
    SmartHome.text('temp-note', 'Temperatura actual del espacio');
    SmartHome.text('cl-hum-caption', 'Humedad relativa del ambiente');
    SmartHome.text('cl-temp-label', temp[0]);
    SmartHome.text('cl-hum-label', hum[0]);
    SmartHome.text('cl-condition', temp[0]);
    SmartHome.text('cl-condition-note', hum[0]);
    SmartHome.text('cl-headline', 'Un espacio que puedes conocer.');
    SmartHome.text('cl-description', 'Temperatura de ' + format(d.temp) + ' °C y humedad del ' + format(d.hum) + ' %. Lecturas actuales de tu estación Smart Home.');

    const temperaturePercent = clamp((d.temp - 10) / 35 * 100, 0, 100);
    const tube = $('cl-temp-fill');
    if (tube) tube.style.setProperty('--fill', clamp(temperaturePercent, 4, 100) + '%');
    const marker = $('cl-temp-marker');
    if (marker) marker.style.setProperty('--marker', clamp(temperaturePercent, 3, 97) + '%');
    const ring = $('cl-ring-progress');
    if (ring) ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - clamp(d.hum, 0, 100) / 100));
    SmartHome.progress('hum-progress', d.hum);

    SmartHome.text('cl-updated', new Date().toLocaleTimeString('es-NI', { hour12: false }));
    SmartHome.text('cl-reading-status', active ? 'Control activo · DHT11' : 'Lectura disponible · control inactivo');
  }

  function onError() {
    const badge = $('cl-live');
    if (badge) {
      badge.classList.remove('live');
      badge.classList.add('warn');
    }
    SmartHome.text('cl-live-text', 'Reintentando conexión');
    SmartHome.text('cl-reading-status', 'Última lectura recibida; conexión pendiente');
  }

  return { update, onError };
})();

SmartHome.bootPage({
  active: 'clima',
  interval: 2600,
  onData: ClimateView.update,
  onError: ClimateView.onError
});
