from datetime import datetime, timedelta, timezone
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text
from pwdlib import PasswordHash
from firebase_admin import auth as firebase_auth
from firebase_admin.exceptions import FirebaseError
from google.auth.exceptions import GoogleAuthError

from app.core.config import settings
from app.core.database import get_db
from app.models.patient_profile import PatientProfile
from app.models.user import User
from app.schemas.auth import RegisterRequest, LoginRequest, FirebaseLoginRequest
from app.core.dependencies import get_current_user, log_audit

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

password_hasher = PasswordHash.recommended()

JWT_SECRET = settings.MEDRA_JWT_SECRET
JWT_ALGORITHM = "HS256"


def create_access_token(user_id: int, role: str):
    if not JWT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="Authentication server configuration is missing"
        )

    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8)
    }

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def auth_role_fields(user: User) -> dict[str, str | int | None]:
    return {
        "ambulance_subrole": getattr(user, "ambulance_subrole", None),
        "ambulance_id": getattr(user, "ambulance_id", None),
    }


def verify_firebase_id_token(id_token: str) -> dict:
    try:
        from app.core import firebase as firebase_admin_setup

        app = firebase_admin_setup.firebase_admin.get_app()
    except (GoogleAuthError, ValueError) as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase authentication is not configured on the backend",
        ) from e

    try:
        return firebase_auth.verify_id_token(id_token, app=app)
    except (FirebaseError, ValueError) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Firebase login",
        ) from e


@router.get("/health")
def auth_health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection failed: {str(e)}"
        )

    return {
        "status": "online",
        "service": "MEDRA Smart Emergency Response Authentication Service",
        "database": db_status,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register_user(
    request: RegisterRequest,
    db: Session = Depends(get_db)
):
    full_name = request.full_name.strip()
    email = str(request.email).strip().lower()
    role = request.role

    if len(full_name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Please enter a valid full name with at least 2 characters."
        )

    if len(request.password) < 8:
        raise HTTPException(
            status_code=422,
            detail="Password must be at least 8 characters long."
        )

    existing_email = db.query(User).filter(User.email == email).first()
    if existing_email:
        raise HTTPException(
            status_code=409,
            detail="This email is already registered. Please log in."
        )

    if request.mobile:
        clean_mobile = request.mobile.strip()
        existing_mobile = db.query(User).filter(User.mobile == clean_mobile).first()
        if existing_mobile:
            raise HTTPException(
                status_code=409,
                detail="This mobile number is already registered to an account."
            )
    else:
        clean_mobile = None

    user = User(
        full_name=full_name,
        email=email,
        mobile=clean_mobile,
        password_hash=password_hasher.hash(request.password),
        role=role,
        is_active=True
    )

    try:
        db.add(user)
        db.flush()

        # Automatically create profile for patient accounts
        if role == "patient":
            profile = PatientProfile(user_id=user.id)
            db.add(profile)

        db.commit()
        db.refresh(user)

        log_audit(db, action="USER_REGISTERED", resource_type="User", user=user, resource_id=user.id, details=f"Role: {role}")

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An account with these details already exists."
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Unable to create account: {str(e)}"
        )

    return {
        "message": "Registration successful",
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "mobile": user.mobile,
            "role": user.role
        }
    }


@router.post("/login")
def login_user(
    request: LoginRequest,
    db: Session = Depends(get_db)
):
    email = str(request.email).strip().lower()

    user = db.query(User).filter(User.email == email).first()

    if (
        user is None
        or not user.password_hash
        or not password_hasher.verify(request.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="This account is deactivated. Please contact support."
        )

    token = create_access_token(user.id, user.role)

    log_audit(db, action="USER_LOGIN", resource_type="User", user=user, resource_id=user.id, details=f"Role: {user.role}")

    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role,
            "mobile": user.mobile,
            **auth_role_fields(user),
        }
    }


@router.post("/firebase")
def firebase_login(
    request: FirebaseLoginRequest,
    db: Session = Depends(get_db),
):
    claims = verify_firebase_id_token(request.firebase_id_token)
    firebase_uid = claims.get("uid")
    firebase_email = claims.get("email")

    if not isinstance(firebase_uid, str) or not firebase_uid or not isinstance(firebase_email, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Firebase did not provide a valid account identity",
        )

    email = firebase_email.strip().lower()
    user = db.query(User).filter(User.firebase_uid == firebase_uid).first()

    if user is None:
        if claims.get("email_verified") is not True:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Verify your Firebase email before linking it to a MEDRA account",
            )

        user = db.query(User).filter(User.email == email).first()
        if user is None or user.firebase_uid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No MEDRA account is available for this Firebase identity",
            )
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account is deactivated. Please contact support.",
            )

        user.firebase_uid = firebase_uid
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This Firebase identity is already linked to another MEDRA account",
            ) from e

    if user.email.strip().lower() != email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Firebase email does not match the linked MEDRA account",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is deactivated. Please contact support.",
        )

    token = create_access_token(user.id, user.role)
    log_audit(
        db,
        action="USER_LOGIN",
        resource_type="User",
        user=user,
        resource_id=user.id,
        details="Firebase authentication",
    )

    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role,
            "mobile": user.mobile,
            **auth_role_fields(user),
        },
    }


@router.get("/me")
def get_current_user_profile(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    profile_data = {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "mobile": user.mobile,
        "role": user.role,
        "is_active": user.is_active,
        **auth_role_fields(user),
        "created_at": user.created_at.isoformat() if user.created_at else None
    }

    if user.role == "patient":
        profile = db.query(PatientProfile).filter(PatientProfile.user_id == user.id).first()
        if profile:
            profile_data.update({
                "blood_group": profile.blood_group,
                "gender": profile.gender,
                "date_of_birth": profile.date_of_birth.isoformat() if profile.date_of_birth else None,
                "address": profile.address,
                "emergency_contact_name": profile.emergency_contact_name,
                "emergency_contact_mobile": profile.emergency_contact_mobile,
                "abha_linked": profile.abha_linked
            })

    return profile_data


@router.post("/logout")
def logout_user(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_audit(db, action="USER_LOGOUT", resource_type="User", user=user, resource_id=user.id)
    return {"message": "Logged out successfully"}