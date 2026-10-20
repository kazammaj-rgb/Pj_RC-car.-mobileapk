#include <Servo.h>
#include <string.h>

#if defined(__has_include)
#if __has_include("IR_remote.h") && __has_include("keymap.h")
#include "IR_remote.h"
#include "keymap.h"
#define PIRCCAR_HAS_IR_REMOTE 1
#else
#define PIRCCAR_HAS_IR_REMOTE 0
#endif
#else
#define PIRCCAR_HAS_IR_REMOTE 0
#endif

// Pin assignments from the supplied LAFVIN hardware specification.
const byte IR_RECEIVER_PIN = 12;
const byte LEFT_LINE_PIN = 9;
const byte CENTER_LINE_PIN = 10;
const byte RIGHT_LINE_PIN = 11;
const byte LEFT_BACK_PIN = 2;
const byte LEFT_FORWARD_PIN = 4;
const byte RIGHT_BACK_PIN = 7;
const byte RIGHT_FORWARD_PIN = 8;
const byte LEFT_PWM_PIN = 5;
const byte RIGHT_PWM_PIN = 6;
const byte ULTRASONIC_TRIG_PIN = A1;
const byte ULTRASONIC_ECHO_PIN = A0;
const byte SERVO_PIN = A2;

const unsigned long CONTROL_LEASE_MS = 1400;
const unsigned long TELEMETRY_INTERVAL_MS = 500;
const unsigned long LINE_INTERVAL_MS = 40;
const unsigned long SCAN_SETTLE_MS = 120;
const unsigned long OBSTACLE_CRUISE_MS = 300;
const unsigned long OBSTACLE_TURN_MS = 220;
const unsigned long ULTRASONIC_TIMEOUT_US = 12000UL;
const byte MOTOR_SPEED = 120;
const int OBSTACLE_STOP_CM = 20;

enum Mode : byte { MODE_LOCKED, MODE_MANUAL, MODE_LINE, MODE_OBSTACLE };
enum Movement : byte { MOVE_STOP, MOVE_FORWARD, MOVE_BACKWARD, MOVE_LEFT, MOVE_RIGHT };
enum ScanState : byte { SCAN_IDLE, SCAN_FRONT_SETTLE, SCAN_FRONT_READ, SCAN_LEFT_SETTLE, SCAN_LEFT_READ, SCAN_RIGHT_SETTLE, SCAN_RIGHT_READ, SCAN_DECIDE, SCAN_CRUISE, SCAN_TURN };

Servo scanner;
#if PIRCCAR_HAS_IR_REMOTE
IRremote irReceiver(IR_RECEIVER_PIN);
#endif
Mode mode = MODE_LOCKED;
Movement movement = MOVE_STOP;
ScanState scanState = SCAN_IDLE;
bool emergencyLocked = true;
bool hostLeaseActive = false;
unsigned long lastHostControlMs = 0;
unsigned long lastTelemetryMs = 0;
unsigned long lastLineMs = 0;
unsigned long scanAtMs = 0;
unsigned long lastIrMovementMs = 0;
unsigned long frontMeasuredAtMs = 0;
bool irDriving = false;
int frontDistance = -1;
int leftDistance = -1;
int rightDistance = -1;
bool frontValid = false;
bool leftValid = false;
bool rightValid = false;
char frame[20];
byte frameLength = 0;
bool droppingFrame = false;

void sendAck(const char *message) {
  Serial.print(F("ACK:"));
  Serial.println(message);
}

const char *modeName() {
  switch (mode) {
    case MODE_LOCKED: return "locked";
    case MODE_MANUAL: return "manual";
    case MODE_LINE: return "line-follow";
    case MODE_OBSTACLE: return "obstacle-avoid";
  }
  return "unknown";
}

const char *movementName() {
  switch (movement) {
    case MOVE_FORWARD: return "forward";
    case MOVE_BACKWARD: return "backward";
    case MOVE_LEFT: return "left";
    case MOVE_RIGHT: return "right";
    default: return "stop";
  }
}

void setMotion(bool leftForward, bool rightForward) {
  digitalWrite(LEFT_BACK_PIN, leftForward ? LOW : HIGH);
  digitalWrite(LEFT_FORWARD_PIN, leftForward ? HIGH : LOW);
  digitalWrite(RIGHT_BACK_PIN, rightForward ? LOW : HIGH);
  digitalWrite(RIGHT_FORWARD_PIN, rightForward ? HIGH : LOW);
  analogWrite(LEFT_PWM_PIN, MOTOR_SPEED);
  analogWrite(RIGHT_PWM_PIN, MOTOR_SPEED);
}

void stopMotors() {
  analogWrite(LEFT_PWM_PIN, 0);
  analogWrite(RIGHT_PWM_PIN, 0);
  // The supplied LAFVIN driver sketch brakes with all direction pins HIGH.
  digitalWrite(LEFT_BACK_PIN, HIGH);
  digitalWrite(LEFT_FORWARD_PIN, HIGH);
  digitalWrite(RIGHT_BACK_PIN, HIGH);
  digitalWrite(RIGHT_FORWARD_PIN, HIGH);
  movement = MOVE_STOP;
}

void stopAutonomy() {
  scanState = SCAN_IDLE;
  mode = emergencyLocked ? MODE_LOCKED : MODE_MANUAL;
  scanner.write(90);
  stopMotors();
}

bool move(Movement next) {
  if (emergencyLocked) return false;
  mode = MODE_MANUAL;
  scanState = SCAN_IDLE;
  scanner.write(90);
  movement = next;
  switch (next) {
    case MOVE_FORWARD: setMotion(true, true); break;
    case MOVE_BACKWARD: setMotion(false, false); break;
    case MOVE_LEFT: setMotion(true, false); break;
    case MOVE_RIGHT: setMotion(false, true); break;
    default: stopMotors(); break;
  }
  return true;
}

void touchHostLease() {
  hostLeaseActive = true;
  lastHostControlMs = millis();
}

void updateIrRemote(unsigned long now) {
#if PIRCCAR_HAS_IR_REMOTE
  if (emergencyLocked || hostLeaseActive || mode != MODE_MANUAL) return;
  const byte key = irReceiver.getIrKey(irReceiver.getCode(), IR_TYPE_NORMAL);
  Movement requested = MOVE_STOP;
  bool movementKey = true;
  if (key == IR_KEYCODE_UP) requested = MOVE_FORWARD;
  else if (key == IR_KEYCODE_DOWN) requested = MOVE_BACKWARD;
  else if (key == IR_KEYCODE_LEFT) requested = MOVE_LEFT;
  else if (key == IR_KEYCODE_RIGHT) requested = MOVE_RIGHT;
  else if (key == IR_KEYCODE_OK) movementKey = false;
  else movementKey = false;

  if (movementKey) {
    move(requested);
    irDriving = true;
    lastIrMovementMs = now;
  } else if (key == IR_KEYCODE_OK && irDriving) {
    stopMotors();
    irDriving = false;
  } else if (irDriving && now - lastIrMovementMs > 350) {
    stopMotors();
    irDriving = false;
  }
#else
  (void)now;
#endif
}

int measureDistanceCm(bool &valid) {
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRASONIC_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
  const unsigned long duration = pulseIn(ULTRASONIC_ECHO_PIN, HIGH, ULTRASONIC_TIMEOUT_US);
  if (duration == 0) { valid = false; return -1; }
  const int cm = static_cast<int>(duration / 58UL);
  valid = cm >= 2 && cm <= 200;
  return valid ? cm : -1;
}

bool lineBlack(byte pin) {
  // The supplied behavior defines digital 1 as black and 0 as white.
  return digitalRead(pin) == HIGH;
}

void emitTelemetry(unsigned long now) {
  if (now - lastTelemetryMs < TELEMETRY_INTERVAL_MS) return;
  lastTelemetryMs = now;
  if (mode != MODE_OBSTACLE) {
    frontDistance = measureDistanceCm(frontValid);
    frontMeasuredAtMs = now;
  } else if (now - frontMeasuredAtMs > 1500) {
    frontValid = false;
  }
  Serial.print(F("TEL:v1,"));
  if (frontValid) Serial.print(frontDistance); else Serial.print(F("NA"));
  Serial.print(','); Serial.print(lineBlack(LEFT_LINE_PIN) ? 1 : 0);
  Serial.print(','); Serial.print(lineBlack(CENTER_LINE_PIN) ? 1 : 0);
  Serial.print(','); Serial.print(lineBlack(RIGHT_LINE_PIN) ? 1 : 0);
  Serial.print(','); Serial.print(modeName());
  Serial.print(','); Serial.print(movementName());
  Serial.print(','); Serial.print(emergencyLocked ? 1 : 0);
  Serial.print(','); Serial.print(hostLeaseActive && (now - lastHostControlMs <= CONTROL_LEASE_MS) ? 1 : 0);
  Serial.print(','); Serial.println(frontValid ? 1 : 0);
}

void startObstacleScan(unsigned long now) {
  stopMotors();
  scanner.write(90);
  scanState = SCAN_FRONT_SETTLE;
  scanAtMs = now;
}

void updateObstacleAvoidance(unsigned long now) {
  if (mode != MODE_OBSTACLE || emergencyLocked) return;
  switch (scanState) {
    case SCAN_IDLE: startObstacleScan(now); break;
    case SCAN_FRONT_SETTLE:
      if (now - scanAtMs >= SCAN_SETTLE_MS) scanState = SCAN_FRONT_READ;
      break;
    case SCAN_FRONT_READ:
      frontDistance = measureDistanceCm(frontValid);
      frontMeasuredAtMs = now;
      if (frontValid && frontDistance < OBSTACLE_STOP_CM) {
        scanner.write(150); scanAtMs = now; scanState = SCAN_LEFT_SETTLE;
      } else if (!frontValid) {
        stopMotors(); scanner.write(90); scanState = SCAN_IDLE;
      } else {
        setMotion(true, true); movement = MOVE_FORWARD; scanAtMs = now; scanState = SCAN_CRUISE;
      }
      break;
    case SCAN_LEFT_SETTLE:
      if (now - scanAtMs >= SCAN_SETTLE_MS) scanState = SCAN_LEFT_READ;
      break;
    case SCAN_LEFT_READ:
      leftDistance = measureDistanceCm(leftValid);
      scanner.write(30); scanAtMs = now; scanState = SCAN_RIGHT_SETTLE;
      break;
    case SCAN_RIGHT_SETTLE:
      if (now - scanAtMs >= SCAN_SETTLE_MS) scanState = SCAN_RIGHT_READ;
      break;
    case SCAN_RIGHT_READ:
      rightDistance = measureDistanceCm(rightValid);
      scanner.write(90); scanState = SCAN_DECIDE;
      break;
    case SCAN_DECIDE:
      if (!leftValid && !rightValid) stopMotors();
      else if (!rightValid || (leftValid && leftDistance >= rightDistance)) {
        setMotion(true, false); movement = MOVE_LEFT;
      } else { setMotion(false, true); movement = MOVE_RIGHT; }
      scanAtMs = now; scanState = movement == MOVE_STOP ? SCAN_IDLE : SCAN_TURN;
      break;
    case SCAN_CRUISE:
      if (now - scanAtMs >= OBSTACLE_CRUISE_MS) startObstacleScan(now);
      break;
    case SCAN_TURN:
      if (now - scanAtMs >= OBSTACLE_TURN_MS) startObstacleScan(now);
      break;
  }
}

void updateLineFollowing(unsigned long now) {
  if (mode != MODE_LINE || emergencyLocked || now - lastLineMs < LINE_INTERVAL_MS) return;
  lastLineMs = now;
  const bool left = lineBlack(LEFT_LINE_PIN);
  const bool center = lineBlack(CENTER_LINE_PIN);
  const bool right = lineBlack(RIGHT_LINE_PIN);
  if (center) { setMotion(true, true); movement = MOVE_FORWARD; }
  else if (left && !right) { setMotion(true, false); movement = MOVE_LEFT; }
  else if (right && !left) { setMotion(false, true); movement = MOVE_RIGHT; }
  else stopMotors();
}

void processFrame(const char *command) {
  if (strcmp(command, "%I") == 0) {
    sendAck("BOOT_READY"); return;
  }
  if (strcmp(command, "%E") == 0) {
    emergencyLocked = true; hostLeaseActive = false; irDriving = false; stopAutonomy();
    mode = MODE_LOCKED; sendAck("EMERGENCY_STOP"); return;
  }
  if (strcmp(command, "%K") == 0) {
    stopMotors(); scanState = SCAN_IDLE; emergencyLocked = false; irDriving = false;
    hostLeaseActive = false; irDriving = false; mode = MODE_MANUAL;
    sendAck("REARM"); return;
  }
  if (emergencyLocked) { sendAck("LOCKED"); return; }
  if (strcmp(command, "%H") == 0) {
    if (hostLeaseActive) lastHostControlMs = millis();
    return;
  }
  if (strcmp(command, "%S") == 0) {
    hostLeaseActive = false; irDriving = false; stopAutonomy(); mode = MODE_MANUAL; sendAck("STOP"); return;
  }
  if (strcmp(command, "%F") == 0 || strcmp(command, "%B") == 0 ||
      strcmp(command, "%L") == 0 || strcmp(command, "%R") == 0) {
    touchHostLease(); irDriving = false;
    Movement next = strcmp(command, "%F") == 0 ? MOVE_FORWARD :
                    strcmp(command, "%B") == 0 ? MOVE_BACKWARD :
                    strcmp(command, "%L") == 0 ? MOVE_LEFT : MOVE_RIGHT;
    move(next);
    sendAck(next == MOVE_FORWARD ? "FORWARD" : next == MOVE_BACKWARD ? "BACKWARD" : next == MOVE_LEFT ? "LEFT" : "RIGHT");
    return;
  }
  if (strcmp(command, "%T") == 0 || strcmp(command, "%A") == 0) {
    touchHostLease(); irDriving = false; stopMotors(); scanner.write(90); scanState = SCAN_IDLE;
    mode = command[1] == 'T' ? MODE_LINE : MODE_OBSTACLE;
    sendAck(mode == MODE_LINE ? "LINE_FOLLOW" : "OBSTACLE_AVOID"); return;
  }
  sendAck("UNKNOWN");
}

void readBluetooth() {
  while (Serial.available() > 0) {
    const char incoming = static_cast<char>(Serial.read());
    if (incoming == '%') {
      frameLength = 0; droppingFrame = false;
      frame[frameLength++] = incoming;
    } else if (droppingFrame) {
      if (incoming == '#') droppingFrame = false;
    } else if (incoming == '#') {
      frame[frameLength] = '\0';
      if (frameLength > 1) processFrame(frame);
      frameLength = 0;
    } else if (incoming == '\r' || incoming == '\n') {
      continue;
    } else if (frameLength < sizeof(frame) - 1) {
      if (frameLength > 0) frame[frameLength++] = incoming;
    } else {
      frameLength = 0; droppingFrame = true; sendAck("FRAME_TOO_LONG");
    }
  }
}

void setup() {
  Serial.begin(9600);
  pinMode(IR_RECEIVER_PIN, INPUT);
  pinMode(LEFT_LINE_PIN, INPUT);
  pinMode(CENTER_LINE_PIN, INPUT);
  pinMode(RIGHT_LINE_PIN, INPUT);
  pinMode(LEFT_BACK_PIN, OUTPUT); pinMode(LEFT_FORWARD_PIN, OUTPUT);
  pinMode(RIGHT_BACK_PIN, OUTPUT); pinMode(RIGHT_FORWARD_PIN, OUTPUT);
  pinMode(LEFT_PWM_PIN, OUTPUT); pinMode(RIGHT_PWM_PIN, OUTPUT);
  pinMode(ULTRASONIC_TRIG_PIN, OUTPUT); pinMode(ULTRASONIC_ECHO_PIN, INPUT);
  scanner.attach(SERVO_PIN); scanner.write(90);
#if PIRCCAR_HAS_IR_REMOTE
  irReceiver.begin();
#endif
  stopMotors();
  sendAck("BOOT_READY");
}

void loop() {
  readBluetooth();
  const unsigned long now = millis();
  if (!emergencyLocked && hostLeaseActive && now - lastHostControlMs > CONTROL_LEASE_MS) {
    emergencyLocked = true; hostLeaseActive = false; stopAutonomy(); mode = MODE_LOCKED;
    sendAck("WATCHDOG");
  }
  updateLineFollowing(now);
  updateObstacleAvoidance(now);
  updateIrRemote(now);
  emitTelemetry(now);
}
