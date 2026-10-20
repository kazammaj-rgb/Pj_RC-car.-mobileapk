# Testing Guide

## Frontend checks

- Verify direct URLs `#overview`, `#dashboard`, `#controls`, `#sensors`, `#connections`, `#logs`, `#settings`, `#how-it-works`, and `#docs`; only the matching view should be visible.
- Verify missing/unknown hashes fall back to Overview, and browser refresh/back/forward restore the corresponding view and active navigation state.
- Check the persistent navigation and each view at desktop and mobile widths. Confirm switching views while holding a drive control sends the release STOP and does not clear an emergency lock.
- Navigation loads without broken links.
- Buttons and modes respond to pointer events.
- Theme persistence is retained in localStorage.
- Logs export to CSV.
- Emergency stop remains pending until gateway and Arduino confirmation is received.
- Stale telemetry changes to unavailable.
- Controller directions use pointer capture and request STOP on release, cancel, focus loss, hidden tab, view change, or a lost ready connection.
- Verify the controller mode labels follow reported Arduino mode; selecting an active autonomous mode sends `%S#` to exit it.
- Verify the device dialog reports gateway unavailable, discovery unavailable, empty results, permission errors, connection failure, and actual Bluetooth/Arduino state distinctly.
- Verify Cancel clears the selection and UI timer without issuing a connect or disconnect request; an existing serial connection remains open.
- On the gateway host, verify `bluetoothctl`/`blueutil` scan output against nearby devices and confirm the selected device's configured serial port before connecting.

## Gateway checks

- Serial frame parsing is valid.
- Invalid commands are rejected.
- Payloads with expired timestamps are refused.
- Reconnection and heartbeat handling remain stable.
- Versioned `TEL:v1` telemetry validates mode, movement, sensor bits, lock state, and invalid-distance handling.
- Serial reader retains partial lines across Bluetooth reads and splits multiple buffered lines correctly.
- Bluetooth discovery parser tests assert that the gateway returns only devices reported by the platform scan and rejects invalid device IDs.

## Firmware checks

- `arduino-cli` was not available in the implementation environment. A host C++ syntax-only check was run using minimal Arduino/Servo stubs; this checks sketch syntax only, not Arduino core or library compatibility.
- Firmware behavior, IR library integration, sensor polarity, and motor direction still require Uno compilation and raised-wheel hardware verification.

## Hardware tests

- Wheels raised and secured before motion tests.
- Pair the HC-06 with the gateway host and verify the mapped `BT_PORT` or `BT_DEVICE_PORTS` value before attempting website discovery/connection.
- Validate commands individually and with stop handling.
- Confirm telemetry serial responses after each movement command.
- Test emergency lock and rearm behavior explicitly.
