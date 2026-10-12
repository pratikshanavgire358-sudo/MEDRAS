from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class PatientProfileUpdate(BaseModel):
    date_of_birth: Optional[date] = None
    gender: Optional[str] = Field(default=None, max_length=30)
    blood_group: Optional[str] = Field(default=None, max_length=5)
    address: Optional[str] = Field(default=None, max_length=300)
    emergency_contact_name: Optional[str] = Field(default=None, max_length=100)
    emergency_contact_mobile: Optional[str] = Field(default=None, max_length=20)


class PatientProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    blood_group: Optional[str] = None
    address: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_mobile: Optional[str] = None
    abha_linked: bool