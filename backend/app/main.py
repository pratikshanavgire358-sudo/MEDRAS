from contextlib import asynccontextmanager
from datetime import datetime, timezone
import asyncio
import logging

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import Base, engine, get_db

logger = logging.getLogger(__name__)

# Import models before creating tables.
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.models.family_member import FamilyMember
from app.models.medra_demo import (
    DemoMedicalRecord,
    Emergency,
    EmergencyAction,
    Ambulance,
    Hospital,
    EmergencyAssignment,
)
from app.models.hospital import HospitalPatient, HospitalResource
from app.models.vitals import VitalObservation
from app.models.system import Notification, NotificationRead, AuditLog
from app.models.iot import IOTTelemetry

# Import routers.
from app.routes.auth import router as auth_router
from app.routes.patient import router as patient_router
from app.routes.hospital import router as hospital_router
from app.routes.ambulance import router as ambulance_router
from app.routes.admin import router as admin_router
from app.routes.abdm import router as abdm_router
from app.routes.demo import router as demo_router
from app.routes.iot import (
    router as iot_router,
    start_mqtt_bridge,
    stop_mqtt_bridge,
    start_discovery_broadcast,
    stop_discovery_broadcast,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Keep startup failures visible in the server logs.
    try:
        Base.metadata.create_all(bind=engine)
    except Exception:
        logger.exception("Database table initialization failed")
        raise

    loop = asyncio.get_running_loop()

    try:
        start_mqtt_bridge(loop)
        start_discovery_broadcast()
    except Exception:
        # IoT services are optional; do not take down the API
        # just because an MQTT broker or discovery service is unavailable.
        logger.exception("Optional IoT service startup failed")

    yield

    try:
        stop_mqtt_bridge()
    except Exception:
        logger.exception("Failed to stop MQTT bridge")

    try:
        stop_discovery_broadcast()
    except Exception:
        logger.exception("Failed to stop discovery broadcast")


app = FastAPI(
    title="MEDRA Smart Emergency Response API",
    description=(
        "Backend API for MEDRA — connected emergency response "
        "system for Patients, Ambulances, Hospitals, and Administrators."
    ),
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Allow only the deployed frontend and approved local development origins.
allowed_origins = [
    "https://medra-ui.onrender.com",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

# Register CORS on the same FastAPI application as the API routers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=[
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
        "X-IoT-Device-Key",
    ],
)

# Register existing MEDRA modules.
app.include_router(auth_router)
app.include_router(patient_router)
app.include_router(hospital_router)
app.include_router(ambulance_router)
app.include_router(admin_router)
app.include_router(abdm_router)
app.include_router(demo_router)
app.include_router(iot_router)


@app.get("/")
def home():
    return {
        "project": "MEDRA — Smart Emergency Response System",
        "status": "online",
        "version": "2.0.0",
        "documentation": "/docs",
        "endpoints": {
            "auth": "/api/auth",
            "patient": "/api/patient",
            "hospital": "/api/hospital",
            "ambulance": "/api/ambulance",
            "admin": "/api/admin",
            "abdm": "/api/abdm",
            "demo": "/api/demo",
            "iot_telemetry": "/api/iot/telemetry/latest",
            "iot_websocket": "/ws/iot",
            "health": "/api/health",
        },
    }


@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    try:
        dialect = db.get_bind().dialect.name
        version_query = {
            "postgresql": "SELECT version()",
            "sqlite": "SELECT sqlite_version()",
        }.get(dialect, "SELECT 1")
        version = db.execute(text(version_query)).scalar()
    except Exception as exc:
        logger.exception("Database health check failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connectivity failed",
        ) from exc

    return {
        "status": "healthy",
        "database": "connected",
        "database_version": version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
