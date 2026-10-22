/*
============================================================
MEDRAS - ESP32 #6 : JUNCTION J03
FILE: 04_Junction_J03_SERVER_COORDINATED.ino
============================================================

FINAL J03 FEATURES — 1m BLE + PRIORITY BUTTON AUTHORIZATION
------------------------------------------------------------
1. Four-way traffic signal
2. 30-second normal green cycle
3. 3-second yellow transition
4. Four IR vehicle sensors
5. BLE ambulance detection
6. BLE emergency threshold = approximately 1 meter
7. Server-authorized green corridor only after ambulance priority button request
8. Ambulance incoming/outgoing direction
9. GPS distance received from MEDRAS server
10. Repeating emergency buzzer
11. 16x2 I2C LCD
12. MQTT communication
13. Server command reception
14. Continuous junction telemetry
15. Vehicle counting
16. Emergency status
17. Hospital information
18. Ambulance information
19. Safe all-red state
20. Automatic return to normal traffic
21. Non-blocking traffic/buzzer operation

IMPORTANT
------------------------------------------------------------
BLE:
    Primary local proximity trigger.

SERVER GPS:
    Verification / additional information only.

IR:
    Vehicle detection and ambulance passage confirmation.

SERVER:
    Selects ambulance
    Selects hospital
    Selects route
    Selects junction
    Selects incoming direction
    Selects outgoing direction

JUNCTION:
    Controls only traffic signals.
============================================================
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
// ============================================================
// MEDRAS MQTT AUTO SERVER DISCOVERY + 15-SECOND FALLBACK
// ============================================================
// Backend broadcasts:
//   MEDRAS_SERVER=<current-laptop-ip>:1883
// over UDP port 4210.
//
// Priority:
//   1. Use discovered MEDRAS server immediately.
//   2. If no discovery is received for 15 seconds, use the
//      configured fallback broker.
//   3. If discovery later appears, switch back automatically.
//
// Wi-Fi loss:
//   - Current broker is invalidated.
//   - MQTT is disconnected.
//   - Discovery starts again after Wi-Fi reconnects.
//   - 15-second fallback timer restarts.
//
// This keeps all four junctions consistent and supports changing
// laptop/mobile-hotspot IP addresses.
// ============================================================

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
      payload["device_id"] = "ESP32_JUNCTION_J03";
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
    heartbeat["device_id"] = "ESP32_JUNCTION_J03";
    heartbeat["mqtt_connected"] = mqtt.connected();
    heartbeat["uptime_ms"] = now;
    String message;
    serializeJson(heartbeat, message);
    medrasWebSocket.sendTXT(message);
  }
}



bool medrasServerDiscovered = false;
bool usingMQTTFallback = false;
bool medrasDiscoveryStarted = false;
bool medrasWiFiWasConnected = false;

unsigned long medrasDiscoveryStart = 0;

#define MEDRAS_DISCOVERY_PORT       4210
#define MQTT_FALLBACK_SERVER        "10.17.229.46"
#define MQTT_FALLBACK_PORT          1883
#define MQTT_DISCOVERY_WAIT_MS      15000UL

void resetMEDRASDiscovery()
{
  medrasServerDiscovered = false;
  usingMQTTFallback = false;
  medrasDiscoveryStart = millis();
}

void medrasDiscoveryTask()
{
  bool wifiConnected =
    (WiFi.status() == WL_CONNECTED);

  // ----------------------------------------------------------
  // WIFI DISCONNECTED
  // ----------------------------------------------------------
  if (!wifiConnected)
  {
    if (medrasWiFiWasConnected)
    {
      medrasWiFiWasConnected = false;
      medrasServerDiscovered = false;
      usingMQTTFallback = false;
      medrasDiscoveryStart = 0;

      if (mqtt.connected())
      {
        mqtt.disconnect();
      }

      if (medrasDiscoveryStarted)
      {
        medrasDiscoveryUDP.stop();
        medrasDiscoveryStarted = false;
      }

      Serial.println(
        "[MEDRAS] WiFi lost - MQTT broker invalidated"
      );
    }

    return;
  }

  // ----------------------------------------------------------
  // WIFI JUST CONNECTED / RECONNECTED
  // ----------------------------------------------------------
  if (!medrasWiFiWasConnected)
  {
    medrasWiFiWasConnected = true;

    medrasServerDiscovered = false;
    usingMQTTFallback = false;

    medrasDiscoveryStart = millis();

    if (!medrasDiscoveryStarted)
    {
      medrasDiscoveryUDP.begin(
        MEDRAS_DISCOVERY_PORT
      );

      medrasDiscoveryStarted = true;
    }

    Serial.print(
      "[MEDRAS] WiFi connected. ESP32 IP: "
    );

    Serial.println(
      WiFi.localIP()
    );

    Serial.println(
      "[MEDRAS] Waiting for server discovery on UDP 4210..."
    );
  }

  // ----------------------------------------------------------
  // START UDP LISTENER IF NEEDED
  // ----------------------------------------------------------
  if (!medrasDiscoveryStarted)
  {
    medrasDiscoveryUDP.begin(
      MEDRAS_DISCOVERY_PORT
    );

    medrasDiscoveryStarted = true;

    medrasDiscoveryStart = millis();

    Serial.println(
      "[MEDRAS] MQTT discovery listening on UDP 4210"
    );
  }

  // ----------------------------------------------------------
  // READ SERVER BROADCAST
  // ----------------------------------------------------------
  int packetSize =
    medrasDiscoveryUDP.parsePacket();

  if (packetSize > 0)
  {
    char buf[128];

    int n =
      medrasDiscoveryUDP.read(
        buf,
        sizeof(buf) - 1
      );

    if (n > 0)
    {
      buf[n] = '\0';

      String msg(buf);
      msg.trim();

      if (
        msg.startsWith(
          "MEDRAS_SERVER="
        )
      )
      {
        String value =
          msg.substring(14);

        int colon =
          value.indexOf(':');

        String ipText =
          (colon >= 0)
            ? value.substring(0, colon)
            : value;

        uint16_t port =
          (colon >= 0)
            ? (uint16_t)value.substring(
                colon + 1
              ).toInt()
            : MQTT_FALLBACK_PORT;

        if (port == 0)
        {
          port =
            MQTT_FALLBACK_PORT;
        }

        IPAddress parsedIP;

        if (
          parsedIP.fromString(
            ipText
          )
        )
        {
          bool changed =
            !medrasServerDiscovered ||
            parsedIP != medrasMQTTServerIP ||
            port != medrasMQTTServerPort ||
            usingMQTTFallback;

          medrasMQTTServerIP =
            parsedIP;

          medrasMQTTServerPort =
            port;

          medrasServerDiscovered =
            true;

          usingMQTTFallback =
            false;

          if (changed)
          {
            Serial.print(
              "[MEDRAS] MQTT server discovered: "
            );

            Serial.print(
              medrasMQTTServerIP
            );

            Serial.print(":");

            Serial.println(
              medrasMQTTServerPort
            );

            // Force MQTT to reconnect to the newly
            // discovered broker.
            if (mqtt.connected())
            {
              mqtt.disconnect();

              Serial.println(
                "[MEDRAS] MQTT broker changed - reconnecting"
              );
            }
          }
        }
      }
    }
  }

  // ----------------------------------------------------------
  // 15-SECOND FALLBACK
  // ----------------------------------------------------------
  if (
    !medrasServerDiscovered &&
    medrasDiscoveryStart > 0 &&
    millis() -
      medrasDiscoveryStart >=
      MQTT_DISCOVERY_WAIT_MS
  )
  {
    IPAddress fallback;

    if (
      fallback.fromString(
        MQTT_FALLBACK_SERVER
      )
    )
    {
      medrasMQTTServerIP =
        fallback;

      medrasMQTTServerPort =
        MQTT_FALLBACK_PORT;

      medrasServerDiscovered =
        true;

      usingMQTTFallback =
        true;

      Serial.print(
        "[MEDRAS] Discovery timeout after 15 seconds. "
        "Using fallback MQTT: "
      );

      Serial.print(
        medrasMQTTServerIP
      );

      Serial.print(":");

      Serial.println(
        medrasMQTTServerPort
      );
    }
  }
}

// Compatibility wrapper used by the main loop.
void useMQTTFallbackIfNeeded()
{
  // Fallback is handled inside medrasDiscoveryTask().
}

// ============================================================
// WIFI

// ============================================================

#define WIFI_SSID       "OPPO Reno7 Pro 5G"
#define WIFI_PASSWORD   "Pass@word"

// MQTT broker is selected dynamically by MEDRAS discovery/fallback.
// MQTT_PORT is selected dynamically; fallback port is 1883.

// ============================================================
// DEVICE
// ============================================================

#define JUNCTION_ID     "J03_001"
#define JUNCTION_NAME   "J03"

#define DEVICE_TOKEN    "MEDRAS_J03_SECRET"

// ============================================================
// LCD
// ============================================================

#define LCD_ADDRESS 0x27
#define LCD_COLUMNS 16
#define LCD_ROWS    2

LiquidCrystal_I2C lcd(
  LCD_ADDRESS,
  LCD_COLUMNS,
  LCD_ROWS
);

// ============================================================
// BLE
// ============================================================

#define BLE_SERVICE_UUID \
"7b5b0001-5e5d-4a4a-9b1e-4d4554524153"

// Approximately 1 meter (RSSI-based proximity trigger)
#define BLE_DISTANCE_THRESHOLD 1.0
bool ambulanceWithinOneMeter = false; // true only when RSSI estimate <= 1.0 m

// BLE transmitter calibration
#define BLE_TX_POWER -59

// Path-loss factor
#define RSSI_PATH_LOSS 2.0

NimBLEScan *bleScan;

// ============================================================
// TRAFFIC SIGNAL PINS
// ============================================================
//
// IMPORTANT:
// These pins match the FINAL physical J03 wiring.
//
// NORTH
// RED     GPIO 4
// YELLOW  GPIO 13
// GREEN   GPIO 14
//
// EAST
// RED     GPIO 16
// YELLOW  GPIO 17
// GREEN   GPIO 18
//
// SOUTH
// RED     GPIO 19
// YELLOW  GPIO 23
// GREEN   GPIO 25
//
// WEST
// RED     GPIO 26
// YELLOW  GPIO 27
// GREEN   GPIO 32
//
// BUZZER  GPIO 33
// ============================================================

// NORTH
#define N_RED       4
#define N_YELLOW    13
#define N_GREEN     14

// EAST
#define E_RED       16
#define E_YELLOW    17
#define E_GREEN     18

// SOUTH
#define S_RED       19
#define S_YELLOW    23
#define S_GREEN     25

// WEST
#define W_RED       26
#define W_YELLOW    27
#define W_GREEN     32

// ============================================================
// BUZZER
// ============================================================

#define BUZZER_PIN 33

// ============================================================
// IR VEHICLE SENSORS
// ============================================================

#define SENSOR_NORTH 34
#define SENSOR_EAST  35
#define SENSOR_SOUTH 36
#define SENSOR_WEST  39

// Most IR modules:
// LOW = vehicle detected
#define IR_ACTIVE_LOW true

// ============================================================
// MQTT
// ============================================================



const char *TOPIC_DATA =
  "medras/junction/J03/data";

const char *TOPIC_STATUS =
  "medras/junction/J03/status";

const char *TOPIC_COMMAND =
  "medras/junction/J03/command";

// ============================================================
// TIMING
// ============================================================

// Normal GREEN = 30 seconds
const unsigned long NORMAL_GREEN_TIME =
  30000UL;

// YELLOW = 3 seconds
const unsigned long YELLOW_TIME =
  3000UL;

// BLE scan
const unsigned long BLE_SCAN_INTERVAL =
  1000UL;

// BLE detection timeout
const unsigned long BLE_DETECTION_TIMEOUT =
  3000UL;

// MQTT telemetry
const unsigned long PUBLISH_INTERVAL =
  1000UL;

// LCD refresh
const unsigned long LCD_REFRESH_INTERVAL =
  1000UL;

// LCD page change
// Display content refreshes every 1 second.
// Information page changes every 5 seconds.
const unsigned long LCD_PAGE_INTERVAL =
  5000UL;

// Emergency buzzer
const unsigned long BUZZER_ON_TIME =
  300UL;

const unsigned long BUZZER_OFF_TIME =
  300UL;

// Minimum IR detection time before considering passage
const unsigned long AMBULANCE_IR_MIN_TIME =
  500UL;

// Safety timeout for emergency green
// This prevents a permanent green if communication fails.
const unsigned long EMERGENCY_SAFETY_TIMEOUT =
  120000UL;

// ============================================================
// JUNCTION STATES
// ============================================================

enum JunctionState
{
  NORMAL_TRAFFIC,
  NORMAL_YELLOW,
  EMERGENCY_YELLOW,
  EMERGENCY_GREEN
};

JunctionState junctionState =
  NORMAL_TRAFFIC;

// ============================================================
// DIRECTIONS
// ============================================================

enum DirectionIndex
{
  DIR_NORTH = 0,
  DIR_EAST  = 1,
  DIR_SOUTH = 2,
  DIR_WEST  = 3
};

// Current normal traffic direction
int normalDirection =
  DIR_NORTH;

// ============================================================
// SERVER EMERGENCY DATA
// ============================================================

bool serverPriority =
  false;

// TRUE only when the ambulance priority button request has been
// received and authorized by the MEDRAS backend.
// Without this flag, GREEN_CORRIDOR_START is rejected.
bool priorityButtonActive =
  false;

String emergencyId =
  "";

String ambulanceId =
  "";

// Incoming direction for ambulance
String incomingDirection =
  "";

// Outgoing direction after crossing J03
String outgoingDirection =
  "";

// Hospital selected by server
String hospitalName =
  "";

// Route
String routeFrom =
  "";

String routeTo =
  "";

// ============================================================
// SERVER GPS
// ============================================================

float serverGPSDistance =
  999.0;

double ambulanceLatitude =
  0.0;

double ambulanceLongitude =
  0.0;

// ============================================================
// BLE DATA
// ============================================================

bool ambulanceNearby =
  false;

int ambulanceRSSI =
  -127;

float ambulanceDistance =
  999.0;

String bleAmbulanceName =
  "";

unsigned long lastBLEDetection =
  0;

// ============================================================
// VEHICLE COUNTERS
// ============================================================

unsigned long northVehicleCount =
  0;

unsigned long eastVehicleCount =
  0;

unsigned long southVehicleCount =
  0;

unsigned long westVehicleCount =
  0;

// ============================================================
// PREVIOUS IR STATES
// ============================================================

bool previousNorthSensor =
  false;

bool previousEastSensor =
  false;

bool previousSouthSensor =
  false;

bool previousWestSensor =
  false;

// ============================================================
// AMBULANCE IR PASSAGE
// ============================================================

bool ambulanceIRDetected =
  false;

unsigned long ambulanceIRStartTime =
  0;

// ============================================================
// TIMERS
// ============================================================

unsigned long lastWiFiAttempt =
  0;

unsigned long lastMQTTAttempt =
  0;

unsigned long lastBLEScan =
  0;

unsigned long lastPublish =
  0;

unsigned long lastLCDRefresh =
  0;

unsigned long lastLCDPageChange =
  0;

unsigned long stateStartTime =
  0;

unsigned long emergencyStartTime =
  0;

// ============================================================
// LCD
// ============================================================

int lcdPage =
  0;

// ============================================================
// BUZZER
// ============================================================

bool buzzerActive =
  false;

bool buzzerOutput =
  false;

unsigned long buzzerTimer =
  0;

// ============================================================
// WIFI START
// ============================================================

void startWiFi()
{
  WiFi.mode(
    WIFI_STA
  );

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );
}

// ============================================================
// WIFI TASK
// ============================================================

void wifiTask()
{
  if (
    WiFi.status() ==
    WL_CONNECTED
  )
  {
    return;
  }

  if (
    millis() -
    lastWiFiAttempt <
    5000UL
  )
  {
    return;
  }

  lastWiFiAttempt =
    millis();

  Serial.println(
    "Connecting WiFi..."
  );

  WiFi.disconnect();

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );
}

// ============================================================
// MQTT TASK
// ============================================================

void mqttTask()
{
  if (
    WiFi.status() !=
    WL_CONNECTED
  )
  {
    return;
  }

  if (
    mqtt.connected()
  )
  {
    return;
  }

  if (
    millis() -
    lastMQTTAttempt <
    5000UL
  )
  {
    return;
  }

  lastMQTTAttempt =
    millis();

  String clientId =
    "MEDRAS_J03_" +
    String(
      (uint32_t)ESP.getEfuseMac(),
      HEX
    );

  Serial.println(
    "Connecting MQTT..."
  );

  if (!medrasServerDiscovered)
    return;

  mqtt.setServer(
    medrasMQTTServerIP,
    medrasMQTTServerPort
  );

  if (
    mqtt.connect(
      clientId.c_str()
    )
  )
  {
    Serial.println(
      "MAIN MEDRAS SERVER CONNECTED (MQTT)"
    );

    mqtt.subscribe(
      TOPIC_COMMAND
    );

    String status =
      "{"
      "\"junction_id\":\"J03_001\","
      "\"device_id\":\"ESP32_J03\","
      "\"status\":\"ONLINE\","
      "\"server_connected\":true,"
      "\"green_corridor_requires_priority\":true,"
      "\"mqtt_using_fallback\":" +
      String(usingMQTTFallback ? "true" : "false") +
      "}";

    mqtt.publish(
      TOPIC_STATUS,
      status.c_str(),
      true
    );
  }
}

// ============================================================
// MAIN MEDRAS SERVER CONNECTION
// ============================================================
// All junctions communicate through the central MEDRAS server
// using Wi-Fi + MQTT. Junctions do NOT communicate directly.
// Green Corridor requires an active server connection.
// ============================================================

bool mainServerConnected()
{
  return (
    WiFi.status() == WL_CONNECTED &&
    mqtt.connected()
  );
}

// ============================================================
// HANDLE MAIN SERVER CONNECTION LOSS
// ============================================================

void handleServerConnectionLoss()
{
  if (
    serverPriority ||
    priorityButtonActive
  )
  {
    Serial.println();
    Serial.println(
      "MAIN SERVER CONNECTION LOST - GREEN CORRIDOR STOPPED"
    );

    returnToNormalTraffic();
  }
}

// ============================================================
// ALL RED
// ============================================================

void allRed()
{
  // NORTH
  digitalWrite(
    N_RED,
    HIGH
  );

  digitalWrite(
    N_YELLOW,
    LOW
  );

  digitalWrite(
    N_GREEN,
    LOW
  );

  // EAST
  digitalWrite(
    E_RED,
    HIGH
  );

  digitalWrite(
    E_YELLOW,
    LOW
  );

  digitalWrite(
    E_GREEN,
    LOW
  );

  // SOUTH
  digitalWrite(
    S_RED,
    HIGH
  );

  digitalWrite(
    S_YELLOW,
    LOW
  );

  digitalWrite(
    S_GREEN,
    LOW
  );

  // WEST
  digitalWrite(
    W_RED,
    HIGH
  );

  digitalWrite(
    W_YELLOW,
    LOW
  );

  digitalWrite(
    W_GREEN,
    LOW
  );
}

// ============================================================
// SET NORMAL GREEN
// ============================================================
//
// This function ALWAYS calls allRed() first.
//
// Therefore:
// selected direction = GREEN
// other 3 directions = RED
// ============================================================

void setNormalGreen(
  int direction
)
{
  allRed();

  switch (
    direction
  )
  {
    case DIR_NORTH:

      digitalWrite(
        N_RED,
        LOW
      );

      digitalWrite(
        N_GREEN,
        HIGH
      );

      Serial.println(
        "NORMAL: NORTH GREEN"
      );

      break;


    case DIR_EAST:

      digitalWrite(
        E_RED,
        LOW
      );

      digitalWrite(
        E_GREEN,
        HIGH
      );

      Serial.println(
        "NORMAL: EAST GREEN"
      );

      break;


    case DIR_SOUTH:

      digitalWrite(
        S_RED,
        LOW
      );

      digitalWrite(
        S_GREEN,
        HIGH
      );

      Serial.println(
        "NORMAL: SOUTH GREEN"
      );

      break;


    case DIR_WEST:

      digitalWrite(
        W_RED,
        LOW
      );

      digitalWrite(
        W_GREEN,
        HIGH
      );

      Serial.println(
        "NORMAL: WEST GREEN"
      );

      break;
  }
}

// ============================================================
// SET YELLOW
// ============================================================
//
// Selected direction = YELLOW
// Other 3 directions = RED
// ============================================================

void setYellow(
  String direction
)
{
  allRed();

  if (
    direction == "NORTH"
  )
  {
    digitalWrite(
      N_RED,
      LOW
    );

    digitalWrite(
      N_YELLOW,
      HIGH
    );

    Serial.println(
      "NORTH YELLOW"
    );
  }

  else if (
    direction == "EAST"
  )
  {
    digitalWrite(
      E_RED,
      LOW
    );

    digitalWrite(
      E_YELLOW,
      HIGH
    );

    Serial.println(
      "EAST YELLOW"
    );
  }

  else if (
    direction == "SOUTH"
  )
  {
    digitalWrite(
      S_RED,
      LOW
    );

    digitalWrite(
      S_YELLOW,
      HIGH
    );

    Serial.println(
      "SOUTH YELLOW"
    );
  }

  else if (
    direction == "WEST"
  )
  {
    digitalWrite(
      W_RED,
      LOW
    );

    digitalWrite(
      W_YELLOW,
      HIGH
    );

    Serial.println(
      "WEST YELLOW"
    );
  }
}

// ============================================================
// DIRECTION STRING
// ============================================================

String directionName(
  int direction
)
{
  switch (
    direction
  )
  {
    case DIR_NORTH:
      return "NORTH";

    case DIR_EAST:
      return "EAST";

    case DIR_SOUTH:
      return "SOUTH";

    case DIR_WEST:
      return "WEST";
  }

  return "UNKNOWN";
}

// ============================================================
// VALID DIRECTION
// ============================================================

bool validDirection(
  String direction
)
{
  return (
    direction == "NORTH" ||
    direction == "EAST"  ||
    direction == "SOUTH" ||
    direction == "WEST"
  );
}

// ============================================================
// NEXT NORMAL DIRECTION
// ============================================================

void moveToNextNormalDirection()
{
  normalDirection++;

  if (
    normalDirection >
    DIR_WEST
  )
  {
    normalDirection =
      DIR_NORTH;
  }
}

// ============================================================
// NORMAL TRAFFIC TASK
// ============================================================

void normalTrafficTask()
{
  // Emergency has priority.
  if (
    serverPriority
  )
  {
    return;
  }

  unsigned long elapsed =
    millis() -
    stateStartTime;

  // ==========================================================
  // GREEN
  // ==========================================================

  if (
    junctionState ==
    NORMAL_TRAFFIC
  )
  {
    if (
      elapsed >=
      NORMAL_GREEN_TIME
    )
    {
      setYellow(
        directionName(
          normalDirection
        )
      );

      junctionState =
        NORMAL_YELLOW;

      stateStartTime =
        millis();
    }

    return;
  }

  // ==========================================================
  // YELLOW
  // ==========================================================

  if (
    junctionState ==
    NORMAL_YELLOW
  )
  {
    if (
      elapsed >=
      YELLOW_TIME
    )
    {
      moveToNextNormalDirection();

      setNormalGreen(
        normalDirection
      );

      junctionState =
        NORMAL_TRAFFIC;

      stateStartTime =
        millis();
    }
  }
}

// ============================================================
// BLE DISTANCE CALCULATION
// ============================================================

float calculateBLEDistance(
  int rssi
)
{
  if (
    rssi >= 0
  )
  {
    return 999.0;
  }

  float distance =
    pow(
      10.0,
      (
        BLE_TX_POWER -
        rssi
      ) /
      (
        10.0 *
        RSSI_PATH_LOSS
      )
    );

  return distance;
}

// ============================================================
// BLE CALLBACK
// ============================================================

class AmbulanceScanCallbacks :
  public NimBLEScanCallbacks
{
  void onResult(
    const NimBLEAdvertisedDevice *device
  )
  {
    // --------------------------------------------------------
    // Check MEDRAS BLE service
    // --------------------------------------------------------

    if (
      !device->isAdvertisingService(
        NimBLEUUID(
          BLE_SERVICE_UUID
        )
      )
    )
    {
      return;
    }

    // --------------------------------------------------------
    // Read BLE name
    // --------------------------------------------------------

    String name =
      device->getName().c_str();

    // --------------------------------------------------------
    // Only MEDRAS ambulance devices
    // --------------------------------------------------------

    if (
      !name.startsWith(
        "MEDRAS_AMB_"
      )
    )
    {
      return;
    }

    // --------------------------------------------------------
    // If server has selected a specific ambulance,
    // ignore other ambulances.
    // --------------------------------------------------------

    if (
      serverPriority &&
      ambulanceId.length() > 0
    )
    {
      String expectedName =
        String("MEDRAS_AMB_") +
        ambulanceId;

      if (
        name != expectedName &&
        name != ambulanceId
      )
      {
        return;
      }
    }

    // --------------------------------------------------------
    // Ambulance detected
    // --------------------------------------------------------

    ambulanceNearby =
      true;

    lastBLEDetection =
      millis();

    ambulanceRSSI =
      device->getRSSI();

    ambulanceDistance =
      calculateBLEDistance(
        ambulanceRSSI
      );

    ambulanceWithinOneMeter =
      (ambulanceDistance <= BLE_DISTANCE_THRESHOLD);

    bleAmbulanceName =
      name;

    Serial.println();
    Serial.println(
      "========== BLE AMBULANCE =========="
    );

    Serial.print(
      "BLE Name: "
    );

    Serial.println(
      bleAmbulanceName
    );

    Serial.print(
      "RSSI: "
    );

    Serial.println(
      ambulanceRSSI
    );

    Serial.print(
      "Distance: "
    );

    Serial.print(
      ambulanceDistance,
      2
    );

    Serial.println(
      " m"
    );

    if (ambulanceWithinOneMeter)
    {
      Serial.println(
        ">>> BLE WITHIN 1m THRESHOLD <<<"
      );
    }

    Serial.println(
      "=================================="
    );
  }
};

// ============================================================
// BLE CALLBACK INSTANCE
// ============================================================

AmbulanceScanCallbacks bleCallbacks;

// ============================================================
// BLE TASK
// ============================================================

void bleTask()
{
  if (
    millis() -
    lastBLEScan <
    BLE_SCAN_INTERVAL
  )
  {
    return;
  }

  lastBLEScan =
    millis();

  ambulanceNearby =
    false;

  bleScan->start(
    700,
    false,
    true
  );

  bleScan->clearResults();
}

// ============================================================
// VALIDATE BLE STATE
// ============================================================

void validateBLEState()
{
  if (
    millis() -
    lastBLEDetection >
    BLE_DETECTION_TIMEOUT
  )
  {
    ambulanceNearby =
      false;

    ambulanceWithinOneMeter = false;

    ambulanceDistance =
      999.0;

    ambulanceRSSI =
      -127;

    bleAmbulanceName =
      "";
  }
}

// ============================================================
// START EMERGENCY BUZZER
// ============================================================

void startEmergencyBuzzer()
{
  if (
    !buzzerActive
  )
  {
    buzzerActive =
      true;

    buzzerOutput =
      true;

    buzzerTimer =
      millis();

    digitalWrite(
      BUZZER_PIN,
      HIGH
    );
  }
}

// ============================================================
// STOP EMERGENCY BUZZER
// ============================================================

void stopEmergencyBuzzer()
{
  buzzerActive =
    false;

  buzzerOutput =
    false;

  digitalWrite(
    BUZZER_PIN,
    LOW
  );
}

// ============================================================
// BUZZER TASK
// ============================================================
//
// Repeating:
// ON 300 ms
// OFF 300 ms
// ON 300 ms
// OFF 300 ms
// ============================================================

void buzzerTask()
{
  if (
    !buzzerActive
  )
  {
    digitalWrite(
      BUZZER_PIN,
      LOW
    );

    return;
  }

  unsigned long elapsed =
    millis() -
    buzzerTimer;

  if (
    buzzerOutput
  )
  {
    if (
      elapsed >=
      BUZZER_ON_TIME
    )
    {
      buzzerOutput =
        false;

      buzzerTimer =
        millis();

      digitalWrite(
        BUZZER_PIN,
        LOW
      );
    }
  }

  else
  {
    if (
      elapsed >=
      BUZZER_OFF_TIME
    )
    {
      buzzerOutput =
        true;

      buzzerTimer =
        millis();

      digitalWrite(
        BUZZER_PIN,
        HIGH
      );
    }
  }
}

// ============================================================
// SERVER GPS
// ============================================================
//
// GPS is informational/verification only.
// It does NOT independently activate the green corridor.
// ============================================================

bool serverGPSNearby()
{
  if (
    serverGPSDistance <=
    BLE_DISTANCE_THRESHOLD
  )
  {
    return true;
  }

  return false;
}

// ============================================================
// BLE EMERGENCY PROXIMITY
// ============================================================
//
// IMPORTANT:
//
// BLE = actual local ~1m trigger
//
// GPS = verification only
// ============================================================

bool ambulanceBLEAtJunction()
{
  if (
    !ambulanceNearby
  )
  {
    return false;
  }

  if (
    ambulanceDistance >
    BLE_DISTANCE_THRESHOLD
  )
  {
    return false;
  }

  // If server selected a specific ambulance,
  // verify that BLE name.
  if (
    serverPriority &&
    ambulanceId.length() > 0
  )
  {
    String expectedName =
      String("MEDRAS_AMB_") +
      ambulanceId;

    if (
      bleAmbulanceName != expectedName &&
      bleAmbulanceName != ambulanceId
    )
    {
      return false;
    }
  }

  return true;
}

// ============================================================
// EMERGENCY GREEN
// ============================================================
//
// ALWAYS:
// 1 selected direction GREEN
// 3 other directions RED
// ============================================================

void setEmergencyGreen(
  String direction
)
{
  allRed();

  if (
    direction == "NORTH"
  )
  {
    digitalWrite(
      N_RED,
      LOW
    );

    digitalWrite(
      N_GREEN,
      HIGH
    );
  }

  else if (
    direction == "EAST"
  )
  {
    digitalWrite(
      E_RED,
      LOW
    );

    digitalWrite(
      E_GREEN,
      HIGH
    );
  }

  else if (
    direction == "SOUTH"
  )
  {
    digitalWrite(
      S_RED,
      LOW
    );

    digitalWrite(
      S_GREEN,
      HIGH
    );
  }

  else if (
    direction == "WEST"
  )
  {
    digitalWrite(
      W_RED,
      LOW
    );

    digitalWrite(
      W_GREEN,
      HIGH
    );
  }

  Serial.print(
    "EMERGENCY GREEN: "
  );

  Serial.println(
    direction
  );
}

// ============================================================
// GET IR FOR DIRECTION
// ============================================================

bool getDirectionIR(
  String direction
)
{
  if (
    direction == "NORTH"
  )
  {
    return readIR(
      SENSOR_NORTH
    );
  }

  if (
    direction == "EAST"
  )
  {
    return readIR(
      SENSOR_EAST
    );
  }

  if (
    direction == "SOUTH"
  )
  {
    return readIR(
      SENSOR_SOUTH
    );
  }

  if (
    direction == "WEST"
  )
  {
    return readIR(
      SENSOR_WEST
    );
  }

  return false;
}

// ============================================================
// AMBULANCE PASSAGE TASK
// ============================================================
//
// The selected incoming-direction IR sensor is used to detect
// the ambulance at/passing the junction.
//
// We don't immediately cancel the green when BLE disappears.
// This avoids unsafe premature release.
// ============================================================

bool ambulancePassageConfirmed()
{
  if (
    !validDirection(
      incomingDirection
    )
  )
  {
    return false;
  }

  bool detected =
    getDirectionIR(
      incomingDirection
    );

  if (
    detected
  )
  {
    if (
      !ambulanceIRDetected
    )
    {
      ambulanceIRDetected =
        true;

      ambulanceIRStartTime =
        millis();

      Serial.println(
        "Ambulance IR detected"
      );
    }
  }

  else
  {
    if (
      ambulanceIRDetected
    )
    {
      unsigned long detectionTime =
        millis() -
        ambulanceIRStartTime;

      if (
        detectionTime >=
        AMBULANCE_IR_MIN_TIME
      )
      {
        ambulanceIRDetected =
          false;

        Serial.println(
          "Ambulance passage confirmed"
        );

        return true;
      }

      ambulanceIRDetected =
        false;
    }
  }

  return false;
}

// ============================================================
// RETURN TO NORMAL
// ============================================================

void returnToNormalTraffic()
{
  serverPriority =
    false;

  priorityButtonActive =
    false;

  emergencyId =
    "";

  ambulanceId =
    "";

  incomingDirection =
    "";

  outgoingDirection =
    "";

  hospitalName =
    "";

  routeFrom =
    "";

  routeTo =
    "";

  serverGPSDistance =
    999.0;

  ambulanceLatitude =
    0.0;

  ambulanceLongitude =
    0.0;

  ambulanceIRDetected =
    false;

  stopEmergencyBuzzer();

  // Safety first
  allRed();

  // Start a fresh normal cycle from NORTH
  normalDirection =
    DIR_NORTH;

  setNormalGreen(
    normalDirection
  );

  junctionState =
    NORMAL_TRAFFIC;

  stateStartTime =
    millis();

  Serial.println();
  Serial.println(
    "=================================="
  );

  Serial.println(
    "RETURNED TO NORMAL TRAFFIC"
  );

  Serial.println(
    "NORTH = GREEN"
  );

  Serial.println(
    "=================================="
  );
}

// ============================================================
// EMERGENCY CORRIDOR TASK
// ============================================================

void emergencyCorridorTask()
{
  // ==========================================================
  // MAIN SERVER MUST BE CONNECTED
  // ==========================================================

  if (!mainServerConnected())
  {
    handleServerConnectionLoss();
    return;
  }

  // ==========================================================
  // NO SERVER PRIORITY
  // ==========================================================

  if (
    !serverPriority
  )
  {
    return;
  }

  // ==========================================================
  // INVALID SERVER DIRECTION
  // ==========================================================

  if (
    !validDirection(
      incomingDirection
    )
  )
  {
    allRed();

    stopEmergencyBuzzer();

    Serial.println(
      "Invalid emergency direction"
    );

    return;
  }

  // ==========================================================
  // BLE PROXIMITY
  // ==========================================================

  bool ambulanceAtJunction =
    ambulanceBLEAtJunction();

  // ==========================================================
  // WAITING FOR AMBULANCE
  // ==========================================================

  if (
    junctionState ==
    NORMAL_TRAFFIC ||
    junctionState ==
    NORMAL_YELLOW
  )
  {
    if (
      !ambulanceAtJunction
    )
    {
      // Server has authorized corridor,
      // but ambulance has not reached ~1m yet.

      // Keep ALL RED for safety while waiting.
      allRed();

      return;
    }

    // ========================================================
    // AMBULANCE HAS REACHED J03
    // ========================================================

    Serial.println();
    Serial.println(
      "**********************************"
    );

    Serial.println(
      "AMBULANCE REACHED J03 <= ~1m"
    );

    Serial.print(
      "Incoming: "
    );

    Serial.println(
      incomingDirection
    );

    Serial.print(
      "Outgoing: "
    );

    Serial.println(
      outgoingDirection
    );

    Serial.println(
      "**********************************"
    );

    startEmergencyBuzzer();

    // Short yellow transition for safety.
    setYellow(
      incomingDirection
    );

    junctionState =
      EMERGENCY_YELLOW;

    stateStartTime =
      millis();

    emergencyStartTime =
      millis();

    return;
  }

  // ==========================================================
  // EMERGENCY YELLOW → GREEN
  // ==========================================================

  if (
    junctionState ==
    EMERGENCY_YELLOW
  )
  {
    startEmergencyBuzzer();

    if (
      millis() -
      stateStartTime >=
      YELLOW_TIME
    )
    {
      setEmergencyGreen(
        incomingDirection
      );

      junctionState =
        EMERGENCY_GREEN;

      stateStartTime =
        millis();

      emergencyStartTime =
        millis();

      Serial.println(
        "GREEN CORRIDOR ACTIVE"
      );
    }

    return;
  }

  // ==========================================================
  // EMERGENCY GREEN
  // ==========================================================

  if (
    junctionState ==
    EMERGENCY_GREEN
  )
  {
    // Keep selected direction GREEN.
    setEmergencyGreen(
      incomingDirection
    );

    // Repeating buzzer
    startEmergencyBuzzer();

    // --------------------------------------------------------
    // IR PASSAGE CONFIRMATION
    // --------------------------------------------------------

    if (
      ambulancePassageConfirmed()
    )
    {
      Serial.println(
        "IR CONFIRMED AMBULANCE PASSAGE"
      );

      // Safety first: end the local emergency phase and
      // immediately start a fresh normal traffic cycle.
      // This also clears serverPriority so normalTrafficTask()
      // is no longer blocked after IR passage confirmation.
      returnToNormalTraffic();

      return;
    }

    // --------------------------------------------------------
    // SERVER STOP
    // --------------------------------------------------------

    // serverPriority can become false through
    // GREEN_CORRIDOR_STOP command.
    //
    // That command is processed by mqttCallback().

    // --------------------------------------------------------
    // SAFETY TIMEOUT
    // --------------------------------------------------------

    if (
      millis() -
      emergencyStartTime >=
      EMERGENCY_SAFETY_TIMEOUT
    )
    {
      Serial.println(
        "EMERGENCY SAFETY TIMEOUT"
      );

      returnToNormalTraffic();

      return;
    }
  }
}

// ============================================================
// IR READ
// ============================================================

bool readIR(
  int pin
)
{
  int value =
    digitalRead(
      pin
    );

#if IR_ACTIVE_LOW

  return (
    value == LOW
  );

#else

  return (
    value == HIGH
  );

#endif
}

// ============================================================
// VEHICLE SENSOR TASK
// ============================================================

void vehicleSensorTask()
{
  bool north =
    readIR(
      SENSOR_NORTH
    );

  bool east =
    readIR(
      SENSOR_EAST
    );

  bool south =
    readIR(
      SENSOR_SOUTH
    );

  bool west =
    readIR(
      SENSOR_WEST
    );

  // ==========================================================
  // NORTH
  // ==========================================================

  if (
    north &&
    !previousNorthSensor
  )
  {
    northVehicleCount++;
  }

  // ==========================================================
  // EAST
  // ==========================================================

  if (
    east &&
    !previousEastSensor
  )
  {
    eastVehicleCount++;
  }

  // ==========================================================
  // SOUTH
  // ==========================================================

  if (
    south &&
    !previousSouthSensor
  )
  {
    southVehicleCount++;
  }

  // ==========================================================
  // WEST
  // ==========================================================

  if (
    west &&
    !previousWestSensor
  )
  {
    westVehicleCount++;
  }

  previousNorthSensor =
    north;

  previousEastSensor =
    east;

  previousSouthSensor =
    south;

  previousWestSensor =
    west;
}

// ============================================================
// MQTT CALLBACK
// ============================================================

void mqttCallback(
  char *topic,
  byte *payload,
  unsigned int length
)
{
  Serial.println();
  Serial.println(
    "========== MQTT COMMAND =========="
  );

  JsonDocument doc;

  DeserializationError error =
    deserializeJson(
      doc,
      payload,
      length
    );

  if (
    error
  )
  {
    Serial.println(
      "Invalid JSON command"
    );

    return;
  }

  // ==========================================================
  // SECURITY TOKEN
  // ==========================================================

  String token =
    String(
      (const char *)
      (
        doc["token"] |
        ""
      )
    );

  if (
    token !=
    DEVICE_TOKEN
  )
  {
    Serial.println(
      "Unauthorized J03 command"
    );

    return;
  }

  // ==========================================================
  // COMMAND
  // ==========================================================

  String command =
    String(
      (const char *)
      (
        doc["command"] |
        ""
      )
    );

  Serial.print(
    "Command: "
  );

  Serial.println(
    command
  );

  // ==========================================================
  // GREEN CORRIDOR START
  // ==========================================================

  if (
    command ==
    "GREEN_CORRIDOR_START"
  )
  {
    // ========================================================
    // MAIN SERVER CONNECTION CHECK
    // ========================================================

    if (!mainServerConnected())
    {
      Serial.println(
        "GREEN CORRIDOR REJECTED: MAIN SERVER NOT CONNECTED"
      );

      allRed();
      return;
    }

    // ========================================================
    // PRIORITY BUTTON AUTHORIZATION
    // ========================================================
    // The junction MUST NOT activate a green corridor merely
    // because a server command arrived. The command must also
    // explicitly confirm that the ambulance priority button
    // was pressed/authorized.
    // ========================================================

    priorityButtonActive =
      doc["priority_active"] |
      false;

    if (!priorityButtonActive)
    {
      Serial.println();
      Serial.println(
        "GREEN CORRIDOR REJECTED: PRIORITY BUTTON NOT ACTIVE"
      );

      serverPriority = false;
      allRed();
      return;
    }

    emergencyId =
      String(
        (const char *)
        (
          doc["emergency_id"] |
          ""
        )
      );

    ambulanceId =
      String(
        (const char *)
        (
          doc["ambulance_id"] |
          ""
        )
      );

    // --------------------------------------------------------
    // Preferred field:
    // incoming_direction
    //
    // Backward compatibility:
    // direction
    // --------------------------------------------------------

    incomingDirection =
      String(
        (const char *)
        (
          doc["incoming_direction"] |
          ""
        )
      );

    if (
      !validDirection(
        incomingDirection
      )
    )
    {
      incomingDirection =
        String(
          (const char *)
          (
            doc["direction"] |
            ""
          )
        );
    }

    // --------------------------------------------------------
    // Outgoing direction
    // --------------------------------------------------------

    outgoingDirection =
      String(
        (const char *)
        (
          doc["outgoing_direction"] |
          ""
        )
      );

    // --------------------------------------------------------
    // Hospital
    // --------------------------------------------------------

    hospitalName =
      String(
        (const char *)
        (
          doc["hospital_name"] |
          ""
        )
      );

    // --------------------------------------------------------
    // Route
    // --------------------------------------------------------

    routeFrom =
      String(
        (const char *)
        (
          doc["route_from"] |
          ""
        )
      );

    routeTo =
      String(
        (const char *)
        (
          doc["route_to"] |
          ""
        )
      );

    // --------------------------------------------------------
    // GPS
    // --------------------------------------------------------

    serverGPSDistance =
      doc["gps_distance_m"] |
      999.0;

    ambulanceLatitude =
      doc["ambulance_lat"] |
      0.0;

    ambulanceLongitude =
      doc["ambulance_lon"] |
      0.0;

    // --------------------------------------------------------
    // Authorize
    // --------------------------------------------------------

    if (
      !validDirection(
        incomingDirection
      )
    )
    {
      Serial.println(
        "ERROR: Invalid incoming direction"
      );

      allRed();

      return;
    }

    serverPriority =
      true;

    emergencyStartTime =
      millis();

    ambulanceIRDetected =
      false;

    stopEmergencyBuzzer();

    // --------------------------------------------------------
    // WAITING STATE
    // --------------------------------------------------------

    // Keep all signals RED until ambulance actually
    // reaches the local BLE ~1m proximity.
    // This state is entered only after priority_active=true.
    allRed();

    Serial.println();
    Serial.println(
      "**************************************"
    );

    Serial.println(
      "GREEN CORRIDOR AUTHORIZED"
    );

    Serial.print(
      "Emergency ID: "
    );

    Serial.println(
      emergencyId
    );

    Serial.print(
      "Ambulance ID: "
    );

    Serial.println(
      ambulanceId
    );

    Serial.print(
      "Incoming: "
    );

    Serial.println(
      incomingDirection
    );

    Serial.print(
      "Outgoing: "
    );

    Serial.println(
      outgoingDirection
    );

    Serial.print(
      "Hospital: "
    );

    Serial.println(
      hospitalName
    );

    Serial.print(
      "GPS distance: "
    );

    Serial.print(
      serverGPSDistance
    );

    Serial.println(
      " m"
    );

    Serial.println(
      "WAITING FOR BLE <= ~1m"
    );

    Serial.println(
      "**************************************"
    );

    return;
  }

  // ==========================================================
  // GPS UPDATE
  // ==========================================================

  if (
    command ==
    "AMBULANCE_GPS_UPDATE"
  )
  {
    serverGPSDistance =
      doc["gps_distance_m"] |
      999.0;

    ambulanceLatitude =
      doc["ambulance_lat"] |
      0.0;

    ambulanceLongitude =
      doc["ambulance_lon"] |
      0.0;

    return;
  }

  // ==========================================================
  // GREEN CORRIDOR STOP
  // ==========================================================

  if (
    command ==
    "GREEN_CORRIDOR_STOP"
  )
  {
    Serial.println(
      "GREEN CORRIDOR STOPPED BY SERVER"
    );

    returnToNormalTraffic();

    return;
  }

  // ==========================================================
  // RESET JUNCTION
  // ==========================================================

  if (
    command ==
    "RESET_JUNCTION"
  )
  {
    Serial.println(
      "RESETTING J03"
    );

    returnToNormalTraffic();

    return;
  }
}

// ============================================================
// LCD CLEAR LINE
// ============================================================

void lcdClearLine(
  int row
)
{
  lcd.setCursor(
    0,
    row
  );

  lcd.print(
    "                "
  );

  lcd.setCursor(
    0,
    row
  );
}

// ============================================================
// LCD TASK
// ============================================================

void lcdTask()
{
  // ----------------------------------------------------------
  // LIVE 16x2 LCD DASHBOARD
  // Pages rotate every 5 seconds.
  // ----------------------------------------------------------
  static uint8_t page = 0;
  static unsigned long lastPageChange = 0;

  if (millis() - lastPageChange >= 5000UL)
  {
    lastPageChange = millis();
    page = (page + 1) % 6;
    lcd.clear();
  }

  char line1[17];
  char line2[17];

  memset(line1, ' ', 16);
  memset(line2, ' ', 16);
  line1[16] = '\0';
  line2[16] = '\0';

  auto copyLine = [](char *dst, const String &src)
  {
    String t = src;
    if (t.length() > 16)
      t = t.substring(0, 16);

    for (uint8_t i = 0; i < t.length(); i++)
      dst[i] = t[i];
  };

  // ----------------------------------------------------------
  // PAGE 0 - JUNCTION / CONNECTION
  // ----------------------------------------------------------
  if (page == 0)
  {
    copyLine(
      line1,
      String("MEDRAS ") + JUNCTION_ID
    );

    if (mqtt.connected())
      copyLine(line2, "MQTT:CONNECTED");
    else
      copyLine(line2, "MQTT:OFFLINE");
  }

  // ----------------------------------------------------------
  // PAGE 1 - TRAFFIC SIGNAL STATE
  // ----------------------------------------------------------
  else if (page == 1)
  {
    String modeText;

    switch (NORMAL_TRAFFIC)
    {
      case NORMAL_TRAFFIC:
        modeText = "NORMAL";
        break;

      case NORMAL_YELLOW:
        modeText = "YELLOW";
        break;

      case EMERGENCY_YELLOW:
        modeText = "EMG-YELLOW";
        break;

      case EMERGENCY_GREEN:
        modeText = "EMG-GREEN";
        break;

      default:
        modeText = "UNKNOWN";
        break;
    }

    copyLine(line1, "TRAFFIC " + modeText);

    String dir = "GREEN:";
    if (DIR_NORTH == DIR_NORTH)
      dir += "NORTH";
    else if (DIR_NORTH == DIR_EAST)
      dir += "EAST";
    else if (DIR_NORTH == DIR_SOUTH)
      dir += "SOUTH";
    else if (DIR_NORTH == DIR_WEST)
      dir += "WEST";
    else
      dir += "NONE";

    copyLine(line2, dir);
  }

  // ----------------------------------------------------------
  // PAGE 2 - EMERGENCY / AMBULANCE
  // ----------------------------------------------------------
  else if (page == 2)
  {
    if (serverPriority || priorityButtonActive)
    {
      copyLine(line1, "!!! EMERGENCY !!!");

      String amb = "AMB:";
      if (String("").length())
        amb += String("");
      else
        amb += "WAITING";

      copyLine(line2, amb);
    }
    else
    {
      copyLine(line1, "EMERGENCY: NONE");
      copyLine(line2, "ROAD: NORMAL");
    }
  }

  // ----------------------------------------------------------
  // PAGE 3 - BLE AMBULANCE
  // ----------------------------------------------------------
  else if (page == 3)
  {
    if (false)
    {
      copyLine(line1, "BLE AMB: NEAR");

      String d = "D:";
      d += String(0.0, 2);
      d += "m";

      copyLine(line2, d);
    }
    else
    {
      copyLine(line1, "BLE AMB: NONE");
      copyLine(line2, "WAITING...");
    }
  }

  // ----------------------------------------------------------
  // PAGE 4 - SERVER / IR INFORMATION
  // ----------------------------------------------------------
  else if (page == 4)
  {
    if (false)
    {
      String d = "GPS:";
      d += String(0.0, 0);
      d += "m";

      copyLine(line1, d);
    }
    else
    {
      copyLine(line1, "GPS DIST: N/A");
    }

    String ir = "IR N:";
    ir += String(northVehicleCount);
    ir += " E:";
    ir += String(eastVehicleCount);

    copyLine(line2, ir);
  }

  // ----------------------------------------------------------
  // PAGE 5 - NETWORK / BROKER
  // ----------------------------------------------------------
  else
  {
    String wifiText =
      (WiFi.status() == WL_CONNECTED)
        ? "WIFI:OK"
        : "WIFI:OFF";

    copyLine(line1, wifiText);

    if (usingMQTTFallback)
    {
      copyLine(line2, "MQTT:FALLBACK");
    }
    else if (medrasServerDiscovered)
    {
      copyLine(line2, "MQTT:AUTO-IP");
    }
    else
    {
      copyLine(line2, "MQTT:SEARCHING");
    }
  }

  lcd.setCursor(0, 0);
  lcd.print(line1);

  lcd.setCursor(0, 1);
  lcd.print(line2);
}


// ============================================================
// PUBLISH JUNCTION DATA
// ============================================================

void publishStatus()
{
  if (
    !mqtt.connected()
  )
  {
    return;
  }

  if (
    millis() -
    lastPublish <
    PUBLISH_INTERVAL
  )
  {
    return;
  }

  lastPublish =
    millis();

  JsonDocument doc;

  doc["junction_id"] =
    JUNCTION_ID;

  doc["device_id"] =
    "ESP32_J03";

  // DO NOT publish DEVICE_TOKEN.
  // It is a command authentication secret.

  // ==========================================================
  // STATE
  // ==========================================================

  if (
    junctionState ==
    NORMAL_TRAFFIC
  )
  {
    doc["state"] =
      "NORMAL_TRAFFIC";
  }

  else if (
    junctionState ==
    NORMAL_YELLOW
  )
  {
    doc["state"] =
      "NORMAL_YELLOW";
  }

  else if (
    junctionState ==
    EMERGENCY_YELLOW
  )
  {
    doc["state"] =
      "EMERGENCY_YELLOW";
  }

  else
  {
    doc["state"] =
      "EMERGENCY_GREEN";
  }

  // ==========================================================
  // TRAFFIC
  // ==========================================================

  doc["normal_direction"] =
    directionName(
      normalDirection
    );

  doc["server_priority"] =
    serverPriority;

  doc["priority_button_active"] =
    priorityButtonActive;

  doc["main_server_connected"] =
    mainServerConnected();

  // ==========================================================
  // EMERGENCY
  // ==========================================================

  doc["emergency_id"] =
    emergencyId;

  doc["ambulance_id"] =
    ambulanceId;

  doc["incoming_direction"] =
    incomingDirection;

  doc["outgoing_direction"] =
    outgoingDirection;

  doc["hospital"] =
    hospitalName;

  doc["route_from"] =
    routeFrom;

  doc["route_to"] =
    routeTo;

  // ==========================================================
  // BLE
  // ==========================================================

  doc["ble_detected"] =
    ambulanceNearby;

  doc["ble_ambulance_name"] =
    bleAmbulanceName;

  doc["ble_rssi"] =
    ambulanceRSSI;

  doc["ble_distance_m"] =
    ambulanceDistance;

  doc["ble_within_1m"] =
    ambulanceBLEAtJunction();

  // ==========================================================
  // GPS
  // ==========================================================

  doc["server_gps_distance_m"] =
    serverGPSDistance;

  doc["ambulance_lat"] =
    ambulanceLatitude;

  doc["ambulance_lon"] =
    ambulanceLongitude;

  // ==========================================================
  // IR
  // ==========================================================

  doc["ir_north"] =
    readIR(
      SENSOR_NORTH
    );

  doc["ir_east"] =
    readIR(
      SENSOR_EAST
    );

  doc["ir_south"] =
    readIR(
      SENSOR_SOUTH
    );

  doc["ir_west"] =
    readIR(
      SENSOR_WEST
    );

  // ==========================================================
  // VEHICLE COUNTS
  // ==========================================================

  doc["north_vehicle_count"] =
    northVehicleCount;

  doc["east_vehicle_count"] =
    eastVehicleCount;

  doc["south_vehicle_count"] =
    southVehicleCount;

  doc["west_vehicle_count"] =
    westVehicleCount;

  // ==========================================================
  // DEVICE
  // ==========================================================

  doc["wifi_rssi"] =
    WiFi.RSSI();

  doc["uptime_ms"] =
    millis();

  char buffer[2048];

  size_t len =
    serializeJson(
      doc,
      buffer
    );

  mqtt.publish(
    TOPIC_DATA,
    buffer,
    len
  );
}

// ============================================================
// SETUP
// ============================================================

void setup()
{
  Serial.begin(
    115200
  );

  delay(500);

  Serial.println();
  Serial.println(
    "======================================"
  );

  Serial.println(
    "MEDRAS J03 STARTING"
  );

  Serial.println(
    "======================================"
  );

  // ==========================================================
  // TRAFFIC SIGNAL OUTPUTS
  // ==========================================================

  pinMode(
    N_RED,
    OUTPUT
  );

  pinMode(
    N_YELLOW,
    OUTPUT
  );

  pinMode(
    N_GREEN,
    OUTPUT
  );

  pinMode(
    E_RED,
    OUTPUT
  );

  pinMode(
    E_YELLOW,
    OUTPUT
  );

  pinMode(
    E_GREEN,
    OUTPUT
  );

  pinMode(
    S_RED,
    OUTPUT
  );

  pinMode(
    S_YELLOW,
    OUTPUT
  );

  pinMode(
    S_GREEN,
    OUTPUT
  );

  pinMode(
    W_RED,
    OUTPUT
  );

  pinMode(
    W_YELLOW,
    OUTPUT
  );

  pinMode(
    W_GREEN,
    OUTPUT
  );

  // ==========================================================
  // BUZZER
  // ==========================================================

  pinMode(
    BUZZER_PIN,
    OUTPUT
  );

  digitalWrite(
    BUZZER_PIN,
    LOW
  );

  // ==========================================================
  // IR
  // ==========================================================

  pinMode(
    SENSOR_NORTH,
    INPUT
  );

  pinMode(
    SENSOR_EAST,
    INPUT
  );

  pinMode(
    SENSOR_SOUTH,
    INPUT
  );

  pinMode(
    SENSOR_WEST,
    INPUT
  );

  // ==========================================================
  // SAFE INITIAL STATE
  // ==========================================================

  allRed();

  delay(500);

  // ==========================================================
  // START NORMAL TRAFFIC
  // ==========================================================

  normalDirection =
    DIR_NORTH;

  setNormalGreen(
    normalDirection
  );

  junctionState =
    NORMAL_TRAFFIC;

  stateStartTime =
    millis();

  Serial.println(
    "NORTH = GREEN"
  );

  Serial.println(
    "EAST  = RED"
  );

  Serial.println(
    "SOUTH = RED"
  );

  Serial.println(
    "WEST  = RED"
  );

  // ==========================================================
  // LCD
  // ==========================================================

  Wire.begin(
    21,
    22
  );

  lcd.init();

  lcd.backlight();

  lcd.clear();

  lcd.setCursor(
    0,
    0
  );

  lcd.print(
    "MEDRAS J03"
  );

  lcd.setCursor(
    0,
    1
  );

  lcd.print(
    "Starting..."
  );

  delay(1000);

  // ==========================================================
  // WIFI
  // ==========================================================
startWiFi();

  // ==========================================================
  // MQTT
  // ==========================================================

  mqtt.setServer(
    medrasMQTTServerIP,
    medrasMQTTServerPort
  );

  mqtt.setCallback(
    mqttCallback
  );

  mqtt.setBufferSize(
    2048
  );

  // ==========================================================
  // BLE
  // ==========================================================

  NimBLEDevice::init(
    "MEDRAS_J03"
  );

  bleScan =
    NimBLEDevice::getScan();

  bleScan->setScanCallbacks(
    &bleCallbacks,
    true
  );

  bleScan->setMaxResults(
    0
  );

  bleScan->setActiveScan(
    true
  );

  bleScan->setInterval(
    100
  );

  bleScan->setWindow(
    80
  );

  // ==========================================================
  // LCD TIMER
  // ==========================================================

  lastLCDPageChange =
    millis();

  // ==========================================================
  // READY
  // ==========================================================

  Serial.println();
  Serial.println(
    "======================================"
  );

  Serial.println(
    "J03 READY"
  );

  Serial.println(
    "All junctions are coordinated by the main MEDRAS server"
  );

  Serial.println(
    "Green Corridor = server + priority button + BLE <= ~1m"
  );

  Serial.println(
    "Normal cycle = 30s GREEN + 3s YELLOW"
  );

  Serial.println(
    "BLE emergency threshold = ~1m"
  );

  Serial.println(
    "Green corridor requires ambulance PRIORITY button"
  );

  Serial.println(
    "======================================"
  );
}

// ============================================================
// LOOP
// ============================================================

void loop()
{
  medrasDiscoveryTask();
  medrasTransportTask();
  useMQTTFallbackIfNeeded();

  // ----------------------------------------------------------
  // WIFI
  // ----------------------------------------------------------

  wifiTask();

  // ----------------------------------------------------------
  // MQTT
  // ----------------------------------------------------------

  mqttTask();

  if (
    mqtt.connected()
  )
  {
    mqtt.loop();
  }

  // ----------------------------------------------------------
  // BLE
  // ----------------------------------------------------------

  bleTask();

  validateBLEState();

  // ----------------------------------------------------------
  // IR / VEHICLE COUNT
  // ----------------------------------------------------------

  vehicleSensorTask();

  // ----------------------------------------------------------
  // NORMAL TRAFFIC
  // ----------------------------------------------------------

  normalTrafficTask();

  // ----------------------------------------------------------
  // EMERGENCY GREEN CORRIDOR
  // ----------------------------------------------------------

  emergencyCorridorTask();

  // ----------------------------------------------------------
  // BUZZER
  // ----------------------------------------------------------

  buzzerTask();

  // ----------------------------------------------------------
  // LCD
  // ----------------------------------------------------------

  lcdTask();

  // ----------------------------------------------------------
  // MQTT TELEMETRY
  // ----------------------------------------------------------

  publishStatus();

  // Small cooperative delay
  delay(5);
}