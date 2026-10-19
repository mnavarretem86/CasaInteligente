'use strict';

const RainScreen = (() => {
  let effectsCreated = false;

  // =====================================
  // CREAR ANIMACIONES DE LLUVIA
  // =====================================
  function createRainEffects() {
    const layer = SmartHome.$('rain-layer');
    if (!layer || layer.dataset.ready === '1') return;

    document.body.appendChild(layer);
    const fragment = document.createDocumentFragment();

    // Gotas de lluvia
    for (let i = 0; i < 130; i++) {
      const drop = document.createElement('span');
      drop.className = 'rain-streak';
      drop.style.setProperty('--left', (Math.random() * 120).toFixed(1) + '%');
      drop.style.setProperty('--length', (45 + Math.random() * 110).toFixed(0) + 'px');
      drop.style.setProperty('--speed', (0.55 + Math.random() * 1.05).toFixed(2) + 's');
      drop.style.setProperty('--delay', (-Math.random() * 4).toFixed(2) + 's');
      fragment.appendChild(drop);
    }

    // Salpicaduras
    for (let i = 0; i < 22; i++) {
      const splash = document.createElement('span');
      splash.className = 'rain-splash';
      splash.style.setProperty('--left', (Math.random() * 100).toFixed(1) + '%');
      splash.style.setProperty('--bottom', (Math.random() * 18).toFixed(1) + '%');
      splash.style.setProperty('--size', (8 + Math.random() * 18).toFixed(0) + 'px');
      splash.style.setProperty('--speed', (1 + Math.random() * 1.35).toFixed(2) + 's');
      splash.style.setProperty('--delay', (-Math.random() * 4.5).toFixed(2) + 's');
      fragment.appendChild(splash);
    }

    layer.appendChild(fragment);
    layer.dataset.ready = '1';
  }

  // =====================================
  // CREAR ANIMACIÓN SOLAR
  // =====================================
  function createSunEffects() {
    const layer = SmartHome.$('sun-layer');
    if (!layer || layer.dataset.ready === '1') return;

    document.body.appendChild(layer);
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < 16; i++) {
      const ray = document.createElement('span');
      ray.className = 'sun-ray';
      ray.style.setProperty('--angle', (i * 22.5) + 'deg');
      ray.style.opacity = (0.20 + Math.random() * 0.22).toFixed(2);
      fragment.appendChild(ray);
    }

    layer.appendChild(fragment);
    layer.dataset.ready = '1';
  }

  function initializeEffects() {
    if (effectsCreated) return;
    createRainEffects();
    createSunEffects();
    effectsCreated = true;
  }

  // =====================================
  // APAGAR TODOS LOS EFECTOS
  // =====================================
  function hideAllEffects() {
    SmartHome.$('rain-layer')?.classList.remove('active');
    SmartHome.$('sun-layer')?.classList.remove('active');
    SmartHome.$('scene-banner')?.classList.remove('raining');
  }

  // =====================================
  // SENSOR INACTIVO
  // =====================================
  function showInactiveScene() {
    hideAllEffects();
    SmartHome.text('scene-status', '⚪ SENSOR INACTIVO');
    SmartHome.text('scene-title', 'Monitoreo de lluvia desactivado');
    SmartHome.text('scene-desc', 'Activa el sensor de lluvia para comenzar los efectos visuales de lluvia y sol.');
  }

  // =====================================
  // MOSTRAR LLUVIA
  // =====================================
  function showRainScene() {
    hideAllEffects();
    SmartHome.$('rain-layer')?.classList.add('active');
    SmartHome.$('scene-banner')?.classList.add('raining');
    SmartHome.text('scene-status', '🌧️ LLUVIA DETECTADA');
    SmartHome.text('scene-title', '¡Está lloviendo!');
    SmartHome.text('scene-desc', 'El ESP32 detectó agua en la placa. Las gotas de lluvia están activadas en toda la pantalla.');
  }

  // =====================================
  // MOSTRAR SOL
  // =====================================
  function showSunScene() {
    hideAllEffects();
    SmartHome.$('sun-layer')?.classList.add('active');
    SmartHome.text('scene-status', '☀️ SIN LLUVIA');
    SmartHome.text('scene-title', 'Ya no está lloviendo');
    SmartHome.text('scene-desc', 'El sensor está activo y no detecta agua. Se muestra el efecto de sol.');
    SmartHome.text('sun-caption', '☀️ Ya no está lloviendo');
  }

  // =====================================
  // SENSOR SIN DATOS
  // =====================================
  function showNoDataScene() {
    hideAllEffects();
    SmartHome.text('scene-status', '⚠️ SIN LECTURA');
    SmartHome.text('scene-title', 'Esperando datos del sensor');
    SmartHome.text('scene-desc', 'No hay una lectura válida del GPIO 34. Comprueba la conexión del sensor de lluvia.');
  }

  // =====================================
  // ERROR DE CONEXIÓN
  // =====================================
  function showConnectionErrorScene() {
    hideAllEffects();
    SmartHome.text('scene-status', '⚠️ ERROR DE CONEXIÓN');
    SmartHome.text('scene-title', 'Esperando comunicación con ESP32');
    SmartHome.text('scene-desc', 'No se pudo obtener respuesta del ESP32. Verifica la alimentación y la red Wi-Fi.');
  }

  // =====================================
  // CONTROL DE LOS EFECTOS
  // =====================================
  function updateVisualScene(active, valid, raining) {
    initializeEffects();

    if (!active) {
      showInactiveScene();
      return;
    }

    if (!valid) {
      showNoDataScene();
      return;
    }

    if (raining) {
      showRainScene();
    } else {
      showSunScene();
    }
  }

  // =====================================
  // ACTUALIZAR DATOS DEL ESP32
  // =====================================
  function update(d) {
    const active = d.rain_active === true;
    const valid = d.rain_ok === true && Number.isFinite(d.rain_val);
    const raining = active && valid && d.rain_detected === true;
    const windowState = d.window || 'DESCONOCIDA';

    // Botones
    SmartHome.buttonState('btn-rain', active);
    SmartHome.buttonState('btn-auto-rain', d.auto_rain === true);

    // Lectura del ADC y barra de progreso (solo si el sensor está activo y es válido)
    SmartHome.text('rain-value', active && valid ? d.rain_val : '--');
    SmartHome.progress('rain-progress', active && valid ? (d.rain_val / 4095) * 100 : 0);

    // Estado del sensor
    SmartHome.pill(
      'rain-status',
      !active
        ? 'INACTIVO'
        : !valid
          ? 'SIN LECTURA'
          : raining
            ? 'AGUA DETECTADA'
            : 'PLACA SECA',
      !active
        ? ''
        : !valid
          ? 'bad'
          : raining
            ? 'info'
            : 'good'
    );

    // Información del ADC
    SmartHome.text(
      'rain-method',
      !active
        ? 'Sensor desactivado por el usuario.'
        : !valid
          ? 'Sensor sin lectura válida.'
          : d.rain_calibrated
            ? 'Sensor calibrado en seco y mojado.'
            : 'Criterio original ADC ≥ 2000. Puedes calibrarlo en Pronóstico local.'
    );

    // Ventana GPIO13
    SmartHome.pill(
      'rain-window',
      windowState,
      windowState === 'ABIERTA' ? 'warn' : windowState === 'CERRADA' ? 'good' : ''
    );

    // Activar efectos únicamente cuando el sensor esté activo
    updateVisualScene(active, valid, raining);
  }

  return {
    update,
    showConnectionErrorScene
  };
})();

// =====================================
// CONEXIÓN CON EL ESP32
// =====================================
SmartHome.bootPage({
  active: 'lluvia',
  interval: 2000,
  onData: RainScreen.update,
  onError: RainScreen.showConnectionErrorScene
});
