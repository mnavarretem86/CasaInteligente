'use strict';

const RGBPanel = (() => {
  const palette = {
    ROJO: { hex: '#ff494d', soft: '#ff4c5f95', button: 'rgb-btn-red' },
    VERDE: { hex: '#2fda91', soft: '#2fda9199', button: 'rgb-btn-green' },
    AZUL: { hex: '#438eff', soft: '#438effa6', button: 'rgb-btn-blue' },
    AMARILLO: { hex: '#ffcf44', soft: '#ffcf44a4', button: 'rgb-btn-yellow' },
    MORADO: { hex: '#aa69fa', soft: '#aa69faa4', button: 'rgb-btn-purple' },
    CIAN: { hex: '#42e4ec', soft: '#42e4eca4', button: 'rgb-btn-cyan' },
    BLANCO: { hex: '#eff8ff', soft: '#eff8ff8e', button: 'rgb-btn-white' },
    OFF: { hex: '#8192aa', soft: '#ffffff00', button: 'rgb-btn-off' },
    ALARMA: { hex: '#ff394e', soft: '#ff394eaa', button: null }
  };
  const allButtons = ['red','green','blue','yellow','purple','cyan','white','off'];

  function onData(data) {
    const state = typeof data.rgb === 'string' ? data.rgb.toUpperCase() : '';
    const config = palette[state];
    const box = SmartHome.$('rgb-live-card');
    const badge = SmartHome.$('rgb-status');
    if (!box || !badge) return;

    box.classList.toggle('is-on', Boolean(config) && state !== 'OFF');
    box.classList.toggle('is-alarm', state === 'ALARMA');
    box.style.setProperty('--rgb-light', config ? config.hex : '#8192aa');
    box.style.setProperty('--rgb-soft', config ? config.soft : '#ffffff00');

    badge.textContent = config ? (state === 'ALARMA' ? 'ALARMA ACTIVA' : state === 'OFF' ? 'APAGADA' : state) : 'SIN LECTURA';
    badge.style.color = state === 'ALARMA' ? '#c83d4b' : '#305f83';
    SmartHome.text('rgb-color-name', state === 'OFF' ? 'Apagado' : state === 'ALARMA' ? 'Alerta de seguridad' : config ? state.charAt(0) + state.slice(1).toLowerCase() : 'Sin lectura');
    SmartHome.text('rgb-light-count', state === 'OFF' ? '4 LED · Apagados' : state === 'ALARMA' ? '4 LED · Alerta' : config ? '4 LED · Encendidos' : '4 LED · GPIO 26');
    SmartHome.text('rgb-connection-note', state === 'ALARMA' ? 'Los avisos de seguridad tienen prioridad sobre los colores seleccionados.' : 'ESP32 conectado · GPIO 26');

    for (const name of allButtons) {
      const button = SmartHome.$('rgb-btn-' + name);
      if (!button) continue;
      const selected = Boolean(config) && config.button === button.id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  }

  function onError() {
    SmartHome.text('rgb-connection-note', 'Esperando actualización del ESP32. Se conserva el último estado recibido.');
  }

  return { onData, onError };
})();

SmartHome.bootPage({
  active: 'iluminacion',
  interval: 2600,
  onData: RGBPanel.onData,
  onError: RGBPanel.onError
});
