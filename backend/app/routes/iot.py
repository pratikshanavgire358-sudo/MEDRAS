import asyncio
import json
import os
import time
import socket
import threading
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.dependencies import get_current_user
from app.core.config import settings
from app.models.iot import IOTTelemetry
from app.models.user import User

router = APIRouter(tags=["IoT Telemetry"])

# A process-local fan-out. For multiple API workers, use Redis/pub-sub instead.
class ConnectionManager:
    def __init__(self):
        self.connections: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self.lock:
            self.connections.add(websocket)

    async def disconnect(self, websocket: WebSocket):
        async with self.lock:
            self.connections.discard(websocket)

    async def broadcast(self, message: dict[str, Any], *, safe_for_devices: bool = False):
        # ESP32 firmware connects without a browser JWT. Never send raw sensor
        # values or patient data to those unauthenticated device connections.
        async with self.lock:
            peers = list(self.connections)
        stale = []
        for peer in peers:
            if safe_for_devices and peer.query_params.get("token") is None:
                continue
            try:
                await peer.send_json(message)
            except Exception:
                stale.append(peer)
        for peer in stale:
            await self.disconnect(peer)

manager = ConnectionManager()

class TelemetryIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    transport: str = Field(default="HTTP", max_length=20)
    wifi_connected: bool | None = None
    mqtt_connected: bool | None = None
    websocket_connected: bool | None = None
    uptime_ms: int | None = Field(default=None, ge=0)
    type: str | None = Field(default=None, max_length=80)
    # Extra sensor fields are allowed because the eight firmware devices differ.
    model_config = {"extra": "allow"}


def _store(db: Session, *, device_id: str, topic: str, transport: str, payload: dict):
    row = IOTTelemetry(device_id=device_id, topic=topic[:255], transport=transport[:20], payload=payload)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _safe_device_message(row: IOTTelemetry) -> dict:
    return {
        "type": "telemetry",
        "id": row.id,
        "device_id": row.device_id,
        "topic": row.topic,
        "transport": row.transport,
        "payload": row.payload,
        "received_at": row.received_at.isoformat() if row.received_at else datetime.now(timezone.utc).isoformat(),
    }


def _verify_device_key(value: str | None):
    expected = getattr(settings, "IOT_DEVICE_API_KEY", None) or os.getenv("IOT_DEVICE_API_KEY")
    # For the provided firmware, HTTP carries connectivity-only heartbeats and
    # currently has no key header. Keep it limited to non-sensitive status.
    # Configure IOT_DEVICE_API_KEY to require a key for HTTP POSTs.
    if expected and value != expected:
        raise HTTPException(status_code=401, detail="Invalid IoT device API key")


@router.post("/api/iot/telemetry", status_code=202)
async def receive_http_telemetry(
    body: TelemetryIn,
    x_iot_device_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _verify_device_key(x_iot_device_key)
    payload = body.model_dump(exclude_none=True)
    row = _store(db, device_id=body.device_id, topic="http/telemetry", transport="HTTP", payload=payload)
    # Store the lightweight device heartbeat. Don't expose to anonymous WebSockets.
    await manager.broadcast(_safe_device_message(row), safe_for_devices=True)
    return {"accepted": True, "id": row.id, "device_id": row.device_id}


@router.get("/api/iot/telemetry/latest")
def latest_telemetry(
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in ("admin", "hospital", "ambulance"):
        raise HTTPException(status_code=403, detail="IoT telemetry access is not allowed for this role")
    rows = db.query(IOTTelemetry).order_by(IOTTelemetry.received_at.desc()).limit(limit).all()
    return {"items": [_safe_device_message(row) for row in rows]}


@router.websocket("/ws/iot")
async def iot_websocket(websocket: WebSocket, token: str | None = Query(default=None)):
    # ESP32 firmware has no JWT query parameter. It may connect for a heartbeat,
    # but receives no raw sensor payloads. Browser clients must present a valid JWT.
    if token:
        try:
            from app.core.config import settings
            import jwt
            from app.core.database import SessionLocal
            payload = jwt.decode(token, settings.MEDRA_JWT_SECRET, algorithms=["HS256"])
            user_id = int(payload.get("sub"))
            db = SessionLocal()
            try:
                user = db.query(User).filter(User.id == user_id).first()
                if not user or not user.is_active or user.role not in ("admin", "hospital", "ambulance"):
                    await websocket.close(code=1008)
                    return
            finally:
                db.close()
        except Exception:
            await websocket.close(code=1008)
            return
    await manager.connect(websocket)
    try:
        if token:
            await websocket.send_json({"type": "connected", "message": "MEDRA live telemetry connected"})
        else:
            await websocket.send_json({"type": "connected", "message": "Device heartbeat channel connected"})
        while True:
            # Firmware sends heartbeat frames; browser clients can keepalive too.
            raw = await websocket.receive_text()
            if len(raw) > 4096:
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("type") == "device_heartbeat" and isinstance(message.get("device_id"), str):
                # Save only connectivity metadata, not sensor values from this path.
                payload = {k: message[k] for k in ("type", "device_id", "mqtt_connected", "uptime_ms") if k in message}
                db = SessionLocal()
                try:
                    row = _store(db, device_id=message["device_id"], topic="websocket/heartbeat", transport="WebSocket", payload=payload)
                finally:
                    db.close()
                await manager.broadcast(_safe_device_message(row), safe_for_devices=True)
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)


# Paho callback threads schedule DB writes and WebSocket fan-out on the event loop.
_mqtt_client = None
_mqtt_loop = None
_discovery_thread = None
_discovery_stop = threading.Event()

def _lan_ipv4() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()

def _discovery_worker():
    # The sketches listen for MEDRAS_SERVER=<backend LAN IP>:1883 on UDP 4210.
    while not _discovery_stop.is_set():
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            message = f"MEDRAS_SERVER={_lan_ipv4()}:{os.getenv('MQTT_PORT', '1883')}".encode()
            sock.sendto(message, ("255.255.255.255", 4210))
        except OSError as exc:
            print(f"[MEDRA IoT] UDP discovery broadcast failed: {exc}")
        finally:
            sock.close()
        _discovery_stop.wait(5)

def start_discovery_broadcast():
    global _discovery_thread
    _discovery_stop.clear()
    _discovery_thread = threading.Thread(target=_discovery_worker, daemon=True, name="medra-iot-discovery")
    _discovery_thread.start()

def stop_discovery_broadcast():
    _discovery_stop.set()

def start_mqtt_bridge(loop: asyncio.AbstractEventLoop):
    global _mqtt_client, _mqtt_loop
    _mqtt_loop = loop
    host = os.getenv("MQTT_HOST", "127.0.0.1")
    port = int(os.getenv("MQTT_PORT", "1883"))
    username = os.getenv("MQTT_USERNAME")
    password = os.getenv("MQTT_PASSWORD")
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        print("[MEDRA IoT] paho-mqtt is not installed; MQTT bridge disabled. Install backend requirements.")
        return

    def on_connect(client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            client.subscribe("medras/#", qos=0)
            print(f"[MEDRA IoT] MQTT connected to {host}:{port}; subscribed medras/#")
        else:
            print(f"[MEDRA IoT] MQTT connection failed: {reason_code}")

    def on_message(client, userdata, msg):
        try:
            text = msg.payload.decode("utf-8")
            payload = json.loads(text)
            if not isinstance(payload, dict):
                payload = {"value": payload}
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {"raw": msg.payload[:2048].decode("utf-8", errors="replace")}
        device_id = str(payload.get("device_id") or payload.get("deviceId") or _device_from_topic(msg.topic))[:100]
        if _mqtt_loop is None:
            return
        asyncio.run_coroutine_threadsafe(_process_mqtt_message(device_id, msg.topic, payload), _mqtt_loop)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="medra-fastapi-bridge")
    if username:
        client.username_pw_set(username, password)
    client.on_connect = on_connect
    client.on_message = on_message
    _mqtt_client = client
    try:
        client.connect_async(host, port, keepalive=30)
        client.loop_start()
    except Exception as exc:
        print(f"[MEDRA IoT] MQTT bridge could not start: {exc}")


def _device_from_topic(topic: str) -> str:
    parts = topic.split("/")
    if len(parts) >= 3 and parts[0] == "medras":
        return "_".join(parts[1:3]).upper()
    return "UNKNOWN_DEVICE"


async def _process_mqtt_message(device_id: str, topic: str, payload: dict):
    db = SessionLocal()
    try:
        row = _store(db, device_id=device_id, topic=topic, transport="MQTT", payload=payload)
        message = _safe_device_message(row)
    except Exception as exc:
        db.rollback()
        print(f"[MEDRA IoT] Could not store MQTT message from {topic}: {exc}")
        return
    finally:
        db.close()
    await manager.broadcast(message, safe_for_devices=True)


def stop_mqtt_bridge():
    global _mqtt_client
    if _mqtt_client is not None:
        _mqtt_client.loop_stop()
        _mqtt_client.disconnect()
        _mqtt_client = None
