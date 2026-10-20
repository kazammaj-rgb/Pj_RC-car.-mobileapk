from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import firebase_admin
from firebase_admin import db


class FirebaseClient:
    def __init__(self, database_url: str, project_id: str, device_id: str):
        self.database_url = database_url or os.getenv('FIREBASE_DATABASE_URL', '')
        self.project_id = project_id
        self.device_id = device_id
        self.logger = logging.getLogger('firebase_client')
        self.app = None
        self.root = None
        self.connected = False
        self.last_error = None

    def _device_ref(self):
        return self.root.child('pirccar').child('devices').child(self.device_id)

    def _read(self, reference, fallback=None):
        try:
            value = reference.get()
            if self.connected:
                self.last_error = None
            return value
        except Exception as exc:  # pragma: no cover - requires Firebase outage/denial
            self.connected = False
            self.last_error = str(exc)
            self.logger.error('Firebase read failed: %s', exc)
            return fallback

    def _write(self, operation) -> bool:
        try:
            operation()
            if self.connected:
                self.last_error = None
            return True
        except Exception as exc:  # pragma: no cover - requires Firebase outage/denial
            self.connected = False
            self.last_error = str(exc)
            self.logger.error('Firebase write failed: %s', exc)
            return False

    def connect(self) -> bool:
        try:
            if not self.database_url:
                self.logger.warning('Firebase database URL is not configured; skipping connection.')
                self.root = None
                self.connected = False
                return False

            if not firebase_admin._apps:
                self.app = firebase_admin.initialize_app({'databaseURL': self.database_url})
            else:
                self.app = firebase_admin.get_app()
            self.root = db.reference('/', app=self.app)
            # Read a small device state node to verify credentials and database reachability.
            self._device_ref().child('state').get()
            self.connected = True
            self.last_error = None
            self.logger.info('Firebase connected for device %s', self.device_id)
            return True
        except Exception as exc:  # pragma: no cover
            self.logger.error('Firebase connection failed: %s', exc)
            self.root = None
            self.connected = False
            self.last_error = str(exc)
            return False

    def write_state(self, state: Dict[str, Any]) -> None:
        if not self.root:
            return
        self._write(lambda: self._device_ref().child('state').set(state))

    def write_telemetry(self, telemetry: Dict[str, Any]) -> None:
        if not self.root:
            return
        path = self._device_ref().child('telemetry')
        telemetry = dict(telemetry)
        telemetry['timestamp'] = datetime.now(timezone.utc).isoformat()
        self._write(lambda: path.push(telemetry))

    def write_event(self, event_type: str, message: str, status: str = 'info') -> None:
        if not self.root:
            return
        data = {
            'type': event_type,
            'message': message,
            'status': status,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }
        path = self._device_ref().child('events')
        self._write(lambda: path.push(data))

    def write_discovery(self, result: Dict[str, Any]) -> None:
        if not self.root:
            return
        data = dict(result)
        data['updated_at'] = datetime.now(timezone.utc).isoformat()
        reference = self._device_ref().child('control').child('discovery')
        self._write(lambda: reference.set(data))

    def read_command(self) -> Optional[Dict[str, Any]]:
        if not self.root:
            return None
        try:
            commands_ref = self._device_ref().child('commands')
            data = self._read(commands_ref)
            if not data:
                return None
            pending = [
                {'id': key, **value}
                for key, value in data.items()
                if isinstance(value, dict) and value.get('status') == 'pending'
            ] if isinstance(data, dict) else []
            if not pending:
                return None

            pending.sort(key=lambda item: (
                str(item.get('command', '')).lower() == 'emergency-stop',
                int(item.get('created_at_ms') or 0),
                int(item.get('command_seq') or 0),
                int(item.get('priority') or 0),
            ), reverse=True)
            selected = pending[0]
            selected_id = selected['id']
            if not self._write(lambda: commands_ref.child(selected_id).child('status').set('processing')):
                return None
            for stale in pending[1:]:
                self._write(lambda stale=stale: commands_ref.child(stale['id']).update({
                    'status': 'rejected',
                    'error': f'Superseded by newer or higher-priority command {selected_id}',
                }))
            return selected
        except Exception as exc:  # pragma: no cover
            self.logger.error('Read command failed: %s', exc)
            return None

    def update_command_status(self, command_id: str, status: str, **fields: Any) -> None:
        if not self.root or not command_id:
            return
        update = {'status': status, **fields}
        update['updated_at'] = datetime.now(timezone.utc).isoformat()
        reference = self._device_ref().child('commands').child(command_id)
        self._write(lambda: reference.update(update))

    def read_operators(self) -> Dict[str, Any]:
        if not self.root:
            return {}
        value = self._read(self._device_ref().child('operators'), {})
        return value if isinstance(value, dict) else {}

    def read_control_request(self) -> Optional[Dict[str, Any]]:
        if not self.root:
            return None
        value = self._read(self._device_ref().child('control').child('request'))
        if isinstance(value, dict) and value.get('status') == 'pending':
            return value
        return None

    def update_control_request(self, status: str, **fields: Any) -> None:
        if not self.root:
            return
        reference = self._device_ref().child('control').child('request')
        self._write(lambda: reference.update({
            'status': status,
            'updated_at': datetime.now(timezone.utc).isoformat(),
            **fields,
        }))
