from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional


class TelemetryParser:
    @staticmethod
    def parse_frame(raw: str) -> Optional[Dict[str, Any]]:
        text = (raw or '').strip()
        if not text:
            return None

        if text.startswith('TEL:v1,'):
            parts = text[len('TEL:v1,'):].split(',')
            if len(parts) != 9:
                return None
            raw_distance, left, center, right, mode, movement, locked, host_active, valid = [part.strip() for part in parts]
            try:
                distance_valid = valid == '1' and raw_distance not in ('', 'NA', 'N/A')
                distance = float(raw_distance) if distance_valid else None
                if distance is not None and not 2 <= distance <= 200:
                    distance = None
                ir_values = [int(left), int(center), int(right)]
                if any(value not in (0, 1) for value in ir_values):
                    return None
                if mode not in ('locked', 'manual', 'line-follow', 'obstacle-avoid'):
                    return None
                if movement not in ('stop', 'forward', 'backward', 'left', 'right'):
                    return None
                if locked not in ('0', '1') or host_active not in ('0', '1') or valid not in ('0', '1'):
                    return None
                return {
                    'protocol': 'v1',
                    'distance_cm': distance,
                    'distance_valid': distance is not None,
                    'left_ir': ir_values[0],
                    'center_ir': ir_values[1],
                    'right_ir': ir_values[2],
                    'mode': mode,
                    'movement': movement,
                    'safety_locked': locked == '1',
                    'host_control_active': host_active == '1',
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                }
            except (TypeError, ValueError):
                return None

        # Backward-compatible parser for already deployed pre-v1 firmware.
        match = re.search(r'TELEMETRY:(.*)', text)
        if match:
            parts = match.group(1).strip().split(',')
            if len(parts) < 4:
                return None
            try:
                raw_distance = parts[0].strip()
                distance = float(raw_distance) if raw_distance not in ('', 'NA', 'N/A') else None
                if distance is not None and (distance < 0 or distance > 400):
                    distance = None
                ir_values = [part.strip().lower() for part in parts[1:4]]
                if any(value not in ('white', 'black', '0', '1') for value in ir_values):
                    return None
                return {
                    'distance_cm': distance,
                    'distance_valid': distance is not None,
                    'left_ir': ir_values[0], 'center_ir': ir_values[1], 'right_ir': ir_values[2],
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                }
            except ValueError:
                return None
        return None

    @staticmethod
    def parse_ack(raw: str) -> Optional[str]:
        text = (raw or '').strip()
        if text.startswith('ACK:'):
            return text.split(':', 1)[1].strip()
        return None
