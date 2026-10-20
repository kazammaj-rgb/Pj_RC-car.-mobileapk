# PiRCcar Project Status

Audit date: 2026-10-19

UI navigation refactor: 2026-10-19

Controller refresh: 2026-10-19

Controls interaction and contrast update: 2026-10-19

Engineering case study integration: 2026-10-19

Components section and About/Docs cleanup: 2026-10-19

## Case study documentation update

- Replaced the brief How It Works summary with the complete 26-section “ARDUINO BLUETOOTH REMOTE-CONTROL RACING CAR” case study, including appendices A and B.
- Added the executive summary, background and objectives, scope limits, FR-01 through FR-12 and non-functional requirements, system architecture, hardware table, conceptual wiring diagram, suggested wiring relationships and warnings, proposed command protocol, manual and autonomous behavior, Android design/flow/project structure, Arduino modules and pseudocode, safety checklist, test plan, development phases, expected experience, enhancements, conclusion, and final wiring deliverable.
- Added explicit compatibility notes separating the proposed Android/Kotlin/XML direct Bluetooth architecture and single-character command list from the current website's Firebase/Python-gateway/framed-command architecture. Proposed headlights/buzzer and case-study commands are not represented as confirmed hardware capabilities.
- Added scoped TOC/deep links of the form `#how-it-works/cs-section-12`; links keep the independent How It Works view active. Added responsive tables and diagrams, keyboard-operable disclosure, and a print stylesheet.
- Files changed for this documentation task: `frontend/index.html`, `frontend/style.css`, `frontend/app.js`, and `PROJECT_STATUS.md`.
- Verification performed: source assertion found 26 case-study sections, 26 TOC links, and no unmatched destinations; `node --check frontend/app.js` passed; browser verified a TOC jump and direct deep link, both preserving the view and scrolling the selected section to the 108px header offset; browser verified 390px width with no body overflow and table-local horizontal scrolling; print emulation showed How It Works content and hid the top navigation; no browser console/page errors were observed.
- Existing gateway regression suite: 20 tests passed. This was a documentation-only follow-up; it does not certify live Firebase, Android functionality, Arduino compilation, or physical hardware behavior.
- Remaining limitations: no real Android application is included or inspected; no phone, car, Firebase project, or paired Bluetooth hardware was available for physical validation. Case-study wiring is conceptual and the exact pin-by-pin build remains dependent on the actual kit.

## Components and About/Docs update

- Added `26. Components` after `25. Source Code` and before the existing appendices in the How It Works case study.
- Added the 15 supplied hardware inventory names and four supplied project-status notes without adding specifications or claims.
- Removed the standalone About / Docs navigation link and its separate UI view; removed the now-unused doc-grid/doc-card selectors and removed `docs` from the view hash allowlist. Unknown `#docs` now follows the established Overview fallback.
- Preserved the case-study appendices, Source Code section, and its five source tabs.
- Verification: static check found 28 case-study sections and matching TOC links; browser confirmed Component deep-link navigation, 15 inventory entries, four notes, retained five source tabs and appendix, no docs nav/view, and no JS/page errors. At 390px viewport the page width remains 390px. JavaScript diagnostics report no errors and CSS braces balance.
- Regression: 20 gateway tests remain passing; no gateway, Firebase, firmware, pin-map, or control code was changed for this task.

## Architecture

The application is a static HTML/CSS/vanilla-JavaScript site under `frontend/`, Firebase Realtime Database transport with Email/Password Authentication and custom role claims, a Python Firebase Admin + pySerial gateway under `gateway/`, and an Arduino Uno sketch under `firmware/`. Firebase Hosting and database rules are configured under `firebase/`. The HC-06 uses Bluetooth Classic serial at 9600 baud; the gateway must run on a nearby computer and is not hosted by Firebase Hosting.

## Verified project contents

- `frontend/index.html`, `style.css`, and `app.js` implement the dashboard, controls, modes, telemetry, connection status, logs, authentication, tilt, preferences, and navigation.
- `frontend/firebase-config.js` still contains placeholder Firebase values. No project credentials or live connection are available in this workspace.
- `firebase/database.rules.json` denies root access and limits driver writes to newly created allowlisted commands, own operator heartbeats, and gateway control requests. Gateway state/telemetry/events writes require gateway/admin claims for clients; Firebase Admin service credentials bypass RTDB rules and must stay on the gateway host.
- `gateway/main.py`, `firebase_client.py`, `command_router.py`, `bluetooth_serial.py`, `safety.py`, and `telemetry_parser.py` implement the gateway. It requires a local Firebase Admin credential and paired serial port.
- `firmware/PiRCcar.ino` uses the supplied pin map, framed commands, local lease timeout, safety lock, mode cancellation, nonblocking obstacle scan states, and `TEL:v1` telemetry.
- Existing Python tests cover gateway command validation and telemetry parsing. There is no browser automation or hardware fixture in the project.
- Earlier integration checks passed: 14 gateway unit tests, gateway Python compilation, frontend JavaScript syntax, Firebase JSON parsing, frontend asset links, and a host C++ stub syntax check. `arduino-cli` is unavailable.
- The UI now has nine hash-addressable views. Static markup validation confirms each view ID is unique, navigation hashes exist, Overview is the initial visible view, and the other eight views start hidden. Browser automation is not installed in this workspace, so visual desktop/mobile, refresh/history, and console checks remain unrun.
- The Controls view now uses the black/charcoal and gold controller palette, large circular movement buttons, distinct Stop/Emergency buttons, telemetry-driven mode labels, connection health details, and a native device-selection dialog. Movement still uses the existing Firebase command path and `%F#`, `%B#`, `%L#`, `%R#`, `%S#`, `%E#`, `%T#`, `%A#`, `%K#` protocol.
- Gateway-based Bluetooth Classic discovery is implemented through BlueZ `bluetoothctl` on Linux or `blueutil` on macOS. Results are published at `control/discovery`; driver reads and gateway-only writes are covered in database rules. Devices without configured serial-port mappings are shown but cannot be connected.
- Discovery/connection requires deployed database rules, configured Firebase, an online gateway, host Bluetooth permission/utilities, paired HC-06 where required, and a valid `BT_PORT`/`BT_DEVICE_PORTS` mapping. This workspace has no `blueutil`, Firebase configuration, paired HC-06, or Arduino hardware, so no live scan or connection was claimed.
- Controller refresh checks passed locally: `node --check frontend/app.js`, gateway `compileall`, all 20 gateway tests, Firebase JSON parsing, CSS brace validation, and static markup checks for unique IDs and all JavaScript element references. The macOS discovery probe honestly returned unavailable because `blueutil` is not installed. No browser runtime or hardware test was available.
- Controls follow-up: removed the live health strip and its duplicate connection summary in the Bluetooth dialog; made safety/readiness-limited controls remain clickable with handler-level explanations; retained command authorization/readiness/safety checks; sharpened controller colors and surfaces; and made the header Bluetooth indicator require connected Firebase, an online gateway, and the gateway-reported connected serial link. No new tests were run for this follow-up; browser and HC-06 behavior remain unverified.

## Existing working and partial areas

- Manual press/release controls, stop-on-focus-loss, emergency lock/re-arm UI, tilt permission flow, themes/settings, Firebase auth, data subscriptions, command status display, connection requests, and logs are implemented in the browser.
- Gateway command validation, expiration, operator heartbeat checks, serial acknowledgments, reconnect configuration, health state, and telemetry publishing exist.
- Firmware supports manual, Line Following, Anti-Crash, emergency lock, re-arm, a host lease, and structured sensor/controller telemetry.
- The website protocol and firmware now agree on `%F#`, `%B#`, `%L#`, `%R#`, `%S#`, `%T#`, `%A#`, `%E#`, `%K#`, `%H#`, `%I#`; `%Z#` remains unsupported.
- The persistent header links to independent Overview, Dashboard, Controls, Sensors, Connections, Logs, Settings, How It Works, and About / Docs views. Hash changes update the visible view and `aria-current`; unknown or missing hashes resolve to Overview. Live DOM state and Firebase subscriptions remain in place when views are hidden.
- Changing views releases a held directional control through the existing STOP command and disables tilt steering. It does not clear the emergency lock, reset application state, or disconnect the gateway.
- Controller mode buttons now use the firmware-reported mode as their state; selecting the active autonomous mode sends STOP to exit it. Tilt displays active only after orientation data arrives and disables on timeout, navigation, focus loss, or readiness loss. Local emergency-stop state remains latched until firmware lock state or a REARM acknowledgement is observed.

## Confirmed issues found in this audit

1. Gateway environment loading and partial serial frame loss were confirmed and have now been repaired.
2. Browser Firebase value listeners were not unsubscribed across sign-out/sign-in cycles; listener cleanup has now been added.
3. Gateway and Bluetooth statuses were previously conflated in the dashboard; state reporting now separates process heartbeat, Firebase connection, Bluetooth connection, and Arduino responsiveness.
4. Firebase operations now mark connectivity unavailable on failure, retry on a configurable interval, block remote commands during outages, and require explicit re-arm after recovery.
5. The supplied IR receiver/keymap source files are not in the opened project tree. Firmware IR support is conditional on those matching files being present and cannot be verified against the actual source here.
6. Firebase credentials/configuration, HC-06 pairing, motor orientation, sensor behavior, and physical operation have not been verified.

## Security and operational concerns

- Browser Firebase configuration is intentionally public client configuration, but remains placeholder text. Do not put service-account credentials in the frontend.
- Driver role custom claims must be assigned through a trusted administrative process; hiding controls is not the authorization boundary.
- The Arduino software emergency lock is not a motor power disconnect.
- The pin group is specified, but per-wheel direction assignment was not included in the local firmware source. Raised-wheel direction verification is required before floor operation.

## Prioritized implementation checklist

- [x] Audit actual code and document status.
- [x] Keep one command/telemetry contract across browser, gateway, and firmware.
- [x] Load the documented gateway `.env` reliably and retain partial serial frames.
- [x] Unsubscribe/recreate browser Firebase listeners cleanly on auth changes.
- [x] Add tests for serial partial/multiple frames and existing command/telemetry rejection cases.
- [x] Re-run JavaScript, Python, JSON, and firmware host-stub syntax checks.
- [x] Lock remote operation during Firebase outages and require re-arm after recovery.
- [x] Split the website into nine independent hash-addressable views while preserving live application state and control safety behavior.
- [x] Redesign Controls with hold-to-drive buttons, actual mode states, safe STOP/Emergency behavior, and responsive controller styling.
- [x] Add authenticated gateway Bluetooth scan/connect/disconnect request flow with honest empty/error/unavailable states and serial-port mapping checks.
- [x] Keep driver discovery writes restricted to the gateway in Firebase rules.
- [ ] Configure Firebase web client, authentication claims, gateway ADC, and HC-06 serial port on the deployment host.
- [ ] Compile with Arduino Uno core and the actual LAFVIN IR/keymap files.
- [ ] Perform raised-wheel motor, sensor, watchdog, emergency-lock, IR, and autonomous-mode tests on the physical car.

## Files for current repair

`frontend/index.html`, `frontend/style.css`, `frontend/app.js`, `gateway/bluetooth_discovery.py`, `gateway/main.py`, `gateway/firebase_client.py`, `gateway/config.example.env`, `firebase/database.rules.json`, `tests/gateway/test_bluetooth_discovery.py`, and controller setup/testing/architecture documentation. Arduino firmware was not changed.
