import unittest
from unittest.mock import patch
from types import SimpleNamespace

from gateway.bluetooth_discovery import _scan_linux, connect_device, disconnect_device, scan_devices


class BluetoothDiscoveryTests(unittest.TestCase):
    @patch('gateway.bluetooth_discovery.subprocess.run')
    @patch('gateway.bluetooth_discovery.shutil.which', return_value='/usr/bin/bluetoothctl')
    def test_linux_scan_returns_only_devices_reported_during_scan(self, _which, run):
        run.return_value = SimpleNamespace(
            stdout='[NEW] Device 00:11:22:33:44:55 HC-06\n[CHG] Device 00:11:22:33:44:66 Name: Phone',
            stderr='', returncode=0,
        )
        devices = _scan_linux(8)
        self.assertEqual([device['id'] for device in devices], ['00:11:22:33:44:55', '00:11:22:33:44:66'])
        self.assertEqual(devices[0]['name'], 'HC-06')

    @patch('gateway.bluetooth_discovery.subprocess.run')
    def test_invalid_device_identifier_is_rejected_without_os_connect(self, run):
        result = connect_device('not-a-device')
        self.assertFalse(result['connected'])
        run.assert_not_called()

    def test_invalid_disconnect_identifier_is_rejected(self):
        result = disconnect_device('not-a-device')
        self.assertFalse(result['disconnected'])

    @patch('gateway.bluetooth_discovery.shutil.which', return_value=None)
    @patch('gateway.bluetooth_discovery.platform.system', return_value='Darwin')
    def test_macos_without_blueutil_reports_unavailable_without_devices(self, _system, _which):
        result = scan_devices()
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(result['devices'], [])
        self.assertIn('install blueutil', result['error'])

    @patch('gateway.bluetooth_discovery.platform.system', return_value='Plan9')
    def test_unsupported_platform_reports_discovery_unavailable(self, _system):
        result = scan_devices()
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(result['devices'], [])
        self.assertIn('not implemented', result['error'])


if __name__ == '__main__':
    unittest.main()
