# PiRCcar Architecture

## Overview

The PiRCcar system is a web-based vehicle control platform designed around an Arduino Uno, HC-06 Bluetooth Classic link, Firebase Realtime Database, and a Python gateway running on a local computer.

## Command path

1. A user sends a command from the web dashboard.
2. The site's JavaScript writes a command record to the Firebase Realtime Database.
3. The Python gateway polls for valid, authorized commands.
4. The gateway validates, filters duplicates, and rejects stale or malformed commands.
5. The gateway forwards a framed command over the serial Bluetooth link to the Arduino.
6. The Arduino executes the command and returns either ACK or telemetry.
7. The gateway updates Firebase state and telemetry for the dashboard.

Bluetooth discovery and serial connection requests use the authenticated `control/request` path. The Python gateway runs OS-level inquiry (BlueZ `bluetoothctl` on Linux or `blueutil` on macOS), writes actual scan results to `control/discovery`, and opens the selected device's configured serial port. The browser does not use Web Bluetooth because the HC-06 is Bluetooth Classic SPP. Arduino readiness and telemetry remain separate live status signals.

## Safety model

- Stop commands and emergency stop are always prioritized.
- Gateway heartbeat loss and stale commands can trigger lockout.
- The Arduino watchdog prevents indefinite motion if the command stream stalls.
- The frontend disables movement when the system is not ready.

## Components

- Frontend: HTML/CSS/JavaScript dashboard
- Gateway: Python serial + Firebase bridge
- Firmware: Arduino Uno sketch with leased manual control, autonomous cancellation, lockout, and structured telemetry
- Hardware: motors, driver, IR sensors, ultrasonic range sensor, servo, IR remote

The sketch uses the pin map supplied in the PiRCcar requirements. The optional LAFVIN IR receiver adapter is enabled when the original `IR_remote` and `keymap` source files are included beside the sketch. These files are not in the website workspace copy.
