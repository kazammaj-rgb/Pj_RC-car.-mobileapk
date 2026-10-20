const APP = {
  theme: localStorage.getItem('pirccar-theme') || 'dark',
  density: localStorage.getItem('pirccar-density') || 'comfortable',
  fontSize: localStorage.getItem('pirccar-font-size') || 'normal',
  reducedMotion: localStorage.getItem('pirccar-reduced-motion') === 'true',
  ready: false,
  configured: false,
  user: null,
  lastCommand: null,
  lastMode: 'unknown',
  safetyLocked: false,
  emergencyStopPending: false,
  rearmPending: false,
  commandHistory: [],
  telemetryHistory: [],
  activePointerId: null,
  activeButton: null,
  tiltDirection: null,
  tiltEnabled: false,
  tiltListening: false,
  lastTiltCommandAt: 0,
  gatewayControlRequest: null,
  bluetoothDiscovery: null,
  pendingMode: null,
  telemetry: {
    distance: null,
    leftIR: null,
    centerIR: null,
    rightIR: null,
    movement: null,
    timestamp: null
  },
  connection: {
    website: 'Running',
    firebase: 'Not configured',
    gateway: 'Unavailable',
    bluetooth: 'Unavailable',
    arduino: 'Unavailable'
  }
};

const SETTINGS = {
  tiltSensitivity: Number(localStorage.getItem('pirccar-tilt-sensitivity')) || 18,
  tiltDeadZone: Number(localStorage.getItem('pirccar-tilt-dead-zone')) || 5,
  autoReconnect: localStorage.getItem('pirccar-auto-reconnect') === 'true',
  heartbeatTimeout: Number(localStorage.getItem('pirccar-heartbeat-timeout')) || 5000,
  commandHoldTimeout: Number(localStorage.getItem('pirccar-command-hold-timeout')) || 700
};

let cloud = null;
let heartbeatTimer = null;
let lastSerialAck = 'Unavailable';
let gatewayHealthTimer = null;
let gatewayHeartbeatAt = 0;
let commandSequence = 0;
let lastTelemetryLogAt = 0;
let liveDataUnsubscribers = [];
let firebaseConnectionUnsubscribe = null;
let navigationInitialized = false;
let tiltPermissionTimer = null;
let discoveryTimeout = null;
let selectedBluetoothDeviceId = null;
let pendingGatewayRequestId = null;
let modeCommandTimer = null;

const els = {
  body: document.body,
  themeToggle: document.getElementById('themeToggle'),
  gatewayStatusValue: document.getElementById('gatewayStatusValue'),
  bluetoothStatusValue: document.getElementById('bluetoothStatusValue'),
  arduinoStatusValue: document.getElementById('arduinoStatusValue'),
  operatingModeValue: document.getElementById('operatingModeValue'),
  safetyStatusValue: document.getElementById('safetyStatusValue'),
  telemetryStampValue: document.getElementById('telemetryStampValue'),
  gatewayStateBadge: document.getElementById('gatewayStateBadge'),
  bluetoothStateBadge: document.getElementById('bluetoothStateBadge'),
  modeBadge: document.getElementById('modeBadge'),
  ultrasonicValue: document.getElementById('ultrasonicValue'),
  leftIrValue: document.getElementById('leftIrValue'),
  centerIrValue: document.getElementById('centerIrValue'),
  rightIrValue: document.getElementById('rightIrValue'),
  logTableBody: document.getElementById('logTableBody'),
  eventList: document.getElementById('eventList'),
  commandStatusList: document.getElementById('commandStatusList'),
  connectionList: document.getElementById('connectionList'),
  telemetryChart: document.getElementById('telemetryChart'),
  logFilterType: document.getElementById('logFilterType'),
  exportLogs: document.getElementById('exportLogs'),
  themeSetting: document.getElementById('themeSetting'),
  densitySetting: document.getElementById('densitySetting'),
  fontSizeSetting: document.getElementById('fontSizeSetting'),
  motionSetting: document.getElementById('motionSetting'),
  emergencyStopButton: document.getElementById('emergencyStopButton')
};

Object.assign(els, {
  authForm: document.getElementById('authForm'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  authSubmit: document.getElementById('authSubmit'),
  authSignOut: document.getElementById('authSignOut'),
  authStatus: document.getElementById('authStatus'),
  connectionError: document.getElementById('connectionError'),
  gatewayConnect: document.getElementById('gatewayConnect'),
  gatewayDisconnect: document.getElementById('gatewayDisconnect'),
  tiltToggle: document.getElementById('tiltToggle'),
  tiltToggleLabel: document.getElementById('tiltToggleLabel'),
  tiltStatus: document.getElementById('tiltStatus'),
  tiltSensitivity: document.getElementById('tiltSensitivity'),
  tiltSensitivityValue: document.getElementById('tiltSensitivityValue'),
  tiltDeadZone: document.getElementById('tiltDeadZone'),
  tiltDeadZoneValue: document.getElementById('tiltDeadZoneValue'),
  autoReconnect: document.getElementById('autoReconnect'),
  heartbeatTimeout: document.getElementById('heartbeatTimeout'),
  commandHoldTimeout: document.getElementById('commandHoldTimeout'),
  controllerStopButton: document.getElementById('controllerStopButton'),
  controllerFeedback: document.getElementById('controllerFeedback'),
  controllerConnectionText: document.getElementById('controllerConnectionText'),
  controllerConnectionLed: document.getElementById('controllerConnectionLed'),
  controllerMovementState: document.getElementById('controllerMovementState'),
  globalMenuButton: document.getElementById('globalMenuButton'),
  controllerThemeToggle: document.getElementById('controllerThemeToggle'),
  deviceConnectOpen: document.getElementById('deviceConnectOpen'),
  deviceConnectButtonText: document.getElementById('deviceConnectButtonText'),
  deviceConnectDialog: document.getElementById('deviceConnectDialog'),
  deviceDialogStatus: document.getElementById('deviceDialogStatus'),
  deviceDialogClose: document.getElementById('deviceDialogClose'),
  deviceDialogCancel: document.getElementById('deviceDialogCancel'),
  scanBluetoothDevices: document.getElementById('scanBluetoothDevices'),
  connectSelectedDevice: document.getElementById('connectSelectedDevice'),
  disconnectBluetoothDevice: document.getElementById('disconnectBluetoothDevice'),
  bluetoothDeviceList: document.getElementById('bluetoothDeviceList'),
  deviceListEmpty: document.getElementById('deviceListEmpty')
});

function applyTheme() {
  const light = APP.theme === 'light';
  els.body.classList.toggle('light-theme', light);
  const themeAction = light ? 'dark' : 'light';
  const themeLabel = `Switch to ${themeAction} mode`;
  els.themeToggle.setAttribute('aria-label', themeLabel);
  els.themeToggle.title = themeLabel;
  els.themeToggle.querySelector('.theme-sun-icon').hidden = light;
  els.themeToggle.querySelector('.theme-moon-icon').hidden = !light;
  els.themeSetting.value = APP.theme;
  localStorage.setItem('pirccar-theme', APP.theme);
}

function isPlaceholderConfig(config) {
  return !config || !config.apiKey || /REPLACE|YOUR_PROJECT|YOUR_APP_ID|000000000000/.test(JSON.stringify(config));
}

async function initializeFirebase() {
  const config = window.PIRCCAR_FIREBASE_CONFIG;
  if (isPlaceholderConfig(config)) {
    els.connectionError.textContent = 'Firebase is not configured. Add the web app configuration before signing in.';
    els.authStatus.textContent = 'Firebase configuration is required for authenticated control.';
    renderStatusPanels();
    return;
  }

  try {
    const version = '10.12.5';
    const [appSdk, authSdk, databaseSdk] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-database.js`)
    ]);
    const firebaseApp = appSdk.initializeApp(config);
    const auth = authSdk.getAuth(firebaseApp);
    const db = databaseSdk.getDatabase(firebaseApp);
    const deviceId = config.deviceId || 'pirccar-001';
    cloud = {
      auth,
      db,
      devicePath: `pirccar/devices/${deviceId}`,
      ...authSdk,
      ...databaseSdk
    };
    APP.configured = true;
    APP.connection.firebase = 'Connecting';
    firebaseConnectionUnsubscribe = databaseSdk.onValue(databaseSdk.ref(db, '.info/connected'), (snapshot) => {
      const wasConnected = APP.connection.firebase === 'Connected';
      APP.connection.firebase = snapshot.val() === true ? 'Connected' : 'Disconnected';
      if (wasConnected && APP.connection.firebase !== 'Connected') {
        APP.ready = false;
        void cancelControlOnUnavailable('Firebase connection lost; movement control stopped.');
      }
      renderStatusPanels();
    }, (error) => {
      APP.connection.firebase = 'Connection error';
      els.connectionError.textContent = `Firebase connection monitor failed: ${error.message}`;
      renderStatusPanels();
    });
    document.getElementById('firebaseConnection').textContent = APP.connection.firebase;
    els.connectionError.textContent = 'Firebase configured. Gateway status remains unverified until live state arrives.';

    authSdk.onAuthStateChanged(auth, (user) => {
      APP.user = user;
      els.authStatus.textContent = user ? `Signed in as ${user.email || user.uid}` : 'Sign in with an authorized Firebase operator account.';
      els.authSubmit.hidden = Boolean(user);
      els.authSignOut.hidden = !user;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (gatewayHealthTimer) clearInterval(gatewayHealthTimer);
      if (user) {
        subscribeLiveData();
        writeOperatorHeartbeat();
        heartbeatTimer = setInterval(writeOperatorHeartbeat, 1000);
        gatewayHealthTimer = setInterval(() => {
          if (!gatewayHeartbeatAt || Date.now() - gatewayHeartbeatAt > SETTINGS.heartbeatTimeout) {
            const wasReady = APP.ready;
            APP.connection.gateway = 'Stale heartbeat';
            APP.ready = false;
            if (wasReady) void cancelControlOnUnavailable('Gateway heartbeat expired; movement control stopped.');
          }
          renderStatusPanels();
        }, 500);
      } else {
        unsubscribeLiveData();
        APP.ready = false;
        APP.connection.gateway = 'Unavailable';
        APP.connection.bluetooth = 'Unavailable';
        APP.connection.arduino = 'Unavailable';
        APP.telemetry = { distance: null, leftIR: null, centerIR: null, rightIR: null, movement: null, timestamp: null };
        APP.lastMode = 'unknown';
      }
      renderStatusPanels();
    });
  } catch (error) {
    APP.connection.firebase = 'Connection failed';
    els.connectionError.textContent = `Firebase initialization failed: ${error.message}`;
    els.authStatus.textContent = 'Firebase SDK unavailable or configuration invalid.';
    renderStatusPanels();
  }
}

function subscribeLiveData() {
  if (!cloud || !APP.user) return;
  unsubscribeLiveData();
  const { db, ref, onValue, query, orderByChild, limitToLast } = cloud;
  const devicePath = cloud.devicePath;

  liveDataUnsubscribers.push(onValue(ref(db, `${devicePath}/state`), (snapshot) => {
    const state = snapshot.val();
    if (!state) {
      APP.connection.gateway = 'Waiting for gateway';
      APP.connection.bluetooth = 'Unavailable';
      APP.connection.arduino = 'Unavailable';
      const wasReady = APP.ready;
      APP.ready = false;
      if (wasReady) void cancelControlOnUnavailable('Gateway state is unavailable; movement control stopped.');
      renderStatusPanels();
      return;
    }
    const components = state.components || {};
    APP.connection.gateway = components.gateway === 'online' ? 'Online' : 'Unavailable';
    APP.connection.bluetooth = components.bluetooth || 'Unknown';
    APP.connection.arduino = components.arduino || 'Unknown';
    const reportedSafetyLock = Boolean(state.safety?.emergency_locked);
    if (APP.emergencyStopPending) {
      APP.safetyLocked = true;
      if (reportedSafetyLock) APP.emergencyStopPending = false;
    } else if (APP.rearmPending) {
      APP.safetyLocked = true;
    } else {
      APP.safetyLocked = reportedSafetyLock;
    }
    APP.lastMode = state.mode || 'unknown';
    if (APP.lastMode !== 'manual' && APP.tiltListening) disableTilt('Tilt stopped because the Arduino changed mode.');
    if (APP.pendingMode && APP.pendingMode === APP.lastMode) {
      APP.pendingMode = null;
      if (modeCommandTimer) clearTimeout(modeCommandTimer);
      modeCommandTimer = null;
    }
    gatewayHeartbeatAt = Date.parse(state.heartbeat || '') || 0;
    const wasReady = APP.ready;
    APP.ready = Boolean(APP.user && state.status === 'online'
      && String(APP.connection.bluetooth).toLowerCase() === 'connected'
      && String(APP.connection.arduino).toLowerCase() === 'responsive'
      && state.capabilities?.drive_ready === true
      && gatewayHeartbeatAt > 0
      && Date.now() - gatewayHeartbeatAt <= SETTINGS.heartbeatTimeout
      && !APP.safetyLocked);
    if (wasReady && !APP.ready) void cancelControlOnUnavailable('Connection or safety state changed; movement control stopped.');
    if (state.safety?.last_error) els.connectionError.textContent = state.safety.last_error;
    renderStatusPanels();
  }, (error) => {
    APP.connection.firebase = 'Read denied';
    els.connectionError.textContent = `Cannot read device status: ${error.message}`;
    renderStatusPanels();
  }));

  liveDataUnsubscribers.push(onValue(query(ref(db, `${devicePath}/telemetry`), orderByChild('timestamp'), limitToLast(50)), (snapshot) => {
    const entries = Object.values(snapshot.val() || {}).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    APP.telemetryHistory = entries
      .filter((entry) => entry.distance_cm !== null && entry.distance_cm !== undefined)
      .map((entry) => Number(entry.distance_cm))
      .filter(Number.isFinite);
    const latest = entries.at(-1);
    if (latest) {
      APP.telemetry = {
        distance: latest.distance_cm !== null && latest.distance_cm !== undefined && Number.isFinite(Number(latest.distance_cm)) ? Number(latest.distance_cm) : null,
        leftIR: latest.left_ir ?? null,
        centerIR: latest.center_ir ?? null,
        rightIR: latest.right_ir ?? null,
        movement: latest.movement ?? null,
        timestamp: latest.timestamp || null
      };
      if (Date.now() - lastTelemetryLogAt >= 5000) {
        lastTelemetryLogAt = Date.now();
        pushLog('telemetry', 'Live telemetry received from gateway', 'received');
      }
    }
    updateChart();
    renderStatusPanels();
  }, (error) => {
    els.connectionError.textContent = `Cannot read telemetry: ${error.message}`;
  }));

  liveDataUnsubscribers.push(onValue(query(ref(db, `${devicePath}/events`), orderByChild('timestamp'), limitToLast(50)), (snapshot) => {
    APP.commandHistory = Object.values(snapshot.val() || {}).map((event) => ({
      time: event.timestamp ? new Date(event.timestamp).toLocaleTimeString([], { hour12: false }) : 'Unknown time',
      type: event.type || 'system',
      event: event.message || 'Gateway event',
      status: event.status || 'unknown'
    })).reverse();
    renderLogs();
    renderEvents();
  }, (error) => {
    els.connectionError.textContent = `Cannot read event history: ${error.message}`;
  }));

  liveDataUnsubscribers.push(onValue(ref(db, `${devicePath}/commands`), (snapshot) => {
    const commands = Object.values(snapshot.val() || {}).sort((a, b) => Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0));
    if (commands.length) {
      APP.lastCommand = commands[0].command || 'Unknown';
      APP.commandStatus = commands[0].status || 'Unknown';
      lastSerialAck = commands[0].arduino_ack || 'Unavailable';
      if (commands[0].command === 'emergency-stop' && commands[0].arduino_ack === 'EMERGENCY_STOP') {
        APP.safetyLocked = true;
        APP.emergencyStopPending = false;
      }
      if (commands[0].command === 'rearm' && commands[0].arduino_ack === 'REARM') {
        APP.safetyLocked = false;
        APP.emergencyStopPending = false;
        APP.rearmPending = false;
      }
      if (['failed', 'rejected'].includes(commands[0].status)) {
        els.connectionError.textContent = commands[0].error || `Last command ${commands[0].status}.`;
        if (APP.pendingMode) {
          APP.pendingMode = null;
          if (modeCommandTimer) clearTimeout(modeCommandTimer);
          modeCommandTimer = null;
        }
      }
      renderStatusPanels();
    }
  }, (error) => {
    els.connectionError.textContent = `Cannot read command status: ${error.message}`;
  }));

  liveDataUnsubscribers.push(onValue(ref(db, `${devicePath}/control/discovery`), (snapshot) => {
    APP.bluetoothDiscovery = snapshot.val();
    renderBluetoothDevices();
  }, (error) => {
    APP.bluetoothDiscovery = { status: 'unavailable', devices: [], error: `Discovery results are unavailable: ${error.message}` };
    renderBluetoothDevices();
  }));

  liveDataUnsubscribers.push(onValue(ref(db, `${devicePath}/control/request`), (snapshot) => {
    APP.gatewayControlRequest = snapshot.val();
    renderGatewayRequestStatus();
  }, (error) => {
    els.deviceDialogStatus.textContent = `Cannot read gateway operation status: ${error.message}`;
  }));
}

function unsubscribeLiveData() {
  liveDataUnsubscribers.forEach((unsubscribe) => unsubscribe());
  liveDataUnsubscribers = [];
}

async function writeOperatorHeartbeat() {
  if (!cloud || !APP.user) return;
  try {
    const heartbeatRef = cloud.ref(cloud.db, `${cloud.devicePath}/operators/${APP.user.uid}`);
    await cloud.set(heartbeatRef, {
      heartbeat_at_ms: Date.now(),
      heartbeat_timeout_ms: SETTINGS.heartbeatTimeout,
      active_command: APP.activePointerId !== null ? APP.activeButton?.dataset.command || null : APP.tiltDirection,
      auto_reconnect: SETTINGS.autoReconnect
    });
  } catch (error) {
    els.connectionError.textContent = `Operator heartbeat failed: ${error.message}`;
    APP.ready = false;
    renderStatusPanels();
  }
}

async function requestGateway(action) {
  if (!cloud) {
    els.deviceDialogStatus.textContent = 'Firebase is not configured. Add the web client configuration before requesting gateway Bluetooth access.';
    return null;
  }
  if (!APP.user) {
    els.deviceDialogStatus.textContent = 'Sign in with an authorized driver account before requesting Bluetooth discovery or connection.';
    return null;
  }
  if (APP.connection.gateway !== 'Online') {
    els.deviceDialogStatus.textContent = 'The Python gateway is offline. Start it on the computer connected to the HC-06, then retry.';
    return null;
  }
  if (APP.gatewayControlRequest && ['pending', 'scanning'].includes(APP.gatewayControlRequest.status)) {
    els.deviceDialogStatus.textContent = 'A gateway Bluetooth operation is already in progress. Wait for its result before retrying.';
    return null;
  }
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const request = {
    action,
    request_id: requestId,
    requested_by: APP.user.uid,
    requested_at_ms: Date.now(),
    status: 'pending'
  };
  if (action === 'connect' && selectedBluetoothDeviceId) request.device_id = selectedBluetoothDeviceId;
  pendingGatewayRequestId = requestId;
  APP.gatewayControlRequest = request;
  updateControlAvailability();
  try {
    await cloud.set(cloud.ref(cloud.db, `${cloud.devicePath}/control/request`), request);
    return requestId;
  } catch (error) {
    els.connectionError.textContent = `Gateway ${action} request failed: ${error.message}`;
    els.deviceDialogStatus.textContent = `Gateway ${action} request failed: ${error.message}`;
    pendingGatewayRequestId = null;
    updateControlAvailability();
    return null;
  }
}

function renderBluetoothDevices() {
  const result = APP.bluetoothDiscovery;
  const devices = result?.status === 'complete' && Array.isArray(result.devices) ? result.devices : [];
  els.bluetoothDeviceList.replaceChildren();
  els.deviceListEmpty.hidden = devices.length > 0;
  if (!result) {
    els.deviceListEmpty.textContent = 'No scan results yet. Scanning reports only devices found by the gateway computer.';
    return;
  }
  if (result.status === 'scanning') {
    els.deviceListEmpty.hidden = false;
    els.deviceListEmpty.textContent = 'Scanning from the gateway computer…';
    return;
  }
  if (result.status === 'unavailable') {
    els.deviceListEmpty.hidden = false;
    const error = result.error || 'Bluetooth discovery is unavailable on the gateway computer.';
    const permissionDenied = /permission|not authorized|not permitted/i.test(error);
    els.deviceListEmpty.textContent = permissionDenied
      ? `Gateway operating-system Bluetooth permission denied or adapter access blocked: ${error}`
      : error;
    if (permissionDenied) {
      const guidance = result.platform === 'darwin'
        ? 'Grant Bluetooth access to the app running the Python gateway in macOS Privacy & Security settings.'
        : 'Check Bluetooth permissions and adapter availability on the gateway computer.';
      els.deviceDialogStatus.textContent = `${guidance} The browser does not request Bluetooth permission for HC-06 Classic serial.`;
    }
    return;
  }
  if (devices.length === 0) {
    els.deviceListEmpty.hidden = false;
    els.deviceListEmpty.textContent = 'The gateway completed the scan but found no devices.';
  }
  devices.forEach((device) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'device-option';
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(selectedBluetoothDeviceId === device.id));
    option.disabled = String(APP.connection.bluetooth).toLowerCase() === 'connected';
    const details = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = device.name || 'Unknown Bluetooth device';
    const address = document.createElement('small');
    address.textContent = `ID: ${device.address || device.id}`;
    const port = document.createElement('small');
    port.textContent = device.serial_port ? `Serial: ${device.serial_port}` : 'No gateway serial-port mapping configured';
    details.append(name, address, port);
    option.append(details);
    option.addEventListener('click', () => {
      selectedBluetoothDeviceId = device.id;
      renderBluetoothDevices();
      els.deviceDialogStatus.textContent = device.serial_port
        ? `${device.name || 'Device'} selected. The gateway serial connection is not open yet; choose Connect Selected Device to request it.`
        : `${device.name || 'Device'} selected, but no gateway serial port is mapped. Configure BT_PORT or BT_DEVICE_PORTS before connecting.`;
      updateControlAvailability();
    });
    els.bluetoothDeviceList.append(option);
  });
}

function renderGatewayRequestStatus() {
  const request = APP.gatewayControlRequest;
  if (!request || !pendingGatewayRequestId || request.request_id !== pendingGatewayRequestId) return;
  if (request.status === 'pending' || request.status === 'scanning') {
    els.deviceDialogStatus.textContent = request.action === 'scan'
      ? 'The gateway is scanning nearby Bluetooth Classic devices. Any operating-system Bluetooth permission prompt appears on the gateway computer.'
      : `${request.action === 'disconnect' ? 'Disconnecting' : 'Connecting'} through the Python gateway…`;
    return;
  }
  if (discoveryTimeout) clearTimeout(discoveryTimeout);
  discoveryTimeout = null;
  if (request.status === 'completed') {
    if (request.action === 'scan') {
      const count = Number(request.devices_count || 0);
      els.deviceDialogStatus.textContent = count
        ? `Gateway scan completed. ${count} real device${count === 1 ? '' : 's'} reported.`
        : 'Gateway scan completed. No nearby devices were reported.';
    } else if (request.action === 'connect') {
      const selectedDevice = APP.bluetoothDiscovery?.devices?.find((device) => device.id === selectedBluetoothDeviceId);
      const selectedName = selectedDevice?.name || selectedBluetoothDeviceId || 'Selected device';
      els.deviceDialogStatus.textContent = `Gateway serial connection to ${selectedName} opened. Arduino responsiveness is reported separately below.`;
    } else {
      els.deviceDialogStatus.textContent = 'The gateway serial connection was closed.';
    }
  } else {
    els.deviceDialogStatus.textContent = request.error || `Gateway ${request.action} operation failed.`;
  }
  pendingGatewayRequestId = null;
  renderStatusPanels();
}

async function scanBluetoothDevices() {
  if (!cloud) {
    els.deviceDialogStatus.textContent = 'Firebase is not configured. Add the web client configuration before requesting gateway Bluetooth discovery.';
    return;
  }
  if (!APP.user) {
    els.deviceDialogStatus.textContent = 'Sign in with an authorized driver account before requesting Bluetooth discovery.';
    return;
  }
  if (String(APP.connection.bluetooth).toLowerCase() === 'connected') {
    els.deviceDialogStatus.textContent = 'A Bluetooth serial connection is already active. Disconnect it before scanning again.';
    return;
  }
  if (APP.connection.gateway !== 'Online') {
    els.deviceDialogStatus.textContent = 'The Python gateway is offline. Bluetooth Classic scanning runs on the gateway computer; browser Bluetooth support is not required.';
    return;
  }
  selectedBluetoothDeviceId = null;
  APP.bluetoothDiscovery = { status: 'scanning', devices: [] };
  renderBluetoothDevices();
  const requestId = await requestGateway('scan');
  if (!requestId) return;
  discoveryTimeout = setTimeout(() => {
    if (pendingGatewayRequestId === requestId) {
      pendingGatewayRequestId = null;
      els.deviceDialogStatus.textContent = 'The gateway did not return a scan result in time. Check its Bluetooth adapter and gateway logs, then retry.';
    }
  }, 25000);
}

async function connectSelectedBluetoothDevice() {
  if (pendingGatewayRequestId) return;
  if (!cloud) {
    els.deviceDialogStatus.textContent = 'Firebase is not configured. Add the web client configuration before requesting a gateway connection.';
    return;
  }
  if (!APP.user) {
    els.deviceDialogStatus.textContent = 'Sign in with an authorized driver account before connecting a Bluetooth device.';
    return;
  }
  if (APP.connection.gateway !== 'Online') {
    els.deviceDialogStatus.textContent = 'The Python gateway is offline. Start it on the computer connected to the HC-06, then retry.';
    return;
  }
  if (String(APP.connection.bluetooth).toLowerCase() === 'connected') {
    els.deviceDialogStatus.textContent = 'A Bluetooth serial connection is already active. Disconnect it before selecting another device.';
    return;
  }
  if (!selectedBluetoothDeviceId) {
    els.deviceDialogStatus.textContent = 'Select a device from the latest gateway scan before connecting.';
    return;
  }
  const device = APP.bluetoothDiscovery?.devices?.find((entry) => entry.id === selectedBluetoothDeviceId);
  if (!device?.serial_port) {
    els.deviceDialogStatus.textContent = device
      ? 'This discovered device has no configured gateway serial-port mapping. Configure BT_PORT or BT_DEVICE_PORTS and scan again.'
      : 'The selected device is no longer in the latest scan results. Scan again and select it.';
    return;
  }
  const requestId = await requestGateway('connect');
  if (requestId) {
    discoveryTimeout = setTimeout(() => {
      if (pendingGatewayRequestId === requestId) {
        pendingGatewayRequestId = null;
        APP.gatewayControlRequest = { ...APP.gatewayControlRequest, status: 'failed', error: 'Connection request timed out waiting for the gateway.' };
        els.deviceDialogStatus.textContent = APP.gatewayControlRequest.error;
        updateControlAvailability();
      }
    }, 25000);
  } else updateControlAvailability();
}

function closeDeviceDialog() {
  if (discoveryTimeout) clearTimeout(discoveryTimeout);
  discoveryTimeout = null;
  pendingGatewayRequestId = null;
  selectedBluetoothDeviceId = null;
  els.deviceConnectDialog.close();
  renderBluetoothDevices();
  updateControlAvailability();
}

function openDeviceDialog() {
  if (!cloud) {
    els.deviceDialogStatus.textContent = 'Firebase is not configured. Add the web client configuration and sign in before requesting gateway discovery.';
  } else if (!APP.user) {
    els.deviceDialogStatus.textContent = 'Sign in with an authorized driver account before requesting Bluetooth discovery or connection.';
  } else if (APP.connection.gateway !== 'Online') {
    els.deviceDialogStatus.textContent = 'Gateway unavailable. HC-06 discovery runs on the computer hosting the Python gateway.';
  } else if (String(APP.connection.bluetooth).toLowerCase() === 'connected') {
    els.deviceDialogStatus.textContent = 'A gateway Bluetooth serial connection is active. Disconnect it here before choosing another device.';
  } else {
    els.deviceDialogStatus.textContent = 'Choose Scan for Devices to search from the Python gateway computer. Pair the HC-06 in the gateway computer’s Bluetooth settings if needed; browser Bluetooth permission is not used for Classic serial.';
  }
  if (!els.deviceConnectDialog.open) els.deviceConnectDialog.showModal();
  renderBluetoothDevices();
  renderStatusPanels();
}

async function cancelControlOnUnavailable(message) {
  const hadDirectionalGesture = APP.activePointerId !== null;
  const tiltWasDriving = APP.tiltEnabled && APP.tiltDirection !== null;
  const autonomousWasActive = ['line-follow', 'obstacle-avoid'].includes(APP.lastMode);
  const telemetryShowsMovement = APP.telemetry.movement && APP.telemetry.movement !== 'stop';
  if (hadDirectionalGesture) await releaseDirectionalControl();
  disableTilt(message, false);
  if (!hadDirectionalGesture && (tiltWasDriving || autonomousWasActive || telemetryShowsMovement) && APP.user) {
    await sendCommand('stop', { label: 'Stop because connection became unavailable', safety: true });
  }
  const activeDirections = document.querySelectorAll('.direction-button.is-active');
  activeDirections.forEach((button) => button.classList.remove('is-active'));
}

function disableTilt(message = 'Tilt steering is off.', sendStop = true) {
  const wasDriving = APP.tiltEnabled && APP.tiltDirection !== null;
  APP.tiltEnabled = false;
  APP.tiltListening = false;
  if (tiltPermissionTimer) clearTimeout(tiltPermissionTimer);
  tiltPermissionTimer = null;
  APP.tiltDirection = null;
  window.removeEventListener('deviceorientation', handleOrientation);
  els.tiltStatus.textContent = message;
  renderStatusPanels();
  if (sendStop && wasDriving && APP.user && cloud) sendCommand('stop', { label: 'Tilt cancellation stop', safety: true });
}

async function enableTilt() {
  if (!APP.ready || APP.activePointerId !== null || APP.lastMode !== 'manual') {
    disableTilt('Tilt requires an authenticated, ready vehicle in manual mode.');
    return;
  }
  if (!('DeviceOrientationEvent' in window)) {
    disableTilt('Device orientation is not supported by this browser/device.');
    return;
  }
  if (!window.isSecureContext) {
    disableTilt('Device orientation requires HTTPS or localhost in this browser.');
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        disableTilt('Device orientation permission was not granted.');
        return;
      }
    } catch (error) {
      disableTilt(`Device orientation permission failed: ${error.message}`);
      return;
    }
  }
  const stopped = await sendCommand('stop', { label: 'Stop before tilt steering', safety: true });
  if (!stopped) {
    disableTilt('Tilt could not start because STOP was not accepted.');
    return;
  }
  APP.tiltListening = true;
  APP.tiltEnabled = false;
  els.tiltStatus.textContent = 'Waiting for live device orientation data…';
  window.removeEventListener('deviceorientation', handleOrientation);
  window.addEventListener('deviceorientation', handleOrientation);
  renderStatusPanels();
  tiltPermissionTimer = setTimeout(() => {
    if (APP.tiltListening && !APP.tiltEnabled) disableTilt('No orientation data received. Tilt steering remains off.');
  }, 3000);
}

async function handleOrientation(event) {
  if (!APP.tiltListening || !APP.ready || APP.activePointerId !== null || APP.lastMode !== 'manual') return;
  if (!Number.isFinite(event.gamma)) {
    disableTilt('Orientation readings are unavailable.');
    return;
  }
  if (!APP.tiltEnabled) {
    APP.tiltEnabled = true;
    if (tiltPermissionTimer) clearTimeout(tiltPermissionTimer);
    tiltPermissionTimer = null;
    els.tiltStatus.textContent = 'Tilt steering active. Roll to steer; return to neutral to stop.';
    renderStatusPanels();
  }
  let direction = null;
  if (event.gamma <= -SETTINGS.tiltSensitivity) direction = 'left';
  if (event.gamma >= SETTINGS.tiltSensitivity) direction = 'right';
  if (Math.abs(event.gamma) <= SETTINGS.tiltDeadZone) direction = null;
  if (direction === APP.tiltDirection) return;
  APP.tiltDirection = direction;
  await writeOperatorHeartbeat();
  if (direction) await sendCommand(direction, { label: `Tilt ${direction}` });
  else await sendCommand('stop', { label: 'Tilt neutral', safety: true });
}

function applyDensity() {
  els.body.classList.toggle('compact-mode', APP.density === 'compact');
  els.densitySetting.value = APP.density;
  localStorage.setItem('pirccar-density', APP.density);
}

function applyFontSize() {
  els.body.classList.toggle('large-font', APP.fontSize === 'large');
  els.fontSizeSetting.value = APP.fontSize;
  localStorage.setItem('pirccar-font-size', APP.fontSize);
}

function applyMotionPreference() {
  els.body.classList.toggle('reduce-motion', APP.reducedMotion);
  els.motionSetting.checked = APP.reducedMotion;
  localStorage.setItem('pirccar-reduced-motion', String(APP.reducedMotion));
}

function applySettings() {
  els.tiltSensitivity.value = String(SETTINGS.tiltSensitivity);
  els.tiltSensitivityValue.value = `${SETTINGS.tiltSensitivity}°`;
  els.tiltDeadZone.value = String(SETTINGS.tiltDeadZone);
  els.tiltDeadZoneValue.value = `${SETTINGS.tiltDeadZone}°`;
  els.autoReconnect.checked = SETTINGS.autoReconnect;
  els.heartbeatTimeout.value = String(SETTINGS.heartbeatTimeout);
  els.commandHoldTimeout.value = String(SETTINGS.commandHoldTimeout);
  document.getElementById('heartbeatSettingValue').textContent = `${SETTINGS.heartbeatTimeout} ms`;
  document.getElementById('holdSettingValue').textContent = `${SETTINGS.commandHoldTimeout} ms`;
}

function clampSetting(input, min, max, fallback) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour12: false });
}

function pushLog(type, event, status = 'info') {
  APP.commandHistory.unshift({
    time: formatTime(),
    type,
    event,
    status
  });
  renderLogs();
  renderEvents();
}

function renderEvents() {
  const limit = 5;
  const items = APP.commandHistory.slice(0, limit).map((entry) => {
    const stateText = entry.type === 'safety' ? 'Safety' : entry.type === 'connection' ? 'Connection' : 'System';
    return `<li><strong>${escapeHtml(stateText)}</strong><span>${escapeHtml(entry.event)}</span></li>`;
  });

  els.eventList.innerHTML = items.length ? items.join('') : '<li><strong>System</strong><span>No events recorded yet</span></li>';
}

function renderLogs() {
  const filter = els.logFilterType.value;
  const rows = APP.commandHistory.filter((entry) => {
    if (filter === 'all') return true;
    return entry.type === filter;
  });

  if (!rows.length) {
    els.logTableBody.innerHTML = `
      <tr>
        <td colspan="4">No events recorded yet</td>
      </tr>
    `;
    return;
  }

  els.logTableBody.innerHTML = rows
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(entry.time)}</td>
          <td>${escapeHtml(entry.type)}</td>
          <td>${escapeHtml(entry.event)}</td>
          <td>${escapeHtml(entry.status)}</td>
        </tr>
      `
    )
    .join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatReadableState(value, fallback = 'Unavailable') {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return value;
}

function formatSensorState(value) {
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'black') return 'Black (1)';
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'white') return 'White (0)';
  return formatReadableState(value);
}

function renderStatusPanels() {
  const telemetryAt = APP.telemetry.timestamp ? Date.parse(APP.telemetry.timestamp) : 0;
  const telemetryFresh = telemetryAt > 0 && Date.now() - telemetryAt <= Math.max(2000, SETTINGS.heartbeatTimeout);
  const timestamp = telemetryFresh ? new Date(telemetryAt).toLocaleTimeString([], { hour12: false }) : 'Waiting for telemetry';
  const banner = document.getElementById('liveStatusBanner');
  if (banner) {
    banner.textContent = APP.configured
      ? (APP.user ? 'Authenticated session. Controls unlock only when the gateway and Arduino are confirmed online.' : 'Firebase configured. Sign in with an authorized operator account.')
      : 'Waiting for live Firebase configuration. No commands or telemetry are simulated.';
  }

  els.gatewayStatusValue.textContent = formatReadableState(APP.connection.gateway);
  els.bluetoothStatusValue.textContent = formatReadableState(APP.connection.bluetooth);
  els.arduinoStatusValue.textContent = formatReadableState(APP.connection.arduino);
  els.operatingModeValue.textContent = readableMode(APP.lastMode);
  els.safetyStatusValue.textContent = APP.safetyLocked ? 'Locked' : (APP.user ? 'Armed' : 'Unknown');
  els.telemetryStampValue.textContent = telemetryFresh ? timestamp : 'Telemetry unavailable';

  els.gatewayStateBadge.textContent = formatReadableState(APP.connection.gateway);
  els.bluetoothStateBadge.textContent = formatReadableState(APP.connection.bluetooth);
  els.modeBadge.textContent = readableMode(APP.lastMode);

  els.ultrasonicValue.textContent = !telemetryFresh || APP.telemetry.distance === null ? 'Unavailable' : `${APP.telemetry.distance} cm`;
  els.leftIrValue.textContent = telemetryFresh ? formatSensorState(APP.telemetry.leftIR) : 'Unavailable';
  els.centerIrValue.textContent = telemetryFresh ? formatSensorState(APP.telemetry.centerIR) : 'Unavailable';
  els.rightIrValue.textContent = telemetryFresh ? formatSensorState(APP.telemetry.rightIR) : 'Unavailable';
  const movementValue = document.getElementById('movementStateValue');
  if (movementValue) movementValue.textContent = telemetryFresh ? formatReadableState(APP.telemetry.movement) : 'Unavailable';
  document.getElementById('authSnapshot').textContent = APP.user ? 'Authenticated' : 'Not signed in';
  document.getElementById('modeSnapshot').textContent = readableMode(APP.lastMode);
  document.getElementById('telemetrySnapshot').textContent = telemetryFresh ? 'Receiving' : 'Unavailable';
  document.getElementById('safetySnapshot').textContent = APP.safetyLocked ? 'Locked' : (APP.user ? 'Armed' : 'Unknown');
  document.getElementById('overallStatus').textContent = APP.ready ? 'Control ready' : 'Not ready';
  document.getElementById('telemetryStatus').textContent = telemetryFresh ? 'Telemetry received' : 'Telemetry unavailable';
  document.getElementById('firebaseConnection').textContent = APP.connection.firebase;
  document.getElementById('gatewayConnection').textContent = APP.connection.gateway;
  document.getElementById('bluetoothConnection').textContent = APP.connection.bluetooth;
  document.getElementById('arduinoConnection').textContent = APP.connection.arduino;
  document.getElementById('gatewayIdValue').textContent = window.PIRCCAR_FIREBASE_CONFIG?.deviceId || 'pirccar-001';

  const bluetoothConnected = APP.connection.gateway === 'Online'
    && APP.connection.firebase === 'Connected'
    && String(APP.connection.bluetooth).toLowerCase() === 'connected';
  els.controllerConnectionText.textContent = bluetoothConnected ? 'CONNECTED' : 'DISCONNECTED';
  els.controllerConnectionLed.classList.toggle('is-connected', bluetoothConnected);
  els.deviceConnectButtonText.textContent = bluetoothConnected ? 'DEVICE CONNECTED' : 'CONNECT DEVICE';
  els.disconnectBluetoothDevice.hidden = !bluetoothConnected;
  const gatewayOperationPending = Boolean(APP.gatewayControlRequest && ['pending', 'scanning'].includes(APP.gatewayControlRequest.status));
  els.disconnectBluetoothDevice.disabled = APP.connection.gateway !== 'Online';
  els.disconnectBluetoothDevice.disabled ||= gatewayOperationPending;
  els.controllerMovementState.textContent = telemetryFresh && APP.telemetry.movement
    ? (APP.telemetry.movement === 'stop' ? 'STOPPED' : `ARDUINO: ${String(APP.telemetry.movement).toUpperCase()}`)
    : APP.safetyLocked ? 'SAFETY LOCKED' : 'STATUS UNKNOWN';
  els.controllerMovementState.previousElementSibling?.classList.toggle('is-connected', telemetryFresh && APP.telemetry.movement === 'stop');
  const lineButton = document.querySelector('[data-mode="line-follow"]');
  const obstacleButton = document.querySelector('[data-mode="obstacle-avoid"]');
  const lineActive = APP.lastMode === 'line-follow';
  const obstacleActive = APP.lastMode === 'obstacle-avoid';
  lineButton.setAttribute('aria-pressed', String(lineActive));
  lineButton.lastElementChild.textContent = lineActive ? 'LINE ON' : 'LINE OFF';
  lineButton.querySelector('.mode-indicator').classList.toggle('is-on', lineActive);
  obstacleButton.setAttribute('aria-pressed', String(obstacleActive));
  obstacleButton.lastElementChild.textContent = obstacleActive ? 'ANTI-CRASH ON' : 'ANTI-CRASH OFF';
  obstacleButton.querySelector('.mode-indicator').classList.toggle('is-on', obstacleActive);
  document.querySelectorAll('[data-mode="line-follow"], [data-mode="obstacle-avoid"]').forEach((button) => {
    button.setAttribute('aria-disabled', String(!APP.ready || Boolean(APP.pendingMode)));
  });
  els.tiltToggle.setAttribute('aria-pressed', String(APP.tiltEnabled));
  els.tiltToggleLabel.textContent = APP.tiltEnabled ? 'TILT ON' : APP.tiltListening ? 'TILT STARTING' : 'TILT OFF';
  els.tiltToggle.querySelector('.mode-indicator').classList.toggle('is-on', APP.tiltEnabled);
  const reportedMovement = telemetryFresh ? APP.telemetry.movement : null;
  document.querySelectorAll('.direction-button[data-command]').forEach((button) => {
    button.classList.toggle('is-active', Boolean(reportedMovement && reportedMovement === button.dataset.command));
  });
  if (els.controllerFeedback && APP.commandStatus) {
    els.controllerFeedback.textContent = `${APP.lastCommand || 'Command'}: ${APP.commandStatus}${lastSerialAck !== 'Unavailable' ? ` • Arduino ${lastSerialAck}` : ''}`;
  }

  els.commandStatusList.innerHTML = `
    <li><span>Last request</span><strong>${APP.lastCommand || 'None'}</strong></li>
    <li><span>Gateway status</span><strong>${APP.commandStatus || 'Unavailable'}</strong></li>
    <li><span>Arduino acknowledgement</span><strong>${lastSerialAck}</strong></li>
    <li><span>Emergency Lock</span><strong>${APP.safetyLocked ? 'Locked' : 'Not verified'}</strong></li>
  `;
  updateControlAvailability();
}

function readableMode(mode) {
  return ({ locked: 'Locked', manual: 'Manual', 'line-follow': 'Line Following', 'obstacle-avoid': 'Anti-Crash', stop: 'Stopped', unknown: 'Unknown' })[mode] || 'Unknown';
}

function updateChart() {
  const canvas = els.telemetryChart;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fillRect(0, 0, width, height);

  const dataPoints = APP.telemetryHistory.filter((value) => Number.isFinite(value) && value >= 0 && value < 999);
  if (dataPoints.length < 2) {
    ctx.fillStyle = '#9fb6cf';
    ctx.font = '16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No telemetry history yet', width / 2, height / 2);
    return;
  }

  ctx.strokeStyle = '#f4c96d';
  ctx.lineWidth = 2;
  ctx.beginPath();

  const max = Math.max(...dataPoints, 10);
  const min = 0;
  const gap = width / (dataPoints.length - 1);

  dataPoints.forEach((value, index) => {
    const x = index * gap;
    const y = height - ((value - min) / (max - min || 1)) * (height - 24) - 12;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
}

async function sendCommand(command, { label = command, safety = false } = {}) {
  if (!cloud || !APP.user || (!APP.ready && !safety)) {
    pushLog('command', `${label} not sent: authenticated live connection required`, 'rejected');
    return false;
  }
  if (APP.safetyLocked && !['emergency-stop', 'rearm'].includes(command)) {
    pushLog('safety', `${label} blocked by emergency lock`, 'blocked');
    return false;
  }
  try {
    const commandRef = cloud.push(cloud.ref(cloud.db, `${cloud.devicePath}/commands`));
    const now = Date.now();
    const record = {
      command,
      command_id: commandRef.key,
      status: 'pending',
      requested_by: APP.user.uid,
      requested_at: new Date(now).toISOString(),
      created_at_ms: now,
      expires_at: new Date(now + SETTINGS.commandHoldTimeout).toISOString(),
      command_seq: ++commandSequence,
      priority: safety || command === 'stop' ? 100 : 10
    };
    await cloud.set(commandRef, record);
    APP.lastCommand = command;
    APP.commandStatus = 'Pending';
    renderStatusPanels();
    return true;
  } catch (error) {
    pushLog('command', `${label} failed: ${error.message}`, 'failed');
    return false;
  }
}

async function handleDirectionalPress(event) {
  event.preventDefault();
  if (!APP.ready) {
    els.controllerFeedback.textContent = 'Control unavailable. Sign in and wait for a live, ready gateway and Arduino connection.';
    return;
  }
  if (APP.activePointerId !== null) {
    els.controllerFeedback.textContent = 'Another direction is already being held. Release it before choosing another direction.';
    return;
  }
  if (APP.tiltListening || APP.tiltEnabled || APP.pendingMode) {
    els.controllerFeedback.textContent = 'Manual movement is paused while tilt or a mode change is active.';
    return;
  }
  const button = event.currentTarget;
  const command = button.dataset.command;
  if (!command) return;
  APP.activePointerId = event.pointerId;
  APP.activeButton = button;
  button.classList.add('is-pressed');
  button.setPointerCapture?.(event.pointerId);
  const pointerId = event.pointerId;
  await writeOperatorHeartbeat();
  if (APP.activePointerId !== pointerId) return;
  const sent = await sendCommand(command, { label: command });
  if (!sent && APP.activePointerId === pointerId) releaseDirectionalControl(pointerId);
}

async function releaseDirectionalControl(pointerId = APP.activePointerId) {
  if (APP.activePointerId === null || (pointerId !== null && pointerId !== APP.activePointerId)) return;
  const activeButton = APP.activeButton;
  APP.activePointerId = null;
  APP.activeButton = null;
  activeButton?.classList.remove('is-pressed');
  if (activeButton?.hasPointerCapture?.(pointerId)) {
    try { activeButton.releasePointerCapture(pointerId); } catch { /* Pointer was already released by the browser. */ }
  }
  if (APP.user && cloud) {
    await writeOperatorHeartbeat();
    await sendCommand('stop', { label: 'Stop on release', safety: true });
  }
}

async function handleModeCommand(event) {
  const mode = event.currentTarget.dataset.mode;
  if (!mode) return;
  if (APP.pendingMode || (mode === 'rearm' && APP.rearmPending)) {
    els.controllerFeedback.textContent = 'A mode or safety request is already awaiting a result.';
    return;
  }
  if (mode === 'rearm' && !APP.safetyLocked) {
    els.controllerFeedback.textContent = 'Safety lock is not active; no re-arm command was sent.';
    return;
  }
  if (mode === 'rearm' && (!APP.user || !cloud)) {
    els.controllerFeedback.textContent = 'Re-arm was not sent because an authenticated Firebase session is unavailable.';
    return;
  }
  if (mode !== 'rearm' && !APP.ready) {
    els.controllerFeedback.textContent = 'Mode unavailable. Sign in and wait for a live, ready gateway and Arduino connection.';
    return;
  }
  let command = mode;
  if (mode === APP.lastMode) {
    disableTilt('Tilt steering disabled because an autonomous mode was selected.', false);
    await cancelDirectionalGesture();
    command = 'stop';
  } else {
    disableTilt('Tilt steering disabled for mode change.', false);
    await releaseDirectionalControl();
  }
  if (mode === 'rearm') {
    APP.rearmPending = true;
    const accepted = await sendCommand('rearm', { label: 'Re-arm', safety: true });
    if (!accepted) APP.rearmPending = false;
    return;
  }
  APP.pendingMode = command === 'stop' ? 'manual' : command;
  updateControlAvailability();
  const accepted = await sendCommand(command, { label: command === 'stop' ? 'Stop autonomous mode' : readableMode(mode), safety: command === 'stop' });
  if (!accepted) APP.pendingMode = null;
  else {
    if (modeCommandTimer) clearTimeout(modeCommandTimer);
    modeCommandTimer = setTimeout(() => {
      APP.pendingMode = null;
      els.controllerFeedback.textContent = 'Mode change has no Arduino confirmation yet. Control remains governed by live gateway state.';
      updateControlAvailability();
    }, 4000);
  }
  updateControlAvailability();
}

async function cancelDirectionalGesture() {
  if (APP.activePointerId === null) return;
  const pointerId = APP.activePointerId;
  const button = APP.activeButton;
  APP.activePointerId = null;
  APP.activeButton = null;
  button?.classList.remove('is-pressed');
  if (button?.hasPointerCapture?.(pointerId)) {
    try { button.releasePointerCapture(pointerId); } catch { /* Pointer was already released by the browser. */ }
  }
  await writeOperatorHeartbeat();
}

async function requestNormalStop() {
  disableTilt('Tilt steering stopped.', false);
  await cancelDirectionalGesture();
  if (!APP.user || !cloud) {
    els.controllerFeedback.textContent = 'STOP was not sent because an authenticated Firebase session is unavailable.';
    return;
  }
  const sent = await sendCommand('stop', { label: 'Stop', safety: true });
  els.controllerFeedback.textContent = sent ? 'STOP requested. Waiting for gateway and Arduino confirmation.' : 'STOP could not be sent; the firmware lease watchdog remains the fallback.';
}

async function emergencyStop() {
  if (!APP.user || !cloud) {
    els.controllerFeedback.textContent = 'Emergency Stop was not sent because an authenticated Firebase session is unavailable.';
    return;
  }
  APP.safetyLocked = true;
  APP.emergencyStopPending = true;
  APP.rearmPending = false;
  APP.ready = false;
  disableTilt('Emergency lock is active.', false);
  await cancelDirectionalGesture();
  updateControlAvailability();
  await sendCommand('emergency-stop', { label: 'Emergency Stop', safety: true });
  pushLog('safety', 'Emergency stop requested; confirmation pending from gateway and Arduino', 'pending');
  renderStatusPanels();
}

function exportLogs() {
  const rows = APP.commandHistory.map((entry) => [entry.time, entry.type, entry.event, entry.status]);
  const csv = rows.map((row) => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'pirccar-logs.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

const APP_VIEW_IDS = new Set([
  'overview', 'dashboard', 'controls', 'sensors', 'connections', 'logs',
  'settings', 'how-it-works'
]);

function activateViewFromHash() {
  const hashValue = window.location.hash.slice(1);
  const [requestedView, ...fragmentParts] = hashValue.split('/');
  const viewId = APP_VIEW_IDS.has(requestedView) ? requestedView : 'overview';
  const fragmentId = fragmentParts.join('/');
  const normalizedHash = fragmentId && viewId === 'how-it-works'
    ? `#${viewId}/${fragmentId}`
    : `#${viewId}`;
  if (window.location.hash !== normalizedHash) {
    window.history.replaceState(null, '', `#${viewId}`);
  }

  document.querySelectorAll('[data-view]').forEach((view) => {
    const active = view.dataset.view === viewId;
    view.hidden = !active;
    view.classList.toggle('is-active', active);
  });
  document.querySelectorAll('.main-nav a[href^="#"]').forEach((link) => {
    if (link.getAttribute('href') === `#${viewId}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (fragmentId && viewId === 'how-it-works') {
    scrollToCaseStudySection(fragmentId);
  }
}

function scrollToCaseStudySection(sectionId) {
  const target = document.getElementById(sectionId);
  if (!target || !target.classList.contains('case-study-section')) return;
  const top = target.getBoundingClientRect().top + window.scrollY - 108;
  window.scrollTo({ top, behavior: 'auto' });
}

function initializeSourceCodeViewer() {
  const tabs = [...document.querySelectorAll('.source-file-tabs [role="tab"]')];
  const panel = document.getElementById('source-panel');
  const code = document.getElementById('source-code');
  if (!tabs.length || !panel || !code) return;

  const selectSource = (tab, moveFocus = false) => {
    const source = document.getElementById(tab.dataset.sourceId);
    if (!source) return;
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tab.id);
    code.textContent = source.textContent.replace(/^\r?\n/, '').replace(/\n[\t ]*$/, '');
    if (moveFocus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectSource(tab));
    tab.addEventListener('keydown', (event) => {
      let nextIndex = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      selectSource(tabs[nextIndex], true);
    });
  });

  selectSource(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0]);
}

function initializeNavigation() {
  if (navigationInitialized) return;
  navigationInitialized = true;
  activateViewFromHash();
  document.querySelector('.case-study-toc').addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#how-it-works/cs-"]');
    if (!link) return;
    event.preventDefault();
    const sectionId = link.getAttribute('href').split('/').at(-1);
    window.history.pushState(null, '', `#how-it-works/${sectionId}`);
    activateViewFromHash();
    scrollToCaseStudySection(sectionId);
  });
  window.addEventListener('hashchange', () => {
    // Leaving Controls while a directional pointer is held must end the
    // command lease with the normal STOP request; navigation never rearms.
    void releaseDirectionalControl();
    disableTilt('Tilt steering stopped when changing views.');
    if (els.deviceConnectDialog.open) closeDeviceDialog();
    document.querySelector('.main-nav').classList.remove('is-open');
    els.globalMenuButton.setAttribute('aria-expanded', 'false');
    activateViewFromHash();
  });
}

function attachListeners() {
  document.querySelectorAll('[data-command]').forEach((button) => {
    const isDirectional = ['forward', 'backward', 'left', 'right'].includes(button.dataset.command);

    if (isDirectional) {
      button.addEventListener('pointerdown', handleDirectionalPress);
      button.addEventListener('pointerup', (event) => releaseDirectionalControl(event.pointerId));
      button.addEventListener('pointercancel', (event) => releaseDirectionalControl(event.pointerId));
      button.addEventListener('lostpointercapture', (event) => releaseDirectionalControl(event.pointerId));
    } else {
      button.addEventListener('click', () => sendCommand('stop', { label: 'Stop', safety: true }));
    }
  });

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', handleModeCommand);
  });

  els.emergencyStopButton.addEventListener('click', emergencyStop);
  els.controllerStopButton.addEventListener('click', requestNormalStop);
  els.controllerThemeToggle.addEventListener('click', () => {
    APP.theme = APP.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });
  els.globalMenuButton.addEventListener('click', () => {
    const nav = document.querySelector('.main-nav');
    nav.classList.toggle('is-open');
    els.globalMenuButton.setAttribute('aria-expanded', String(nav.classList.contains('is-open')));
  });
  els.deviceConnectOpen.addEventListener('click', openDeviceDialog);
  els.deviceDialogClose.addEventListener('click', closeDeviceDialog);
  els.deviceDialogCancel.addEventListener('click', closeDeviceDialog);
  els.deviceConnectDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDeviceDialog();
  });
  els.deviceConnectDialog.addEventListener('click', (event) => {
    if (event.target === els.deviceConnectDialog) closeDeviceDialog();
  });
  els.scanBluetoothDevices.addEventListener('click', scanBluetoothDevices);
  els.connectSelectedDevice.addEventListener('click', connectSelectedBluetoothDevice);
  els.disconnectBluetoothDevice.addEventListener('click', async () => {
    if (APP.activePointerId !== null) await releaseDirectionalControl();
    disableTilt('Tilt steering stopped before Bluetooth disconnect.');
    const requestId = await requestGateway('disconnect');
    if (requestId) els.deviceDialogStatus.textContent = 'Disconnect requested. Waiting for the gateway to close its serial connection.';
  });
  els.gatewayConnect.addEventListener('click', () => requestGateway('connect'));
  els.gatewayDisconnect.addEventListener('click', async () => {
    await sendCommand('stop', { label: 'Stop before gateway disconnect', safety: true });
    await requestGateway('disconnect');
  });

  els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!cloud) return;
    els.authStatus.textContent = 'Signing in...';
    try {
      await cloud.signInWithEmailAndPassword(cloud.auth, els.authEmail.value.trim(), els.authPassword.value);
      els.authPassword.value = '';
    } catch (error) {
      els.authStatus.textContent = `Sign-in failed: ${error.message}`;
    }
  });
  els.authSignOut.addEventListener('click', async () => {
    await releaseDirectionalControl();
    disableTilt('Tilt steering is off.');
    if (cloud) await cloud.signOut(cloud.auth);
  });

  els.exportLogs.addEventListener('click', exportLogs);
  els.logFilterType.addEventListener('change', renderLogs);

  els.themeToggle.addEventListener('click', () => {
    APP.theme = APP.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });

  els.themeSetting.addEventListener('change', (event) => {
    APP.theme = event.target.value;
    applyTheme();
  });

  els.densitySetting.addEventListener('change', (event) => {
    APP.density = event.target.value;
    applyDensity();
  });

  els.fontSizeSetting.addEventListener('change', (event) => {
    APP.fontSize = event.target.value;
    applyFontSize();
  });

  els.motionSetting.addEventListener('change', (event) => {
    APP.reducedMotion = event.target.checked;
    applyMotionPreference();
  });

  els.tiltToggle.addEventListener('click', () => {
    if (APP.tiltListening || APP.tiltEnabled) disableTilt('Tilt steering is off.');
    else enableTilt();
  });
  els.tiltSensitivity.addEventListener('input', (event) => {
    SETTINGS.tiltSensitivity = clampSetting(event.target, 5, 35, 18);
    localStorage.setItem('pirccar-tilt-sensitivity', String(SETTINGS.tiltSensitivity));
    applySettings();
  });
  els.tiltDeadZone.addEventListener('input', (event) => {
    SETTINGS.tiltDeadZone = clampSetting(event.target, 0, 15, 5);
    localStorage.setItem('pirccar-tilt-dead-zone', String(SETTINGS.tiltDeadZone));
    applySettings();
  });
  els.autoReconnect.addEventListener('change', (event) => {
    SETTINGS.autoReconnect = event.target.checked;
    localStorage.setItem('pirccar-auto-reconnect', String(SETTINGS.autoReconnect));
    writeOperatorHeartbeat();
  });
  els.heartbeatTimeout.addEventListener('change', (event) => {
    SETTINGS.heartbeatTimeout = clampSetting(event.target, 1000, 30000, 5000);
    localStorage.setItem('pirccar-heartbeat-timeout', String(SETTINGS.heartbeatTimeout));
    applySettings();
    writeOperatorHeartbeat();
  });
  els.commandHoldTimeout.addEventListener('change', (event) => {
    SETTINGS.commandHoldTimeout = clampSetting(event.target, 250, 1500, 700);
    localStorage.setItem('pirccar-command-hold-timeout', String(SETTINGS.commandHoldTimeout));
    applySettings();
  });

  window.addEventListener('blur', () => {
    releaseDirectionalControl();
    disableTilt('Tilt stopped because the page lost focus.');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseDirectionalControl();
      disableTilt('Tilt stopped because the page is hidden.');
    }
  });
  window.addEventListener('pagehide', () => {
    releaseDirectionalControl();
    disableTilt('Tilt stopped because the page is closing.');
  });
}

function updateControlAvailability() {
  const gatewayOperationPending = Boolean(APP.gatewayControlRequest && ['pending', 'scanning'].includes(APP.gatewayControlRequest.status));
  document.querySelectorAll('[data-command]').forEach((button) => {
    button.setAttribute('aria-disabled', String(!APP.ready || Boolean(APP.pendingMode)));
  });
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const unavailable = button.dataset.mode === 'rearm'
      ? !APP.user || !APP.safetyLocked || APP.rearmPending
      : !APP.ready || Boolean(APP.pendingMode);
    button.setAttribute('aria-disabled', String(unavailable));
  });
  els.controllerStopButton.setAttribute('aria-disabled', String(!APP.user));
  els.emergencyStopButton.setAttribute('aria-disabled', String(!APP.user));
  els.gatewayConnect.disabled = !APP.user;
  els.gatewayDisconnect.disabled = !APP.user;
  els.authSubmit.disabled = !cloud || Boolean(APP.user);
  els.deviceConnectOpen.disabled = false;
  // Keep the actions clickable so the dialog can explain missing prerequisites.
  // Authorization, gateway availability, device selection, and connection state
  // are still checked by the handlers before any Firebase request is made.
  els.connectSelectedDevice.disabled = gatewayOperationPending || Boolean(pendingGatewayRequestId);
  els.scanBluetoothDevices.disabled = gatewayOperationPending || Boolean(pendingGatewayRequestId);
  els.disconnectBluetoothDevice.disabled = APP.connection.gateway !== 'Online' || gatewayOperationPending || Boolean(pendingGatewayRequestId);
  els.globalMenuButton.setAttribute('aria-expanded', String(document.querySelector('.main-nav').classList.contains('is-open')));
}

function initialLoad() {
  initializeNavigation();
  initializeSourceCodeViewer();
  applyTheme();
  applyDensity();
  applyFontSize();
  applyMotionPreference();
  applySettings();
  updateControlAvailability();
  renderStatusPanels();
  renderLogs();
  renderEvents();
  updateChart();
  attachListeners();
  initializeFirebase();
}

initialLoad();
