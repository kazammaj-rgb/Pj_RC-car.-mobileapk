from __future__ import annotations

import logging
import time
from typing import Optional

try:
    import serial
except ModuleNotFoundError:  # Allow parser/reader unit tests without gateway extras installed.
    serial = None


class BluetoothSerial:
    def __init__(self, port: str, baudrate: int = 9600, timeout: float = 1.0):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.connection = None
        self.rx_buffer = bytearray()
        self.logger = logging.getLogger('bluetooth_serial')

    def connect(self) -> bool:
        if self.is_connected:
            return True
        if serial is None:
            self.logger.error('pySerial is not installed; install gateway/requirements.txt')
            return False
        try:
            self.connection = serial.Serial(self.port, self.baudrate, timeout=self.timeout, write_timeout=1.0)
            time.sleep(1)
            # Discard bytes buffered across a reconnect so stale acknowledgements
            # or telemetry are never mistaken for the current session.
            self.connection.reset_input_buffer()
            self.connection.reset_output_buffer()
            self.rx_buffer.clear()
            self.logger.info('Connected to HC-06 on %s', self.port)
            return True
        except Exception as exc:  # pragma: no cover
            self.logger.error('Bluetooth connect failed: %s', exc)
            self.connection = None
            return False

    def disconnect(self) -> None:
        if self.connection and self.connection.is_open:
            try:
                self.connection.close()
            except Exception as exc:  # pragma: no cover
                self.logger.warning('Bluetooth close error: %s', exc)
        self.connection = None
        self.rx_buffer.clear()

    def write_command(self, command: str) -> bool:
        if not self.connection or not self.connection.is_open:
            return False
        try:
            payload = f"{command}\n".encode('utf-8')
            self.connection.write(payload)
            return True
        except Exception as exc:  # pragma: no cover
            self.logger.error('Command write error: %s', exc)
            self.disconnect()
            return False

    def read_line(self) -> Optional[str]:
        if not self.connection or not self.connection.is_open:
            return None
        try:
            newline = self.rx_buffer.find(b'\n')
            if newline < 0:
                chunk = self.connection.read(128)
                if chunk:
                    self.rx_buffer.extend(chunk)
                newline = self.rx_buffer.find(b'\n')
            if newline < 0:
                if len(self.rx_buffer) > 512:
                    self.logger.error('Discarding oversized Bluetooth response without a line delimiter')
                    self.rx_buffer.clear()
                return None
            raw = bytes(self.rx_buffer[:newline])
            del self.rx_buffer[:newline + 1]
            return raw.decode('utf-8', errors='replace').strip()
        except Exception as exc:  # pragma: no cover
            self.logger.error('Read error: %s', exc)
            self.disconnect()
            return None

    @property
    def is_connected(self) -> bool:
        return bool(self.connection and self.connection.is_open)
