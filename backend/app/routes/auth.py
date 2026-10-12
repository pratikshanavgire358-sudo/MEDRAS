from app.core.config import settings
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import EmailStr
from pwdlib import PasswordHash
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import datetime, timedelta, timezone
import jwt

from app.core.database import get_db
from app.models.patient_profile import PatientProfile
from app.models.user import User
from app.schemas.auth import RegisterRequest, LoginRequest

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

password_hasher = PasswordHash.recommended()
bearer_scheme = HTTPBearer()

JWT_SECRET = settings.MEDRA_JWT_SECRET
JWT_ALGORITHM = "HS256"


def create_access_token(user_id: int):
    if not JWT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="Authentication server configuration is missing"
        )

    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(hours=2)
    }

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@router.get("/health")
def auth_health():
    return {
        "status": "success",
        "message": "MEDRA authentication routes are working"
    }


@router.post("/register")
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
            detail="Please enter a valid full name"
        )

    existing = db.query(User).filter(
        User.email == email
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="This email is already registered. Please log in."
        )

    user = User(
        full_name=full_name,
        email=email,
        mobile=request.mobile,
        password_hash=password_hasher.hash(request.password),
        role=role,
        is_active=True
    )

    try:
        db.add(user)
        db.flush()

        # Automatically create a profile for patient accounts.
        if role == "patient":
            profile = PatientProfile(user_id=user.id)
            db.add(profile)

        db.commit()
        db.refresh(user)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An account with these details already exists"
        )

    except Exception:
        db.rollback()
        raise

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

    user = db.query(User).filter(
        User.email == email
    ).first()

    if (
        user is None
        or not user.password_hash
        or not password_hasher.verify(
            request.password,
            user.password_hash
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="This account is inactive"
        )

    token = create_access_token(user.id)

    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role
        }
    }