'use strict';
SmartHome.bootPage({ active: 'diagnostico', interval: 3000, onData: d => {
  SmartHome.text('diag-wifi', d.wifi_connected ? 'CONECTADO' : 'SIN RED');
  SmartHome.text('diag-rssi', d.wifi_rssi ?? '--');
  SmartHome.text('diag-reconnects', d.wifi_reconnects ?? '--');
  SmartHome.text('diag-dht', d.dht_ok ? 'OK' : 'ERROR');
  SmartHome.text('diag-hum', d.dht_ok && Number.isFinite(d.hum) ? d.hum + ' %' : '--');
  SmartHome.text('diag-dht-errors', d.dht_errors ?? '--');
  SmartHome.text('diag-rain', d.rain_ok && Number.isFinite(d.rain_val) ? d.rain_val : '--');
  SmartHome.text('diag-rain-state', !d.rain_ok ? 'ERROR' : d.rain_detected ? 'MOJADO' : 'SECO');
  SmartHome.text('diag-mode', d.rain_method ?? '--');
  SmartHome.text('diag-version', d.version ?? 'Firmware anterior');
  SmartHome.text('diag-uptime', Number.isFinite(d.uptime_s) ? Math.floor(d.uptime_s / 60) + ' min' : '--');
  SmartHome.text('diag-http', d.http_requests ?? '--');
  SmartHome.text('diag-servo', 'GPIO' + (d.window_pin ?? '?'));
  SmartHome.text('diag-rfid', d.rfid_available ? 'SÍ' : 'NO');
}});

const testButton = SmartHome.$('test-api');
if (testButton) {
  testButton.addEventListener('click', async () => {
    testButton.disabled = true;
    try {
      const diag = await SmartHome.diagnostics();
      window.SmartNotify?.show(diag.ok ? 'Diagnóstico listo' : 'Respuesta inválida', diag.ok ? 'success' : 'warning');
      SmartHome.text('diag-result', diag.ok
        ? '✅ API respondió. Memoria libre: ' + (diag.free_mem ?? 'no disponible') +
          ' bytes. Reinicios Wi-Fi: ' + (diag.wifi_reconnects ?? '--') + '.'
        : 'Respuesta no válida.');
    } catch (err) {
      window.SmartNotify?.error('No se pudo revisar el ESP32', {duration: 3500});
      SmartHome.text('diag-result', '❌ Prueba fallida: ' + err.message);
    } finally {
      testButton.disabled = false;
    }
  });
}
