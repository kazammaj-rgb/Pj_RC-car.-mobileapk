from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Dict, Optional


class CommandRouter:
    VALID_COMMANDS = {
        'forward': '%F#',
        'backward': '%B#',
        'left': '%L#',
        'right': '%R#',
        'stop': '%S#',
        'line-follow': '%T#',
        'obstacle-avoid': '%A#',
        'emergency-stop': '%E#',
        'rearm': '%K#',
    }

    def __init__(self):
        self.logger = logging.getLogger('command_router')
        self.processed_ids = set()

    def validate(self, command: Dict) -> tuple[bool, Optional[str]]:
        command_id = str(command.get('command_id') or command.get('id') or '').strip()
        if not command_id:
            return False, 'Missing command ID'
        if command_id in self.processed_ids:
            return False, 'Duplicate command ID'

        command_name = str(command.get('command', '')).strip().lower()
        if not command_name:
            return False, 'Missing command name'
        if command_name not in self.VALID_COMMANDS:
            return False, f'Unsupported command: {command_name}'

        expires_at = command.get('expires_at')
        if not expires_at:
            return False, 'Missing expiration timestamp'
        try:
            expires = datetime.fromisoformat(str(expires_at).replace('Z', '+00:00'))
            if expires.tzinfo is None:
                return False, 'Expiration timestamp must include a timezone'
            now = datetime.now(timezone.utc)
            if now > expires:
                return False, 'Expired command'
            if (expires - now).total_seconds() > 30:
                return False, 'Command expiration exceeds 30-second limit'
        except ValueError:
            return False, 'Malformed expiration timestamp'

        try:
            created_at_ms = int(command['created_at_ms'])
        except (KeyError, TypeError, ValueError):
            return False, 'Missing or malformed creation time'
        if created_at_ms > int(datetime.now(timezone.utc).timestamp() * 1000) + 1000:
            return False, 'Creation time is in the future'

        if command.get('status') not in ('pending', 'processing'):
            return False, 'Command is not pending'

        return True, None

    def encode(self, command_name: str) -> str:
        key = str(command_name).strip().lower()
        return self.VALID_COMMANDS.get(key, '%S#')

    def should_reject_duplicate(self, command: Dict) -> bool:
        command_id = str(command.get('command_id') or command.get('id') or '').strip()
        if not command_id or command_id in self.processed_ids:
            return True
        self.processed_ids.add(command_id)
        return False
