'use strict';

// GreenLife IoT: únicamente presenta lecturas existentes de /api/status.
const GreenLife = (() => {
  const $ = id => document.getElementById(id);
  const write = (id, value) => { if ($(id)) $(id).textContent = String(value); };
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));

  const moods = {
    dry: { greeting: '¡Tengo sed!', message: 'Mi tierra está bastante seca. ¿Me regalas un poquito de agua?', chip: '💧 Necesito agua', advice: 'Es momento de revisar la tierra', tip: 'Comprueba con un dedo antes de regar y añade agua poco a poco, sin encharcar la maceta.', icon: '💧', tone: 'dry', name: 'Seca' },
    medium: { greeting: '¡Voy mejorando!', message: 'Tengo algo de humedad, pero me vendría bien que me vigiles.', chip: '🌾 Humedad intermedia', advice: 'Revisa cómo evoluciona la humedad', tip: 'Observa si la lectura baja con las horas. Las necesidades de agua dependen de la especie.', icon: '🌤️', tone: 'medium', name: 'Media' },
    happy: { greeting: '¡Estoy muy feliz!', message: 'Mi tierrita tiene buena humedad. ¡Gracias por cuidarme! ♡', chip: '💚 Tierra húmeda', advice: 'Tu plantita se siente a gusto', tip: 'La tierra mantiene humedad dentro del rango elegido. Evita regar solo por rutina.', icon: '🌱', tone: 'happy', name: 'Húmeda' },
    wet: { greeting: '¡Mucha agüita!', message: 'Mi tierra está muy mojada. Vamos a dejar que drene un poco.', chip: '💦 Tierra muy mojada', advice: 'Deja descansar la regadera', tip: 'Si la lectura sigue al máximo mucho tiempo, verifica que la maceta tenga buen drenaje.', icon: '💦', tone: 'wet', name: 'Mojada' },
    waiting: { greeting: '¡Hola, soy tu plantita!', message: 'Estoy esperando al sensor para saber cómo está mi tierra.', chip: '🌱 Esperando lectura', advice: 'Esperando datos de la maceta', tip: 'Comprueba que el sensor capacitivo esté conectado a GPIO 32.', icon: '🌿', tone: 'waiting', name: 'Sin lectura' }
  };

  function update(data) {
    if (!data || typeof data !== 'object') return;
    const soilAvailable = data.soil_ok === true &&
      Number.isFinite(data.soil_humidity) && Number.isFinite(data.soil_adc);
    const humidity = soilAvailable ? clamp(Math.round(data.soil_humidity), 0, 100) : null;
    const mood = humidity === null ? moods.waiting :
      humidity < 25 ? moods.dry : humidity < 55 ? moods.medium : humidity < 85 ? moods.happy : moods.wet;

    const scene = $('plant-character');
    if (scene) {
      scene.dataset.mood = mood.tone;
      scene.setAttribute('aria-label', 'Plantita animada. Estado: ' + mood.name);
    }
    write('plant-greeting', mood.greeting);
    write('plant-message', mood.message);
    write('plant-happy-chip', mood.chip);
    write('plant-advice-icon', mood.icon);
    write('plant-advice-title', mood.advice);
    write('plant-advice-text', mood.tip);
    write('plant-soil-percent', humidity === null ? '--' : humidity);
    write('plant-soil-description', soilAvailable ?
      (humidity < 25 ? 'La tierra necesita atención.' : humidity < 55 ? 'Humedad intermedia.' : humidity < 85 ? 'Tu tierrita está húmeda.' : 'La tierra está muy mojada.') :
      'Todavía no hay una lectura válida del suelo.');
    write('plant-adc', soilAvailable ? data.soil_adc : '----');
    write('plant-soil-badge', soilAvailable ? (data.soil_state || mood.name).toUpperCase() : 'SIN LECTURA');
    const badge = $('plant-soil-badge');
    if (badge) badge.dataset.tone = mood.tone;
    const fill = $('plant-earth-fill');
    if (fill) fill.style.width = (humidity === null ? 0 : humidity) + '%';
    const gauge = $('plant-earth-meter');
    if (gauge) {
      gauge.dataset.tone = mood.tone;
      gauge.setAttribute('aria-valuetext', humidity === null ? 'Sin lectura disponible' : humidity + ' por ciento de humedad relativa');
      if (humidity === null) gauge.removeAttribute('aria-valuenow');
      else gauge.setAttribute('aria-valuenow', String(humidity));
    }

    const hasDht = data.dht_ok === true && Number.isFinite(data.temp) && Number.isFinite(data.hum);
    write('plant-temperature', hasDht ? Number(data.temp).toFixed(1).replace(/\.0$/, '') : '--');
    write('plant-air-humidity', hasDht ? Math.round(data.hum) : '--');
    write('plant-temp-label', hasDht ? (data.temp >= 32 ? 'Ambiente cálido' : data.temp < 20 ? 'Ambiente fresco' : 'Temperatura ambiental') : 'Sin lectura');
    write('plant-hum-label', hasDht ? (data.hum < 40 ? 'Aire algo seco' : data.hum > 75 ? 'Aire húmedo' : 'Humedad ambiental') : 'Sin lectura');
    const tempBar = $('plant-temp-bar');
    if (tempBar) tempBar.style.width = (hasDht ? clamp((data.temp - 10) / 30 * 100, 0, 100) : 0) + '%';
    const humBar = $('plant-hum-bar');
    if (humBar) humBar.style.width = (hasDht ? clamp(data.hum, 0, 100) : 0) + '%';

    const live = $('plant-live');
    if (live) live.classList.add('is-live');
    write('plant-live-label', soilAvailable ? 'Lecturas en vivo' : 'ESP32 conectado');
    const dot = $('plant-reading-dot');
    if (dot) dot.className = 'plant-reading-dot' + (soilAvailable ? ' good' : ' warn');
    write('plant-reading-label', soilAvailable ? 'Sensor de suelo respondiendo' : 'Esperando sensor de suelo');
    write('plant-last-updated', 'Última actualización: ' + new Date().toLocaleTimeString('es-NI', {hour12: false}) + (hasDht ? ' · DHT11 activo en lectura' : ' · DHT11 sin lectura'));
  }

  function onError() {
    const live = $('plant-live');
    if (live) live.classList.remove('is-live');
    write('plant-live-label', 'Última lectura');
    write('plant-reading-label', 'Conexión pendiente');
    write('plant-last-updated', 'Se muestran los últimos valores recibidos.');
  }

  function init() {
    const button = $('plant-refresh');
    if (button) button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const result = await SmartHome.status();
        update(result);
      } catch (error) {
        window.SmartNotify?.error('No se pudo actualizar', {duration: 2800});
        onError();
      } finally { button.disabled = false; }
    });
  }
  return { update, onError, init };
})();

SmartHome.bootPage({
  active: 'planta',
  interval: 2800,
  onData: GreenLife.update,
  onError: GreenLife.onError
});
GreenLife.init();
