from pydantic import BaseModel, EmailStr, Field


from typing import Literal
from pydantic import BaseModel, EmailStr, Field

class RegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str = Field(min_length=8)
    mobile: str | None = None
    role: Literal["patient", "ambulance", "hospital"] = "patient"

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)