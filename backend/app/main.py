from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timezone

from app.core.database import Base, engine, get_db

# Import all models before metadata creation to ensure all tables exist
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.models.medra_demo import (
    DemoMedicalRecord,
    Emergency,
    Ambulance,
    Hospital,
    EmergencyAssignment,
)
from app.models.hospital import HospitalPatient, HospitalResource
from app.models.vitals import VitalObservation
from app.models.system import Notification, AuditLog
from app.models.iot import IOTTelemetry

# Create all tables safely if they do not exist
Base.metadata.create_all(bind=engine)

# Import routers
from app.routes.auth import router as auth_router
from app.routes.patient import router as patient_router
from app.routes.hospital import router as hospital_router
from app.routes.ambulance import router as ambulance_router
from app.routes.admin import router as admin_router
from app.routes.abdm import router as abdm_router
from app.routes.demo import router as demo_router
from app.routes.iot import router as iot_router, start_mqtt_bridge, stop_mqtt_bridge, start_discovery_broadcast, stop_discovery_broadcast

app = FastAPI(
    title="MEDRA Smart Emergency Response API",
    description="Backend API for MEDRA — connected emergency response system for Patients, Ambulances, Hospitals, and Administrators.",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Robust CORS configuration to allow local development, file protocol, Live Server, and local servers
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "*"
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With", "X-IoT-Device-Key"]
)

# Register all module routers
app.include_router(auth_router)
app.include_router(patient_router)
app.include_router(hospital_router)
app.include_router(ambulance_router)
app.include_router(admin_router)
app.include_router(abdm_router)
app.include_router(demo_router)
app.include_router(iot_router)


@app.on_event("startup")
async def start_iot_services():
    # MQTT is optional at boot: API remains available if the broker is offline.
    import asyncio
    start_mqtt_bridge(asyncio.get_running_loop())
    start_discovery_broadcast()


@app.on_event("shutdown")
def stop_iot_services():
    stop_mqtt_bridge()
    stop_discovery_broadcast()


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
            "health": "/api/health"
        }
    }


@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    try:
        ver = db.execute(text("SELECT version()")).scalar()
        db_connected = True
    except Exception as e:
        db_connected = False
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connectivity failed: {str(e)}"
        )

    return {
        "status": "healthy",
        "database": "connected",
        "database_version": ver,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }