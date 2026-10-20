import unittest
from datetime import datetime, timedelta, timezone

from gateway.command_router import CommandRouter
from gateway.bluetooth_serial import BluetoothSerial
from gateway.telemetry_parser import TelemetryParser


class GatewayCoreTests(unittest.TestCase):
    @staticmethod
    def make_command(command='forward', **overrides):
        command_data = {
            'command': command,
            'command_id': 'test-command-1',
            'status': 'pending',
            'created_at_ms': int(datetime.now(timezone.utc).timestamp() * 1000),
            'expires_at': (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat(),
        }
        command_data.update(overrides)
        return command_data

    def test_valid_command_is_accepted(self):
        router = CommandRouter()
        ok, error = router.validate(self.make_command())
        self.assertTrue(ok)
        self.assertIsNone(error)

    def test_invalid_command_is_rejected(self):
        router = CommandRouter()
        ok, error = router.validate(self.make_command('spin-around'))
        self.assertFalse(ok)
        self.assertIn('Unsupported', error or '')

    def test_commands_encode_to_existing_firmware_protocol(self):
        router = CommandRouter()
        expected = {
            'forward': '%F#', 'backward': '%B#', 'left': '%L#', 'right': '%R#',
            'stop': '%S#', 'emergency-stop': '%E#', 'line-follow': '%T#',
            'obstacle-avoid': '%A#', 'rearm': '%K#',
        }
        self.assertEqual({name: router.encode(name) for name in expected}, expected)

    def test_expired_command_is_rejected(self):
        router = CommandRouter()
        expired = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        ok, error = router.validate(self.make_command(expires_at=expired))
        self.assertFalse(ok)
        self.assertEqual(error, 'Expired command')

    def test_command_without_id_or_expiry_is_rejected(self):
        router = CommandRouter()
        command = self.make_command()
        command.pop('command_id')
        ok, error = router.validate(command)
        self.assertFalse(ok)
        self.assertEqual(error, 'Missing command ID')

    def test_processed_command_id_cannot_be_replayed(self):
        router = CommandRouter()
        command = self.make_command()
        self.assertFalse(router.should_reject_duplicate(command))
        self.assertTrue(router.should_reject_duplicate(command))

    def test_telemetry_frame_is_parsed(self):
        data = TelemetryParser.parse_frame('TELEMETRY:18.0,white,black,white')
        self.assertIsNotNone(data)
        self.assertIn('distance_cm', data)

    def test_versioned_firmware_telemetry_is_parsed(self):
        data = TelemetryParser.parse_frame('TEL:v1,23,1,0,1,line-follow,left,0,1,1')
        self.assertIsNotNone(data)
        self.assertEqual(data['distance_cm'], 23)
        self.assertEqual(data['left_ir'], 1)
        self.assertEqual(data['mode'], 'line-follow')
        self.assertTrue(data['host_control_active'])

    def test_versioned_invalid_distance_stays_unavailable(self):
        data = TelemetryParser.parse_frame('TEL:v1,NA,1,0,1,manual,stop,0,0,0')
        self.assertIsNotNone(data)
        self.assertIsNone(data['distance_cm'])
        self.assertFalse(data['distance_valid'])

    def test_versioned_bad_mode_is_rejected(self):
        self.assertIsNone(TelemetryParser.parse_frame('TEL:v1,23,1,0,1,pretend,stop,0,0,1'))

    def test_invalid_distance_is_unavailable_without_dropping_ir_data(self):
        data = TelemetryParser.parse_frame('TELEMETRY:999,white,black,white')
        self.assertIsNotNone(data)
        self.assertIsNone(data['distance_cm'])
        self.assertEqual(data['center_ir'], 'black')

    def test_invalid_ir_frame_is_rejected(self):
        self.assertIsNone(TelemetryParser.parse_frame('TELEMETRY:18.0,yes,black,white'))

    def test_ack_is_parsed(self):
        ack = TelemetryParser.parse_ack('ACK:FORWARD')
        self.assertEqual(ack, 'FORWARD')

    def test_bluetooth_reader_retains_partial_line(self):
        class FakeSerial:
            is_open = True

            def __init__(self):
                self.chunks = [b'ACK:FOR', b'WARD\n']

            def read(self, size):
                return self.chunks.pop(0) if self.chunks else b''

        link = BluetoothSerial('fake', timeout=0)
        link.connection = FakeSerial()
        self.assertIsNone(link.read_line())
        self.assertEqual(link.read_line(), 'ACK:FORWARD')

    def test_bluetooth_reader_splits_multiple_frames(self):
        class FakeSerial:
            is_open = True

            def __init__(self):
                self.chunks = [b'ACK:STOP\nACK:REARM\n']

            def read(self, size):
                return self.chunks.pop(0) if self.chunks else b''

        link = BluetoothSerial('fake', timeout=0)
        link.connection = FakeSerial()
        self.assertEqual(link.read_line(), 'ACK:STOP')
        self.assertEqual(link.read_line(), 'ACK:REARM')


if __name__ == '__main__':
    unittest.main()
