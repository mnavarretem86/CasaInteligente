# Smart Home UdeM - Dashboard.py corregido para ESP32 MicroPython
# Version integrada con main.py (menu App IoT / Sensores). Ventana GPIO13.
# Auto ventana: abre cuando esta SECO estable y cierra si detecta lluvia.
# Se conservan GPIO y comandos de todos los demas sensores y actuadores.
import network
import socket
import time
import ujson
import gc
from machine import Pin, PWM, SoftI2C, ADC
from neopixel import NeoPixel
import dht

# Conserva el Wi-Fi de tu programa que funcionaba.
SSID = 'Thousand_Sunny'
PASSWORD = 'Temporal*123'

PIN_SCL = 22
PIN_SDA = 21
PIN_VENTANA = 13     # SOLO UN SERVO: reutiliza el GPIO de la antigua puerta

# Configuracion de recorrido completo del servo a 50 Hz (500 us a 2400 us).
# Si el montaje fisico de tu ventana abre al reves, invierte 0 y 180.
SERVO_CERRADA_ANGULO = 0
SERVO_ABIERTA_ANGULO = 180
SERVO_MIN_NS = 500_000       # 0.5 ms -> 0 grados (duty 10-bit ~ 26)
SERVO_MAX_NS = 2_400_000     # 2.4 ms -> 180 grados (duty 10-bit ~ 123)
SERVO_SETTLE_MS = 750        # Tiempo para completar el recorrido antes de relajar el PWM
SERVO_RELEASE_PWM = True     # Evita vibracion/calentamiento una vez alcanzada la posicion

RAIN_FALLBACK_THRESHOLD = 2000  # Comportamiento del proyecto ORIGINAL sin calibracion
RAIN_MIN_SPAN = 80              # Diferencia minima de ADC seco / mojado
AUTO_OPEN_DRY_MS = 3000         # Esperar 3 segundos de placa seca estable antes de abrir
CAL_FILE = 'rain_cal.json'      # Persistente en el ESP32
PIR_WARMUP_MS = 30000
AUTHORIZED_UIDS = []
LEGACY_SUMS = (495,)

# Modulos opcionales: una falla de LCD/RFID no debe detener la API.
try:
    from i2c_lcd import I2cLcd
except ImportError:
    I2cLcd = None
try:
    from mfrc522_i2c import mfrc522
except ImportError:
    mfrc522 = None

lcd = None
try:
    if I2cLcd:
        i2c = SoftI2C(scl=Pin(PIN_SCL), sda=Pin(PIN_SDA), freq=100000)
        lcd = I2cLcd(i2c, 0x27, 2, 16)
        lcd.backlight_on()
except Exception as exc:
    print('LCD no disponible:', exc)


def lcd_msg(line1, line2=''):
    if lcd:
        try:
            lcd.clear()
            lcd.putstr(str(line1)[:16])
            if line2:
                lcd.move_to(0, 1)
                lcd.putstr(str(line2)[:16])
        except Exception:
            pass


rc522 = None
if mfrc522:
    try:
        rc522 = mfrc522(PIN_SCL, PIN_SDA, 0x28)
        rc522.PCD_Init()
    except Exception as exc:
        print('RFID no disponible:', exc)
        rc522 = None

led_interno = Pin(12, Pin.OUT, value=0)
motor_ina = PWM(Pin(19), freq=25000, duty=0)
motor_inb = PWM(Pin(18), freq=25000, duty=0)
FAN_DUTY = 600

# El GPIO5 NO se controla: el servo viejo de ventana esta danado.
# Inicializar con duty=0 evita un desplazamiento inesperado al encender.
servo_ventana = PWM(Pin(PIN_VENTANA), freq=50, duty=0)
servo_release_deadline = None
manual_window_override = False

led_rgb = NeoPixel(Pin(26), 4)
sensor_gas = Pin(23, Pin.IN, Pin.PULL_UP)
pir = Pin(14, Pin.IN)
dht_sensor = dht.DHT11(Pin(17))
adc_lluvia = ADC(Pin(34))
adc_lluvia.atten(ADC.ATTN_11DB)
adc_lluvia.width(ADC.WIDTH_12BIT)
# Botones originales, reservados: se mantienen sin asignar acciones nuevas.
boton_accion = Pin(16, Pin.IN, Pin.PULL_UP)
boton_select = Pin(27, Pin.IN, Pin.PULL_UP)

buzzer_pin = Pin(25, Pin.OUT, value=0)
buzzer = None
boot_time = time.ticks_ms()

state = {
    'temp': None, 'hum': None, 'dht_ok': False, 'dht_errors': 0,
    'rain_val': None, 'rain_ok': False, 'rain_detected': False,
    'rain_cal_dry': None, 'rain_cal_wet': None,
    'rain_calibrated': False, 'rain_method': 'original',
    'gas_alert': False, 'pir_alert': False,
    'rfid_uid': 'Ninguna', 'rfid_access': 'Esperando...',
    'rfid_available': rc522 is not None,
    'led': False, 'fan': 'OFF',
    'window': 'DESCONOCIDA', 'window_pin': PIN_VENTANA,
    'auto_window_status': 'Esperando lectura de lluvia',
    'rgb': 'OFF', 'gas_active': False, 'rain_active': False,
    'temp_active': False, 'pir_active': False, 'rfid_active': False,
    'auto_rain': True, 'auto_alarm': True,
    'wifi_connected': False, 'wifi_rssi': None, 'wifi_reconnects': 0,
    'http_requests': 0, 'uptime_s': 0, 'version': '2.4-servo-full'
}


def set_rgb(r, g, b, label='ON'):
    for index in range(4):
        led_rgb[index] = (r, g, b)
    led_rgb.write()
    state['rgb'] = label


def set_fan(mode):
    if mode == 'OFF':
        motor_ina.duty(0)
        motor_inb.duty(0)
    elif mode == 'DER':
        motor_ina.duty(FAN_DUTY)
        motor_inb.duty(0)
    elif mode == 'IZQ':
        motor_ina.duty(0)
        motor_inb.duty(FAN_DUTY)
    else:
        return
    state['fan'] = mode


def _apply_servo_angle(angle):
    """Aplica el pulso PWM completo (500 us a 2400 us) para lograr los 180 grados."""
    angle = max(0, min(180, int(angle)))
    pulse_ns = int(SERVO_MIN_NS + (angle / 180.0) * (SERVO_MAX_NS - SERVO_MIN_NS))
    try:
        servo_ventana.duty_ns(pulse_ns)
    except AttributeError:
        # Respaldo en escala de 10 bits (0-1023) sobre periodo de 20,000,000 ns
        duty_10bit = int((pulse_ns * 1023) // 20_000_000)
        servo_ventana.duty(duty_10bit)


def _stop_servo_pwm():
    try:
        servo_ventana.duty_ns(0)
    except AttributeError:
        servo_ventana.duty(0)


def update_servo_release(now):
    """Apaga el pulso PWM una vez que el servo termino su recorrido fisico."""
    global servo_release_deadline
    if servo_release_deadline is not None and time.ticks_diff(now, servo_release_deadline) >= 0:
        servo_release_deadline = None
        if SERVO_RELEASE_PWM:
            _stop_servo_pwm()


def set_window(open_win, force=False):
    global servo_release_deadline
    # Unico servo de ventana: GPIO13. El GPIO5 y la puerta NO se usan.
    destino = 'ABIERTA' if open_win else 'CERRADA'
    # Evita mandar PWM repetidamente en cada lectura (~350 ms).
    # force=True conserva los comandos manuales incluso para reintentos.
    if not force and state['window'] == destino:
        return
    angulo = SERVO_ABIERTA_ANGULO if open_win else SERVO_CERRADA_ANGULO
    _apply_servo_angle(angulo)
    servo_release_deadline = time.ticks_add(time.ticks_ms(), SERVO_SETTLE_MS)
    state['window'] = destino
    print('Ventana GPIO13:', destino, '-> angulo:', angulo)


def buzzer_on(freq):
    global buzzer
    if buzzer is None:
        buzzer = PWM(buzzer_pin, freq=freq, duty=512)
    else:
        buzzer.freq(freq)
        buzzer.duty(512)


def buzzer_off():
    global buzzer, buzzer_pin
    if buzzer is not None:
        try:
            buzzer.deinit()
        finally:
            buzzer = None
    buzzer_pin = Pin(25, Pin.OUT, value=0)


# Melodias monofonicas del buzzer. Se reproducen sin bloquear la API.
# Las 3 melodias nuevas son piezas tradicionales / de dominio publico.
MELODIES = {
    'jingle': [(659, 150), (659, 150), (659, 300), (659, 150), (659, 150),
               (659, 300), (659, 150), (784, 150), (523, 200), (587, 100), (659, 400)],
    'starwars': [(440, 350), (440, 350), (440, 350), (349, 250), (523, 120), (440, 400)],
    'twinkle': [
        (262,220),(262,220),(392,220),(392,220),(440,220),(440,220),(392,440),
        (349,220),(349,220),(330,220),(330,220),(294,220),(294,220),(262,440),
        (392,220),(392,220),(349,220),(349,220),(330,220),(330,220),(294,440),
        (392,220),(392,220),(349,220),(349,220),(330,220),(330,220),(294,440),
        (262,220),(262,220),(392,220),(392,220),(440,220),(440,220),(392,440),
        (349,220),(349,220),(330,220),(330,220),(294,220),(294,220),(262,550)
    ],
    'ode': [
        (330,230),(330,230),(349,230),(392,230),(392,230),(349,230),(330,230),(294,230),
        (262,230),(262,230),(294,230),(330,230),(330,350),(294,115),(294,470),
        (330,230),(330,230),(349,230),(392,230),(392,230),(349,230),(330,230),(294,230),
        (262,230),(262,230),(294,230),(330,230),(294,350),(262,115),(262,510)
    ],
    'birthday': [
        (392,165),(392,165),(440,330),(392,330),(523,330),(494,650),
        (392,165),(392,165),(440,330),(392,330),(587,330),(523,650),
        (392,165),(392,165),(784,330),(659,330),(523,330),(494,330),(440,650),
        (698,165),(698,165),(659,330),(523,330),(587,330),(523,720)
    ]
}
melody = None
melody_index = 0
melody_phase = 0
melody_deadline = 0
alarm_sounding = False
state['melody_playing'] = False
state['melody_name'] = None
state['melody_progress'] = 0
state['melody_total'] = 0
state['melody_note_index'] = 0
state['alarm_sounding'] = False


def stop_melody():
    global melody, melody_index, melody_phase, melody_deadline
    melody = None
    melody_index = 0
    melody_phase = 0
    melody_deadline = 0
    state['melody_playing'] = False
    state['melody_name'] = None
    state['melody_progress'] = 0
    state['melody_total'] = 0
    state['melody_note_index'] = 0
    # No silenciar el buzzer si esta sonando la alarma de seguridad.
    if not alarm_sounding:
        buzzer_off()


def start_melody(name):
    global melody, melody_index, melody_phase, melody_deadline
    if name not in MELODIES:
        return False
    # El aviso de gas o movimiento tiene prioridad sobre la musica.
    if state['auto_alarm'] and (state['gas_alert'] or state['pir_alert'] or alarm_sounding):
        return False
    stop_melody()
    melody = MELODIES[name]
    melody_index = 0
    melody_phase = 0
    melody_deadline = 0
    state['melody_playing'] = True
    state['melody_name'] = name
    state['melody_progress'] = 0
    state['melody_total'] = len(melody)
    state['melody_note_index'] = 0
    return True


def advance_melody(now):
    global melody, melody_index, melody_phase, melody_deadline
    if melody is None or alarm_sounding:
        return
    if melody_deadline and time.ticks_diff(now, melody_deadline) < 0:
        return
    if melody_phase == 1:
        buzzer_off()
        melody_phase = 0
        melody_deadline = time.ticks_add(now, 35)
        return
    if melody_index >= len(melody):
        stop_melody()
        return
    frequency, duration = melody[melody_index]
    melody_index += 1
    state['melody_note_index'] = melody_index
    state['melody_progress'] = (melody_index * 100) // len(melody)
    if frequency:
        buzzer_on(frequency)
    else:
        buzzer_off()
    melody_phase = 1
    melody_deadline = time.ticks_add(now, duration)


def es_autorizada(uid_bytes, uid_str):
    return uid_str in AUTHORIZED_UIDS or sum(uid_bytes) in LEGACY_SUMS


# Configuracion lluvia persistente; el sensor puede subir o bajar al mojarse.
def calibrated():
    dry = state['rain_cal_dry']
    wet = state['rain_cal_wet']
    return (isinstance(dry, int) and isinstance(wet, int)
            and abs(dry - wet) >= RAIN_MIN_SPAN)


def load_calibration():
    try:
        with open(CAL_FILE, 'r') as file:
            data = ujson.load(file)
        for key in ('dry', 'wet'):
            value = data.get(key)
            if not (isinstance(value, int) and 0 <= value <= 4095):
                value = None
            state['rain_cal_' + key] = value
    except (OSError, ValueError, TypeError):
        pass
    state['rain_calibrated'] = calibrated()


def save_calibration():
    try:
        with open(CAL_FILE, 'w') as file:
            ujson.dump({'dry': state['rain_cal_dry'],
                        'wet': state['rain_cal_wet']}, file)
        return True
    except OSError as exc:
        print('No se pudo guardar calibracion:', exc)
        return False


rain_candidate = None
rain_candidate_count = 0
rain_stable_since = None
rain_last_confirmed = None


def control_auto_ventana(now):
    # El estado rain_detected es el confirmado por la deteccion con histeresis.
    # No mueve el servo si hay un fallo de ADC o el usuario desactivo la funcion.
    if not state['auto_rain']:
        state['auto_window_status'] = 'Automatizacion desactivada'
        return
    if not state['rain_active']:
        state['auto_window_status'] = 'Active tambien el sensor de lluvia'
        return
    if not state['rain_ok'] or rain_stable_since is None:
        state['auto_window_status'] = 'Esperando lectura valida del sensor'
        return
    if manual_window_override:
        state['auto_window_status'] = 'Control manual activo hasta cambio de clima'
        return

    if state['rain_detected']:
        # La lluvia tiene prioridad; el propio detector ya confirma las lecturas.
        state['auto_window_status'] = 'Lluvia detectada: ventana cerrada'
        set_window(False)
    else:
        # Evita abrir inmediatamente por una gota intermitente o falso seco.
        if time.ticks_diff(now, rain_stable_since) >= AUTO_OPEN_DRY_MS:
            state['auto_window_status'] = 'Placa seca: ventana abierta'
            set_window(True)
        else:
            state['auto_window_status'] = 'Confirmando placa seca (3 segundos)'


def update_rain_detection(value, immediate=False):
    global rain_candidate, rain_candidate_count, rain_stable_since
    global rain_last_confirmed, manual_window_override
    if calibrated():
        dry, wet = state['rain_cal_dry'], state['rain_cal_wet']
        mid = (dry + wet) / 2
        margin = min(85, max(20, abs(wet - dry) * 0.08))
        # Histeresis para que el aviso no oscile en el umbral.
        if wet > dry:
            candidate = value >= (mid - margin if state['rain_detected'] else mid + margin)
        else:
            candidate = value <= (mid + margin if state['rain_detected'] else mid - margin)
        state['rain_method'] = 'calibrado'
    else:
        candidate = value >= RAIN_FALLBACK_THRESHOLD
        state['rain_method'] = 'original'
    state['rain_calibrated'] = calibrated()
    if immediate:
        state['rain_detected'] = candidate
        rain_candidate = None
        rain_candidate_count = 0
    elif candidate == rain_candidate:
        rain_candidate_count += 1
    else:
        rain_candidate = candidate
        rain_candidate_count = 1
    if rain_candidate_count >= 2:
        state['rain_detected'] = candidate
        rain_candidate_count = 0

    # Reiniciar el temporizador SOLO al cambiar el estado CONFIRMADO.
    # Si cambia entre seco y mojado, se retoma el control automatico.
    now = time.ticks_ms()
    if rain_last_confirmed is None or state['rain_detected'] != rain_last_confirmed:
        rain_last_confirmed = state['rain_detected']
        rain_stable_since = now
        manual_window_override = False
    control_auto_ventana(now)


def read_rain():
    try:
        # Mediana de tres lecturas: reduce ruido sin bloquear el equipo.
        a, b, c = adc_lluvia.read(), adc_lluvia.read(), adc_lluvia.read()
        value = sorted((a, b, c))[1]
        state['rain_val'] = value
        state['rain_ok'] = True
        update_rain_detection(value)
    except Exception as exc:
        state['rain_ok'] = False
        print('Error ADC lluvia:', exc)


last_dht_success = None


def read_dht(now):
    global last_dht_success
    try:
        dht_sensor.measure()
        temp = dht_sensor.temperature()
        hum = dht_sensor.humidity()
        if not (-20 <= temp <= 80 and 0 <= hum <= 100):
            raise ValueError('Valores DHT fuera de rango')
        state['temp'], state['hum'] = temp, hum
        state['dht_ok'] = True
        last_dht_success = now
    except Exception as exc:
        state['dht_errors'] += 1
        # Un fallo de lectura DHT no apaga inmediatamente un valor reciente.
        if last_dht_success is None or time.ticks_diff(now, last_dht_success) > 12000:
            state['dht_ok'] = False
        if state['dht_errors'] % 10 == 1:
            print('Error DHT11:', exc)


def calibrate_rain(which):
    if not state['rain_ok']:
        return False, 'El sensor de lluvia no tiene una lectura valida'
    # Leer el ADC en el mismo momento de pulsar calibracion.
    try:
        readings = [adc_lluvia.read() for _ in range(5)]
        value = sorted(readings)[2]
    except Exception:
        return False, 'No fue posible leer el ADC'
    state['rain_val'] = value
    state['rain_cal_' + which] = value
    state['rain_calibrated'] = calibrated()
    update_rain_detection(value, immediate=True)
    if not save_calibration():
        return False, 'Lectura registrada, pero no se pudo guardar en memoria'
    return True, 'Calibracion guardada'


def ejecutar_comando(cmd):
    global alarm_sounding, melody, manual_window_override
    if cmd == 'led_on':
        led_interno.value(1)
        state['led'] = True
    elif cmd == 'led_off':
        led_interno.value(0)
        state['led'] = False
    elif cmd == 'win_open':
        manual_window_override = True
        set_window(True, force=True)
    elif cmd == 'win_close':
        manual_window_override = True
        set_window(False, force=True)
    elif cmd == 'fan_off':
        set_fan('OFF')
    elif cmd == 'fan_der':
        set_fan('DER')
    elif cmd == 'fan_izq':
        set_fan('IZQ')
    elif cmd.startswith('rgb_'):
        colors = {
            'rgb_red': (255, 0, 0, 'ROJO'),
            'rgb_green': (0, 255, 0, 'VERDE'),
            'rgb_blue': (0, 0, 255, 'AZUL'),
            'rgb_yellow': (255, 255, 0, 'AMARILLO'),
            'rgb_purple': (128, 0, 128, 'MORADO'),
            'rgb_cyan': (0, 255, 255, 'CIAN'),
            'rgb_white': (255, 255, 255, 'BLANCO'),
            'rgb_off': (0, 0, 0, 'OFF')
        }
        if cmd not in colors:
            return False, 'Comando RGB desconocido'
        set_rgb(*colors[cmd])
    elif cmd == 'toggle_temp':
        state['temp_active'] = not state['temp_active']
    elif cmd == 'toggle_gas':
        state['gas_active'] = not state['gas_active']
    elif cmd == 'toggle_pir':
        state['pir_active'] = not state['pir_active']
    elif cmd == 'toggle_rain':
        state['rain_active'] = not state['rain_active']
        manual_window_override = False
        control_auto_ventana(time.ticks_ms())
    elif cmd == 'toggle_rfid':
        state['rfid_active'] = not state['rfid_active']
    elif cmd == 'toggle_autorain':
        state['auto_rain'] = not state['auto_rain']
        manual_window_override = False
        # Al activar Auto-ventana, aplicar el ultimo estado confirmado.
        control_auto_ventana(time.ticks_ms())
    elif cmd == 'toggle_alarm':
        state['auto_alarm'] = not state['auto_alarm']
        if not state['auto_alarm'] and alarm_sounding:
            buzzer_off()
            alarm_sounding = False
    elif cmd in ('play_jingle', 'play_starwars', 'play_twinkle',
                 'play_ode', 'play_birthday'):
        name = cmd[5:]
        if not start_melody(name):
            return False, 'La alarma de seguridad tiene prioridad'
    elif cmd == 'stop_melody':
        stop_melody()
    elif cmd in ('rain_dry', 'rain_wet'):
        return calibrate_rain('dry' if cmd == 'rain_dry' else 'wet')
    elif cmd == 'rain_reset':
        state['rain_cal_dry'] = None
        state['rain_cal_wet'] = None
        state['rain_calibrated'] = False
        if state['rain_val'] is not None:
            update_rain_detection(state['rain_val'], immediate=True)
        if not save_calibration():
            return False, 'No se pudo guardar el reinicio de calibracion'
    # Puerta eliminada: NO redirigir una orden de puerta a la ventana.
    elif cmd in ('door_open', 'door_close'):
        return False, 'Puerta eliminada; solo hay servo de ventana en GPIO13'
    else:
        return False, 'Comando desconocido'
    return True, 'OK'


set_rgb(0, 0, 0, 'OFF')
load_calibration()
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
try:
    wlan.config(pm=0xa11140)  # ESP32: desactivar ahorro Wi-Fi si lo admite
except Exception:
    pass

last_wifi_attempt = time.ticks_add(boot_time, -15000)
was_connected = False


def maintain_wifi(now):
    global last_wifi_attempt, was_connected
    connected = wlan.isconnected()
    state['wifi_connected'] = connected
    if connected:
        try:
            state['wifi_rssi'] = wlan.status('rssi')
        except Exception:
            state['wifi_rssi'] = None
        if not was_connected:
            was_connected = True
            ip = wlan.ifconfig()[0]
            print('Servidor disponible en http://' + ip)
            lcd_msg('Servidor:', ip)
    else:
        state['wifi_rssi'] = None
        if was_connected:
            was_connected = False
            state['wifi_reconnects'] += 1
            lcd_msg('WiFi perdido', 'Reconectando...')
        if time.ticks_diff(now, last_wifi_attempt) >= 15000:
            last_wifi_attempt = now
            try:
                wlan.active(True)
                wlan.connect(SSID, PASSWORD)
                print('Intentando reconectar WiFi...')
            except Exception as exc:
                print('Error de WiFi:', exc)


last_alarm_poll = boot_time
last_rfid_poll = boot_time
last_dht_poll = time.ticks_add(boot_time, -3000)
last_rain_poll = time.ticks_add(boot_time, -400)
last_wifi_poll = time.ticks_add(boot_time, -5000)
last_gc_poll = boot_time


def poll_alarm(now):
    global alarm_sounding, melody
    if not (state['gas_active'] or state['pir_active']):
        gas_danger = False
        pir_motion = False
    else:
        gas_danger = state['gas_active'] and (sensor_gas.value() == 0)
        pir_motion = (state['pir_active']
                      and time.ticks_diff(now, boot_time) > PIR_WARMUP_MS
                      and pir.value() == 1)
    state['gas_alert'] = bool(gas_danger)
    state['pir_alert'] = bool(pir_motion)
    if gas_danger or pir_motion:
        if state['auto_alarm']:
            if melody is not None:
                stop_melody()
            buzzer_on(1000 if gas_danger else 700)
            alarm_sounding = True
        if state['rgb'] != 'ALARMA':
            set_rgb(255, 0, 0, 'ALARMA')
    else:
        if alarm_sounding:
            buzzer_off()
            alarm_sounding = False
        if state['rgb'] == 'ALARMA':
            set_rgb(0, 0, 0, 'OFF')
    state['alarm_sounding'] = alarm_sounding


def poll_rfid():
    if not (state['rfid_active'] and rc522):
        return
    try:
        if rc522.PICC_IsNewCardPresent() and rc522.PICC_ReadCardSerial():
            uid_bytes = rc522.uid.uidByte
            uid_str = ''.join('{:02X}'.format(x) for x in uid_bytes)
            state['rfid_uid'] = uid_str
            state['rfid_access'] = ('Acceso OK' if es_autorizada(uid_bytes, uid_str)
                                    else 'Denegado')
            # No abrir ventana: la puerta y su servo ya no existen.
    except Exception as exc:
        print('Error RFID:', exc)


def send_response(conn, code, data):
    body = ujson.dumps(data).encode('utf-8')
    headers = ('HTTP/1.1 ' + code + '\r\n'
               'Content-Type: application/json; charset=utf-8\r\n'
               'Content-Length: ' + str(len(body)) + '\r\n'
               'Cache-Control: no-store\r\n'
               'Access-Control-Allow-Origin: *\r\n'
               'Access-Control-Allow-Private-Network: true\r\n'
               'Access-Control-Allow-Methods: GET, OPTIONS\r\n'
               'Access-Control-Allow-Headers: Content-Type\r\n'
               'Connection: close\r\n\r\n').encode('utf-8')
    # send() puede escribir solo parte de la respuesta en ciertos firmwares.
    for piece in (headers, body):
        offset = 0
        while offset < len(piece):
            written = conn.send(piece[offset:])
            if not written:
                raise OSError('Socket: escritura incompleta')
            offset += written


def service_request(server):
    try:
        conn, addr = server.accept()
    except OSError:
        return
    try:
        conn.settimeout(0.65)
        request = conn.recv(768).decode('utf-8', 'ignore')
        parts = request.split('\r\n', 1)[0].split(' ')
        if len(parts) < 2:
            return
        method, path = parts[0], parts[1]
        state['http_requests'] += 1
        if method == 'OPTIONS':
            send_response(conn, '200 OK', {'ok': True})
        elif method != 'GET':
            send_response(conn, '405 Method Not Allowed', {'ok': False, 'error': 'Solo GET'})
        elif path.split('?', 1)[0] in ('/api/status', '/api/diagnostics'):
            state['uptime_s'] = time.ticks_diff(time.ticks_ms(), boot_time) // 1000
            if path.startswith('/api/diagnostics'):
                send_response(conn, '200 OK', {
                    'ok': True, 'version': state['version'],
                    'wifi_connected': state['wifi_connected'],
                    'wifi_rssi': state['wifi_rssi'],
                    'wifi_reconnects': state['wifi_reconnects'],
                    'http_requests': state['http_requests'],
                    'uptime_s': state['uptime_s'],
                    'dht_ok': state['dht_ok'], 'dht_errors': state['dht_errors'],
                    'rain_ok': state['rain_ok'], 'rain_val': state['rain_val'],
                    'rain_detected': state['rain_detected'],
                    'rain_method': state['rain_method'],
                    'rain_calibrated': state['rain_calibrated'],
                    'window_pin': state['window_pin'],
                    'window': state['window'],
                    'auto_window_status': state['auto_window_status'],
                    'rfid_available': state['rfid_available'],
                    'free_mem': gc.mem_free() if hasattr(gc, 'mem_free') else None
                })
            else:
                send_response(conn, '200 OK', state)
        elif path.startswith('/api/cmd?c='):
            cmd = path.split('/api/cmd?c=', 1)[1].split('&', 1)[0]
            success, message = ejecutar_comando(cmd)
            send_response(conn, '200 OK' if success else '400 Bad Request',
                          {'ok': success, 'message': message})
        else:
            send_response(conn, '404 Not Found', {'ok': False, 'error': 'Ruta no encontrada'})
    except Exception as exc:
        print('Error HTTP:', exc)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def run():
    global last_rain_poll, last_dht_poll, last_alarm_poll
    global last_wifi_poll, last_rfid_poll, last_gc_poll
    lcd_msg('Bienvenido UdeM', 'Robotica SI15A')
    maintain_wifi(time.ticks_ms())
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('', 80))
    server.listen(4)
    server.setblocking(False)
    print('Smart Home: servidor HTTP escuchando en puerto 80')
    try:
        while True:
            now = time.ticks_ms()
            update_servo_release(now)
            if time.ticks_diff(now, last_wifi_poll) >= 3500:
                last_wifi_poll = now
                maintain_wifi(now)
            if time.ticks_diff(now, last_rain_poll) >= 350:
                last_rain_poll = now
                read_rain()
            if time.ticks_diff(now, last_dht_poll) >= 2600:
                last_dht_poll = now
                read_dht(now)
            if time.ticks_diff(now, last_alarm_poll) >= 220:
                last_alarm_poll = now
                poll_alarm(now)
            if time.ticks_diff(now, last_rfid_poll) >= 230:
                last_rfid_poll = now
                poll_rfid()
            advance_melody(now)
            service_request(server)
            if time.ticks_diff(now, last_gc_poll) >= 10000:
                last_gc_poll = now
                gc.collect()
            time.sleep_ms(18)
    finally:
        server.close()
        _stop_servo_pwm()
        buzzer_off()
        set_fan('OFF')


if __name__ == '__main__':
    run()