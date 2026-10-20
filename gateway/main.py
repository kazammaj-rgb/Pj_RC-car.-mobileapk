from __future__ import annotations

import logging
import json
import os
import signal
import sys
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from bluetooth_serial import BluetoothSerial
from bluetooth_discovery import connect_device as connect_bluetooth_device
from bluetooth_discovery import disconnect_device as disconnect_bluetooth_device
from bluetooth_discovery import scan_devices
from command_router import CommandRouter
from firebase_client import FirebaseClient
from safety import SafetyState
from telemetry_parser import TelemetryParser


load_dotenv(Path(__file__).with_name('.env'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('gateway')


class Gateway:
    def __init__(self):
        self.device_id = os.getenv('DEVICE_ID', 'pirccar-001')
        self.database_url = os.getenv('FIREBASE_DATABASE_URL', '')
        self.bluetooth_port = os.getenv('BT_PORT', '/dev/rfcomm0')
        try:
            self.bluetooth_device_ports = json.loads(os.getenv('BT_DEVICE_PORTS', '{}'))
        except json.JSONDecodeError:
            logger.warning('BT_DEVICE_PORTS must be a JSON object; ignoring invalid mapping')
            self.bluetooth_device_ports = {}
        if not isinstance(self.bluetooth_device_ports, dict):
            self.bluetooth_device_ports = {}
        self.bluetooth_device_ports = {
            str(key).upper() if ':' in str(key) else str(key).lower(): str(value)
            for key, value in self.bluetooth_device_ports.items()
        }
        self.bluetooth_device_name = os.getenv('BT_DEVICE_NAME', 'HC-06').strip().lower()
        self.bluetooth_baud = int(os.getenv('BT_BAUD', '9600'))
        self.heartbeat_interval = max(1, int(os.getenv('HEARTBEAT_SECONDS', '2')))
        self.default_operator_timeout_ms = max(1000, int(os.getenv('OPERATOR_TIMEOUT_MS', '5000')))
        self.reconnect_interval = max(1, float(os.getenv('RECONNECT_INTERVAL_SECONDS', '5')))
        self.firebase_retry_interval = max(1, float(os.getenv('FIREBASE_RETRY_SECONDS', '5')))
        self.auto_reconnect = os.getenv('AUTO_RECONNECT', 'false').lower() == 'true'
        self.keepalive_interval = 0.7
        self.router = CommandRouter()
        self.safety = SafetyState()
        self.bluetooth = BluetoothSerial(self.bluetooth_port, self.bluetooth_baud, timeout=0.1)
        self.firebase = FirebaseClient(self.database_url, os.getenv('FIREBASE_PROJECT_ID', ''), self.device_id)
        self.running = True
        self.mode = 'unknown'
        self.active_movement = None
        self.reported_movement = 'stop'
        self.expected_ack = None
        self.last_ack_at = 0.0
        self.last_heartbeat_write = 0.0
        self.last_reconnect_attempt = 0.0
        self.last_firebase_retry = 0.0
        self.firebase_outage_latched = False
        self.discovery_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='bluetooth-discovery')
        self.discovery_future: Optional[Future] = None
        self.discovery_request_id = None
        self.discovered_devices = {}
        self.connected_device_id = None
        self.last_keepalive = 0.0
        self.last_operator = None
        self.operator_timeout_ms = self.default_operator_timeout_ms
        self.drive_ready = False
        self.last_serial_at = 0.0

    def connect(self) -> None:
        self.firebase.connect()
        self.safety.require_rearm()
        self.connect_bluetooth()
        self.firebase.write_event('connection', 'Gateway process started; explicit re-arm required', 'warning')
        self.write_state(force=True)

    def connect_bluetooth(self) -> bool:
        connected = self.bluetooth.connect()
        self.safety.connection_ok = connected
        if connected:
            self.drive_ready = False
            self.bluetooth.write_command('%I#')
            self.bluetooth.write_command('%E#')
            self.mode = 'unknown'
            self.firebase.write_event('connection', f'Bluetooth serial connected on {self.bluetooth_port}', 'info')
        else:
            self.safety.last_error = f'Bluetooth connection failed on {self.bluetooth_port}'
        return connected

    def active_operator(self):
        now_ms = int(time.time() * 1000)
        operators = self.firebase.read_operators()
        fresh = []
        for user_id, data in operators.items():
            if not isinstance(data, dict):
                continue
            heartbeat = int(data.get('heartbeat_at_ms') or 0)
            timeout_ms = max(1000, min(30000, int(data.get('heartbeat_timeout_ms') or self.default_operator_timeout_ms)))
            if 0 <= now_ms - heartbeat <= timeout_ms:
                fresh.append((heartbeat, user_id, data, timeout_ms))
        if not fresh:
            return None
        _, user_id, data, timeout_ms = max(fresh, key=lambda row: row[0])
        self.operator_timeout_ms = timeout_ms
        self.auto_reconnect = bool(data.get('auto_reconnect', self.auto_reconnect))
        self.last_operator = {'uid': user_id, **data}
        return self.last_operator

    def stop_vehicle(self, reason: str, lock: bool = False) -> None:
        if lock:
            self.safety.require_rearm()
        if self.bluetooth.is_connected:
            if self.expected_ack:
                self.firebase.update_command_status(self.expected_ack['id'], 'failed', error=f'Superseded by safety stop: {reason}')
                self.expected_ack = None
            stop_frame = '%E#' if lock else '%S#'
            if self.bluetooth.write_command(stop_frame):
                self.mode = 'unknown'
                self.active_movement = None
                self.firebase.write_event('safety', f'STOP sent: {reason}', 'warning' if lock else 'info')
            else:
                self.safety.last_error = f'Unable to send STOP: {reason}'
                self.safety.require_rearm()
        else:
            self.safety.last_error = f'STOP could not be transmitted; Bluetooth unavailable: {reason}'
            self.safety.require_rearm()

    def process_control_request(self) -> None:
        request = self.firebase.read_control_request()
        if not request:
            return
        action = request.get('action')
        if action == 'scan':
            if self.discovery_future and not self.discovery_future.done():
                self.firebase.update_control_request('failed', error='A Bluetooth scan is already running')
                return
            self.discovery_request_id = request.get('request_id')
            self.firebase.update_control_request('scanning')
            self.firebase.write_discovery({'status': 'scanning', 'platform': None, 'devices': [], 'error': None})
            self.discovery_future = self.discovery_executor.submit(scan_devices)
        elif action == 'connect':
            selected_device_id = str(request.get('device_id') or '').upper()
            if selected_device_id:
                device = self.discovered_devices.get(selected_device_id)
                if not device:
                    self.firebase.update_control_request('failed', error='Select a device from the latest gateway scan and try again')
                    return
                serial_port = device.get('serial_port')
                if not serial_port:
                    self.firebase.update_control_request('failed', error='No serial port is mapped to this Bluetooth device. Configure BT_DEVICE_PORTS or BT_DEVICE_NAME and BT_PORT, then scan again.')
                    return
                if self.bluetooth.is_connected and self.bluetooth.port != serial_port:
                    self.firebase.update_control_request('failed', error='The gateway already has another serial port open. Disconnect it before selecting a different device.')
                    return
                if self.bluetooth.is_connected and self.connected_device_id and self.connected_device_id != selected_device_id:
                    self.firebase.update_control_request('failed', error='A different discovered Bluetooth device is already connected. Disconnect it before selecting another device.')
                    return
                self.bluetooth.port = serial_port
                os_result = connect_bluetooth_device(selected_device_id)
                if not os_result['connected']:
                    self.firebase.update_control_request('failed', error=os_result['error'])
                    return
                result = self.connect_bluetooth()
                if result:
                    self.connected_device_id = selected_device_id
                else:
                    disconnect_bluetooth_device(selected_device_id)
            else:
                # Preserve the existing Connections page behavior for the
                # gateway's configured serial port.
                result = self.connect_bluetooth()
            self.firebase.update_control_request(
                'completed' if result else 'failed',
                error=None if result else self.safety.last_error,
                device_id=selected_device_id or None,
            )
        elif action == 'disconnect':
            self.stop_vehicle('operator requested gateway disconnect', lock=True)
            if self.bluetooth.is_connected:
                self.bluetooth.disconnect()
            disconnect_result = {'disconnected': True, 'error': None}
            if self.connected_device_id:
                disconnect_result = disconnect_bluetooth_device(self.connected_device_id)
                self.connected_device_id = None
            self.safety.connection_ok = False
            self.firebase.update_control_request(
                'completed' if disconnect_result['disconnected'] else 'failed',
                error=disconnect_result['error'],
            )
        else:
            self.firebase.update_control_request('rejected', error='Unsupported gateway action')

    def complete_bluetooth_scan(self) -> None:
        if not self.discovery_future or not self.discovery_future.done():
            return
        future = self.discovery_future
        self.discovery_future = None
        try:
            result = future.result()
            self.discovered_devices = {}
            for item in result.get('devices', []):
                address = str(item.get('id', '')).upper()
                name = str(item.get('name', '')).strip()
                serial_port = self.bluetooth_device_ports.get(address) or self.bluetooth_device_ports.get(name.lower())
                if not serial_port and name.lower() == self.bluetooth_device_name:
                    serial_port = self.bluetooth_port
                item['serial_port'] = serial_port
                self.discovered_devices[address] = item
            self.firebase.write_discovery(result)
            self.firebase.update_control_request(
                'completed' if result.get('status') == 'complete' else 'failed',
                error=result.get('error'),
                devices_count=len(result.get('devices', [])),
            )
        except Exception as exc:  # pragma: no cover - unexpected platform failure
            logger.exception('Bluetooth discovery failed: %s', exc)
            result = {'status': 'unavailable', 'devices': [], 'error': str(exc)}
            self.discovered_devices = {}
            self.firebase.write_discovery(result)
            self.firebase.update_control_request('failed', error=str(exc))

    def process_command(self) -> None:
        command = self.firebase.read_command()
        if not command:
            return
        command_id = str(command.get('command_id') or command.get('id') or '')
        name = str(command.get('command', '')).lower()
        safety_command = name in ('stop', 'emergency-stop', 'rearm')
        if self.expected_ack and not safety_command:
            self.firebase.update_command_status(command_id, 'pending', error=None)
            return
        if self.expected_ack and safety_command:
            self.firebase.update_command_status(self.expected_ack['id'], 'failed', error=f'Superseded by safety command {name}')
            self.expected_ack = None
        valid, error = self.router.validate(command)
        if not valid:
            self.firebase.update_command_status(command_id, 'rejected', error=error)
            self.firebase.write_event('command', f'Rejected command {command_id}: {error}', 'warning')
            return

        if self.safety.emergency_locked and name not in ('emergency-stop', 'rearm'):
            self.firebase.update_command_status(command_id, 'rejected', error='Emergency safety lock is active')
            return
        if name in ('forward', 'backward', 'left', 'right', 'line-follow', 'obstacle-avoid'):
            if not self.drive_ready:
                self.firebase.update_command_status(command_id, 'rejected', error='Arduino motor driver is not configured and ready')
                return
            operator = self.active_operator()
            if not operator or operator.get('uid') != command.get('requested_by'):
                self.firebase.update_command_status(command_id, 'rejected', error='No current operator heartbeat')
                return
        if name == 'emergency-stop':
            self.safety.set_emergency_lock(True)
            self.active_movement = None
        if not self.bluetooth.is_connected:
            self.firebase.update_command_status(command_id, 'failed', error='HC-06 Bluetooth is not connected')
            if name == 'emergency-stop':
                self.safety.last_error = 'Emergency stop could not be transmitted because Bluetooth is unavailable'
            return

        if name in ('stop', 'emergency-stop', 'line-follow', 'obstacle-avoid', 'rearm'):
            self.active_movement = None

        encoded = self.router.encode(name)
        if not self.bluetooth.write_command(encoded):
            self.firebase.update_command_status(command_id, 'failed', error='Serial write failed')
            self.safety.last_error = 'Serial write failed'
            self.safety.require_rearm()
            return

        self.router.should_reject_duplicate(command)
        self.expected_ack = {'id': command_id, 'command': name, 'deadline': time.monotonic() + 2.0}
        self.firebase.update_command_status(command_id, 'sent')
        if name in ('forward', 'backward', 'left', 'right'):
            self.active_movement = name
        elif name in ('stop', 'emergency-stop', 'rearm'):
            self.active_movement = None
        self.firebase.write_event('command', f'Command transmitted to Arduino: {name}', 'pending')

    def process_serial(self) -> None:
        response = self.bluetooth.read_line()
        if not response:
            return
        self.last_serial_at = time.monotonic()
        logger.info('Received serial frame: %s', response)
        ack = TelemetryParser.parse_ack(response)
        if ack:
            self.last_ack_at = time.monotonic()
            if ack == 'BOOT_READY':
                self.drive_ready = True
            elif ack == 'BOOT_MOTOR_UNCONFIGURED':
                self.drive_ready = False
                self.safety.last_error = 'Motor pin mapping is not configured in firmware'
            elif ack == 'EMERGENCY_STOP':
                self.safety.set_emergency_lock(True)
                self.mode = 'stop'
            elif ack == 'REARM':
                self.safety.mark_rearm()
                self.mode = 'manual'
            elif ack in ('STOP', 'WATCHDOG'):
                self.mode = 'manual' if ack == 'STOP' else 'unknown'
                self.active_movement = None
                if ack == 'WATCHDOG':
                    self.safety.require_rearm()
            if self.expected_ack:
                expected = self.expected_ack
                expected_ack = {
                    'forward': 'FORWARD', 'backward': 'BACKWARD', 'left': 'LEFT', 'right': 'RIGHT',
                    'stop': 'STOP', 'line-follow': 'LINE_FOLLOW', 'obstacle-avoid': 'OBSTACLE_AVOID',
                    'emergency-stop': 'EMERGENCY_STOP', 'rearm': 'REARM',
                }.get(expected['command'])
                if ack == expected_ack:
                    self.firebase.update_command_status(expected['id'], 'acknowledged', arduino_ack=ack)
                    self.firebase.write_event('ack', f'Arduino acknowledged {expected["command"]}', 'success')
                    self.mode = {
                        'forward': 'manual', 'backward': 'manual', 'left': 'manual', 'right': 'manual',
                        'stop': 'manual', 'line-follow': 'line-follow', 'obstacle-avoid': 'obstacle-avoid',
                        'emergency-stop': 'stop', 'rearm': 'manual',
                    }.get(expected['command'], self.mode)
                    self.expected_ack = None
                elif ack == 'HARDWARE_NOT_CONFIGURED':
                    self.drive_ready = False
                    self.active_movement = None
                    self.firebase.update_command_status(expected['id'], 'failed', arduino_ack=ack, error='Firmware has no verified motor pin configuration')
                    self.expected_ack = None
                elif ack in ('LOCKED', 'UNKNOWN'):
                    self.firebase.update_command_status(expected['id'], 'rejected', arduino_ack=ack, error=f'Arduino replied {ack}')
                    if ack == 'LOCKED':
                        self.safety.require_rearm()
                    self.expected_ack = None
            self.write_state(force=True)
        telemetry = TelemetryParser.parse_frame(response)
        if telemetry:
            if telemetry.get('mode'):
                self.mode = telemetry['mode']
                self.reported_movement = telemetry.get('movement', 'stop')
                self.active_movement = self.reported_movement if telemetry.get('host_control_active') else None
                # Only an explicit REARM acknowledgement clears this gateway latch.
                if telemetry.get('safety_locked'):
                    self.safety.require_rearm()
                self.write_state(force=True)
            self.firebase.write_telemetry(telemetry)

    def write_state(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_heartbeat_write < self.heartbeat_interval:
            return
        bluetooth_connected = self.bluetooth.is_connected
        arduino_responsive = bluetooth_connected and now - self.last_serial_at < 15
        self.safety.connection_ok = bluetooth_connected
        self.safety.set_heartbeat(bluetooth_connected)
        self.firebase.write_state({
            # A fresh state heartbeat proves the gateway process is alive;
            # Bluetooth and Arduino health have separate component fields.
            'status': 'online',
            'mode': self.mode,
            'components': {
                'gateway': 'online',
                'firebase': 'connected' if self.firebase.connected else 'unavailable',
                'bluetooth': 'Connected' if bluetooth_connected else 'Unavailable',
                'arduino': 'Responsive' if arduino_responsive else 'Unknown',
            },
            'capabilities': {'drive_ready': self.drive_ready},
            'control': {'active': bool(self.reported_movement != 'stop' or self.mode in ('line-follow', 'obstacle-avoid'))},
            'heartbeat': datetime.now(timezone.utc).isoformat(),
            'safety': self.safety.to_dict(),
        })
        self.last_heartbeat_write = now

    def loop(self) -> None:
        while self.running:
            try:
                if not self.firebase.connected and time.monotonic() - self.last_firebase_retry >= self.firebase_retry_interval:
                    self.last_firebase_retry = time.monotonic()
                    if self.firebase.connect():
                        self.safety.require_rearm()
                        self.stop_vehicle('Firebase connection recovered; explicit re-arm required', lock=True)
                        self.firebase_outage_latched = True
                        self.firebase.write_event('connection', 'Firebase connection recovered; movement remains locked', 'warning')
                        self.write_state(force=True)

                self.process_serial()
                self.complete_bluetooth_scan()
                if self.firebase.connected:
                    self.process_control_request()
                    self.process_command()
                elif not self.firebase_outage_latched:
                    # A cloud outage removes remote operator supervision. Stop
                    # locally and require explicit re-arm after connectivity returns.
                    self.stop_vehicle('Firebase unavailable; explicit re-arm required', lock=True)
                    self.firebase_outage_latched = True

                operator = self.active_operator() if self.firebase.connected else None
                autonomous = self.mode in ('line-follow', 'obstacle-avoid')
                if self.firebase.connected and (self.active_movement or autonomous):
                    if not operator or (self.active_movement and operator.get('active_command') != self.active_movement):
                        self.stop_vehicle('operator heartbeat expired or released control', lock=not bool(operator))
                    elif time.monotonic() - self.last_keepalive >= self.keepalive_interval and self.bluetooth.is_connected:
                        if not self.bluetooth.write_command('%H#'):
                            self.stop_vehicle('serial keepalive failed', lock=True)
                        self.last_keepalive = time.monotonic()

                if self.expected_ack and time.monotonic() > self.expected_ack['deadline']:
                    pending = self.expected_ack
                    self.firebase.update_command_status(pending['id'], 'failed', error='Arduino acknowledgement timeout')
                    self.expected_ack = None
                    self.safety.last_error = 'Arduino acknowledgement timeout'
                    self.stop_vehicle('Arduino acknowledgement timeout', lock=True)

                if not self.bluetooth.is_connected:
                    self.safety.connection_ok = False
                    self.drive_ready = False
                    if self.auto_reconnect and time.monotonic() - self.last_reconnect_attempt >= self.reconnect_interval:
                        self.last_reconnect_attempt = time.monotonic()
                        self.connect_bluetooth()
                self.write_state()
            except KeyboardInterrupt:
                break
            except Exception as exc:  # pragma: no cover
                logger.exception('Gateway loop failure: %s', exc)
                self.safety.last_error = str(exc)
                self.stop_vehicle(f'gateway loop failure: {exc}', lock=True)
                self.firebase.write_event('gateway', f'Gateway loop failure: {exc}', 'error')
            time.sleep(0.05)

    def shutdown(self) -> None:
        self.running = False
        self.stop_vehicle('gateway shutdown', lock=True)
        self.bluetooth.disconnect()
        self.write_state(force=True)
        self.firebase.write_event('connection', 'Gateway shutdown', 'info')
        self.discovery_executor.shutdown(wait=False, cancel_futures=True)


if __name__ == '__main__':
    gateway = Gateway()

    def stop_handler(signum, frame):
        gateway.shutdown()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)

    try:
        gateway.connect()
        gateway.loop()
    except SystemExit:
        pass
    finally:
        gateway.shutdown()
        sys.exit(0)
