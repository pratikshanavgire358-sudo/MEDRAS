#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
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
bool medrasServerDiscovered = false;

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
  String ipText = colon >= 0 ? value.substring(0, colon) : value;
  uint16_t port = colon >= 0 ? (uint16_t)value.substring(colon + 1).toInt() : 1883;
  IPAddress parsed;
  if (!parsed.fromString(ipText)) return;
  bool changed = !medrasServerDiscovered || parsed != medrasMQTTServerIP || port != medrasMQTTServerPort;
  medrasMQTTServerIP = parsed;
  medrasMQTTServerPort = port;
  medrasServerDiscovered = true;
  if (changed) {
    Serial.print("[MEDRAS] Server discovered: ");
    Serial.print(medrasMQTTServerIP);
    Serial.print(":");
    Serial.println(medrasMQTTServerPort);
  }
}


// MEDRAS ESP32 #8 - GSM GATEWAY
// Incoming call to SIM900A -> GSM emergency -> MQTT server.
// Family members are NOT notified for this emergency source.
// Caller mobile GPS must be supplied by the caller's phone/web app.
// SIM900A itself cannot read the caller's phone GPS.
//
// PIN SET:
// SIM900A TXD -> GPIO26 (ESP32 RX)
// SIM900A RXD -> GPIO27 (ESP32 TX)
// LCD SDA -> GPIO21
// LCD SCL -> GPIO22
// Buzzer -> GPIO4
// Status LED -> GPIO25 through 220R
//
// Backend remains responsible for nearest ambulance, hospital,
// live tracking, dashboards, and emergency coordination.

const char* DEVICE_ID = "ESP32_GSM_GATEWAY_001";
const char* GATEWAY_ID = "GATEWAY_001";

const char* WIFI_SSID = "OPPO Reno7 Pro 5G";
const char* WIFI_PASSWORD = "Pass@word";
const char* MQTT_SERVER = "0.0.0.0"; // Runtime discovery replaces this.
const uint16_t MQTT_PORT = 1883;

const char* TOPIC_CALL = "medras/gateway/call";
const char* TOPIC_SMS = "medras/gateway/sms";
const char* TOPIC_STATUS = "medras/gateway/status";
const char* TOPIC_CMD = "medras/gateway/command";

const char* LIVE_TRACKING_BASE_URL = "https://YOUR_MEDRAS_DOMAIN/track";

const int GSM_RX_PIN = 26;
const int GSM_TX_PIN = 27;
const int LCD_SDA_PIN = 21;
const int LCD_SCL_PIN = 22;
const int BUZZER_PIN = 4;
const int STATUS_LED_PIN = 25;

HardwareSerial GSMSerial(2);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

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
      payload["device_id"] = "ESP32_GSM_GATEWAY_001";
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
    heartbeat["device_id"] = "ESP32_GSM_GATEWAY_001";
    heartbeat["mqtt_connected"] = mqtt.connected();
    heartbeat["uptime_ms"] = now;
    String message;
    serializeJson(heartbeat, message);
    medrasWebSocket.sendTXT(message);
  }
}








LiquidCrystal_I2C lcd(0x27, 16, 2);

const unsigned long WIFI_RECONNECT_INTERVAL = 5000UL;
const unsigned long MQTT_RECONNECT_INTERVAL = 3000UL;
const unsigned long STATUS_INTERVAL = 10000UL;
const unsigned long LCD_INTERVAL = 1000UL;
const unsigned long BUZZER_INTERVAL = 500UL;
const unsigned long CALL_RING_TIMEOUT = 30000UL;

bool wifiConnected = false;
bool mqttConnected = false;
bool gsmReady = false;
bool incomingCallActive = false;
bool emergencyActive = false;
bool locationRequested = false;
bool buzzerState = false;

String incomingCallerNumber = "";
String lastCallerNumber = "";
String emergencyId = "";
String assignedAmbulance = "";
String assignedHospital = "";
String liveTrackingLink = "";
String currentLocationLink = "";

float latitude = 0.0;
float longitude = 0.0;
float locationAccuracy = 0.0;
bool gpsLocationAvailable = false;

unsigned long incomingCallStartedAt = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long lastMQTTAttempt = 0;
unsigned long lastStatusPublish = 0;
unsigned long lastLCDUpdate = 0;
unsigned long lastBuzzerToggle = 0;

String generateEmergencyId() {
  return String("MEDRAS-GSM-") + String((esp_random() % 900000UL) + 100000UL);
}

String buildLiveTrackingLink() {
  if (emergencyId.length() == 0) {
    return String(LIVE_TRACKING_BASE_URL) + "?gateway_id=" + GATEWAY_ID;
  }
  return String(LIVE_TRACKING_BASE_URL) + "?emergency_id=" + emergencyId +
         "&gateway_id=" + GATEWAY_ID;
}

String buildCurrentLocationLink() {
  if (!gpsLocationAvailable) return "Location pending from caller mobile GPS";
  return String("https://www.google.com/maps/search/?api=1&query=") +
         String(latitude, 6) + "," + String(longitude, 6);
}

bool sendATCommand(const String& command, const String& expected,
                   unsigned long timeout = 5000UL) {
  while (GSMSerial.available()) GSMSerial.read();

  GSMSerial.println(command);
  unsigned long start = millis();
  String response;

  while (millis() - start < timeout) {
    while (GSMSerial.available()) {
      char c = GSMSerial.read();
      response += c;
      if (response.indexOf(expected) >= 0) return true;
      if (response.indexOf("ERROR") >= 0) return false;
    }
    delay(5);
  }
  return false;
}

void initializeGSM() {
  gsmReady = false;

  for (int i = 0; i < 5; i++) {
    if (sendATCommand("AT", "OK", 2000)) {
      gsmReady = true;
      break;
    }
    delay(1000);
  }

  if (!gsmReady) {
    Serial.println("[GSM] SIM900A not responding.");
    return;
  }

  sendATCommand("ATE0", "OK", 2000);
  sendATCommand("AT+CMGF=1", "OK", 3000);
  sendATCommand("AT+CLIP=1", "OK", 3000);
  sendATCommand("AT+CNMI=2,1,0,0,0", "OK", 3000);

  Serial.println("[GSM] SIM900A ready.");
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 8000UL) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  wifiConnected = WiFi.status() == WL_CONNECTED;

  if (wifiConnected) {
    Serial.print("[WiFi] IP: ");
    Serial.println(WiFi.localIP());
  }
}

void publishStatus() {
  if (!mqtt.connected()) return;

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["gateway_id"] = GATEWAY_ID;
  doc["wifi_connected"] = wifiConnected;
  doc["mqtt_connected"] = mqtt.connected();
  doc["gsm_ready"] = gsmReady;
  doc["incoming_call_active"] = incomingCallActive;
  doc["emergency_active"] = emergencyActive;
  doc["emergency_id"] = emergencyId;
  doc["caller_number"] = incomingCallerNumber;
  doc["assigned_ambulance"] = assignedAmbulance;
  doc["assigned_hospital"] = assignedHospital;
  doc["location_available"] = gpsLocationAvailable;
  doc["latitude"] = latitude;
  doc["longitude"] = longitude;
  doc["accuracy_m"] = locationAccuracy;
  doc["live_tracking_link"] = liveTrackingLink;
  doc["current_location_link"] = currentLocationLink;
  doc["family_notification"] = false;
  doc["timestamp_ms"] = millis();

  char buffer[1800];
  size_t len = serializeJson(doc, buffer);
  mqtt.publish(TOPIC_STATUS, buffer, len);
}

void publishCallEvent(const String& eventType, const String& status) {
  if (!mqtt.connected()) return;

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["gateway_id"] = GATEWAY_ID;
  doc["event"] = eventType;
  doc["status"] = status;
  doc["emergency_id"] = emergencyId;
  doc["emergency_source"] = "GSM_INCOMING_CALL";
  doc["caller_number"] = incomingCallerNumber;
  doc["family_notification"] = false;
  doc["live_tracking_link"] = liveTrackingLink;
  doc["current_location_link"] = currentLocationLink;
  doc["latitude"] = latitude;
  doc["longitude"] = longitude;
  doc["accuracy_m"] = locationAccuracy;
  doc["timestamp_ms"] = millis();

  char buffer[1800];
  size_t len = serializeJson(doc, buffer);
  mqtt.publish(TOPIC_CALL, buffer, len);
}

void publishEmergencyCreated() {
  if (!mqtt.connected()) return;

  JsonDocument doc;
  doc["event"] = "EMERGENCY_CREATED";
  doc["source"] = "GSM_INCOMING_CALL";
  doc["emergency_id"] = emergencyId;
  doc["caller_number"] = incomingCallerNumber;
  doc["request"] = "GET_CALLER_LOCATION_AND_FIND_NEAREST_AMBULANCE";
  doc["find_nearest_ambulance"] = true;
  doc["find_nearest_hospital"] = true;
  doc["notify_caller"] = true;
  doc["notify_ambulance"] = true;
  doc["notify_hospital"] = true;
  doc["notify_admin"] = true;
  doc["notify_family"] = false;
  doc["live_tracking_link"] = liveTrackingLink;
  doc["current_location_link"] = currentLocationLink;

  char buffer[1800];
  size_t len = serializeJson(doc, buffer);
  mqtt.publish(TOPIC_CALL, buffer, len);
}

void sendSMS(const String& number, const String& message) {
  if (!gsmReady || number.length() == 0) return;

  GSMSerial.println("AT+CMGF=1");
  delay(500);
  GSMSerial.print("AT+CMGS=\"");
  GSMSerial.print(number);
  GSMSerial.println("\"");
  delay(1000);
  GSMSerial.print(message);
  GSMSerial.write(26);

  unsigned long start = millis();
  while (millis() - start < 15000UL) {
    if (GSMSerial.available()) {
      String response = GSMSerial.readString();
      Serial.print("[SMS] ");
      Serial.println(response);
      if (response.indexOf("+CMGS:") >= 0 || response.indexOf("OK") >= 0) return;
      if (response.indexOf("ERROR") >= 0) return;
    }
    delay(10);
  }
}

bool makeCall(const String& number) {
  if (!gsmReady || number.length() == 0) return false;
  GSMSerial.print("ATD");
  GSMSerial.print(number);
  GSMSerial.println(";");
  publishCallEvent("OUTGOING_CALL_STARTED", "ACTIVE");
  return true;
}

void hangupCall() {
  if (gsmReady) GSMSerial.println("ATH");
}

void requestCallerLocation() {
  if (incomingCallerNumber.length() == 0) return;

  String message =
    "MEDRAS EMERGENCY\n"
    "Emergency ID: " + emergencyId +
    "\nYour emergency call was detected."
    "\nPlease open this MEDRAS location link and allow mobile GPS:"
    "\n" + liveTrackingLink +
    "\n\nMEDRAS will coordinate ambulance and hospital."
    "\nFamily members are not contacted in this flow.";

  sendSMS(incomingCallerNumber, message);
  locationRequested = true;
  publishCallEvent("LOCATION_REQUEST_SENT", "WAITING_FOR_CALLER_GPS");
}

void createIncomingCallEmergency(const String& callerNumber) {
  if (callerNumber.length() == 0) return;

  // Ignore repeated CLIP messages for the same active call.
  if (emergencyActive && callerNumber == lastCallerNumber) return;

  lastCallerNumber = callerNumber;
  incomingCallerNumber = callerNumber;

  emergencyId = generateEmergencyId();
  assignedAmbulance = "";
  assignedHospital = "";
  latitude = 0.0;
  longitude = 0.0;
  locationAccuracy = 0.0;
  gpsLocationAvailable = false;
  emergencyActive = true;
  locationRequested = false;

  liveTrackingLink = buildLiveTrackingLink();
  currentLocationLink = buildCurrentLocationLink();

  digitalWrite(STATUS_LED_PIN, HIGH);

  Serial.println("\n=== GSM INCOMING CALL EMERGENCY ===");
  Serial.print("Emergency ID: ");
  Serial.println(emergencyId);
  Serial.print("Caller: ");
  Serial.println(incomingCallerNumber);

  publishCallEvent("INCOMING_CALL_DETECTED", "EMERGENCY_CREATED");
  publishEmergencyCreated();
  requestCallerLocation();
}

void handleLocationUpdate(JsonDocument& doc) {
  if (!doc["latitude"].is<float>() && !doc["latitude"].is<double>()) return;

  latitude = doc["latitude"] | 0.0;
  longitude = doc["longitude"] | 0.0;
  locationAccuracy = doc["accuracy_m"] | 0.0;
  gpsLocationAvailable = true;

  currentLocationLink = buildCurrentLocationLink();
  liveTrackingLink = buildLiveTrackingLink();

  publishCallEvent("CALLER_LOCATION_UPDATED", "LOCATION_AVAILABLE");
}

void handleBackendCommand(JsonDocument& doc) {
  String command = doc["command"] | "";

  if (command == "CALLER_LOCATION_UPDATE") {
    handleLocationUpdate(doc);
    return;
  }

  if (command == "SEND_SMS") {
    sendSMS(doc["number"] | "", doc["message"] | "");
    return;
  }

  if (command == "CALL_NUMBER") {
    makeCall(doc["number"] | "");
    return;
  }

  if (command == "CALL_CALLER") {
    makeCall(incomingCallerNumber);
    return;
  }

  if (command == "HANGUP_CALL") {
    hangupCall();
    return;
  }

  if (command == "EMERGENCY_ASSIGNMENT") {
    emergencyId = doc["emergency_id"] | emergencyId;
    assignedAmbulance = doc["ambulance_id"] | "";
    assignedHospital = doc["hospital_id"] | "";
    emergencyActive = true;

    if (doc["live_tracking_link"].is<const char*>()) {
      liveTrackingLink = doc["live_tracking_link"] | liveTrackingLink;
    }

    if (doc["latitude"].is<float>() || doc["latitude"].is<double>()) {
      latitude = doc["latitude"] | latitude;
      longitude = doc["longitude"] | longitude;
      locationAccuracy = doc["accuracy_m"] | locationAccuracy;
      gpsLocationAvailable = true;
      currentLocationLink = buildCurrentLocationLink();
    }

    String message =
      "MEDRAS EMERGENCY\n"
      "Emergency ID: " + emergencyId +
      "\nAmbulance: " + assignedAmbulance +
      "\nHospital: " + assignedHospital +
      "\nLive Tracking: " + liveTrackingLink +
      "\nCurrent Location: " + currentLocationLink;

    // Caller only. Family is intentionally excluded.
    sendSMS(incomingCallerNumber, message);
    publishCallEvent("AMBULANCE_ASSIGNED", "ACTIVE");
    return;
  }

  if (command == "LIVE_UPDATE") {
    if (doc["ambulance_id"].is<const char*>()) {
      assignedAmbulance = doc["ambulance_id"] | assignedAmbulance;
    }

    if (doc["hospital_id"].is<const char*>()) {
      assignedHospital = doc["hospital_id"] | assignedHospital;
    }

    if (doc["live_tracking_link"].is<const char*>()) {
      liveTrackingLink = doc["live_tracking_link"] | liveTrackingLink;
    }

    if (doc["latitude"].is<float>() || doc["latitude"].is<double>()) {
      latitude = doc["latitude"] | latitude;
      longitude = doc["longitude"] | longitude;
      locationAccuracy = doc["accuracy_m"] | locationAccuracy;
      gpsLocationAvailable = true;
      currentLocationLink = buildCurrentLocationLink();
    }

    publishCallEvent("LIVE_UPDATE", "ACTIVE");
    return;
  }

  if (command == "EMERGENCY_COMPLETED") {
    String message =
      "MEDRAS EMERGENCY COMPLETED\n"
      "Emergency ID: " + emergencyId +
      "\nAmbulance: " + assignedAmbulance +
      "\nHospital: " + assignedHospital;

    sendSMS(incomingCallerNumber, message);
    publishCallEvent("EMERGENCY_COMPLETED", "COMPLETED");

    emergencyActive = false;
    incomingCallActive = false;
    assignedAmbulance = "";
    assignedHospital = "";
    digitalWrite(BUZZER_PIN, LOW);
    return;
  }

  if (command == "CANCEL_EMERGENCY") {
    String message =
      "MEDRAS EMERGENCY CANCELLED\n"
      "Emergency ID: " + emergencyId +
      "\nNo family notification was made.";

    sendSMS(incomingCallerNumber, message);
    publishCallEvent("EMERGENCY_CANCELLED", "CANCELLED");

    emergencyActive = false;
    incomingCallActive = false;
    digitalWrite(BUZZER_PIN, LOW);
    return;
  }

  if (command == "RESET_GATEWAY_STATE") {
    emergencyActive = false;
    incomingCallActive = false;
    incomingCallerNumber = "";
    emergencyId = "";
    assignedAmbulance = "";
    assignedHospital = "";
    gpsLocationAvailable = false;
    digitalWrite(BUZZER_PIN, LOW);
    return;
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  JsonDocument doc;
  if (deserializeJson(doc, message)) return;

  if (String(topic) == TOPIC_CMD) handleBackendCommand(doc);
}

void connectMQTT() {
  if (!wifiConnected) return;

  String clientId = String(DEVICE_ID) + "_" +
                    String((uint32_t)ESP.getEfuseMac(), HEX);

  if (!medrasServerDiscovered) return;
  mqtt.setServer(medrasMQTTServerIP, medrasMQTTServerPort);
  if (mqtt.connect(clientId.c_str())) {
    mqttConnected = true;
    mqtt.subscribe(TOPIC_CMD);

    JsonDocument doc;
    doc["event"] = "GATEWAY_ONLINE";
    doc["device_id"] = DEVICE_ID;
    doc["gateway_id"] = GATEWAY_ID;
    doc["gsm_ready"] = gsmReady;
    doc["incoming_call_detection"] = true;
    doc["caller_gps_source"] = "CALLER_MOBILE";
    doc["family_notification_for_gsm_call"] = false;

    char buffer[1000];
    size_t len = serializeJson(doc, buffer);
    mqtt.publish(TOPIC_STATUS, (const uint8_t*)buffer, len, true);
  } else {
    mqttConnected = false;
  }
}

void processGSM() {
  while (GSMSerial.available()) {
    String line = GSMSerial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    Serial.print("[GSM] ");
    Serial.println(line);

    if (line == "RING") {
      if (!incomingCallActive) {
        incomingCallActive = true;
        incomingCallStartedAt = millis();
      }
      continue;
    }

    if (line.startsWith("+CLIP:")) {
      int firstQuote = line.indexOf('"');
      int secondQuote = line.indexOf('"', firstQuote + 1);

      if (firstQuote >= 0 && secondQuote > firstQuote) {
        String caller = line.substring(firstQuote + 1, secondQuote);
        caller.trim();

        if (caller.length() > 0) {
          createIncomingCallEmergency(caller);
        }
      }
      continue;
    }

    if (line == "CONNECT") {
      if (emergencyActive)
        publishCallEvent("CALL_CONNECTED", "ACTIVE");
      continue;
    }

    if (line == "NO CARRIER") {
      incomingCallActive = false;
      if (emergencyActive)
        publishCallEvent("CALL_ENDED", "ACTIVE");
      continue;
    }
  }
}

void updateLCD() {
  lcd.clear();

  if (!emergencyActive) {
    lcd.setCursor(0, 0);
    lcd.print("GSM GATEWAY");
    lcd.setCursor(0, 1);

    if (!gsmReady) lcd.print("GSM NOT READY");
    else if (!mqtt.connected()) lcd.print("MQTT OFFLINE");
    else lcd.print("READY");

    return;
  }

  lcd.setCursor(0, 0);
  lcd.print("GSM EMERGENCY");
  lcd.setCursor(0, 1);

  if (assignedAmbulance.length() > 0) {
    lcd.print("AMB:");
    lcd.print(assignedAmbulance.substring(0, 11));
  } else {
    lcd.print("AMB SEARCHING");
  }
}

void updateBuzzer() {
  if (!emergencyActive) {
    digitalWrite(BUZZER_PIN, LOW);
    buzzerState = false;
    return;
  }

  if (millis() - lastBuzzerToggle >= BUZZER_INTERVAL) {
    lastBuzzerToggle = millis();
    buzzerState = !buzzerState;
    digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
  }
}

void setup() {
  medrasDiscoveryUDP.begin(4210);
  Serial.begin(115200);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(STATUS_LED_PIN, LOW);

  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("MEDRAS GSM");
  lcd.setCursor(0, 1);
  lcd.print("Gateway Boot");
  delay(1200);

  GSMSerial.begin(9600, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);
  delay(1000);
  initializeGSM();

  mqtt.setServer(medrasMQTTServerIP, medrasMQTTServerPort);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(2048);

  connectWiFi();

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("GSM Gateway");
  lcd.setCursor(0, 1);
  lcd.print("Ready");
}

void loop() {
  medrasDiscoveryTask();
  medrasTransportTask();

  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    if (now - lastWiFiAttempt >= WIFI_RECONNECT_INTERVAL) {
      lastWiFiAttempt = now;
      connectWiFi();
    }
  } else {
    wifiConnected = true;
  }

  if (wifiConnected && !mqtt.connected()) {
    mqttConnected = false;
    if (now - lastMQTTAttempt >= MQTT_RECONNECT_INTERVAL) {
      lastMQTTAttempt = now;
      connectMQTT();
    }
  }

  if (mqtt.connected()) {
    mqtt.loop();
    mqttConnected = true;
  }

  processGSM();

  if (incomingCallActive &&
      now - incomingCallStartedAt >= CALL_RING_TIMEOUT) {
    incomingCallActive = false;
    hangupCall();
    if (!emergencyActive) digitalWrite(BUZZER_PIN, LOW);
  }

  updateBuzzer();

  if (now - lastLCDUpdate >= LCD_INTERVAL) {
    lastLCDUpdate = now;
    updateLCD();
  }

  if (now - lastStatusPublish >= STATUS_INTERVAL) {
    lastStatusPublish = now;
    publishStatus();
  }
}
