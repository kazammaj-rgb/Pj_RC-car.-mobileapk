from __future__ import annotations

import json
import platform
import re
import shutil
import subprocess
from typing import Any, Dict, List


MAC_PATTERN = re.compile(r'(?i)(?:[0-9a-f]{2}:){5}[0-9a-f]{2}')


def _device(address: str, name: str) -> Dict[str, str]:
    return {'id': address.upper(), 'address': address.upper(), 'name': name.strip() or 'Unknown Bluetooth device'}


def _scan_linux(timeout_seconds: int) -> List[Dict[str, str]]:
    binary = shutil.which('bluetoothctl')
    if not binary:
        raise RuntimeError('Bluetooth discovery unavailable: install and enable BlueZ bluetoothctl on the gateway computer.')

    scan = subprocess.run(
        [binary, '--timeout', str(timeout_seconds), 'scan', 'on'],
        capture_output=True, text=True, timeout=timeout_seconds + 5, check=False,
    )
    output = f'{scan.stdout}\n{scan.stderr}'
    devices = {}
    # bluetoothctl emits these records while discovery is running. Use only
    # devices observed in the scan output, not its potentially stale cache.
    patterns = (
        re.compile(r'(?im)(?:\[NEW\]\s+|\[CHG\]\s+)?Device\s+((?:[0-9a-f]{2}:){5}[0-9a-f]{2})\s+(?:Name:\s*)?(.+?)\s*$'),
        re.compile(r'(?im)\[NEW\]\s+Device\s+((?:[0-9a-f]{2}:){5}[0-9a-f]{2})\s*$'),
    )
    for pattern in patterns:
        for match in pattern.finditer(output):
            name = match.group(2) if match.lastindex and match.lastindex >= 2 else ''
            item = _device(match.group(1), name)
            devices[item['id']] = item
    lower_output = output.lower()
    if any(marker in lower_output for marker in (
        'no default controller available', 'not authorized', 'permission denied',
        'operation not permitted', 'notready', 'controller is not powered',
    )):
        raise RuntimeError(output.strip() or 'Bluetooth permission denied or adapter unavailable.')
    if scan.returncode and not devices:
        detail = (scan.stderr or scan.stdout).strip()
        raise RuntimeError(detail or 'BlueZ scan failed. Check that the gateway Bluetooth adapter is powered and available.')
    return list(devices.values())


def _scan_macos(timeout_seconds: int) -> List[Dict[str, str]]:
    binary = shutil.which('blueutil')
    if not binary:
        raise RuntimeError('Bluetooth discovery unavailable: install blueutil on the macOS gateway (for example, with Homebrew).')
    result = subprocess.run(
        [binary, '--inquiry', str(timeout_seconds), '--format', 'json'],
        capture_output=True, text=True, timeout=timeout_seconds + 5, check=False,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or 'blueutil discovery failed.')
    if any(marker in (result.stderr or '').lower() for marker in ('not authorized', 'permission denied', 'not permitted')):
        raise RuntimeError((result.stderr or '').strip())
    try:
        raw = json.loads(result.stdout or '[]')
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'blueutil returned an unreadable discovery result: {exc}') from exc
    if isinstance(raw, dict):
        raw = raw.get('devices', [])
    devices = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        address = item.get('address') or item.get('addr') or item.get('mac')
        if address and MAC_PATTERN.fullmatch(str(address)):
            devices.append(_device(str(address), str(item.get('name') or '')))
    return devices


def scan_devices(timeout_seconds: int = 8) -> Dict[str, Any]:
    timeout_seconds = max(4, min(15, int(timeout_seconds)))
    system = platform.system().lower()
    try:
        if system == 'linux':
            devices = _scan_linux(timeout_seconds)
        elif system == 'darwin':
            devices = _scan_macos(timeout_seconds)
        else:
            raise RuntimeError(f'Bluetooth discovery is not implemented for gateway platform {platform.system() or "unknown"}.')
        return {'status': 'complete', 'platform': system, 'devices': devices, 'error': None}
    except (OSError, subprocess.TimeoutExpired, RuntimeError) as exc:
        return {'status': 'unavailable', 'platform': system, 'devices': [], 'error': str(exc)}


def connect_device(address: str) -> Dict[str, Any]:
    address = str(address or '').upper()
    if not MAC_PATTERN.fullmatch(address):
        return {'connected': False, 'error': 'Invalid Bluetooth device identifier.'}
    system = platform.system().lower()
    if system == 'linux':
        binary = shutil.which('bluetoothctl')
        command = [binary, 'connect', address] if binary else None
    elif system == 'darwin':
        binary = shutil.which('blueutil')
        command = [binary, '--connect', address] if binary else None
    else:
        command = None
    if not command:
        return {'connected': False, 'error': f'Bluetooth connection unavailable for platform {platform.system() or "unknown"} or required OS utility is missing.'}
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {'connected': False, 'error': str(exc)}
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        return {'connected': False, 'error': detail or 'The operating system could not connect to this device. Pair it with the gateway computer first if required.'}
    if system == 'linux':
        try:
            info = subprocess.run([binary, 'info', address], capture_output=True, text=True, timeout=8, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return {'connected': False, 'error': str(exc)}
        if not re.search(r'(?im)^\s*Connected:\s*yes\s*$', info.stdout or ''):
            detail = (info.stderr or info.stdout).strip()
            return {'connected': False, 'error': detail or 'BlueZ did not confirm that this Bluetooth device is connected.'}
    elif system == 'darwin':
        try:
            info = subprocess.run([binary, '--is-connected', address], capture_output=True, text=True, timeout=8, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return {'connected': False, 'error': str(exc)}
        if info.returncode or (info.stdout or '').strip() not in ('1', 'true', 'True'):
            detail = (info.stderr or info.stdout).strip()
            return {'connected': False, 'error': detail or 'macOS did not confirm that this Bluetooth device is connected.'}
    return {'connected': True, 'error': None}


def disconnect_device(address: str) -> Dict[str, Any]:
    address = str(address or '').upper()
    if not MAC_PATTERN.fullmatch(address):
        return {'disconnected': False, 'error': 'Invalid Bluetooth device identifier.'}
    system = platform.system().lower()
    binary = shutil.which('bluetoothctl' if system == 'linux' else 'blueutil') if system in ('linux', 'darwin') else None
    if not binary:
        return {'disconnected': False, 'error': 'The Bluetooth operating-system utility is unavailable.'}
    command = [binary, 'disconnect', address] if system == 'linux' else [binary, '--disconnect', address]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)
        if result.returncode:
            return {'disconnected': False, 'error': (result.stderr or result.stdout).strip() or 'The operating system could not disconnect this Bluetooth device.'}
        if system == 'linux':
            info = subprocess.run([binary, 'info', address], capture_output=True, text=True, timeout=8, check=False)
            if re.search(r'(?im)^\s*Connected:\s*yes\s*$', info.stdout or ''):
                return {'disconnected': False, 'error': 'BlueZ still reports this Bluetooth device as connected.'}
        else:
            info = subprocess.run([binary, '--is-connected', address], capture_output=True, text=True, timeout=8, check=False)
            if info.returncode or (info.stdout or '').strip() not in ('0', 'false', 'False'):
                return {'disconnected': False, 'error': (info.stderr or info.stdout).strip() or 'macOS did not confirm that this Bluetooth device disconnected.'}
        return {'disconnected': True, 'error': None}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {'disconnected': False, 'error': str(exc)}
