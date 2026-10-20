# PiRCcar Command and Telemetry Protocol

## Website-to-Arduino path

The website writes authenticated command records to Firebase. The Python gateway selects the newest valid request, rejects expired or superseded work, transmits one command over the paired HC-06 serial port at 9600 baud, and waits for an Arduino acknowledgement. A Firebase write is only `pending`; `acknowledged` is set after a matching `ACK:` frame from the Arduino.

## Serial commands

Commands are ASCII frames that start with `%` and end with `#`. A newline after a frame is accepted but is not required.

| Frame | Meaning |
|---|---|
| `%F#` | Hold forward movement while the host lease is refreshed |
| `%B#` | Hold backward movement while the host lease is refreshed |
| `%L#` | Hold left movement while the host lease is refreshed |
| `%R#` | Hold right movement while the host lease is refreshed |
| `%S#` | Stop and disable either autonomous mode; normal STOP does not lock or disconnect |
| `%T#` | Start Line Following |
| `%A#` | Start ultrasonic Anti-Crash scanning |
| `%E#` | Emergency stop and latch the safety lock |
| `%K#` | Stop and explicitly re-arm; this does not start motion |
| `%H#` | Refresh an active host motion/autonomy lease; ignored while idle |
| `%I#` | Query firmware readiness after serial connection |
| `%Z#` | Unsupported; returns `ACK:UNKNOWN` |

The Arduino stops and latches its lock if an active host lease is not refreshed within 1400 ms. The gateway sends `%H#` while movement or autonomous control is active. `%S#` cancels the lease. A re-arm requires a deliberate command after the gateway has reported the emergency lock. The remote's OK key requests a normal STOP when the IR library is installed; the lock still blocks remote movement.

## Acknowledgements

The Arduino emits one line per response: `ACK:<STATE>`. Defined states include `BOOT_READY`, `FORWARD`, `BACKWARD`, `LEFT`, `RIGHT`, `STOP`, `LINE_FOLLOW`, `OBSTACLE_AVOID`, `EMERGENCY_STOP`, `REARM`, `WATCHDOG`, `LOCKED`, `UNKNOWN`, and `FRAME_TOO_LONG`. `%H#` has no acknowledgement. The gateway does not treat transmission alone as execution confirmation.

## Telemetry v1

Each telemetry record is one newline-terminated ASCII line:

```text
TEL:v1,<distance_cm|NA>,<left_bit>,<center_bit>,<right_bit>,<mode>,<movement>,<safety_locked>,<host_control_active>,<distance_valid>
```

IR sensor bits are the actual digital readings; `1` means black and `0` means white per the supplied requirements. Distance is valid from 2 through 200 cm; timeout/out-of-range reads use `NA` and `distance_valid=0`. Modes are `locked`, `manual`, `line-follow`, and `obstacle-avoid`; movement is `stop`, `forward`, `backward`, `left`, or `right`. `host_control_active` means the Arduino's bounded host lease is active; it does not claim Firebase or website connectivity.

## Hardware pins

IR receiver D12; line sensors D9/D10/D11; motor direction D2/D4/D7/D8; motor PWM D5/D6; ultrasonic trigger A1 and echo A0; servo A2. The per-wheel direction assignment (left-back D2, left-forward D4, right-back D7, right-forward D8) follows a [LAFVIN code example](https://github.com/Supreme253/LAFVIN-Smart-Robot-Car/blob/main/Code); the request only specified the group of direction pins, so verify wheel direction with the wheels raised before floor operation.

## Safety limits

`%E#` is a software stop transmitted over Bluetooth, not a physical battery cutoff. Keep a reachable power disconnect available during testing. Physical IR control is compiled only when the matching `IR_remote.h`, `IR_remote.cpp`, `keymap.h`, and `keymap.cpp` are present beside the sketch; those files were not present in this workspace, so that path has not been compiled or verified here.
