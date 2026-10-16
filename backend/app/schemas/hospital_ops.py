from datetime import date
from typing import Optional, Literal
from pydantic import BaseModel, EmailStr, Field


class HospitalPatientCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    date_of_birth: Optional[date] = None
    gender: Optional[str] = Field(default="Not specified", max_length=30)
    phone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[EmailStr] = None
    arrival_type: str = Field(default="Emergency", max_length=50)
    arrival_method: str = Field(default="Ambulance", max_length=50)
    arrival_date: Optional[str] = None
    arrival_time: Optional[str] = None
    priority: Literal["Critical", "High", "Medium", "Low"] = "Critical"
    referral_source: Optional[str] = Field(default="Direct Arrival", max_length=100)
    notes: Optional[str] = Field(default="", max_length=2000)


class HospitalPatientVerify(BaseModel):
    verification_status: Literal["Verified", "Pending review", "Rejected"] = "Verified"
    notes: Optional[str] = Field(default="", max_length=1000)


class HospitalResourceUpdate(BaseModel):
    occupied_count: int = Field(ge=0)
    total_count: Optional[int] = Field(default=None, ge=1)


class EmergencyStatusUpdate(BaseModel):
    status: Literal["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRIAGED", "RESOLVED", "CANCELLED"]
    notes: Optional[str] = Field(default="", max_length=1000)
