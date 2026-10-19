"use strict";

const AudioUAM = (() => {
  const SONGS = {
    jingle: "Navidad",
    starwars: "Star Wars",
    twinkle: "Estrellita",
    ode: "Himno a la alegría",
    birthday: "Cumpleaños feliz"
  };

  function setText(id, value) {
    SmartHome.text(id, value);
  }

  function setBadge(id, message, type) {
    const el = SmartHome.$(id);
    if (!el) return;
    el.textContent = message;
    el.className = "au-mini-pill" + (type ? " " + type : "");
  }

  function onData(data) {
    const hasPlayerInfo = typeof data.melody_playing === "boolean";
    const isPlaying = hasPlayerInfo && data.melody_playing === true &&
      Object.prototype.hasOwnProperty.call(SONGS, data.melody_name);
    const gasDanger = data.gas_active === true && data.gas_alert === true;
    const pirDanger = data.pir_active === true && data.pir_alert === true;
    const alarmOn = data.auto_alarm === true;
    const alarming = data.alarm_sounding === true ||
      (alarmOn && (gasDanger || pirDanger));
    const songName = isPlaying ? SONGS[data.melody_name] : null;

    const player = SmartHome.$("au-player");
    player?.classList.toggle("is-playing", isPlaying && !alarming);
    const alertCard = SmartHome.$("au-alert");
    alertCard?.classList.toggle("alarming", alarming);

    setText("au-connection", "ESP32 conectado");
    SmartHome.$("au-conn-dot")?.classList.remove("off");

    if (alarming) {
      setText("au-player-state", "⚠ SEGURIDAD PRIORITARIA");
      setText("au-current-song", "Alarma en curso");
      setText("au-player-description", "El aviso de seguridad tiene prioridad sobre la reproducción de melodías.");
      setText("au-progress-text", "Música suspendida");
    } else if (isPlaying) {
      setText("au-player-state", "♫ REPRODUCIENDO EN ESP32");
      setText("au-current-song", songName);
      setText("au-player-description", "La melodía se está reproduciendo en el buzzer conectado al GPIO 25.");
      setText("au-progress-text", "Nota " +
        (Number.isFinite(data.melody_note_index) ? data.melody_note_index : 0) +
        " de " + (Number.isFinite(data.melody_total) ? data.melody_total : "—"));
    } else {
      setText("au-player-state", "♫ REPRODUCTOR DISPONIBLE");
      setText("au-current-song", "Elige una melodía");
      setText("au-player-description", "Selecciona una de las cinco canciones para reproducirla en tu ESP32.");
      setText("au-progress-text", "5 melodías disponibles");
    }

    const percentage = isPlaying && !alarming
      ? Math.max(0, Math.min(100, Number(data.melody_progress) || 0))
      : 0;
    SmartHome.progress("au-progress-bar", percentage);

    document.querySelectorAll(".au-track").forEach(track => {
      const selected = isPlaying && !alarming && track.dataset.track === data.melody_name;
      track.classList.toggle("is-playing", selected);
      track.setAttribute("aria-pressed", selected ? "true" : "false");
      track.disabled = alarming;
      const icon = track.querySelector(".au-track-play");
      if (icon) icon.textContent = selected ? "♫" : "▶";
    });

    const stop = SmartHome.$("au-stop");
    if (stop) stop.disabled = !isPlaying || alarming;
    const oldVersion = SmartHome.$("au-old-version");
    if (oldVersion) oldVersion.hidden = hasPlayerInfo;

    SmartHome.pill("alarm-state", alarmOn ? "HABILITADA" : "SILENCIADA",
      alarmOn ? "good" : "warn");

    const toggle = SmartHome.$("btn-alarm");
    if (toggle) {
      toggle.textContent = alarmOn ? "Silenciar alarma" : "Activar alarma";
      toggle.className = "au-toggle" + (alarmOn ? " is-on" : "");
    }

    setText("au-alarm-description", alarming
      ? "Atención: se ha detectado un evento de seguridad. Revisa los sensores de gas y movimiento."
      : alarmOn
        ? "La alarma está habilitada y responderá a los eventos de los sensores activos."
        : "La alerta sonora está silenciada. Puedes volver a habilitarla cuando lo necesites.");

    setBadge("au-gas-status", !data.gas_active ? "INACTIVO" :
      gasDanger ? "ALERTA" : "NORMAL",
      !data.gas_active ? "" : gasDanger ? "bad" : "good");
    setBadge("au-pir-status", !data.pir_active ? "INACTIVO" :
      pirDanger ? "MOVIMIENTO" : "NORMAL",
      !data.pir_active ? "" : pirDanger ? "bad" : "good");
    setBadge("au-music-status", alarming ? "INTERRUMPIDA" :
      isPlaying ? "SONANDO" : "DETENIDA", alarming ? "warn" : isPlaying ? "good" : "");
  }

  function onError() {
    setText("au-connection", "Comprobando conexión…");
    SmartHome.$("au-conn-dot")?.classList.add("off");
    setText("au-player-state", "CONEXIÓN EN ESPERA");
    setText("au-player-description",
      "No se han recibido datos recientes. La reproducción y las alarmas del ESP32 pueden continuar aunque esta página no responda.");
    SmartHome.$("au-player")?.classList.remove("is-playing");
  }

  return { onData, onError };
})();

SmartHome.bootPage({
  active: "audio",
  interval: 2200,
  onData: AudioUAM.onData,
  onError: AudioUAM.onError
});
