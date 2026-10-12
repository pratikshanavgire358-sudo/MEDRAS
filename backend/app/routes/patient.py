import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.schemas.patient_profile import PatientProfileUpdate

router = APIRouter(
    prefix="/api/patient",
    tags=["Patient Profile"]
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


def get_or_create_profile(
    db: Session,
    user_id: int,
) -> PatientProfile:
    profile = (
        db.query(PatientProfile)
        .filter(PatientProfile.user_id == user_id)
        .first()
    )

    if profile is None:
        profile = PatientProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)

    return profile


@router.get("/profile")
def get_patient_profile(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    profile = get_or_create_profile(db, user.id)

    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "mobile": user.mobile,
        "role": user.role,
        "date_of_birth": (
            profile.date_of_birth.isoformat()
            if profile.date_of_birth
            else None
        ),
        "gender": profile.gender,
        "blood_group": profile.blood_group,
        "address": profile.address,
        "emergency_contact_name": profile.emergency_contact_name,
        "emergency_contact_mobile": profile.emergency_contact_mobile,
        "abha_linked": profile.abha_linked,
    }


@router.put("/profile")
def update_patient_profile(
    request: PatientProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    profile = get_or_create_profile(db, user.id)

    # Update only fields accepted by the profile-update schema.
    updates = request.model_dump(exclude_unset=True)

    for field, value in updates.items():
        setattr(profile, field, value)

    try:
        db.commit()
        db.refresh(profile)

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to save patient profile",
        )

    return {
        "message": "Patient profile saved successfully",
        "full_name": user.full_name,
        "email": user.email,
        "mobile": user.mobile,
        "date_of_birth": (
            profile.date_of_birth.isoformat()
            if profile.date_of_birth
            else None
        ),
        "gender": profile.gender,
        "blood_group": profile.blood_group,
        "address": profile.address,
        "emergency_contact_name": profile.emergency_contact_name,
        "emergency_contact_mobile": profile.emergency_contact_mobile,
        "abha_linked": profile.abha_linked,
    }
