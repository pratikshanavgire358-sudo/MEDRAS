/*
================================================================
 MEDRAS - VEHICLE CONTROLLER
 FILE : 03_Vehicle.ino
 DEVICE: ESP32 #3 - VEHICLE
================================================================

PURPOSE
----------------------------------------------------------------
Real-time vehicle emergency / accident detection controller.

COMPONENTS
----------------------------------------------------------------
1. SW-420 Vibration Sensor
2. Emergency Push Button
3. Emergency Cancel Push Button
4. Buzzer
5. 16x2 I2C LCD
6. SIM900A GSM Module
7. NEO-6M GPS Module
8. MPU6050
9. ESP32 DevKit
10. IR / Vehicle Detection Sensor - FRONT ONLY

ARCHITECTURE
----------------------------------------------------------------
Vehicle ESP32
    |
    | Wi-Fi + MQTT
    v
MEDRAS Backend / FastAPI + MQTT + Database
    |
    +--> User Dashboard
    +--> Family Members
    +--> Ambulance Dashboard
    +--> Hospital Dashboard
    +--> Master Admin Dashboard
    +--> Nearest Ambulance selection
    +--> Nearest Hospital selection
    +--> Green Corridor coordination

IMPORTANT
----------------------------------------------------------------
- ESP32 #3 does NOT decide which ambulance/hospital is nearest.
- Backend makes the assignment and sends the selected details back.
- MQTT is used for fast telemetry and emergency events.
- Telemetry is published every 1 second.
- Emergency events are published immediately.
- SIM900A can send local SMS/call notifications to numbers supplied
  by the backend. No phone numbers are hard-coded.
- Google Maps URL is a current GPS snapshot.
- LIVE_TRACKING_BASE_URL must be replaced by the deployed MEDRAS URL.
- Full dashboard live tracking is handled by the backend/WebSocket layer.
================================================================
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include <math.h>

// MPU6050 using direct I2C registers.
// This avoids dependency on a separate MPU6050 library.

#include <string>
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// ================= MEDRAS AUTO SERVER DISCOVERY =================
// Backend broadcasts MEDRAS_SERVER=<current-laptop-ip>:1883 on UDP 4210.
#include <WiFiUdp.h>

// ============================================================
// MEDRAS HTTP + WEBSOCKET CLIENTS (in addition to MQTT)
// Backend contract expected by this firmware:
//   HTTP POST http://<discovered-server-ip>:5000/api/iot/telemetry
//   WebSocket ws://<discovered-server-ip>:8000/ws/iot
// The backend must implement these endpoints; firmware presence
// alone does not create the server endpoints.
// ============================================================
#include <HTTPClient.h>
#include <WebSocketsClient.h>

WebSocketsClient medrasWebSocket;
bool medrasWebSocketStarted = false;
bool medrasWebSocketConnected = false;
String medrasTransportHost = "";
unsigned long medrasLastHttpPost = 0;
unsigned long medrasLastWebSocketHeartbeat = 0;
const uint16_t MEDRAS_HTTP_PORT = 8000;
const uint16_t MEDRAS_WEBSOCKET_PORT = 8000;
const unsigned long MEDRAS_HTTP_INTERVAL_MS = 10000UL;
const unsigned long MEDRAS_WS_HEARTBEAT_MS = 5000UL;






WiFiUDP medrasDiscoveryUDP;
IPAddress medrasMQTTServerIP(0, 0, 0, 0);
uint16_t medrasMQTTServerPort = 1883;

void medrasWebSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      medrasWebSocketConnected = true;
      Serial.println("[MEDRAS WS] Connected to backend");
      break;
    case WStype_DISCONNECTED:
      medrasWebSocketConnected = false;
      Serial.println("[MEDRAS WS] Disconnected; auto-reconnect enabled");
      break;
    case WStype_TEXT:
      Serial.print("[MEDRAS WS] Server message: ");
      for (size_t i = 0; i < length; ++i) Serial.print((char)payload[i]);
      Serial.println();
      // Commands that affect emergency/traffic safety must still be
      // validated by the existing MQTT/backend authorization flow.
      break;
    default:
      break;
  }
}

void medrasTransportTask() {
  if (WiFi.status() != WL_CONNECTED) {
    medrasWebSocketConnected = false;
    return;
  }

  // Reconfigure the HTTP/WebSocket target when UDP discovery changes IP.
  if (medrasMQTTServerIP[0] == 0 && medrasMQTTServerIP[1] == 0 &&
      medrasMQTTServerIP[2] == 0 && medrasMQTTServerIP[3] == 0) return;

  String host = medrasMQTTServerIP.toString();
  if (!medrasWebSocketStarted || host != medrasTransportHost) {
    if (medrasWebSocketStarted) medrasWebSocket.disconnect();
    medrasTransportHost = host;
    medrasWebSocket.onEvent(medrasWebSocketEvent);
    medrasWebSocket.setReconnectInterval(5000);
    medrasWebSocket.begin(host.c_str(), MEDRAS_WEBSOCKET_PORT, "/ws/iot");
    medrasWebSocketStarted = true;
    Serial.print("[MEDRAS WS] Target: ws://");
    Serial.print(host);
    Serial.println(":8000/ws/iot");
  }

  medrasWebSocket.loop();

  // HTTP status heartbeat; actual sensor/event data remains on the
  // existing MQTT topics. This endpoint must be implemented server-side.
  unsigned long now = millis();
  if (now - medrasLastHttpPost >= MEDRAS_HTTP_INTERVAL_MS) {
    medrasLastHttpPost = now;
    HTTPClient http;
    String url = String("http://") + host + ":" + MEDRAS_HTTP_PORT + "/api/iot/telemetry";
    if (http.begin(url)) {
      http.setConnectTimeout(1200);
      http.setTimeout(1500);
      http.addHeader("Content-Type", "application/json");
      StaticJsonDocument<256> payload;
      payload["device_id"] = "ESP32_VEHICLE_001";
      payload["transport"] = "HTTP";
      payload["wifi_connected"] = true;
      payload["mqtt_connected"] = mqtt.connected();
      payload["websocket_connected"] = medrasWebSocketConnected;
      payload["uptime_ms"] = now;
      String body;
      serializeJson(payload, body);
      int code = http.POST(body);
      Serial.printf("[MEDRAS HTTP] POST status=%d\n", code);
      http.end();
    }
  }

  if (medrasWebSocketConnected && now - medrasLastWebSocketHeartbeat >= MEDRAS_WS_HEARTBEAT_MS) {
    medrasLastWebSocketHeartbeat = now;
    StaticJsonDocument<192> heartbeat;
    heartbeat["type"] = "device_heartbeat";
    heartbeat["device_id"] = "ESP32_VEHICLE_001";
    heartbeat["mqtt_connected"] = mqtt.connected();
    heartbeat["uptime_ms"] = now;
    String message;
    serializeJson(heartbeat, message);
    medrasWebSocket.sendTXT(message);
  }
}


bool medrasServerDiscovered = false;
bool usingMQTTFallback = false;

void medrasDiscoveryTask() {
  int packetSize = medrasDiscoveryUDP.parsePacket();
  if (packetSize <= 0) return;

  char buf[128];
  int n = medrasDiscoveryUDP.read(buf, sizeof(buf) - 1);
  if (n <= 0) return;

  buf[n] = '\0';

  String msg(buf);
  msg.trim();

  if (!msg.startsWith("MEDRAS_SERVER="))
    return;

  String value = msg.substring(14);

  int colon = value.indexOf(':');

  String ipText =
      (colon >= 0)
        ? value.substring(0, colon)
        : value;

  uint16_t port =
      (colon >= 0)
        ? (uint16_t)value.substring(colon + 1).toInt()
        : 1883;

  if (port == 0)
    port = 1883;

  IPAddress parsed;

  if (!parsed.fromString(ipText))
    return;

  bool changed =
      !medrasServerDiscovered ||
      parsed != medrasMQTTServerIP ||
      port != medrasMQTTServerPort;

  medrasMQTTServerIP = parsed;
  medrasMQTTServerPort = port;
  medrasServerDiscovered = true;
  usingMQTTFallback = false;

  if (changed) {
    Serial.print("[MEDRAS] MQTT server discovered: ");
    Serial.print(medrasMQTTServerIP);
    Serial.print(":");
    Serial.println(medrasMQTTServerPort);

    // If the server changed while connected, reconnect using the
    // newly discovered broker.
    if (mqtt.connected()) {
      mqtt.disconnect();
    }
  }
}


// ================================================================
// 1. NETWORK CONFIGURATION
// ================================================================

const char* WIFI_SSID     = "OPPO Reno7 Pro 5G";
const char* WIFI_PASSWORD = "Pass@word";

// Automatic discovery is preferred. This fallback is used only when
// the backend discovery packet has not been received yet.
const char* MQTT_SERVER = "10.17.229.46";
const uint16_t MQTT_PORT = 1883;

const unsigned long MQTT_DISCOVERY_WAIT_MS = 15000UL;
unsigned long medrasDiscoveryStart = 0;

const char* DEVICE_ID = "ESP32_VEHICLE_001";
const char* VEHICLE_ID = "VEHICLE_001";

// ================================================================
// 2. MQTT TOPICS
// ================================================================

const char* TOPIC_DATA      = "medras/vehicle/data";
const char* TOPIC_STATUS    = "medras/vehicle/status";
const char* TOPIC_EMERGENCY = "medras/vehicle/emergency";
const char* TOPIC_COMMAND   = "medras/vehicle/command";
const char* TOPIC_CONFIG    = "medras/vehicle/config";

// ================================================================
// 3. LIVE TRACKING
// ================================================================

const char* LIVE_TRACKING_BASE_URL =
    "https://YOUR_MEDRAS_DOMAIN/track";

// ================================================================
// 4. PIN SET
// ================================================================

// LCD I2C
const uint8_t LCD_SDA_PIN = 21;
const uint8_t LCD_SCL_PIN = 22;

// MPU6050 dedicated I2C bus
const uint8_t MPU_SDA_PIN = 18;
const uint8_t MPU_SCL_PIN = 19;

// NEO-6M GPS
const uint8_t GPS_RX_PIN = 16; // GPS TX -> ESP32 RX
const uint8_t GPS_TX_PIN = 17; // ESP32 TX -> GPS RX

// SIM900A
const uint8_t GSM_RX_PIN = 26; // SIM900A TX -> ESP32 RX
const uint8_t GSM_TX_PIN = 27; // ESP32 TX -> SIM900A RX

// Local sensors / controls
const uint8_t BUZZER_PIN       = 4;
const uint8_t EMERGENCY_PIN    = 13;
const uint8_t CANCEL_PIN       = 14;
const uint8_t SW420_PIN        = 34; // input only
const uint8_t FRONT_IR_PIN     = 35; // input only

// MPU6050 uses dedicated I2C GPIO18/GPIO19.
// LCD remains on the default I2C bus GPIO21/GPIO22.

// ================================================================
// 5. HARDWARE OBJECTS
// ================================================================



HardwareSerial GPSSerial(1);
HardwareSerial GSMSerial(2);

TinyGPSPlus gps;
LiquidCrystal_I2C lcd(0x27, 16, 2);
TwoWire MPUWire = TwoWire(1);

// ================================================================
// 6. MPU6050 REGISTERS
// ================================================================

const uint8_t MPU6050_ADDR = 0x68;

const uint8_t MPU_PWR_MGMT_1   = 0x6B;
const uint8_t MPU_ACCEL_XOUT_H = 0x3B;
const uint8_t MPU_GYRO_XOUT_H  = 0x43;
const uint8_t MPU_ACCEL_CONFIG = 0x1C;
const uint8_t MPU_GYRO_CONFIG  = 0x1B;

// ================================================================
// 7. TIMERS
// ================================================================

const unsigned long TELEMETRY_INTERVAL = 1000UL; // EVERY SECOND
const unsigned long STATUS_INTERVAL    = 10000UL;
const unsigned long LCD_INTERVAL       = 1000UL;

const unsigned long WIFI_RECONNECT_INTERVAL = 5000UL;
const unsigned long MQTT_RECONNECT_INTERVAL = 3000UL;

const unsigned long ACCIDENT_VERIFY_TIME = 10000UL;

// SW-420 debounce / re-trigger protection
const unsigned long SW420_TRIGGER_HOLD = 1000UL;
const unsigned long ACCIDENT_COOLDOWN  = 15000UL;

// Buzzer
const unsigned long BUZZER_TOGGLE_INTERVAL = 500UL;

// GSM
const unsigned long GSM_COMMAND_TIMEOUT = 5000UL;

// ================================================================
// 8. MPU6050 THRESHOLDS
// ================================================================

// These are prototype thresholds and must be calibrated on the
// actual vehicle.
const float ACCIDENT_ACCEL_THRESHOLD_G = 2.50f;
const float HARD_IMPACT_THRESHOLD_G    = 3.20f;
const float GYRO_THRESHOLD_DPS         = 250.0f;

const unsigned long IMPACT_CONFIRM_WINDOW = 1500UL;

// ================================================================
// 9. GLOBAL STATE
// ================================================================

// MPU
float accelX_g = 0.0f;
float accelY_g = 0.0f;
float accelZ_g = 0.0f;

float gyroX_dps = 0.0f;
float gyroY_dps = 0.0f;
float gyroZ_dps = 0.0f;

float accelMagnitudeG = 1.0f;
float gyroMagnitudeDps = 0.0f;

bool mpuConnected = false;

// SW420
bool vibrationActive = false;
unsigned long sw420Start = 0;

// Front IR
bool frontVehicleDetected = false;

// GPS
bool gpsFix = false;
double latitude = 0.0;
double longitude = 0.0;
double gpsSpeedKmph = 0.0;
uint32_t gpsSatellites = 0;
double gpsHDOP = 0.0;

// Emergency
bool emergencyPending = false;
bool emergencyActive = false;
bool emergencyCancelled = false;

String emergencyId = "";
String accidentReason = "";
String emergencyStatus = "NORMAL";

// Verification countdown
unsigned long accidentPendingStart = 0;
int countdownSeconds = 0;

// Impact confirmation
unsigned long impactCandidateTime = 0;
bool impactCandidate = false;

// Cooldown
unsigned long lastAccidentTime = 0;

// Buzzer
bool buzzerState = false;
unsigned long lastBuzzerToggle = 0;

// MQTT
unsigned long lastTelemetry = 0;
unsigned long lastStatus = 0;
unsigned long lastLCD = 0;
unsigned long lastWiFiReconnect = 0;
unsigned long lastMQTTReconnect = 0;

// LCD
uint8_t lcdPage = 0;

// ================================================================
// 10. BACKEND-CONFIGURED CONTACTS
// ================================================================

String patientName = "";
String patientPhone = "";

String familyName = "";
String familyPhone = "";

String adminPhone = "";
String ambulancePhone = "";
String hospitalPhone = "";

String nearestAmbulanceId = "";
String nearestHospitalId = "";
String selectedHospitalName = "";

String eta = "";
float hospitalDistanceKm = -1.0f;

// Backend may set whether local GSM should call all configured
// critical recipients or only the primary contact.
bool gsmCallEnabled = true;

// ================================================================
// 11. MPU6050 LOW LEVEL FUNCTIONS
// ================================================================

void mpuWriteByte(uint8_t reg, uint8_t value) {
  MPUWire.beginTransmission(MPU6050_ADDR);
  MPUWire.write(reg);
  MPUWire.write(value);
  MPUWire.endTransmission();
}

bool mpuReadBytes(uint8_t reg, uint8_t* buffer, uint8_t length) {
  MPUWire.beginTransmission(MPU6050_ADDR);
  MPUWire.write(reg);

  if (MPUWire.endTransmission(false) != 0) {
    return false;
  }

  uint8_t received = MPUWire.requestFrom(MPU6050_ADDR, length, true);

  if (received != length) {
    return false;
  }

  for (uint8_t i = 0; i < length; i++) {
    buffer[i] = MPUWire.read();
  }

  return true;
}

bool setupMPU6050() {
  MPUWire.begin(MPU_SDA_PIN, MPU_SCL_PIN);

  MPUWire.beginTransmission(MPU6050_ADDR);
  if (MPUWire.endTransmission() != 0) {
    return false;
  }

  // Wake up
  mpuWriteByte(MPU_PWR_MGMT_1, 0x00);

  // Accelerometer +/- 8g
  mpuWriteByte(MPU_ACCEL_CONFIG, 0x10);

  // Gyroscope +/- 500 dps
  mpuWriteByte(MPU_GYRO_CONFIG, 0x08);

  delay(50);

  return true;
}

void readMPU6050() {
  uint8_t buffer[14];

  if (!mpuReadBytes(MPU_ACCEL_XOUT_H, buffer, 14)) {
    mpuConnected = false;
    return;
  }

  mpuConnected = true;

  int16_t ax = ((int16_t)buffer[0] << 8) | buffer[1];
  int16_t ay = ((int16_t)buffer[2] << 8) | buffer[3];
  int16_t az = ((int16_t)buffer[4] << 8) | buffer[5];

  int16_t gx = ((int16_t)buffer[8] << 8) | buffer[9];
  int16_t gy = ((int16_t)buffer[10] << 8) | buffer[11];
  int16_t gz = ((int16_t)buffer[12] << 8) | buffer[13];

  // +/- 8g => 4096 LSB/g
  accelX_g = ax / 4096.0f;
  accelY_g = ay / 4096.0f;
  accelZ_g = az / 4096.0f;

  // +/- 500 dps => 65.5 LSB/dps
  gyroX_dps = gx / 65.5f;
  gyroY_dps = gy / 65.5f;
  gyroZ_dps = gz / 65.5f;

  accelMagnitudeG = sqrt(
      accelX_g * accelX_g +
      accelY_g * accelY_g +
      accelZ_g * accelZ_g
  );

  gyroMagnitudeDps = sqrt(
      gyroX_dps * gyroX_dps +
      gyroY_dps * gyroY_dps +
      gyroZ_dps * gyroZ_dps
  );
}

// ================================================================
// 12. GPS
// ================================================================

void readGPS() {
  while (GPSSerial.available()) {
    gps.encode(GPSSerial.read());
  }

  if (gps.location.isValid()) {
    gpsFix = true;
    latitude = gps.location.lat();
    longitude = gps.location.lng();
  } else {
    gpsFix = false;
  }

  if (gps.speed.isValid()) {
    gpsSpeedKmph = gps.speed.kmph();
  }

  if (gps.satellites.isValid()) {
    gpsSatellites = gps.satellites.value();
  }

  if (gps.hdop.isValid()) {
    gpsHDOP = gps.hdop.hdop();
  }
}

// ================================================================
// 13. URL HELPERS
// ================================================================

String buildLiveTrackingLink() {
  String url = String(LIVE_TRACKING_BASE_URL);

  url += "?vehicle_id=";
  url += VEHICLE_ID;

  if (emergencyId.length() > 0) {
    url += "&emergency_id=";
    url += emergencyId;
  }

  return url;
}

String buildCurrentLocationLink() {
  if (!gpsFix) {
    return "GPS location not available yet";
  }

  String url = "https://www.google.com/maps/search/?api=1&query=";
  url += String(latitude, 6);
  url += ",";
  url += String(longitude, 6);

  return url;
}

String locationText() {
  String text;

  if (gpsFix) {
    text += "Lat=";
    text += String(latitude, 6);
    text += ", Lon=";
    text += String(longitude, 6);
  } else {
    text = "GPS FIX NOT AVAILABLE";
  }

  text += "\nLive Tracking: ";
  text += buildLiveTrackingLink();

  text += "\nCurrent GPS: ";
  text += buildCurrentLocationLink();

  return text;
}

// ================================================================
// 14. BUTTONS
// ================================================================

bool emergencyButtonPressed() {
  static bool lastState = HIGH;
  bool currentState = digitalRead(EMERGENCY_PIN);

  bool pressed = (lastState == HIGH && currentState == LOW);

  lastState = currentState;
  return pressed;
}

bool cancelButtonPressed() {
  static bool lastState = HIGH;
  bool currentState = digitalRead(CANCEL_PIN);

  bool pressed = (lastState == HIGH && currentState == LOW);

  lastState = currentState;
  return pressed;
}

// ================================================================
// 15. SW-420
// ================================================================

void readSW420() {
  bool state = digitalRead(SW420_PIN);

  if (state) {
    if (!vibrationActive) {
      sw420Start = millis();
    }

    vibrationActive = true;
  } else {
    if (vibrationActive &&
        millis() - sw420Start > SW420_TRIGGER_HOLD) {
      vibrationActive = false;
    }
  }
}

// ================================================================
// 16. FRONT IR
// ================================================================

void readFrontIR() {
  // Many IR modules output LOW when an object is detected.
  // Change this one line if your module outputs HIGH on detection.
  frontVehicleDetected = (digitalRead(FRONT_IR_PIN) == LOW);
}

// ================================================================
// 17. ACCIDENT DETECTION
// ================================================================

bool severeVehicleMotionDetected() {
  bool highAcceleration =
      accelMagnitudeG >= ACCIDENT_ACCEL_THRESHOLD_G;

  bool hardImpact =
      accelMagnitudeG >= HARD_IMPACT_THRESHOLD_G;

  bool highRotation =
      gyroMagnitudeDps >= GYRO_THRESHOLD_DPS;

  // Strong impact itself is sufficient.
  if (hardImpact) {
    return true;
  }

  // Vibration + high acceleration/rotation is stronger evidence.
  if (vibrationActive &&
      (highAcceleration || highRotation)) {
    return true;
  }

  return false;
}

void startAccidentVerification(String reason) {
  if (emergencyActive || emergencyPending) {
    return;
  }

  if (millis() - lastAccidentTime < ACCIDENT_COOLDOWN) {
    return;
  }

  emergencyPending = true;
  emergencyStatus = "ACCIDENT_VERIFICATION";
  accidentReason = reason;

  accidentPendingStart = millis();
  countdownSeconds = 10;

  impactCandidate = false;
  impactCandidateTime = 0;

  lastAccidentTime = millis();

  digitalWrite(BUZZER_PIN, HIGH);

  publishEmergencyEvent(
      "ACCIDENT_VERIFICATION_STARTED",
      reason
  );

  sendLocalEmergencySMS(
      "ACCIDENT DETECTED - 10 second verification started."
  );

  Serial.println("================================================");
  Serial.println("ACCIDENT DETECTED");
  Serial.println("10 second verification started");
  Serial.println("Press EMERGENCY to confirm.");
  Serial.println("Press CANCEL to reject.");
  Serial.println("================================================");
}

void processAccidentDetection() {
  if (emergencyActive || emergencyPending) {
    return;
  }

  if (severeVehicleMotionDetected()) {
    startAccidentVerification("MPU6050_SW420");
  }
}

void processAccidentCountdown() {
  if (!emergencyPending) {
    return;
  }

  unsigned long elapsed = millis() - accidentPendingStart;

  int remaining = 10 - (int)(elapsed / 1000UL);

  if (remaining < 0) {
    remaining = 0;
  }

  countdownSeconds = remaining;

  if (elapsed >= ACCIDENT_VERIFY_TIME) {
    confirmEmergency("ACCIDENT_AUTO_TIMEOUT");
  }
}

// ================================================================
// 18. EMERGENCY CONTROL
// ================================================================

String generateEmergencyId() {
  String id = "VEH-";
  id += String(millis());
  id += "-";
  id += VEHICLE_ID;
  return id;
}

void confirmEmergency(String source) {
  if (emergencyActive) {
    return;
  }

  emergencyPending = false;
  emergencyActive = true;
  emergencyCancelled = false;

  digitalWrite(BUZZER_PIN, HIGH);

  if (emergencyId.length() == 0) {
    emergencyId = generateEmergencyId();
  }

  emergencyStatus = "EMERGENCY_ACTIVE";

  publishEmergencyEvent(
      "EMERGENCY_CREATED",
      source
  );

  sendEmergencyNotificationSMS(
      "MEDRAS VEHICLE EMERGENCY CONFIRMED. "
      "Nearest ambulance and hospital selection requested."
  );

  requestNearestAmbulanceAndHospital();

  Serial.println("EMERGENCY ACTIVE");
}

void cancelPendingEmergency(String source) {
  if (!emergencyPending && !emergencyActive) {
    return;
  }

  bool wasActive = emergencyActive;

  emergencyPending = false;
  emergencyActive = false;
  emergencyCancelled = true;

  digitalWrite(BUZZER_PIN, LOW);

  emergencyStatus = "CANCELLED";

  publishEmergencyEvent(
      wasActive ? "EMERGENCY_CANCELLED" :
                 "ACCIDENT_VERIFICATION_CANCELLED",
      source
  );

  sendLocalEmergencySMS(
      wasActive
      ? "MEDRAS vehicle emergency cancelled by user."
      : "MEDRAS accident alert cancelled during verification."
  );

  delay(300);

  emergencyStatus = "NORMAL";
}

void processButtons() {
  if (emergencyButtonPressed()) {
    // Manual SOS is immediately confirmed.
    confirmEmergency("MANUAL_EMERGENCY_BUTTON");
  }

  if (cancelButtonPressed()) {
    cancelPendingEmergency("MANUAL_CANCEL_BUTTON");
  }
}

// ================================================================
// 19. BUZZER
// ================================================================

void updateBuzzer() {
  if (emergencyPending) {
    if (millis() - lastBuzzerToggle >= BUZZER_TOGGLE_INTERVAL) {
      lastBuzzerToggle = millis();
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    }
  } else if (emergencyActive) {
    digitalWrite(BUZZER_PIN, HIGH);
  } else {
    buzzerState = false;
    digitalWrite(BUZZER_PIN, LOW);
  }
}

// ================================================================
// 20. GSM LOW LEVEL
// ================================================================

void clearGSMBuffer() {
  while (GSMSerial.available()) {
    GSMSerial.read();
  }
}

bool waitForGSM(String expected, unsigned long timeout) {
  unsigned long start = millis();
  String response;

  while (millis() - start < timeout) {
    while (GSMSerial.available()) {
      char c = (char)GSMSerial.read();
      response += c;

      if (response.indexOf(expected) >= 0) {
        return true;
      }

      if (response.indexOf("ERROR") >= 0) {
        return false;
      }
    }
  }

  return false;
}

bool gsmCommand(String command, String expected = "OK",
                unsigned long timeout = GSM_COMMAND_TIMEOUT) {
  clearGSMBuffer();

  GSMSerial.println(command);

  return waitForGSM(expected, timeout);
}

bool setupGSM() {
  GSMSerial.begin(
      9600,
      SERIAL_8N1,
      GSM_RX_PIN,
      GSM_TX_PIN
  );

  delay(1000);

  bool atOK = gsmCommand("AT", "OK", 3000);

  if (!atOK) {
    Serial.println("SIM900A: AT response not received.");
    return false;
  }

  gsmCommand("ATE0", "OK", 3000);
  gsmCommand("AT+CMGF=1", "OK", 3000);

  Serial.println("SIM900A GSM initialized.");
  return true;
}

bool sendSMS(String phone, String message) {
  if (phone.length() == 0) {
    return false;
  }

  clearGSMBuffer();

  GSMSerial.println("AT+CMGF=1");
  if (!waitForGSM("OK", 3000)) {
    return false;
  }

  GSMSerial.print("AT+CMGS=\"");
  GSMSerial.print(phone);
  GSMSerial.println("\"");

  if (!waitForGSM(">", 5000)) {
    return false;
  }

  GSMSerial.print(message);
  GSMSerial.write(26);

  return waitForGSM("OK", 15000);
}

bool makeCall(String phone) {
  if (phone.length() == 0) {
    return false;
  }

  clearGSMBuffer();

  GSMSerial.print("ATD");
  GSMSerial.print(phone);
  GSMSerial.println(";");

  bool ok = waitForGSM("OK", 10000);

  delay(8000);

  GSMSerial.println("ATH");
  waitForGSM("OK", 3000);

  return ok;
}

// ================================================================
// 21. MESSAGE BUILDING
// ================================================================

String buildCommonEmergencyMessage(String title) {
  String message;

  message += "MEDRAS VEHICLE ALERT\n";
  message += title;
  message += "\nVehicle: ";
  message += VEHICLE_ID;

  if (emergencyId.length() > 0) {
    message += "\nEmergency ID: ";
    message += emergencyId;
  }

  message += "\nStatus: ";
  message += emergencyStatus;

  message += "\nMPU Accel: ";
  message += String(accelMagnitudeG, 2);
  message += " g";

  message += "\nMPU Gyro: ";
  message += String(gyroMagnitudeDps, 1);
  message += " dps";

  message += "\nSW-420: ";
  message += vibrationActive ? "VIBRATION" : "NORMAL";

  message += "\nFront IR: ";
  message += frontVehicleDetected ? "VEHICLE DETECTED" : "CLEAR";

  message += "\nSpeed: ";
  message += String(gpsSpeedKmph, 1);
  message += " km/h";

  message += "\n";
  message += locationText();

  if (nearestAmbulanceId.length() > 0) {
    message += "\nAmbulance: ";
    message += nearestAmbulanceId;
  }

  if (selectedHospitalName.length() > 0) {
    message += "\nHospital: ";
    message += selectedHospitalName;
  }

  if (eta.length() > 0) {
    message += "\nETA: ";
    message += eta;
  }

  return message;
}

// ================================================================
// 22. LOCAL GSM NOTIFICATIONS
// ================================================================

void sendLocalEmergencySMS(String reason) {
  String message = buildCommonEmergencyMessage(reason);

  // Patient
  if (patientPhone.length() > 0) {
    sendSMS(patientPhone, message);
  }

  // Family
  if (familyPhone.length() > 0) {
    sendSMS(familyPhone, message);
  }

  // Admin
  if (adminPhone.length() > 0) {
    sendSMS(adminPhone, message);
  }
}

void sendEmergencyNotificationSMS(String reason) {
  String message = buildCommonEmergencyMessage(reason);

  // User / patient
  if (patientPhone.length() > 0) {
    sendSMS(patientPhone, message);
  }

  // Family member
  if (familyPhone.length() > 0) {
    sendSMS(familyPhone, message);
  }

  // Nearest ambulance
  if (ambulancePhone.length() > 0) {
    sendSMS(ambulancePhone, message);
  }

  // Nearest hospital
  if (hospitalPhone.length() > 0) {
    sendSMS(hospitalPhone, message);
  }

  // Admin
  if (adminPhone.length() > 0) {
    sendSMS(adminPhone, message);
  }
}

void makeEmergencyCall() {
  if (!gsmCallEnabled) {
    return;
  }

  // Call patient first when configured.
  if (patientPhone.length() > 0) {
    makeCall(patientPhone);
    return;
  }

  // Otherwise family.
  if (familyPhone.length() > 0) {
    makeCall(familyPhone);
    return;
  }

  // Otherwise admin.
  if (adminPhone.length() > 0) {
    makeCall(adminPhone);
  }
}

// ================================================================
// 23. SERVER REQUESTS
// ================================================================

void requestNearestAmbulanceAndHospital() {
  if (!mqtt.connected()) {
    return;
  }

  StaticJsonDocument<1200> doc;

  doc["event"] = "FIND_NEAREST_AMBULANCE_AND_HOSPITAL";
  doc["device_id"] = DEVICE_ID;
  doc["vehicle_id"] = VEHICLE_ID;
  doc["emergency_id"] = emergencyId;

  doc["latitude"] = latitude;
  doc["longitude"] = longitude;
  doc["gps_fix"] = gpsFix;

  doc["speed_kmph"] = gpsSpeedKmph;

  doc["accel_g"] = accelMagnitudeG;
  doc["gyro_dps"] = gyroMagnitudeDps;
  doc["sw420"] = vibrationActive;
  doc["front_ir"] = frontVehicleDetected;

  doc["live_tracking_link"] = buildLiveTrackingLink();
  doc["current_location_link"] = buildCurrentLocationLink();

  doc["request_nearest_ambulance"] = true;
  doc["request_nearest_hospital"] = true;

  char buffer[1400];
  serializeJson(doc, buffer);

  mqtt.publish(TOPIC_EMERGENCY, buffer, true);
}

// ================================================================
// 24. EMERGENCY EVENTS
// ================================================================

void publishEmergencyEvent(String eventName, String reason) {
  if (!mqtt.connected()) {
    return;
  }

  StaticJsonDocument<1800> doc;

  doc["event"] = eventName;
  doc["device_id"] = DEVICE_ID;
  doc["vehicle_id"] = VEHICLE_ID;
  doc["emergency_id"] = emergencyId;

  doc["reason"] = reason;
  doc["status"] = emergencyStatus;

  doc["timestamp_ms"] = millis();

  doc["latitude"] = latitude;
  doc["longitude"] = longitude;
  doc["gps_fix"] = gpsFix;
  doc["speed_kmph"] = gpsSpeedKmph;
  doc["satellites"] = gpsSatellites;
  doc["hdop"] = gpsHDOP;

  doc["accel_x_g"] = accelX_g;
  doc["accel_y_g"] = accelY_g;
  doc["accel_z_g"] = accelZ_g;
  doc["accel_magnitude_g"] = accelMagnitudeG;

  doc["gyro_x_dps"] = gyroX_dps;
  doc["gyro_y_dps"] = gyroY_dps;
  doc["gyro_z_dps"] = gyroZ_dps;
  doc["gyro_magnitude_dps"] = gyroMagnitudeDps;

  doc["sw420_vibration"] = vibrationActive;
  doc["front_ir_vehicle_detected"] = frontVehicleDetected;

  doc["live_tracking_link"] = buildLiveTrackingLink();
  doc["current_location_link"] = buildCurrentLocationLink();

  doc["patient_phone_configured"] = patientPhone.length() > 0;
  doc["family_phone_configured"] = familyPhone.length() > 0;

  char buffer[2200];
  serializeJson(doc, buffer);

  mqtt.publish(TOPIC_EMERGENCY, buffer, true);
}

// ================================================================
// 25. ONE-SECOND TELEMETRY
// ================================================================

void publishTelemetry() {
  if (!mqtt.connected()) {
    return;
  }

  StaticJsonDocument<2200> doc;

  doc["device_id"] = DEVICE_ID;
  doc["vehicle_id"] = VEHICLE_ID;

  doc["timestamp_ms"] = millis();

  // Emergency
  doc["emergency_id"] = emergencyId;
  doc["emergency_pending"] = emergencyPending;
  doc["emergency_active"] = emergencyActive;
  doc["emergency_status"] = emergencyStatus;
  doc["countdown_seconds"] = countdownSeconds;

  // MPU6050
  doc["mpu6050_connected"] = mpuConnected;
  doc["accel_x_g"] = accelX_g;
  doc["accel_y_g"] = accelY_g;
  doc["accel_z_g"] = accelZ_g;
  doc["accel_magnitude_g"] = accelMagnitudeG;

  doc["gyro_x_dps"] = gyroX_dps;
  doc["gyro_y_dps"] = gyroY_dps;
  doc["gyro_z_dps"] = gyroZ_dps;
  doc["gyro_magnitude_dps"] = gyroMagnitudeDps;

  // SW-420
  doc["sw420_vibration"] = vibrationActive;

  // Front IR
  doc["front_ir_vehicle_detected"] = frontVehicleDetected;

  // GPS
  doc["gps_fix"] = gpsFix;
  doc["latitude"] = latitude;
  doc["longitude"] = longitude;
  doc["speed_kmph"] = gpsSpeedKmph;
  doc["satellites"] = gpsSatellites;
  doc["hdop"] = gpsHDOP;

  // Links
  doc["live_tracking_link"] = buildLiveTrackingLink();
  doc["current_location_link"] = buildCurrentLocationLink();

  // Backend selected resources
  doc["nearest_ambulance_id"] = nearestAmbulanceId;
  doc["nearest_hospital_id"] = nearestHospitalId;
  doc["selected_hospital_name"] = selectedHospitalName;
  doc["hospital_eta"] = eta;
  doc["hospital_distance_km"] = hospitalDistanceKm;

  // Connectivity
  doc["wifi_connected"] = WiFi.status() == WL_CONNECTED;
  doc["mqtt_connected"] = mqtt.connected();

  char buffer[2600];
  serializeJson(doc, buffer);

  mqtt.publish(TOPIC_DATA, buffer, false);
}

// ================================================================
// 26. STATUS
// ================================================================

void publishStatus() {
  if (!mqtt.connected()) {
    return;
  }

  StaticJsonDocument<1200> doc;

  doc["device_id"] = DEVICE_ID;

  doc["mqtt_server_discovered"] = medrasServerDiscovered;
  doc["mqtt_using_fallback"] = usingMQTTFallback;
  doc["mqtt_server_ip"] = medrasMQTTServerIP.toString();
  doc["mqtt_server_port"] = medrasMQTTServerPort;
  doc["vehicle_id"] = VEHICLE_ID;

  doc["status"] = emergencyStatus;

  doc["wifi_connected"] = WiFi.status() == WL_CONNECTED;
  doc["mqtt_connected"] = mqtt.connected();
  doc["mpu6050_connected"] = mpuConnected;
  doc["gps_fix"] = gpsFix;

  doc["server_connected"] = mqtt.connected();

  doc["live_tracking_link"] = buildLiveTrackingLink();
  doc["current_location_link"] = buildCurrentLocationLink();

  char buffer[1500];
  serializeJson(doc, buffer);

  mqtt.publish(TOPIC_STATUS, buffer, true);
}

// ================================================================
// 27. MQTT COMMAND HANDLER
// ================================================================

void handleBackendCommand(JsonDocument& doc) {
  String command = doc["command"] | "";

  // --------------------------------------------------------------
  // SET VEHICLE CONTACT CONFIG
  // --------------------------------------------------------------
  if (command == "SET_VEHICLE_CONFIG") {
    patientName = doc["patient_name"] | "";
    patientPhone = doc["patient_phone"] | "";

    familyName = doc["family_name"] | "";
    familyPhone = doc["family_phone"] | "";

    adminPhone = doc["admin_phone"] | "";
    ambulancePhone = doc["ambulance_phone"] | "";
    hospitalPhone = doc["hospital_phone"] | "";

    gsmCallEnabled = doc["gsm_call_enabled"] | true;

    Serial.println("Vehicle contact configuration updated.");
    return;
  }

  // --------------------------------------------------------------
  // EMERGENCY ASSIGNMENT
  // --------------------------------------------------------------
  if (command == "EMERGENCY_ASSIGNMENT") {
    emergencyId = doc["emergency_id"] | emergencyId;
    nearestAmbulanceId = doc["ambulance_id"] | "";
    nearestHospitalId = doc["hospital_id"] | "";
    selectedHospitalName = doc["hospital_name"] | "";

    eta = doc["eta"] | "";
    hospitalDistanceKm = doc["hospital_distance_km"] | -1.0f;

    String ambulanceNumber = doc["ambulance_phone"] | "";
    String hospitalNumber = doc["hospital_phone"] | "";

    if (ambulanceNumber.length() > 0) {
      ambulancePhone = ambulanceNumber;
    }

    if (hospitalNumber.length() > 0) {
      hospitalPhone = hospitalNumber;
    }

    emergencyStatus = "AMBULANCE_ASSIGNED";

    String message =
        buildCommonEmergencyMessage(
            "NEAREST AMBULANCE ASSIGNED"
        );

    if (ambulancePhone.length() > 0) {
      sendSMS(ambulancePhone, message);
    }

    if (hospitalPhone.length() > 0) {
      sendSMS(hospitalPhone, message);
    }

    if (patientPhone.length() > 0) {
      sendSMS(patientPhone, message);
    }

    if (familyPhone.length() > 0) {
      sendSMS(familyPhone, message);
    }

    if (adminPhone.length() > 0) {
      sendSMS(adminPhone, message);
    }

    publishEmergencyEvent(
        "AMBULANCE_AND_HOSPITAL_ASSIGNED",
        "BACKEND_ASSIGNMENT"
    );

    return;
  }

  // --------------------------------------------------------------
  // CALL REQUEST
  // --------------------------------------------------------------
  if (command == "CALL_NUMBER") {
    String number = doc["phone"] | "";

    if (number.length() > 0) {
      makeCall(number);
    }

    return;
  }

  // --------------------------------------------------------------
  // SEND SMS REQUEST
  // --------------------------------------------------------------
  if (command == "SEND_SMS") {
    String number = doc["phone"] | "";
    String message = doc["message"] | "";

    if (number.length() > 0 && message.length() > 0) {
      // Backend may supply a message. Append vehicle location
      // links so the recipient always gets the latest location.
      message += "\nVehicle: ";
      message += VEHICLE_ID;

      message += "\nLive Tracking: ";
      message += buildLiveTrackingLink();

      message += "\nCurrent GPS: ";
      message += buildCurrentLocationLink();

      sendSMS(number, message);
    }

    return;
  }

  // --------------------------------------------------------------
  // CALL PATIENT
  // --------------------------------------------------------------
  if (command == "CALL_PATIENT") {
    makeCall(patientPhone);
    return;
  }

  // --------------------------------------------------------------
  // CALL FAMILY
  // --------------------------------------------------------------
  if (command == "CALL_FAMILY") {
    makeCall(familyPhone);
    return;
  }

  // --------------------------------------------------------------
  // CALL AMBULANCE
  // --------------------------------------------------------------
  if (command == "CALL_AMBULANCE") {
    makeCall(ambulancePhone);
    return;
  }

  // --------------------------------------------------------------
  // CALL HOSPITAL
  // --------------------------------------------------------------
  if (command == "CALL_HOSPITAL") {
    makeCall(hospitalPhone);
    return;
  }

  // --------------------------------------------------------------
  // CANCEL EMERGENCY FROM SERVER
  // --------------------------------------------------------------
  if (command == "CANCEL_EMERGENCY") {
    cancelPendingEmergency("BACKEND_CANCEL");
    return;
  }

  // --------------------------------------------------------------
  // EMERGENCY COMPLETED
  // --------------------------------------------------------------
  if (command == "EMERGENCY_COMPLETED") {
    emergencyPending = false;
    emergencyActive = false;
    digitalWrite(BUZZER_PIN, LOW);

    publishEmergencyEvent(
        "EMERGENCY_COMPLETED",
        "BACKEND_COMPLETION"
    );

    emergencyStatus = "NORMAL";
    emergencyId = "";
    nearestAmbulanceId = "";
    nearestHospitalId = "";
    selectedHospitalName = "";
    eta = "";
    hospitalDistanceKm = -1.0f;

    return;
  }

  // --------------------------------------------------------------
  // HOSPITAL UPDATE
  // --------------------------------------------------------------
  if (command == "HOSPITAL_SELECTED") {
    nearestHospitalId = doc["hospital_id"] | "";
    selectedHospitalName = doc["hospital_name"] | "";
    hospitalDistanceKm = doc["distance_km"] | -1.0f;
    eta = doc["eta"] | "";

    emergencyStatus = "HOSPITAL_SELECTED";

    publishEmergencyEvent(
        "HOSPITAL_SELECTED",
        "BACKEND_UPDATE"
    );

    return;
  }

  // --------------------------------------------------------------
  // LIVE UPDATE
  // --------------------------------------------------------------
  if (command == "LIVE_UPDATE") {
    nearestAmbulanceId =
        doc["ambulance_id"] | nearestAmbulanceId;

    nearestHospitalId =
        doc["hospital_id"] | nearestHospitalId;

    selectedHospitalName =
        doc["hospital_name"] | selectedHospitalName;

    eta = doc["eta"] | eta;

    hospitalDistanceKm =
        doc["hospital_distance_km"] | hospitalDistanceKm;

    return;
  }
}

// ================================================================
// 28. MQTT CALLBACK
// ================================================================

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String incoming;

  for (unsigned int i = 0; i < length; i++) {
    incoming += (char)payload[i];
  }

  Serial.print("MQTT [");
  Serial.print(topic);
  Serial.print("] ");
  Serial.println(incoming);

  StaticJsonDocument<2500> doc;

  DeserializationError error =
      deserializeJson(doc, incoming);

  if (error) {
    Serial.print("MQTT JSON error: ");
    Serial.println(error.c_str());
    return;
  }

  handleBackendCommand(doc);
}

// ================================================================
// 29. MQTT CONNECTION
// ================================================================

// ================================================================
// MQTT SERVER FALLBACK
// ================================================================

void useMQTTFallbackIfNeeded() {
  if (medrasServerDiscovered) return;
  if (millis() - medrasDiscoveryStart < MQTT_DISCOVERY_WAIT_MS) return;

  IPAddress fallbackIP;
  if (!fallbackIP.fromString(MQTT_SERVER)) {
    Serial.println("[MQTT] Invalid fallback IP.");
    return;
  }

  bool changed =
      !usingMQTTFallback ||
      medrasMQTTServerIP != fallbackIP ||
      medrasMQTTServerPort != MQTT_PORT;

  medrasMQTTServerIP = fallbackIP;
  medrasMQTTServerPort = MQTT_PORT;
  usingMQTTFallback = true;

  if (changed) {
    Serial.print("[MQTT] Discovery not received. Using 15-second fallback: ");
    Serial.print(medrasMQTTServerIP);
    Serial.print(":");
    Serial.println(medrasMQTTServerPort);

    if (mqtt.connected()) {
      mqtt.disconnect();
    }
  }
}

bool connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  String clientId =
      String(DEVICE_ID) + "_" +
      String((uint32_t)ESP.getEfuseMac(), HEX);

  // Discovery is preferred. After 15 seconds, use the fixed fallback.
  useMQTTFallbackIfNeeded();

  if (!medrasServerDiscovered && !usingMQTTFallback) {
    return false;
  }

  mqtt.setServer(
      medrasMQTTServerIP,
      medrasMQTTServerPort
  );

  if (mqtt.connect(clientId.c_str())) {
    mqtt.subscribe(TOPIC_COMMAND);
    mqtt.subscribe(TOPIC_CONFIG);

    Serial.println("MQTT connected.");

    publishStatus();

    return true;
  }

  Serial.print("MQTT failed, state=");
  Serial.println(mqtt.state());

  return false;
}

// ================================================================
// 30. WIFI
// ================================================================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.print("Connecting Wi-Fi");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();

  while (
      WiFi.status() != WL_CONNECTED &&
      millis() - start < 15000
  ) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection failed.");
  }
}

// ================================================================
// 31. LCD
// ================================================================

void lcdPrintLine(uint8_t row, String text) {
  while (text.length() < 16) {
    text += " ";
  }

  if (text.length() > 16) {
    text = text.substring(0, 16);
  }

  lcd.setCursor(0, row);
  lcd.print(text);
}

void updateLCD() {
  lcd.clear();

  if (emergencyPending) {
    lcdPrintLine(0, "ACCIDENT ALERT");
    lcdPrintLine(
        1,
        "CONFIRM " + String(countdownSeconds) + "s"
    );
    return;
  }

  if (emergencyActive) {
    lcdPrintLine(0, "EMERGENCY ACTIVE");

    if (lcdPage == 0) {
      lcdPrintLine(
          1,
          "A:" + String(accelMagnitudeG, 1) +
          "g V:" + String(vibrationActive ? 1 : 0)
      );
    } else if (lcdPage == 1) {
      lcdPrintLine(
          1,
          "GPS " + String(gpsFix ? "OK" : "NO")
      );
    } else if (lcdPage == 2) {
      lcdPrintLine(
          1,
          "AMB:" + nearestAmbulanceId
      );
    } else {
      lcdPrintLine(
          1,
          "HOSP:" + selectedHospitalName
      );
    }

    lcdPage++;
    if (lcdPage > 3) {
      lcdPage = 0;
    }

    return;
  }

  // NORMAL VEHICLE
  if (lcdPage == 0) {
    lcdPrintLine(0, "MEDRAS VEHICLE");
    lcdPrintLine(
        1,
        "SPD:" + String(gpsSpeedKmph, 0) + "km/h"
    );
  } else if (lcdPage == 1) {
    lcdPrintLine(
        0,
        "ACC:" + String(accelMagnitudeG, 1) + "g"
    );
    lcdPrintLine(
        1,
        "GYR:" + String(gyroMagnitudeDps, 0)
    );
  } else if (lcdPage == 2) {
    lcdPrintLine(
        0,
        "VIB:" + String(vibrationActive ? "YES" : "NO")
    );
    lcdPrintLine(
        1,
        "FRONT:" + String(frontVehicleDetected ? "OBJ" : "CLEAR")
    );
  } else if (lcdPage == 3) {
    lcdPrintLine(
        0,
        "GPS:" + String(gpsFix ? "FIX" : "NO FIX")
    );
    lcdPrintLine(
        1,
        "SAT:" + String(gpsSatellites)
    );
  } else {
    lcdPrintLine(0, "MQTT:");
    lcdPrintLine(
        1,
        mqtt.connected() ? "CONNECTED" : "OFFLINE"
    );
  }

  lcdPage++;

  if (lcdPage > 4) {
    lcdPage = 0;
  }
}

// ================================================================
// 32. SETUP
// ================================================================

void setup() {
  medrasDiscoveryUDP.begin(4210);
  medrasDiscoveryStart = millis();
  medrasServerDiscovered = false;
  usingMQTTFallback = false;

  Serial.begin(115200);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(EMERGENCY_PIN, INPUT_PULLUP);
  pinMode(CANCEL_PIN, INPUT_PULLUP);

  pinMode(SW420_PIN, INPUT);
  pinMode(FRONT_IR_PIN, INPUT);

  digitalWrite(BUZZER_PIN, LOW);

  // LCD default I2C bus
  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);

  // LCD
  lcd.init();
  lcd.backlight();

  lcd.clear();
  lcdPrintLine(0, "MEDRAS VEHICLE");
  lcdPrintLine(1, "Starting...");

  // GPS
  GPSSerial.begin(
      9600,
      SERIAL_8N1,
      GPS_RX_PIN,
      GPS_TX_PIN
  );

  // MPU6050
  mpuConnected = setupMPU6050();

  Serial.print("MPU6050: ");
  Serial.println(mpuConnected ? "OK" : "NOT FOUND");

  // GSM
  setupGSM();

  // MQTT
  // connectMQTT() selects the discovered broker or the 15-second fallback.
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(4096);
  mqtt.setKeepAlive(15);

  // Wi-Fi
  connectWiFi();

  // MQTT
  if (WiFi.status() == WL_CONNECTED) {
    connectMQTT();
  }

  Serial.println();
  Serial.println("================================================");
  Serial.println("MEDRAS ESP32 #3 VEHICLE READY");
  Serial.println("================================================");
  Serial.println("Telemetry interval : 1 second");
  Serial.println("Emergency events   : Immediate MQTT publish");
  Serial.println("GPS                : NEO-6M");
  Serial.println("Impact             : MPU6050 + SW-420");
  Serial.println("Front detection    : IR");
  Serial.println("GSM                : SIM900A");
  Serial.println("MQTT               : MEDRAS backend");
  Serial.println("================================================");
}

// ================================================================
// 33. MAIN LOOP
// ================================================================

void loop() {
  // Keep listening for the current laptop/backend MQTT address.
  medrasDiscoveryTask();
  medrasTransportTask();
  useMQTTFallbackIfNeeded();

  unsigned long now = millis();

  // --------------------------------------------------------------
  // GPS is read continuously.
  // --------------------------------------------------------------
  readGPS();

  // --------------------------------------------------------------
  // Read sensors continuously.
  // --------------------------------------------------------------
  readMPU6050();
  readSW420();
  readFrontIR();

  // --------------------------------------------------------------
  // Physical buttons.
  // --------------------------------------------------------------
  processButtons();

  // --------------------------------------------------------------
  // Accident detection.
  // --------------------------------------------------------------
  processAccidentDetection();

  // --------------------------------------------------------------
  // Verification countdown.
  // --------------------------------------------------------------
  processAccidentCountdown();

  // --------------------------------------------------------------
  // Buzzer.
  // --------------------------------------------------------------
  updateBuzzer();

  // --------------------------------------------------------------
  // Wi-Fi reconnect.
  // --------------------------------------------------------------
  if (
      WiFi.status() != WL_CONNECTED &&
      now - lastWiFiReconnect >= WIFI_RECONNECT_INTERVAL
  ) {
    lastWiFiReconnect = now;
    connectWiFi();
  }

  // --------------------------------------------------------------
  // MQTT reconnect.
  // --------------------------------------------------------------
  if (
      WiFi.status() == WL_CONNECTED &&
      !mqtt.connected() &&
      now - lastMQTTReconnect >= MQTT_RECONNECT_INTERVAL
  ) {
    lastMQTTReconnect = now;
    connectMQTT();
  }

  // --------------------------------------------------------------
  // MQTT processing.
  // --------------------------------------------------------------
  if (mqtt.connected()) {
    mqtt.loop();
  }

  // --------------------------------------------------------------
  // ONE-SECOND TELEMETRY.
  // --------------------------------------------------------------
  if (now - lastTelemetry >= TELEMETRY_INTERVAL) {
    lastTelemetry = now;

    publishTelemetry();
  }

  // --------------------------------------------------------------
  // STATUS.
  // --------------------------------------------------------------
  if (now - lastStatus >= STATUS_INTERVAL) {
    lastStatus = now;

    publishStatus();
  }

  // --------------------------------------------------------------
  // LCD.
  // --------------------------------------------------------------
  if (now - lastLCD >= LCD_INTERVAL) {
    lastLCD = now;

    updateLCD();
  }

  delay(5);
}
