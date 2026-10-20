from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.core.dependencies import get_current_user
import json
from pathlib import Path

router = APIRouter(
    prefix="/api/abdm",
    tags=["ABDM / ABHA Boundary"]
)


class AbhaVerificationRequest(BaseModel):
    abha_number: str = Field(min_length=14, max_length=17, description="14-digit ABHA ID (e.g. 12-3456-7890-1234)")
    consent_confirmed: bool = Field(default=False)


@router.post("/verify-demo")
def verify_demo_abha(
    request: AbhaVerificationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not request.consent_confirmed:
        raise HTTPException(
            status_code=400,
            detail="Patient consent must be acknowledged before verification."
        )

    clean_id = request.abha_number.replace("-", "").strip()

    if not clean_id.isdigit() or len(clean_id) != 14:
        raise HTTPException(
            status_code=422,
            detail="Invalid format. Expected a 14-digit demo identifier."
        )

    # Load synthetic patient records.
    data_file = (
        Path(__file__).resolve().parents[1]
        / "data"
        / "dummy_abha_patients.json"
    )

    try:
        with data_file.open("r", encoding="utf-8") as file:
            patients = json.load(file)
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="Demo patient dataset is missing."
        )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Demo patient dataset contains invalid JSON."
        )

    # Match against the demo dataset.
    demo_patient = next(
        (
            patient for patient in patients
            if patient["abha_number"].replace("-", "") == clean_id
        ),
        None
    )

    if demo_patient is None:
        return {
            "mode": "DEMO_MODE",
            "verified": False,
            "status": "NOT_FOUND",
            "notice": "No matching synthetic patient exists in the demo dataset."
        }

    # Link the logged-in user's own profile.
    profile = (
        db.query(PatientProfile)
        .filter(PatientProfile.user_id == user.id)
        .first()
    )

    if profile is None:
        raise HTTPException(
            status_code=404,
            detail="Patient profile not found for the logged-in user."
        )

    profile.abha_linked = True
    db.commit()

    # Do not return medical records during verification.
    return {
        "mode": "DEMO_MODE",
        "verified": True,
        "demo_patient_id": demo_patient["demo_patient_id"],
        "abha_number": (
            f"{clean_id[:2]}-{clean_id[2:6]}-"
            f"{clean_id[6:10]}-{clean_id[10:]}"
        ),
        "status": "DEMO_LINKED",
        "notice": (
            "Synthetic dataset match successful. "
            "No real ABDM verification has occurred."
        )
    }