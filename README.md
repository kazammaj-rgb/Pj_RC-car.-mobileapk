# PiRCcar Web-Based Remote Control and Monitoring System

This project contains the website, Firebase command flow, Python gateway, and Arduino protocol for a PiRCcar rover controlled via an Arduino Uno and HC-06 Bluetooth module. Hardware use requires a configured Firebase project, paired Bluetooth serial port, and verified motor pin mapping.

## Project structure

- `frontend/` – responsive dashboard and operational controls
- `gateway/` – Python integration layer for Firebase and Bluetooth serial
- `firmware/` – Arduino sketch and protocol definitions
- `firebase/` – Firebase Realtime Database rules and hosting config
- `docs/` – architecture and deployment documentation
- `tests/` – staged verification scripts

## Local preview

```bash
cd /Users/jayviepadron/Desktop/PjRcCar-web
python3 -m http.server 8080 --directory frontend
```

Open http://localhost:8080

## Gateway startup

```bash
cd /Users/jayviepadron/Desktop/PjRcCar-web
python3 -m venv .venv
source .venv/bin/activate
pip install -r gateway/requirements.txt
cp gateway/config.example.env gateway/.env
# Edit gateway/.env with the Firebase URL, Bluetooth serial port, and project ID.
# Configure Application Default Credentials for Firebase Admin separately.
python gateway/main.py
```

The gateway uses Firebase Admin credentials via Application Default Credentials; never place a service account key in `frontend/`. It retries Firebase every five seconds by default and locks the vehicle after a detected outage; re-arm explicitly after recovery. The sketch uses the pin assignments listed in `docs/command-protocol.md` and fails safe by booting with its emergency lock set.

The Controls view uses authenticated Firebase requests for real gateway-host Bluetooth Classic scans and serial connection attempts. Linux requires BlueZ `bluetoothctl`; macOS requires `blueutil`. Configure `BT_PORT` and, when the discovered name is not `HC-06`, the optional `BT_DEVICE_PORTS` mapping in `gateway/.env`. See [the setup guide](docs/setup-guide.md) before scanning.

Open `firmware/PiRCcar.ino` as a sketch in Arduino IDE, select Arduino Uno and the correct serial port, then Verify and Upload. For physical IR control, place the matching LAFVIN `IR_remote.h/.cpp` and `keymap.h/.cpp` alongside the sketch before compiling. Those four files are not present in this website project, so without them the website/Bluetooth features compile independently but the IR integration is omitted.

## Firebase setup and Hosting

Configure `frontend/firebase-config.js` with the Firebase web app's public client configuration, enable Email/Password Authentication, assign authorized users the `driver` custom claim, and deploy the restrictive database rules. From the project root, deploy using `firebase --config firebase/firebase.json deploy`.

## Notes

- The website does not simulate telemetry or command success. Without Firebase and live gateway data, values remain unavailable and controls stay locked.
- No real service-account credentials are committed to the project.
- Physical Bluetooth and Arduino testing must be performed on hardware and is not claimed here as complete.
