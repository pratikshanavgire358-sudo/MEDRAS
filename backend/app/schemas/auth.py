from typing import Literal
from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str = Field(min_length=8)
    mobile: str | None = None
    role: Literal["patient", "ambulance", "hospital", "admin"] = "patient"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class FirebaseLoginRequest(BaseModel):
    firebase_id_token: str = Field(min_length=1)


class UserProfileResponse(BaseModel):
    id: int
    full_name: str
    email: str
    mobile: str | None = None
    role: str
    is_active: bool