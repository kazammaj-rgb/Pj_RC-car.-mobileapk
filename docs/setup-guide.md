# Setup Guide

## Frontend

```bash
cd /Users/jayviepadron/Desktop/PjRcCar-web
python3 -m http.server 8080 --directory frontend
```

Open http://localhost:8080 in a browser.

## Gateway

```bash
cd /Users/jayviepadron/Desktop/PjRcCar-web
python3 -m venv .venv
source .venv/bin/activate
pip install -r gateway/requirements.txt
cp gateway/config.example.env gateway/.env
# Edit gateway/.env to set Firebase, the paired HC-06 serial port, and device mapping.
python gateway/main.py
```

The gateway runs Firebase Admin SDK with Application Default Credentials. On a developer machine, configure ADC with `gcloud auth application-default login`; for a service identity, set `GOOGLE_APPLICATION_CREDENTIALS` in the gateway process environment to a protected key file outside the web root. Firebase Auth users also need the `driver` custom claim; the database rules intentionally reject ordinary signed-in accounts without it.

The gateway retries Firebase connectivity every `FIREBASE_RETRY_SECONDS` (default 5). A detected database outage sends the Arduino emergency lock and blocks remote commands. After Firebase connectivity returns, explicitly re-arm the car before driving.

The Controls view uses the authenticated website-to-Firebase-to-Python-gateway workflow for Bluetooth Classic discovery; browsers do not connect directly to the HC-06 SPP service, and no browser Bluetooth picker or GATT service is used. On Linux, enable BlueZ and `bluetoothctl`. On macOS, install `blueutil` and run the gateway as the signed-in desktop user (blueutil refuses root by default). Pair the HC-06 with the gateway computer through its OS Bluetooth settings first if the module requires a PIN. Grant Bluetooth access to the gateway application in the gateway computer's operating-system privacy settings if prompted. Discovery is a real inquiry and may return no devices or an OS permission/adapter error.

The gateway opens the serial port in `BT_PORT`. Discovered device names matching `BT_DEVICE_NAME` (default `HC-06`) use that port. For other names, set a `BT_DEVICE_PORTS` JSON map from Bluetooth address or lowercase device name to its serial port, for example `BT_DEVICE_PORTS='{"00:11:22:33:44:55":"/dev/cu.HC-06"}'`. The website reports when a discovered device has no configured gateway serial-port mapping and prevents a connection request until the mapping exists. A successful serial-port open is reported separately from Arduino responsiveness and fresh telemetry.

Deploy the updated `firebase/database.rules.json` after adding these controls. The authenticated driver role can request gateway scans/connections and read discovery results; only gateway/admin roles can publish results. macOS discovery requires the `blueutil` CLI (`brew install blueutil`); Linux requires a working BlueZ `bluetoothctl` installation. The gateway does not fabricate results when a tool is missing.

## Bluetooth pairing

1. Pair the computer with the HC-06 module.
2. Confirm the COM port or Bluetooth serial device name.
3. Use the actual port in the environment settings.
4. Test the serial connection before enabling movement commands.

In the Controls view, Scan for Devices runs on the gateway host. An empty list is a real empty scan. If the target has no serial mapping, add the corresponding `BT_DEVICE_PORTS` entry before connecting.

The sketch uses the supplied pin map: IR receiver D12; line sensors D9–D11; motor direction D2, D4, D7, D8; PWM D5/D6; ultrasonic trigger A1 and echo A0; servo A2. Open `firmware/PiRCcar.ino` in Arduino IDE, select Arduino Uno and the car's port, then compile and upload. Test with the wheels raised first.

For IR remote operation, copy the matching `IR_remote.h/.cpp` and `keymap.h/.cpp` into the sketch folder. The workspace copy does not contain those files; the sketch conditionally enables IR handling when both headers are available. It maps the LAFVIN normal remote's arrow keys to movement and OK to STOP, accepts IR only while re-armed and no website host lease is active, and ignores IR during lockout/autonomy.

## Safety check

- Always test with wheels raised first.
- Verify command acknowledgements before moving on a floor.
- Treat the website as a control interface only; Arduino and gateway safety logic remain authoritative.
