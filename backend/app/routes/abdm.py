from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.core.dependencies import get_current_user

router = APIRouter(
    prefix="/api/abdm",
    tags=["ABDM / ABHA Boundary"]
)


class AbhaVerificationRequest(BaseModel):
    abha_number: str = Field(min_length=14, max_length=17, description="14-digit ABHA ID (e.g. 12-3456-7890-1234)")
    consent_confirmed: bool = Field(default=False)


@router.get("/status")
def get_abdm_integration_status(user: User = Depends(get_current_user)):
    return {
        "gateway": "National Health Authority (NHA) ABDM Sandbox",
        "connection_state": "INTEGRATION_BOUNDARY_READY",
        "is_live_production": False,
        "credentials_configured": False,
        "mode": "DEMO_SIMULATION_ONLY",
        "notice": (
            "Live ABDM (Ayushman Bharat Digital Mission) integration requires official NHA client ID, "
            "client secret, public encryption keys, and active HIP/HIU bridge registration. "
            "In this demonstration build, ABHA verification and data exchange are clearly marked as synthetic boundaries."
        ),
        "supported_standards": [
            "FHIR R4 DiagnosticReport",
            "FHIR R4 MedicationRequest",
            "M1 / M2 / M3 ABDM Milestones"
        ]
    }


@router.post("/verify-demo")
def verify_demo_abha(
    request: AbhaVerificationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not request.consent_confirmed:
        raise HTTPException(
            status_code=400,
            detail="Patient consent must be acknowledged before processing ABHA verification."
        )

    clean_id = request.abha_number.replace("-", "").strip()
    if not clean_id.isdigit() or len(clean_id) != 14:
        raise HTTPException(
            status_code=422,
            detail="Invalid ABHA format. Expected a 14-digit number (e.g., 91-1234-5678-9012)."
        )

    # In demonstration mode, simulate validation check against sandbox test range
    profile = db.query(PatientProfile).filter(PatientProfile.user_id == user.id).first()
    if profile:
        profile.abha_linked = True
        db.commit()

    return {
        "mode": "DEMO_MODE",
        "verified": True,
        "abha_number": f"{clean_id[0:2]}-{clean_id[2:6]}-{clean_id[6:10]}-{clean_id[10:14]}",
        "status": "DEMO_LINKED",
        "notice": "Simulated demonstration link recorded in local PostgreSQL database. Real NHA ABDM consent flow is not active.",
    }
