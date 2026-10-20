# PiRCcar Application Overview and Master Prompt

This document summarizes the behavior visible in the current repository and provides a reusable prompt for future planning, documentation, and implementation work. Current source code takes precedence over historical status notes and illustrative case-study material.

## What PiRCcar Is

PiRCcar is a web-based operator dashboard and control system for an Arduino Uno rover. The browser is the operator interface; Firebase Realtime Database is the authenticated message and state channel; a Python gateway on a Bluetooth-capable computer bridges Firebase to the rover's HC-06 Bluetooth Classic serial connection; and the Arduino sketch drives the motors and reads the sensors.

The control path is:

1. An operator signs in to the website with Firebase Email/Password Authentication.
2. The website creates an authenticated, expiring command request in Firebase.
3. The Python gateway checks requests, operator heartbeat, expiry, priority, and safety conditions.
4. The gateway sends a framed ASCII command over the configured Bluetooth serial port at 9600 baud.
5. The Arduino executes or rejects the command and reports an acknowledgement and telemetry.
6. The gateway publishes state, acknowledgements, events, and telemetry for the website to display.

The browser does not connect directly to the HC-06. Bluetooth Classic scanning and serial connection are performed by the gateway host. Firebase Hosting can serve the static website, but it does not run the Python gateway.

## Current Website Features

The navigation and current page markup define eight hash-addressable views:

- **Overview:** Summarizes authentication, gateway, Bluetooth, operating mode, telemetry, and safety. Values remain unavailable or unknown until actual Firebase/gateway data arrives; the interface does not invent telemetry.
- **Dashboard:** Separates gateway process/database state, Bluetooth serial state, Arduino responsiveness, active mode, safety lock, movement, and telemetry freshness.
- **Controls:** Provides press-and-hold forward, backward, left, and right controls; normal STOP; emergency stop; explicit re-arm; Line Following; Anti-Crash; and optional tilt steering. The directional control sends stop behavior on release/cancel and on safety-relevant conditions such as focus loss, hidden tab, view change, or readiness loss. Mode status is driven by reported Arduino state rather than button selection alone.
- **Bluetooth device dialog:** Requests a scan from the gateway, lists discovered devices and mapping availability, and supports connect/disconnect requests. It reports unavailable gateway/platform tools, empty scans, permission errors, unmapped devices, and connection status distinctly. Scanning is not a browser Web Bluetooth flow.
- **Sensors:** Displays ultrasonic distance and left/center/right digital IR readings, plus a history chart for distance. The frontend queries the latest 50 telemetry records; the chart is distance-focused.
- **Connections:** Shows the system connection chain, authentication actions, gateway connection requests, and recent system events.
- **Logs:** Shows recent events with event-type filters and CSV export for the displayed history.
- **Settings:** Persists theme, density, font size, reduced motion, tilt sensitivity, tilt dead zone, auto-reconnect preference, heartbeat timeout, and command-hold timeout in browser local storage.
- **How It Works:** Contains a long technical case study with architecture, requirements, hardware, proposed wiring, software designs, test planning, and appendices. Its Android/Kotlin design and illustrative command examples are case-study proposals, not the live web control implementation.

The markup currently contains no separate About/Docs view. Some historical status and testing notes list a ninth view or an About/Docs view; treat those statements as stale unless the current markup changes.

## Authentication, Authorization, and Data

- The browser uses Firebase Email/Password sign-in. There is no public account-registration workflow in the website UI.
- Firebase custom claims and Realtime Database rules provide authorization. A signed-in user is not automatically an authorized driver.
- Driver/admin clients can submit only allowed command requests and their own operator heartbeat; gateway/admin access is required for authoritative device state, telemetry, events, and Bluetooth discovery results.
- The browser writes operator heartbeat data approximately once per second while signed in. The gateway uses freshness and timeout rules as part of command safety.
- Commands have unique identity, timestamps/expiry, sequencing or priority metadata, and a status lifecycle. A Firebase write means the request is pending, not that the vehicle moved. The gateway updates status after processing and matching Arduino acknowledgement.
- The app subscribes to device state, telemetry, events, commands, Bluetooth discovery, gateway operation requests, and Firebase connection status. It cleans up live listeners across authentication changes.
- The web client configuration in `frontend/firebase-config.js` is populated-looking, public Firebase client configuration. Its presence does not prove that the Firebase project, rules, authentication, custom claims, or live data are correctly configured.
- Firebase Admin credentials are for the gateway only. They must never be embedded in frontend assets or committed as public secrets.

## Gateway and Bluetooth

The Python gateway loads environment configuration, connects to Firebase using Firebase Admin credentials/Application Default Credentials, polls and validates command requests, manages the serial connection, handles acknowledgement and telemetry frames, reports health, and publishes events/state. It retries Firebase according to configuration and locks remote operation when a Firebase outage is detected; after recovery, deliberate re-arm is required.

The gateway also executes authenticated Bluetooth operation requests. Linux scanning uses BlueZ `bluetoothctl`; macOS scanning uses `blueutil`. The HC-06 may need to be paired through the gateway computer's operating-system Bluetooth settings. The selected device must map to a serial port using `BT_PORT` and/or `BT_DEVICE_PORTS`; devices without a mapping cannot be connected by the app. The serial link is configured for 9600 baud by default. Browser permission prompts do not grant access to this Bluetooth Classic serial adapter.

Gateway startup requires a configured `.env`, a valid Firebase database URL/project, gateway ADC credentials, Python dependencies, host Bluetooth utilities/permissions, and an available paired serial port. Exact live behavior depends on that environment.

## Arduino Protocol and Behavior

Commands use `%`-prefixed, `#`-terminated ASCII frames:

| Frame | Behavior |
| --- | --- |
| `%F#` | Forward while the host-control lease is refreshed |
| `%B#` | Backward while the host-control lease is refreshed |
| `%L#` | Left while the host-control lease is refreshed |
| `%R#` | Right while the host-control lease is refreshed |
| `%S#` | Normal stop and autonomous-mode cancellation; does not latch emergency lock |
| `%T#` | Start Line Following mode |
| `%A#` | Start ultrasonic/servo Anti-Crash mode |
| `%E#` | Emergency stop and latch the software safety lock |
| `%K#` | Stop and explicitly re-arm; does not start movement |
| `%H#` | Refresh an active host-control lease; ignored while idle |
| `%I#` | Query firmware readiness after serial connection |
| `%Z#` | Unsupported |

The firmware starts with its software safety lock set. While remote movement or autonomy is active, the gateway refreshes a bounded host lease; the Arduino stops and locks when that lease expires (1400 ms in the current sketch). Firmware responses use `ACK:<STATE>`. Telemetry uses `TEL:v1` and includes ultrasonic distance validity, three IR values, mode, movement, safety-lock state, and host-control lease state.

Line Following uses three digital IR sensors. Anti-Crash uses a servo-mounted ultrasonic sensor and a nonblocking scan sequence; invalid front-distance measurements stop forward movement. These algorithms are implemented in source, but sensor polarity, calibration, motor orientation, thresholds, and physical performance need hardware validation.

The sketch's current pin assignments are IR receiver D12; line sensors D9-D11; motor direction D2/D4/D7/D8; PWM D5/D6; ultrasonic trigger A1 and echo A0; servo A2. Direction-to-wheel behavior must be checked with wheels raised. Optional physical IR remote support depends on matching external LAFVIN IR/keymap files that are not present in this workspace.

Important safety distinction: `%E#` is a software lock command, not a physical battery disconnect. Keep a physical power disconnect available. The current firmware reports `BOOT_READY` unconditionally, so gateway-reported readiness does not establish that motor wiring or other hardware is correct.

## Setup, Validation, and Boundaries

- Static local preview: `python3 -m http.server 8080 --directory frontend` from the repository root.
- Gateway: install `gateway/requirements.txt`, create `gateway/.env` from `gateway/config.example.env`, configure Firebase and Bluetooth values, configure protected Firebase Admin Application Default Credentials, then run `gateway/main.py`.
- Firebase deployment requires Realtime Database, Email/Password Authentication, trusted role-claim assignment, and deployment of restrictive rules.
- The project has gateway unit tests for command validation/encoding, telemetry and acknowledgement parsing, serial frame handling, and Bluetooth discovery parsing. These are not browser automation, live Firebase integration, Arduino-core build, or physical hardware tests.
- Documentation records earlier successful checks, but this overview did not rerun them. No claim of live Firebase, paired HC-06, working car, Arduino compilation, or physical safety validation is made here.
- APK files exist in the repository, but their internals and runtime were not inspected. Their existence alone does not establish a supported Android app.
- Current source imports Firebase SDK 10.12.5 dynamically from Google's CDN, while the root package manifest declares Firebase `^13.0.0`; do not assume the npm dependency is the frontend's actual runtime loading path.
- Some older documentation makes claims that conflict with current markup/configuration. Prefer the current source for implemented behavior and report conflicts rather than silently repeating stale statements.

## Reusable Master Prompt

```text
You are helping maintain PiRCcar, a web-based remote-control and monitoring system for an Arduino Uno rover. Before making claims or changes, inspect the current repository sources. Treat frontend/index.html, frontend/app.js, frontend/style.css, frontend/firebase-config.js, gateway Python source, firebase/database.rules.json, and firmware/PiRCcar.ino as the primary evidence for current behavior. Use documentation for setup and context, but identify and disclose conflicts with current code. Do not mistake the proposed Android/Kotlin case study or embedded legacy examples for implemented production features.

SYSTEM ARCHITECTURE
The web application is a static HTML/CSS/vanilla-JavaScript operator dashboard. Firebase Realtime Database is the authenticated command, state, event, and telemetry channel. A Python gateway must run on a separate Bluetooth-capable computer and uses Firebase Admin plus pySerial to communicate with an HC-06 Bluetooth Classic serial module. The Arduino Uno firmware controls motors and sensors. Firebase Hosting can serve the static frontend but does not host/run the gateway. The browser does not connect directly to HC-06 and does not use Web Bluetooth for this SPP connection.

CURRENT WEBSITE VIEWS
The current markup defines eight views: Overview, Dashboard, Controls, Sensors, Connections, Logs, Settings, and How It Works. Do not claim a separate About/Docs view unless current source adds it.
- Overview summarizes operator auth, gateway, Bluetooth, mode, telemetry, and safety without fabricating live data.
- Dashboard separates gateway/database status, Bluetooth, Arduino responsiveness, movement, mode, safety lock, and telemetry freshness.
- Controls provides hold-to-drive forward/back/left/right; normal STOP; emergency stop; explicit re-arm; Line Following; Anti-Crash; optional device tilt steering; and a gateway-mediated Bluetooth scan/connect/disconnect dialog. Directional input must stop on release, cancellation, focus loss, hidden-tab/navigation conditions, or readiness loss. Firmware-reported mode is authoritative.
- Sensors displays ultrasonic distance and left/center/right IR state, plus distance history. The UI queries recent telemetry (up to 50 records).
- Connections provides sign-in/out, connection-component status, gateway operations, and recent events.
- Logs filters event categories and exports displayed history to CSV.
- Settings persist theme, density, font size, reduced motion, tilt sensitivity/dead zone, auto-reconnect preference, heartbeat timeout, and command-hold timeout in localStorage.
- How It Works is explanatory case-study content. Android architecture, wiring suggestions, proposed features, and examples in that content do not prove they exist in current code or hardware.

AUTHORIZATION AND DATA FLOW
The web UI uses Firebase Email/Password Authentication and has no account-registration flow. Custom claims and database rules enforce driver, gateway, and admin permissions; signed-in status alone is not authority. Keep Firebase Admin credentials on the gateway host and out of all frontend assets. Public Firebase client configuration is not a service-account secret, but populated configuration does not prove a live working project.

The browser writes uniquely identified, expiring command requests and operator heartbeats to Firebase. The gateway validates permissions as represented by the rules, request fields, expiry, duplicates/supersession, priority, operator heartbeat, connectivity, and safety conditions. It then sends the serial frame and waits for a matching Arduino ACK. A Firebase write or serial transmission alone is not proof that the car executed a command. The gateway publishes acknowledgements/status, health, telemetry, and events. During Firebase outages remote control is blocked and safety lockout/re-arm behavior applies.

BLUETOOTH AND DEPLOYMENT
Bluetooth Classic scanning and connection run on the gateway computer. Linux uses BlueZ bluetoothctl; macOS uses blueutil. The HC-06 may require OS-level pairing. Configure BT_PORT and/or BT_DEVICE_PORTS so each discovered device maps to a serial port. Unmapped devices cannot be connected. Default serial baud is 9600. Deployment requires Firebase Realtime Database, Email/Password Authentication, trusted custom role claims, restrictive deployed rules, gateway ADC credentials, Python dependencies, host Bluetooth utilities and permissions, and a valid serial port. Report unavailable or unconfigured states honestly; never simulate a scan, telemetry, connection, or successful command.

CURRENT SERIAL CONTRACT
Frames are ASCII and start with % and end with #:
%F# forward; %B# backward; %L# left; %R# right; %S# normal stop/cancel autonomy without latching emergency lock; %T# Line Following; %A# ultrasonic Anti-Crash; %E# emergency stop and latched software lock; %K# stop and explicitly re-arm without starting motion; %H# refresh active host lease; %I# readiness query. %Z# is unsupported.
ACK:<STATE> is the acknowledgement shape. TEL:v1 records report distance/validity, three IR readings, mode, movement, lock, and host-control lease status. Keep browser, gateway, protocol docs, and firmware consistent when changing this contract.

SAFETY AND HARDWARE LIMITS
Firmware starts locked and expires the active host lease after 1400 ms in the current sketch. Gateway refreshes the lease during active remote control. Preserve explicit stop, emergency-lock, and deliberate re-arm distinctions. The emergency lock is software, not a physical power cutoff; keep physical power isolation available. Current firmware emits BOOT_READY unconditionally, so readiness is not proof of correctly wired motors or verified hardware. Verify wheel direction with wheels raised before floor tests. Line Following uses three digital IR sensors. Anti-Crash uses a servo and ultrasonic distance with invalid readings stopping forward movement. Calibration, polarity, thresholds, wiring, and real performance remain hardware questions. Optional LAFVIN IR support needs matching IR_remote and keymap source files that are absent from this workspace.

EVIDENCE AND CHANGE EXPECTATIONS
Clearly label each capability as implemented in source, dependent on deployment configuration, conditional on absent libraries or hardware, merely proposed/documented, or unverified. Do not claim physical testing or Arduino-core compilation without evidence. APK artifacts are present but uninspected; do not claim a working Android application based on their existence. Do not claim camera, BLE, headlights, buzzer, battery monitoring, speed control, or other features unless current source demonstrates them.

For code changes, preserve existing architecture, Firebase role boundaries, protocol compatibility, honest unavailable states, and safety semantics. Keep changes focused, add or update tests for behavior, and run the narrowest relevant checks. Gateway unit tests do not substitute for browser/Firebase integration, Uno compilation, or raised-wheel hardware testing. Report assumptions, test evidence, limitations, and conflicts in concise terms.
```