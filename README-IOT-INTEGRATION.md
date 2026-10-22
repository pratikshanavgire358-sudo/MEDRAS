# MEDRA ESP32 + MQTT + HTTP + WebSocket integration

This patch adds the backend endpoints and an admin-facing live telemetry page while preserving the existing MEDRA pages and APIs.

## Components added

## How the connections work

All components are inside this one MEDRA project folder:

- **MQTT:** ESP32 publishes sensor/event JSON to `medras/#`; FastAPI subscribes and stores messages in PostgreSQL.
- **HTTP:** each ESP32 posts its connectivity heartbeat to `POST /api/iot/telemetry` on port 8000.
- **WebSocket:** ESP32 connects to `ws://<MEDRA-computer-LAN-IP>:8000/ws/iot`; the website connects to the same endpoint with its MEDRA login token to receive live updates.
- **PostgreSQL:** the backend stores received messages in `iot_telemetry` and the website loads recent rows from `GET /api/iot/telemetry/latest`.


- `backend/app/models/iot.py`: append-only SQLAlchemy telemetry table.
- `backend/app/routes/iot.py`: `POST /api/iot/telemetry`, `GET /api/iot/telemetry/latest`, and `WS /ws/iot` plus MQTT subscriber bridge.
- `pages/admin/iot-dashboard.html` and `js/iot-dashboard.js`: live device/message monitor.
- `docker-compose.mqtt.yml` and `mosquitto/config/mosquitto.conf`: local-development Mosquitto broker.
- `firmware/`: copies of the eight supplied ESP32 sketches for reference.

## 1. Start the MQTT broker (Docker Desktop must be running)

From the project root:

```powershell
docker compose -f docker-compose.mqtt.yml up -d
```

This included Mosquitto configuration allows anonymous connections for a **trusted local demo only**. Do not expose port 1883 to the internet. Before production, configure MQTT usernames/passwords or certificates and update all ESP32 sketches to use them.

## 2. Install backend dependencies

Use the Python environment for this checkout. If there is no environment in `backend`, create one from the backend folder:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal, then activate again. Do not delete an existing environment.

## 3. Configure backend

Keep your existing `backend/.env` values for `DATABASE_URL` and `MEDRA_JWT_SECRET`. Add these lines:

```env
MQTT_HOST=127.0.0.1
MQTT_PORT=1883
# For a protected broker, configure MQTT_USERNAME and MQTT_PASSWORD too.
# Optional: if set, HTTP heartbeat posts must send X-IoT-Device-Key.
# Current supplied sketches do not send this header, so leave unset for local demo only.
# IOT_DEVICE_API_KEY=replace-with-a-long-random-secret
```

The backend creates the new `iot_telemetry` table via the project's existing `Base.metadata.create_all` startup path. No existing tables are dropped.

## 4. Start FastAPI on port 8000 (same port used by the included ESP32 sketches)

Open a terminal in the `backend` folder and run:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Swagger will be at `http://127.0.0.1:8000/docs`. Keep the API on port **8000** for this package; the included firmware sends HTTP telemetry to port 8000 and opens WebSocket `/ws/iot` on port 8000. The MQTT broker is a separate service but remains part of this same project folder and is started with the command in Step 1.

## 5. ESP32 network settings

The backend now broadcasts `MEDRAS_SERVER=<backend LAN IP>:1883` over UDP port 4210 every five seconds, which the supplied sketches use for discovery. If broadcast packets are blocked by the router/firewall, update the sketches' fallback IP (several currently contain `10.17.229.46`) to the backend computer's current LAN IPv4 address. Use `ipconfig` on Windows to find it. Do not use `127.0.0.1` on an ESP32: loopback points to the ESP32 itself. The included copies of all eight sketches use HTTP and WebSocket port 8000 to match the existing FastAPI port; MQTT uses port 1883.

Open each sketch in Arduino IDE and install its referenced libraries, including PubSubClient, ArduinoJson, WebSocketsClient, and any board/sensor-specific libraries listed in that sketch. Select the correct ESP32 board and COM port, then compile/upload one device at a time.

## 6. View the website

Log in to MEDRA with an authorized `admin`, `hospital`, or `ambulance` account. Open `pages/admin/iot-dashboard.html` through your existing local web server (not a `file://` URL). The page loads stored telemetry and subscribes to `/ws/iot` using the current MEDRA JWT. Incoming `medras/#` MQTT messages are persisted and pushed to authorized browser clients.

The current supplied sketches send HTTP status heartbeats every 10 seconds; actual sensor readings are published on the MQTT topics already in firmware, including `medras/home/data`, `medras/home/ecg`, `medras/ambulance/data`, `medras/vehicle/data`, `medras/junction/J01/data` through `J04/data`, and `medras/gateway/status` / `call` / `sms`.

## If devices do not connect

1. The PC and ESP32 must be on the same Wi-Fi/LAN for local discovery.
2. On Windows, run `ipconfig` and note the active Wi-Fi adapter's IPv4 address. ESP32 sketches must target that LAN IP, never `127.0.0.1`.
3. Keep FastAPI running on TCP 8000 and Mosquitto running on TCP 1883. UDP discovery uses port 4210.
4. If Windows Firewall asks, allow Python and Docker on the private network. Do not expose these ports to the public internet.
5. Open `http://127.0.0.1:8000/docs` and confirm the API opens. After an ESP32 is uploaded and online, inspect `/api/iot/telemetry/latest` through the authenticated dashboard to confirm messages are arriving.
6. If the dashboard is blank, first check the backend terminal for `[MEDRA IoT] MQTT connected` and then check the ESP32 Serial Monitor for Wi-Fi, MQTT, HTTP, and WebSocket connection messages.

## Security and deployment notes

- This is a local integration baseline, not a production medical telemetry deployment.
- The provided HTTP heartbeat endpoint is designed for lightweight connectivity metadata. Add per-device authentication to firmware before using HTTP to submit sensitive readings.
- Browser WebSocket clients must pass a valid JWT and have an authorized role. Unauthenticated firmware WebSocket clients receive no raw sensor messages.
- MQTT broker anonymous mode is demo-only. Production requires broker authentication, TLS, network restrictions, payload limits, and device-level ACLs.
- MQTT telemetry is saved as JSON; high-rate ECG waveforms can grow the database quickly. For production, batch samples and add retention/partitioning policies.
- Sensor data displayed here is not a medical diagnosis or a substitute for professional emergency response.
