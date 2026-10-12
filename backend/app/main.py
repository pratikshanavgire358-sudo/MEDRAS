from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import Base, engine
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.routes.patient import router as patient_router
from app.routes.auth import router as auth_router

from app.routes.demo import router as demo_router


# Create tables for models imported above if they do not exist.
# This does not modify existing tables or replace database migrations.
Base.metadata.create_all(bind=engine)
from app.models.medra_demo import (
    DemoMedicalRecord,
    Emergency,
    Ambulance,
    Hospital,
    EmergencyAssignment,
)

app = FastAPI(
    title="MEDRA Smart Emergency Response API",
    version="1.0.0"
)

# Allow requests from the local MEDRA frontend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500"
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"]
)

# Register authentication routes.
app.include_router(auth_router)
app.include_router(patient_router)
app.include_router(demo_router)

@app.get("/")
def home():
    return {
        "project": "MEDRA",
        "status": "online",
        "message": "MEDRA backend is running"
    }