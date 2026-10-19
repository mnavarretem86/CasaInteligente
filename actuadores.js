'use strict';

const ActuatorPanel = (() => {
  const $ = SmartHome.$;
  const stateBadge = (id, value, color = '') => {
    const node = $(id);
    if (!node) return;
    node.textContent = value;
    node.className = 'act-state' + (color ? ' ' + color : '');
  };
  const markSelected = (id, active) => {
    const node = $(id);
    if (node) node.classList.toggle('is-selected', active);
  };
  const toggle = (id, active, className) => {
    const node = $(id);
    if (node) node.classList.toggle(className, active);
  };

  function onData(d) {
    const ledOn = d.led === true;
    const win = typeof d.window === 'string' ? d.window.toUpperCase() : 'DESCONOCIDA';
    const fan = typeof d.fan === 'string' ? d.fan.toUpperCase() : 'OFF';
    const windowOpen = win === 'ABIERTA';
    const windowClosed = win === 'CERRADA';
    const fanLeft = fan === 'IZQ';
    const fanRight = fan === 'DER';
    const fanOff = fan === 'OFF';

    const connection = $('act-link');
    if (connection) connection.className = 'act-online online';
    SmartHome.text('act-link-label', 'ESP32 conectado');

    stateBadge('act-led', ledOn ? 'ENCENDIDA' : 'APAGADA', ledOn ? 'good' : '');
    stateBadge('act-window', win, windowOpen ? 'info' : windowClosed ? 'good' : 'warn');
    stateBadge('act-fan', fanLeft ? 'IZQUIERDA' : fanRight ? 'DERECHA' : fanOff ? 'DETENIDO' : fan, fanOff ? '' : 'info');

    toggle('act-lamp-stage', ledOn, 'is-on');
    toggle('act-window-stage', windowOpen, 'is-open');
    toggle('act-fan-stage', !fanOff, 'spinning');
    toggle('act-fan-stage', fanLeft, 'reverse');

    markSelected('act-led-on', ledOn);
    markSelected('act-led-off', !ledOn);
    markSelected('act-window-open', windowOpen);
    markSelected('act-window-close', windowClosed);
    markSelected('act-fan-left', fanLeft);
    markSelected('act-fan-right', fanRight);
    markSelected('act-fan-off', fanOff);

    SmartHome.text('act-window-caption', windowOpen ? 'Ventana abierta' : windowClosed ? 'Ventana cerrada' : 'Posición no confirmada');
    SmartHome.text('act-window-note', d.auto_rain && d.rain_active
      ? 'Automatización por lluvia activa: el ESP32 puede cambiar esta posición automáticamente.'
      : 'Control manual disponible. La automatización se configura en Sensor de lluvia.');
    SmartHome.text('act-fan-caption', fanLeft ? 'Giro a la izquierda' : fanRight ? 'Giro a la derecha' : fanOff ? 'Ventilador detenido' : 'Estado no disponible');
    SmartHome.text('act-fan-desc', fanLeft ? 'Giro hacia la izquierda seleccionado.' : fanRight ? 'Giro hacia la derecha seleccionado.' : fanOff ? 'El ventilador está detenido.' : 'Revisa el estado recibido del ESP32.');

    const count = Number(ledOn) + Number(windowOpen) + Number(!fanOff);
    SmartHome.text('act-count', String(count).padStart(2, '0'));
    SmartHome.text('act-hero-title', count ? 'Tus dispositivos están en funcionamiento' : 'Tu espacio, listo para comenzar');
    SmartHome.text('act-hero-subtitle', count ? 'Controla cada actuador desde su tarjeta y supervisa su estado actual.' : 'Enciende la iluminación, abre la ventana o activa el ventilador cuando lo necesites.');
  }

  function onError() {
    const connection = $('act-link');
    if (connection) connection.className = 'act-online';
    SmartHome.text('act-link-label', 'Actualizando conexión…');
    // Mantener el último estado mostrado, sin presentarlo como una lectura nueva.
  }

  return { onData, onError };
})();

SmartHome.bootPage({
  active: 'actuadores',
  interval: 2600,
  onData: ActuatorPanel.onData,
  onError: ActuatorPanel.onError
});
