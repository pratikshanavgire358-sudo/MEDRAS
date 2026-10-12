import jwt

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.medra_demo import (
    DemoMedicalRecord,
    Emergency,
    Ambulance,
    Hospital,
)


router = APIRouter(
    prefix="/api/demo",
    tags=["MEDRAS Demo"],
)

bearer_scheme = HTTPBearer()


def get_current_patient(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.MEDRA_JWT_SECRET,
            algorithms=["HS256"],
        )

        user_id = int(payload["sub"])

    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired login session",
        )

    user = db.query(User).filter(User.id == user_id).first()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=401,
            detail="User not found or inactive",
        )

    if user.role != "patient":
        raise HTTPException(
            status_code=403,
            detail="Patient access only",
        )

    return user


class EmergencyRequest(BaseModel):
    emergency_type: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=1000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


@router.get("/medical-records")
def get_demo_medical_records(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    records = (
        db.query(DemoMedicalRecord)
        .filter(DemoMedicalRecord.user_id == user.id)
        .order_by(DemoMedicalRecord.record_date.desc())
        .all()
    )

    return {
        "mode": "DEMO",
        "notice": "Synthetic records only. Not retrieved from ABDM.",
        "records": [
            {
                "id": record.id,
                "record_type": record.record_type,
                "provider_name": record.provider_name,
                "record_date": (
                    record.record_date.isoformat()
                    if record.record_date else None
                ),
                "summary": record.summary,
                "data_source": record.data_source,
            }
            for record in records
        ],
    }


@router.post("/emergencies", status_code=201)
def create_demo_emergency(
    request: EmergencyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    emergency = Emergency(
        user_id=user.id,
        emergency_type=request.emergency_type,
        description=request.description,
        latitude=request.latitude,
        longitude=request.longitude,
        status="REQUESTED",
    )

    db.add(emergency)
    db.commit()
    db.refresh(emergency)

    return {
        "mode": "DEMO",
        "message": "Demo emergency request created.",
        "emergency_id": emergency.id,
        "status": emergency.status,
    }


@router.get("/resources")
def get_demo_resources(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    ambulances = (
        db.query(Ambulance)
        .filter(Ambulance.status == "AVAILABLE")
        .all()
    )

    hospitals = (
        db.query(Hospital)
        .filter(Hospital.emergency_available.is_(True))
        .all()
    )

    return {
        "mode": "DEMO",
        "ambulances": [
            {
                "id": ambulance.id,
                "vehicle_number": ambulance.vehicle_number,
                "latitude": ambulance.latitude,
                "longitude": ambulance.longitude,
                "status": ambulance.status,
            }
            for ambulance in ambulances
        ],
        "hospitals": [
            {
                "id": hospital.id,
                "name": hospital.name,
                "address": hospital.address,
                "latitude": hospital.latitude,
                "longitude": hospital.longitude,
            }
            for hospital in hospitals
        ],
    }