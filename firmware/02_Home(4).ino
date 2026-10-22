/*
================================================================
 MEDRAS - HOME CONTROLLER
 FILE : 02_Home.ino
 DEVICE: ESP32_HOME_001
================================================================
 COMPONENTS
 1. ESP32 DevKit
 2. MAX30102 - Heart Rate + SpO2
 3. MLX90614 - Infrared temperature
 4. MPU6050 - Fall detection
 5. FSR - Bed occupancy
 6. NEO-6M GPS
 7. SIM900A GSM - SMS / Call
 8. 16x2 I2C LCD
 9. Buzzer
10. Emergency Active push button
11. Emergency Reject push button
12. AD8232 ECG

 IMPORTANT ARCHITECTURE
 - ESP32 #2 publishes sensor data to the MEDRAS backend by MQTT.
 - Backend selects nearest ambulance/hospital and controls dashboards.
 - Phone numbers are received from backend configuration; they are
   NOT hard-coded.
 - SIM900A is locally available for patient/family SMS/call.
 - Live tracking URL is a MEDRAS backend URL; replace the placeholder.
 - Google Maps URL is a current GPS snapshot.
 - ECG waveform is published to the ECG MQTT topic and emergency
   messages include an ECG snapshot/value/status.
================================================================
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <TinyGPSPlus.h>
#include <MAX30105.h>
#include <heartRate.h>
#include <Adafruit_MLX90614.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
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







WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// ================= MEDRAS AUTO SERVER DISCOVERY =================
// Backend broadcasts: MEDRAS_SERVER=<laptop-ip>:1883 on UDP port 4210.
// If discovery is unavailable, the optional fallback IP can still be used.
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
      payload["device_id"] = "ESP32_HOME_001";
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
    heartbeat["device_id"] = "ESP32_HOME_001";
    heartbeat["mqtt_connected"] = mqtt.connected();
    heartbeat["uptime_ms"] = now;
    String message;
    serializeJson(heartbeat, message);
    medrasWebSocket.sendTXT(message);
  }
}


bool medrasServerDiscovered = false;
uint32_t medrasDiscoveryLastSeen = 0;
const uint16_t MEDRAS_DISCOVERY_PORT = 4210;
const char* MQTT_FALLBACK_SERVER = "10.17.229.46";
const uint16_t MQTT_FALLBACK_PORT = 1883;
const uint32_t MQTT_DISCOVERY_FALLBACK_MS = 15000UL;
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
  if (!msg.startsWith("MEDRAS_SERVER=")) return;

  String value = msg.substring(14);
  int colon = value.indexOf(':');
  String ipText = (colon >= 0) ? value.substring(0, colon) : value;
  uint16_t port = (colon >= 0)
                    ? (uint16_t)value.substring(colon + 1).toInt()
                    : 1883;

  IPAddress parsed;
  if (!parsed.fromString(ipText)) return;
  if (port == 0) port = 1883;

  bool changed = !medrasServerDiscovered ||
                 parsed != medrasMQTTServerIP ||
                 port != medrasMQTTServerPort;

  medrasMQTTServerIP = parsed;
  medrasMQTTServerPort = port;
  medrasServerDiscovered = true;
  medrasDiscoveryLastSeen = millis();
  usingMQTTFallback = false;

  if (changed) {
    Serial.print("[MEDRAS] MQTT server discovered: ");
    Serial.print(medrasMQTTServerIP);
    Serial.print(":");
    Serial.println(medrasMQTTServerPort);

    // Force a reconnect if the backend moved to a new server.
    if (mqtt.connected()) mqtt.disconnect();
  }
}

void useMQTTFallbackIfNeeded() {
  if (medrasServerDiscovered) return;
  if (millis() < MQTT_DISCOVERY_FALLBACK_MS) return;

  IPAddress fallback;
  if (!fallback.fromString(MQTT_FALLBACK_SERVER)) return;

  medrasMQTTServerIP = fallback;
  medrasMQTTServerPort = MQTT_FALLBACK_PORT;
  medrasServerDiscovered = true;
  usingMQTTFallback = true;

  Serial.print("[MEDRAS] Discovery not received; using fallback MQTT: ");
  Serial.print(medrasMQTTServerIP);
  Serial.print(":");
  Serial.println(medrasMQTTServerPort);
}

// ================= NETWORK =================
const char* DEVICE_ID = "ESP32_HOME_001";
const char* HOME_ID   = "HOME_001";

const char* WIFI_SSID = "OPPO Reno7 Pro 5G";
const char* WIFI_PASSWORD = "Pass@word";

const char* MQTT_SERVER = MQTT_FALLBACK_SERVER; // Used only as the 15-second fallback.
const uint16_t MQTT_PORT = 1883;

const char* TOPIC_DATA      = "medras/home/data";
const char* TOPIC_STATUS    = "medras/home/status";
const char* TOPIC_EMERGENCY = "medras/home/emergency";
const char* TOPIC_COMMAND   = "medras/home/command";
const char* TOPIC_CONFIG    = "medras/home/config";
const char* TOPIC_ECG       = "medras/home/ecg";

const char* LIVE_TRACKING_BASE_URL = "https://YOUR_MEDRAS_DOMAIN/track";

// ================= PINSET =================
// GPS: TX -> GPIO16, RX -> GPIO17
const int GPS_RX_PIN = 16;
const int GPS_TX_PIN = 17;

// MAX30102 uses the shared I2C bus:
// MAX30102 VIN/VCC -> 3.3V, GND -> GND, SDA -> GPIO21, SCL -> GPIO22.
// Do NOT use MAX30105 hardware in this project.
// I2C Bus 1: MAX30102 + LCD
// I2C Bus 2: MLX90614 + MPU6050
const int SDA_PIN = 21;
const int SCL_PIN = 22;

// I2C Bus 2: MLX90614 + MPU6050
const int SENSOR_SDA_PIN = 18;
const int SENSOR_SCL_PIN = 19;

// SIM900A: TXD -> GPIO26, RXD -> GPIO27
const int SIM900_RX_PIN = 26;
const int SIM900_TX_PIN = 27;

// Local controls
const int BUZZER_PIN = 4;
const int ACTIVE_BUTTON_PIN = 13;
const int REJECT_BUTTON_PIN = 14;

// AD8232
const int ECG_OUTPUT_PIN = 34;
const int ECG_LO_PLUS_PIN = 35;
const int ECG_LO_MINUS_PIN = 36;

// FSR
const int FSR_PIN = 39;

// ================= HARDWARE =================
HardwareSerial GPSSerial(1);
HardwareSerial SIM900Serial(2);

TinyGPSPlus gps;


LiquidCrystal_I2C lcd(0x27, 16, 2);
// IMPORTANT: SparkFun MAX3010x library uses the MAX30105 class for MAX30102.
// The physical sensor used in this project is MAX30102 only.
MAX30105 max30102;
Adafruit_MLX90614 mlx = Adafruit_MLX90614();
Adafruit_MPU6050 mpu;
TwoWire SensorWire = TwoWire(1);

// ================= SENSOR DATA =================
float heartRateBPM = 0.0;
float spo2Percent = 0.0;
float temperatureC = 0.0;

int fsrRaw = 0;
bool patientOnBed = false;

int ecgValue = 0;
float ecgAverage = 0.0;
bool ecgLeadsConnected = false;

float accelG = 1.0;
float previousAccelG = 1.0;
float gyroX = 0;
float gyroY = 0;
float gyroZ = 0;

double latitude = 0;
double longitude = 0;
double gpsSpeedKmph = 0;
int gpsSatellites = 0;
double gpsHDOP = 0;
bool gpsFix = false;

// ================= PATIENT CONFIG =================
String patientId = "";
String patientName = "";
String patientPhone = "";
String familyPhone = "";
String ambulancePhone = "";
String hospitalPhone = "";
String adminPhone = "";

// ================= EMERGENCY =================
bool emergencyActive = false;
bool emergencyPending = false;
bool emergencyRejected = false;
bool fallDetected = false;

String emergencyId = "";
String assignedAmbulanceId = "";
String selectedHospitalId = "";
String etaText = "";
String distanceText = "";

uint32_t fallDetectedMillis = 0;
const uint32_t FALL_VERIFY_MS = 10000UL;

// ================= FALL DETECTION =================
bool freeFallSeen = false;
uint32_t freeFallMillis = 0;
uint32_t fallLockoutUntil = 0;

const float FREE_FALL_THRESHOLD_G = 0.65;
const float IMPACT_THRESHOLD_G = 2.30;
const uint32_t FALL_IMPACT_WINDOW_MS = 1200UL;

// ================= MAX30102 =================
float hrSamples[8] = {0};
int hrIndex = 0;
uint32_t lastBeatMillis = 0;

uint32_t redBuffer[100];
uint32_t irBuffer[100];
int ppgIndex = 0;

// This is a practical non-clinical ratio estimate.
// For medical use, replace/calibrate with a validated algorithm.
float estimateSpO2() {
  if (ppgIndex < 20) return spo2Percent;

  double redDC = 0;
  double irDC = 0;

  for (int i = 0; i < ppgIndex; i++) {
    redDC += redBuffer[i];
    irDC += irBuffer[i];
  }

  redDC /= ppgIndex;
  irDC /= ppgIndex;

  if (redDC <= 0 || irDC <= 0) return spo2Percent;

  double redAC = 0;
  double irAC = 0;

  for (int i = 0; i < ppgIndex; i++) {
    double r = redBuffer[i] - redDC;
    double ir = irBuffer[i] - irDC;
    redAC += r * r;
    irAC += ir * ir;
  }

  redAC = sqrt(redAC / ppgIndex);
  irAC = sqrt(irAC / ppgIndex);

  if (redAC <= 0 || irAC <= 0) return spo2Percent;

  double ratio = (redAC / redDC) / (irAC / irDC);
  double value = 110.0 - (25.0 * ratio);

  if (value > 100) value = 100;
  if (value < 70) value = 70;

  return (float)value;
}

// ================= ECG =================
float ecgBatch[10];
int ecgBatchCount = 0;

void readECG() {
  ecgValue = analogRead(ECG_OUTPUT_PIN);

  ecgLeadsConnected =
      digitalRead(ECG_LO_PLUS_PIN) == LOW &&
      digitalRead(ECG_LO_MINUS_PIN) == LOW;

  ecgAverage = (0.90 * ecgAverage) + (0.10 * ecgValue);

  if (ecgBatchCount < 10) {
    ecgBatch[ecgBatchCount++] = ecgValue;
  }
}

String getECGSnapshot() {
  String s = "ECG=" + String(ecgValue);
  s += ",AVG=" + String(ecgAverage, 0);
  s += ",STATUS=" + String(ecgLeadsConnected ? "CONNECTED" : "LEADS_OFF");
  s += ",SAMPLES=";

  for (int i = 0; i < ecgBatchCount; i++) {
    s += String((int)ecgBatch[i]);
    if (i < ecgBatchCount - 1) s += ",";
  }

  return s;
}

// ================= LOCATION LINKS =================
String buildLiveTrackingLink() {
  String link = String(LIVE_TRACKING_BASE_URL);

  if (emergencyId.length() > 0)
    link += "?emergency_id=" + emergencyId;
  else
    link += "?home_id=" + String(HOME_ID);

  link += "&home_id=" + String(HOME_ID);

  if (patientId.length() > 0)
    link += "&patient_id=" + patientId;

  return link;
}

String buildCurrentLocationLink() {
  if (!gpsFix)
    return "GPS location not available yet";

  return String("https://www.google.com/maps/search/?api=1&query=") +
         String(latitude, 6) + "," + String(longitude, 6);
}

// ================= COMMON TEXT =================
String bedStatusText() {
  return patientOnBed ? "ON BED" : "OFF BED";
}

String ecgStatusText() {
  return ecgLeadsConnected ? "CONNECTED" : "LEADS OFF";
}

// ================= GPS =================
void readGPS() {
  while (GPSSerial.available())
    gps.encode(GPSSerial.read());

  gpsFix = gps.location.isValid();

  if (gpsFix) {
    latitude = gps.location.lat();
    longitude = gps.location.lng();
  }

  if (gps.speed.isValid())
    gpsSpeedKmph = gps.speed.kmph();

  if (gps.satellites.isValid())
    gpsSatellites = gps.satellites.value();

  if (gps.hdop.isValid())
    gpsHDOP = gps.hdop.hdop();
}

// ================= MAX30102 =================
void setupMAX30102() {
  if (!max30102.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("[MAX30102] NOT FOUND");
    return;
  }

  max30102.setup(
    60,    // LED brightness
    4,     // sample average
    2,     // RED + IR
    100,   // sample rate
    411,   // pulse width
    4096   // ADC range
  );

  max30102.setPulseAmplitudeGreen(0);
  Serial.println("[MAX30102] READY");
}

void readMAX30102() {
  uint32_t irValue = max30102.getIR();
  uint32_t redValue = max30102.getRed();

  if (irValue < 5000) {
    heartRateBPM = 0;
    spo2Percent = 0;
    ppgIndex = 0;
    return;
  }

  if (checkForBeat(irValue)) {
    uint32_t now = millis();

    if (lastBeatMillis > 0) {
      float bpm = 60000.0 / (float)(now - lastBeatMillis);

      if (bpm >= 35 && bpm <= 220) {
        hrSamples[hrIndex] = bpm;
        hrIndex = (hrIndex + 1) % 8;

        float sum = 0;
        int count = 0;

        for (int i = 0; i < 8; i++) {
          if (hrSamples[i] > 0) {
            sum += hrSamples[i];
            count++;
          }
        }

        if (count > 0)
          heartRateBPM = sum / count;
      }
    }

    lastBeatMillis = now;
  }

  if (ppgIndex < 100) {
    redBuffer[ppgIndex] = redValue;
    irBuffer[ppgIndex] = irValue;
    ppgIndex++;
  }

  if (ppgIndex >= 100) {
    float newSpO2 = estimateSpO2();

    if (spo2Percent == 0)
      spo2Percent = newSpO2;
    else
      spo2Percent = (0.70 * spo2Percent) + (0.30 * newSpO2);

    for (int i = 0; i < 50; i++) {
      redBuffer[i] = redBuffer[i + 50];
      irBuffer[i] = irBuffer[i + 50];
    }

    ppgIndex = 50;
  }
}

// ================= MLX90614 =================
void readTemperature() {
  float t = mlx.readObjectTempC();

  if (!isnan(t) && t > 20 && t < 45)
    temperatureC = t;
}

// ================= FSR =================
void readFSR() {
  fsrRaw = analogRead(FSR_PIN);

  // CALIBRATE THIS VALUE for the actual bed and FSR mounting.
  const int BED_THRESHOLD = 500;

  patientOnBed = (fsrRaw >= BED_THRESHOLD);
}

// ================= MPU6050 =================
void readMPU6050() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  float ax = a.acceleration.x / 9.80665;
  float ay = a.acceleration.y / 9.80665;
  float az = a.acceleration.z / 9.80665;

  accelG = sqrt((ax * ax) + (ay * ay) + (az * az));

  gyroX = g.gyro.x;
  gyroY = g.gyro.y;
  gyroZ = g.gyro.z;
}

void detectFall() {
  if (emergencyActive || emergencyPending)
    return;

  if (millis() < fallLockoutUntil)
    return;

  if (accelG < FREE_FALL_THRESHOLD_G) {
    freeFallSeen = true;
    freeFallMillis = millis();
  }

  bool impactAfterFreeFall =
      freeFallSeen &&
      (millis() - freeFallMillis <= FALL_IMPACT_WINDOW_MS) &&
      accelG >= IMPACT_THRESHOLD_G;

  bool suddenImpact =
      accelG >= (IMPACT_THRESHOLD_G + 0.4) &&
      fabs(accelG - previousAccelG) > 1.0;

  if (impactAfterFreeFall || suddenImpact) {
    freeFallSeen = false;
    triggerFallVerification();
  }

  if (freeFallSeen &&
      millis() - freeFallMillis > FALL_IMPACT_WINDOW_MS) {
    freeFallSeen = false;
  }

  previousAccelG = accelG;
}

// ================= MQTT GENERIC =================
template <typename T>
void publishJson(const char* topic, T& doc) {
  if (!mqtt.connected())
    return;

  String payload;
  serializeJson(doc, payload);
  mqtt.publish(topic, payload.c_str());
}

void addVitals(JsonDocument& doc) {
  doc["heart_rate_bpm"] = heartRateBPM;
  doc["spo2_percent"] = spo2Percent;
  doc["temperature_c"] = temperatureC;

  doc["fsr_raw"] = fsrRaw;
  doc["patient_on_bed"] = patientOnBed;
  doc["bed_status"] = bedStatusText();

  doc["ecg_value"] = ecgValue;
  doc["ecg_average"] = ecgAverage;
  doc["ecg_leads_connected"] = ecgLeadsConnected;
  doc["ecg_status"] = ecgStatusText();

  doc["acceleration_g"] = accelG;
  doc["gyro_x"] = gyroX;
  doc["gyro_y"] = gyroY;
  doc["gyro_z"] = gyroZ;
}

void addLocation(JsonDocument& doc) {
  doc["latitude"] = latitude;
  doc["longitude"] = longitude;
  doc["gps_fix"] = gpsFix;
  doc["gps_speed_kmph"] = gpsSpeedKmph;
  doc["gps_satellites"] = gpsSatellites;
  doc["gps_hdop"] = gpsHDOP;
  doc["live_tracking_link"] = buildLiveTrackingLink();
  doc["current_location_link"] = buildCurrentLocationLink();
}

// ================= TELEMETRY =================
void publishTelemetry() {
  if (!mqtt.connected())
    return;

  JsonDocument doc;

  doc["event"] = "HOME_TELEMETRY";
  doc["device_id"] = DEVICE_ID;
  doc["home_id"] = HOME_ID;
  doc["patient_id"] = patientId;

  doc["emergency_active"] = emergencyActive;
  doc["emergency_pending"] = emergencyPending;
  doc["fall_detected"] = fallDetected;

  // Backend uses this to control dashboard visibility.
  doc["visibility_state"] =
      emergencyActive ? "EMERGENCY" : "NORMAL";

  doc["timestamp_ms"] = millis();

  addVitals(doc);
  addLocation(doc);

  publishJson(TOPIC_DATA, doc);
}

// ================= ECG MQTT =================
void publishECG() {
  if (!mqtt.connected() || ecgBatchCount == 0)
    return;

  JsonDocument doc;

  doc["event"] = "ECG_DATA";
  doc["device_id"] = DEVICE_ID;
  doc["home_id"] = HOME_ID;
  doc["patient_id"] = patientId;
  doc["emergency_id"] = emergencyId;
  doc["leads_connected"] = ecgLeadsConnected;
  doc["ecg_status"] = ecgStatusText();
  doc["timestamp_ms"] = millis();

  JsonArray samples = doc["samples"].to<JsonArray>();

  for (int i = 0; i < ecgBatchCount; i++)
    samples.add(ecgBatch[i]);

  publishJson(TOPIC_ECG, doc);

  ecgBatchCount = 0;
}

// ================= FALL EVENT =================
void triggerFallVerification() {
  if (emergencyActive || emergencyPending)
    return;

  emergencyPending = true;
  emergencyRejected = false;
  fallDetected = true;
  fallDetectedMillis = millis();

  Serial.println("[FALL] DETECTED - 10 SECOND VERIFICATION");

  JsonDocument doc;

  doc["event"] = "FALL_DETECTED";
  doc["device_id"] = DEVICE_ID;
  doc["home_id"] = HOME_ID;
  doc["patient_id"] = patientId;
  doc["patient_name"] = patientName;
  doc["emergency_pending"] = true;
  doc["verification_seconds"] = 10;
  doc["message"] =
      "Patient fall detected. 10-second verification started.";

  addVitals(doc);
  addLocation(doc);

  publishJson(TOPIC_EMERGENCY, doc);

  // REQUIRED: fall detection message to PATIENT + FAMILY.
  String message =
      "MEDRAS FALL ALERT\n"
      "Patient: " + patientName +
      "\nFall detected.\n" +
      "10-second emergency verification started." +
      "\nHR: " + String(heartRateBPM, 0) + " BPM" +
      "\nSpO2: " + String(spo2Percent, 1) + "%" +
      "\nTemp: " + String(temperatureC, 1) + " C" +
      "\nBed: " + bedStatusText() +
      "\nECG: " + ecgStatusText() +
      "\n" + getECGSnapshot() +
      "\nLive Location: " + buildLiveTrackingLink() +
      "\nCurrent GPS: " + buildCurrentLocationLink();

  sendSMS("PATIENT", message);
  sendSMS("FAMILY", message);
  // Backend may not yet have assigned ambulance/hospital at fall detection.
  sendSMS("ADMIN", message);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("FALL DETECTED!");
  lcd.setCursor(0, 1);
  lcd.print("VERIFY 10 SEC");
}

void checkFallCountdown() {
  if (!emergencyPending)
    return;

  uint32_t elapsed = millis() - fallDetectedMillis;

  // 500 ms buzzer pattern.
  digitalWrite(BUZZER_PIN, ((elapsed / 250) % 2) ? LOW : HIGH);

  int remaining =
      10 - (int)(elapsed / 1000UL);

  if (remaining < 0)
    remaining = 0;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("FALL DETECTED");
  lcd.setCursor(0, 1);
  lcd.print("VERIFY: ");
  lcd.print(remaining);
  lcd.print(" SEC");

  if (elapsed >= FALL_VERIFY_MS) {
    digitalWrite(BUZZER_PIN, LOW);
    confirmEmergency("AUTO_TIMEOUT");
  }
}

// ================= EMERGENCY CONFIRM =================
void confirmEmergency(String source) {
  if (emergencyActive)
    return;

  emergencyPending = false;
  emergencyRejected = false;
  emergencyActive = true;
  fallDetected = true;

  digitalWrite(BUZZER_PIN, LOW);

  if (emergencyId.length() == 0)
    emergencyId = "EMG_" + String((uint32_t)millis());

  JsonDocument doc;

  doc["event"] = "EMERGENCY_CREATED";
  doc["device_id"] = DEVICE_ID;
  doc["home_id"] = HOME_ID;
  doc["patient_id"] = patientId;
  doc["patient_name"] = patientName;
  doc["emergency_id"] = emergencyId;
  doc["source"] = source;
  doc["cause"] = "FALL_DETECTED";

  doc["message"] =
      "Home emergency confirmed. Backend must find nearest ambulance.";

  doc["request"] = "FIND_NEAREST_AVAILABLE_AMBULANCE";
  doc["ambulance_selection"] = "BACKEND";
  doc["hospital_selection"] = "BACKEND";

  addVitals(doc);
  addLocation(doc);

  publishJson(TOPIC_EMERGENCY, doc);

  // REQUIRED: emergency message to patient + family.
  String message =
      "MEDRAS EMERGENCY ALERT\n"
      "Patient: " + patientName +
      "\nEmergency ID: " + emergencyId +
      "\nCause: FALL DETECTED" +
      "\nConfirmed by: " + source +
      "\nHR: " + String(heartRateBPM, 0) + " BPM" +
      "\nSpO2: " + String(spo2Percent, 1) + "%" +
      "\nTemperature: " + String(temperatureC, 1) + " C" +
      "\nBed: " + bedStatusText() +
      "\nECG: " + ecgStatusText() +
      "\n" + getECGSnapshot() +
      "\nLive Location: " + buildLiveTrackingLink() +
      "\nCurrent GPS: " + buildCurrentLocationLink();

  sendSMS("PATIENT", message);
  sendSMS("FAMILY", message);
  sendSMS("AMBULANCE", message);
  sendSMS("HOSPITAL", message);
  sendSMS("ADMIN", message);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("EMERGENCY");
  lcd.setCursor(0, 1);
  lcd.print("ACTIVE");
}

// ================= FALL REJECT =================
void cancelPendingEmergency(String reason) {
  emergencyPending = false;
  fallDetected = false;
  emergencyRejected = true;

  digitalWrite(BUZZER_PIN, LOW);

  JsonDocument doc;

  doc["event"] = "FALL_CANCELLED";
  doc["device_id"] = DEVICE_ID;
  doc["home_id"] = HOME_ID;
  doc["patient_id"] = patientId;
  doc["reason"] = reason;
  doc["message"] = "Patient rejected fall emergency.";

  addVitals(doc);
  addLocation(doc);

  publishJson(TOPIC_EMERGENCY, doc);

  String message =
      "MEDRAS: Fall emergency cancelled by patient."
      "\nNo ambulance response requested.";

  sendSMS("PATIENT", message);
  sendSMS("FAMILY", message);

  fallLockoutUntil = millis() + 15000UL;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("EMERGENCY");
  lcd.setCursor(0, 1);
  lcd.print("CANCELLED");
}

// ================= GSM =================
bool waitForGSM(const char* expected, uint32_t timeoutMs) {
  String response;
  uint32_t start = millis();

  while (millis() - start < timeoutMs) {
    while (SIM900Serial.available()) {
      char c = (char)SIM900Serial.read();
      response += c;

      if (response.indexOf(expected) >= 0)
        return true;
    }

    delay(2);
  }

  return false;
}

bool gsmReady = false;

bool initializeGSM() {
  SIM900Serial.begin(
      9600,
      SERIAL_8N1,
      SIM900_RX_PIN,
      SIM900_TX_PIN);

  delay(1000);

  SIM900Serial.println("AT");

  if (!waitForGSM("OK", 2000)) {
    Serial.println("[GSM] NOT RESPONDING");
    gsmReady = false;
    return false;
  }

  SIM900Serial.println("ATE0");
  waitForGSM("OK", 1000);

  SIM900Serial.println("AT+CMGF=1");
  waitForGSM("OK", 2000);

  gsmReady = true;

  Serial.println("[GSM] READY");
  return true;
}

String recipientNumber(String type) {
  if (type == "PATIENT") return patientPhone;
  if (type == "FAMILY") return familyPhone;
  if (type == "AMBULANCE") return ambulancePhone;
  if (type == "HOSPITAL") return hospitalPhone;
  if (type == "ADMIN") return adminPhone;
  return "";
}

void sendSMS(String type, String message) {
  String number = recipientNumber(type);

  if (number.length() == 0) {
    Serial.println("[GSM] No " + type + " number configured.");
    return;
  }

  if (!gsmReady)
    initializeGSM();

  if (!gsmReady)
    return;

  SIM900Serial.print("AT+CMGS=\"");
  SIM900Serial.print(number);
  SIM900Serial.println("\"");

  if (!waitForGSM(">", 3000)) {
    Serial.println("[GSM] SMS prompt failed.");
    return;
  }

  SIM900Serial.print(message);
  SIM900Serial.write(26);

  if (waitForGSM("OK", 10000))
    Serial.println("[GSM] SMS sent to " + type);
  else
    Serial.println("[GSM] SMS FAILED to " + type);
}

void makeCall(String type) {
  String number = recipientNumber(type);

  if (number.length() == 0) {
    Serial.println("[GSM] No " + type + " number configured.");
    return;
  }

  if (!gsmReady)
    initializeGSM();

  if (!gsmReady)
    return;

  SIM900Serial.print("ATD");
  SIM900Serial.print(number);
  SIM900Serial.println(";");

  delay(15000);
  SIM900Serial.println("ATH");
}

// ================= MQTT COMMANDS =================
void processCommand(JsonDocument& doc) {
  String command = doc["command"] | "";

  // Backend sends patient/family numbers here.
  if (command == "SET_PATIENT_CONFIG") {
    patientId =
        String((const char*)(doc["patient_id"] | ""));
    patientName =
        String((const char*)(doc["patient_name"] | ""));
    patientPhone =
        String((const char*)(doc["patient_phone"] | ""));
    familyPhone =
        String((const char*)(doc["family_phone"] | ""));
    ambulancePhone =
        String((const char*)(doc["ambulance_phone"] | ""));
    hospitalPhone =
        String((const char*)(doc["hospital_phone"] | ""));
    adminPhone =
        String((const char*)(doc["admin_phone"] | ""));

    Serial.println("[CONFIG] Patient + family + ambulance + hospital + admin configuration updated.");
    return;
  }

  if (command == "CALL_PATIENT") {
    makeCall("PATIENT");
    return;
  }

  if (command == "CALL_FAMILY") {
    makeCall("FAMILY");
    return;
  }

  if (command == "SEND_SMS_PATIENT") {
    sendSMS(
        "PATIENT",
        String((const char*)(doc["message"] | "")));
    return;
  }

  if (command == "SEND_SMS_FAMILY") {
    sendSMS(
        "FAMILY",
        String((const char*)(doc["message"] | "")));
    return;
  }

  if (command == "CALL_AMBULANCE") { makeCall("AMBULANCE"); return; }
  if (command == "CALL_HOSPITAL") { makeCall("HOSPITAL"); return; }
  if (command == "CALL_ADMIN") { makeCall("ADMIN"); return; }
  if (command == "SEND_SMS_AMBULANCE") { sendSMS("AMBULANCE", String((const char*)(doc["message"] | ""))); return; }
  if (command == "SEND_SMS_HOSPITAL") { sendSMS("HOSPITAL", String((const char*)(doc["message"] | ""))); return; }
  if (command == "SEND_SMS_ADMIN") { sendSMS("ADMIN", String((const char*)(doc["message"] | ""))); return; }

  if (command == "EMERGENCY_ASSIGNMENT") {
    emergencyId =
        String((const char*)(doc["emergency_id"] | ""));

    assignedAmbulanceId =
        String((const char*)(doc["ambulance_id"] | ""));

    selectedHospitalId =
        String((const char*)(doc["hospital_id"] | ""));

    etaText =
        String((const char*)(doc["eta"] | ""));

    distanceText =
        String((const char*)(doc["distance"] | ""));

    emergencyActive = true;

    String message =
        "MEDRAS: Ambulance " +
        assignedAmbulanceId +
        " assigned to emergency " +
        emergencyId +
        "\nHospital: " + selectedHospitalId +
        "\nETA: " + etaText +
        "\nDistance: " + distanceText +
        "\nLive Location: " + buildLiveTrackingLink() +
        "\nCurrent GPS: " + buildCurrentLocationLink();

    sendSMS("PATIENT", message);
    sendSMS("FAMILY", message);
    sendSMS("AMBULANCE", message);
    sendSMS("HOSPITAL", message);
    sendSMS("ADMIN", message);

    return;
  }

  if (command == "EMERGENCY_CANCEL") {
    emergencyActive = false;
    emergencyPending = false;
    fallDetected = false;
    digitalWrite(BUZZER_PIN, LOW);
    return;
  }

  if (command == "EMERGENCY_COMPLETED") {
    emergencyActive = false;
    emergencyPending = false;
    fallDetected = false;

    digitalWrite(BUZZER_PIN, LOW);

    emergencyId = "";
    assignedAmbulanceId = "";
    selectedHospitalId = "";
    etaText = "";
    distanceText = "";

    return;
  }
}

void mqttCallback(
    char* topic,
    byte* payload,
    unsigned int length) {

  String message;

  for (unsigned int i = 0; i < length; i++)
    message += (char)payload[i];

  JsonDocument doc;

  if (deserializeJson(doc, message)) {
    Serial.println("[MQTT] Invalid JSON.");
    return;
  }

  processCommand(doc);
}

// ================= NETWORK =================
uint32_t lastWiFiAttempt = 0;
uint32_t lastMQTTAttempt = 0;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED)
    return;

  if (millis() - lastWiFiAttempt < 5000)
    return;

  lastWiFiAttempt = millis();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println("[WiFi] Connecting...");
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  if (mqtt.connected())
    return;

  if (millis() - lastMQTTAttempt < 3000)
    return;

  lastMQTTAttempt = millis();

  // Never attempt MQTT until a valid server address is known.
  if (!medrasServerDiscovered) {
    Serial.println("[MQTT] Waiting for MEDRAS server discovery...");
    return;
  }

  mqtt.setServer(medrasMQTTServerIP, medrasMQTTServerPort);

  String clientId =
      String(DEVICE_ID) + "_" +
      String((uint32_t)ESP.getEfuseMac(), HEX);

  Serial.print("[MQTT] Connecting to ");
  Serial.print(medrasMQTTServerIP);
  Serial.print(":");
  Serial.println(medrasMQTTServerPort);

  if (mqtt.connect(clientId.c_str())) {
    Serial.println("[MQTT] CONNECTED");

    mqtt.subscribe(TOPIC_COMMAND);
    mqtt.subscribe(TOPIC_CONFIG);

    JsonDocument doc;

    doc["event"] = "HOME_ONLINE";
    doc["device_id"] = DEVICE_ID;
    doc["home_id"] = HOME_ID;
    doc["server_connected"] = true;

    publishJson(TOPIC_STATUS, doc);
  }
}

// ================= BUTTONS =================
bool activeLast = HIGH;
bool rejectLast = HIGH;
uint32_t activeChange = 0;
uint32_t rejectChange = 0;

bool pressed(int pin, bool& lastState, uint32_t& changeTime) {
  bool current = digitalRead(pin);

  if (current != lastState) {
    lastState = current;
    changeTime = millis();
  }

  if (current == LOW &&
      millis() - changeTime > 60) {

    while (digitalRead(pin) == LOW)
      delay(5);

    return true;
  }

  return false;
}

void checkButtons() {
  if (pressed(
          ACTIVE_BUTTON_PIN,
          activeLast,
          activeChange)) {

    if (emergencyPending)
      confirmEmergency("PATIENT_ACTIVE_BUTTON");
  }

  if (pressed(
          REJECT_BUTTON_PIN,
          rejectLast,
          rejectChange)) {

    if (emergencyPending)
      cancelPendingEmergency("PATIENT_REJECT_BUTTON");
  }
}

// ================= LCD =================
uint32_t lastLCD = 0;
int lcdPage = 0;

void updateLCD() {
  if (millis() - lastLCD < 1000)
    return;

  lastLCD = millis();

  lcd.clear();

  if (emergencyPending) {
    uint32_t elapsed =
        millis() - fallDetectedMillis;

    int remaining =
        10 - (int)(elapsed / 1000UL);

    if (remaining < 0)
      remaining = 0;

    lcd.setCursor(0, 0);
    lcd.print("FALL DETECTED");
    lcd.setCursor(0, 1);
    lcd.print("VERIFY ");
    lcd.print(remaining);
    lcd.print(" SEC");
    return;
  }

  if (emergencyActive) {
    lcd.setCursor(0, 0);
    lcd.print("EMERGENCY");
    lcd.setCursor(0, 1);
    lcd.print("ACTIVE");
    return;
  }

  if (lcdPage == 0) {
    lcd.setCursor(0, 0);
    lcd.print("HR:");
    lcd.print(heartRateBPM, 0);
    lcd.print(" BPM");

    lcd.setCursor(0, 1);
    lcd.print("SpO2:");
    lcd.print(spo2Percent, 1);
    lcd.print("%");
  }
  else if (lcdPage == 1) {
    lcd.setCursor(0, 0);
    lcd.print("TEMP:");
    lcd.print(temperatureC, 1);
    lcd.print(" C");

    lcd.setCursor(0, 1);
    lcd.print("BED:");
    lcd.print(patientOnBed ? "ON" : "OFF");
  }
  else if (lcdPage == 2) {
    lcd.setCursor(0, 0);
    lcd.print("ECG:");
    lcd.print(ecgLeadsConnected ? "OK" : "OFF");

    lcd.setCursor(0, 1);
    lcd.print("ADC:");
    lcd.print(ecgValue);
  }
  else if (lcdPage == 3) {
    lcd.setCursor(0, 0);
    lcd.print("GPS:");
    lcd.print(gpsFix ? "FIX" : "NO FIX");

    lcd.setCursor(0, 1);
    lcd.print("SAT:");
    lcd.print(gpsSatellites);
  }
  else {
    lcd.setCursor(0, 0);
    lcd.print("MEDRAS HOME");
    lcd.setCursor(0, 1);
    lcd.print("NORMAL");
  }

  lcdPage++;

  if (lcdPage >= 5)
    lcdPage = 0;
}

// ================= STATUS =================
uint32_t lastStatus = 0;

void publishStatus() {
  if (!mqtt.connected())
    return;

  JsonDocument doc;

  doc["event"] = "HOME_STATUS";
  doc["device_id"] = DEVICE_ID;
  doc["home_id"] = HOME_ID;

  doc["wifi_connected"] =
      WiFi.status() == WL_CONNECTED;

  doc["mqtt_connected"] =
      mqtt.connected();

  doc["mqtt_server_discovered"] = medrasServerDiscovered;
  doc["mqtt_server_ip"] = medrasServerDiscovered
                              ? medrasMQTTServerIP.toString()
                              : "";
  doc["mqtt_server_port"] = medrasMQTTServerPort;
  doc["mqtt_using_fallback"] = usingMQTTFallback;

  doc["gsm_ready"] = gsmReady;
  doc["emergency_active"] = emergencyActive;
  doc["emergency_pending"] = emergencyPending;

  doc["heart_spo2_enabled"] = true;
  doc["temperature_enabled"] = true;
  doc["fall_detection_enabled"] = true;
  doc["bed_sensor_enabled"] = true;
  doc["ecg_enabled"] = true;
  doc["gsm_patient_enabled"] = patientPhone.length() > 0;
  doc["gsm_family_enabled"] = familyPhone.length() > 0;
  doc["gsm_ambulance_enabled"] = ambulancePhone.length() > 0;
  doc["gsm_hospital_enabled"] = hospitalPhone.length() > 0;
  doc["gsm_admin_enabled"] = adminPhone.length() > 0;

  publishJson(TOPIC_STATUS, doc);
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  medrasDiscoveryUDP.begin(MEDRAS_DISCOVERY_PORT);
  delay(500);

  Serial.println();
  Serial.println("======================================");
  Serial.println(" MEDRAS ESP32 #2 - HOME");
  Serial.println("======================================");

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  pinMode(ACTIVE_BUTTON_PIN, INPUT_PULLUP);
  pinMode(REJECT_BUTTON_PIN, INPUT_PULLUP);

  pinMode(ECG_OUTPUT_PIN, INPUT);
  pinMode(ECG_LO_PLUS_PIN, INPUT);
  pinMode(ECG_LO_MINUS_PIN, INPUT);

  analogReadResolution(12);
  analogSetPinAttenuation(
      FSR_PIN, ADC_11db);
  analogSetPinAttenuation(
      ECG_OUTPUT_PIN, ADC_11db);

  Wire.begin(SDA_PIN, SCL_PIN, 400000);
  SensorWire.begin(SENSOR_SDA_PIN, SENSOR_SCL_PIN, 400000);

  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("MEDRAS HOME");
  lcd.setCursor(0, 1);
  lcd.print("STARTING...");

  GPSSerial.begin(
      9600,
      SERIAL_8N1,
      GPS_RX_PIN,
      GPS_TX_PIN);

  Serial.println("[MAX30102] Initializing physical MAX30102 sensor...");
  setupMAX30102();

  if (mlx.begin(0x5A, &SensorWire))
    Serial.println("[MLX90614] READY");
  else
    Serial.println("[MLX90614] NOT FOUND");

  if (mpu.begin(0x68, &SensorWire)) {
    Serial.println("[MPU6050] READY");

    mpu.setAccelerometerRange(
        MPU6050_RANGE_8_G);

    mpu.setGyroRange(
        MPU6050_RANGE_500_DEG);

    mpu.setFilterBandwidth(
        MPU6050_BAND_21_HZ);
  }
  else {
    Serial.println("[MPU6050] NOT FOUND");
  }

  initializeGSM();

  mqtt.setServer(
      medrasMQTTServerIP,
      medrasMQTTServerPort);

  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(4096);

  WiFi.mode(WIFI_STA);
  WiFi.begin(
      WIFI_SSID,
      WIFI_PASSWORD);

  Serial.println("[SYSTEM] READY");
  Serial.println("[MQTT] Auto-discovery enabled; 15-second fallback enabled.");
}

// ================= LOOP =================
uint32_t lastTelemetry = 0;
uint32_t lastECG = 0;

void loop() {
  medrasDiscoveryTask();
  medrasTransportTask();
  useMQTTFallbackIfNeeded();

  connectWiFi();
  connectMQTT();

  if (mqtt.connected())
    mqtt.loop();

  readGPS();
  readMAX30102();
  readTemperature();
  readFSR();
  readECG();
  readMPU6050();

  detectFall();
  checkButtons();
  checkFallCountdown();

  uint32_t now = millis();

  // HR, SpO2, temperature, FSR, ECG state, MPU6050 and GPS
  // are included in the live telemetry every second.
  if (now - lastTelemetry >= 1000UL) {
    lastTelemetry = now;
    publishTelemetry();
  }

  // ECG waveform samples are published continuously.
  if (now - lastECG >= 100UL) {
    lastECG = now;
    publishECG();
  }

  if (now - lastStatus >= 10000UL) {
    lastStatus = now;
    publishStatus();
  }

  updateLCD();

  delay(5);
}
