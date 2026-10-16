from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class EmergencyCreateRequest(BaseModel):
    emergency_type: str = Field(min_length=2, max_length=100)
    description: Optional[str] = Field(default="", max_length=1000)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)


class VitalObservationCreate(BaseModel):
    heart_rate: Optional[int] = Field(default=None, ge=30, le=250)
    blood_pressure_systolic: Optional[int] = Field(default=None, ge=50, le=250)
    blood_pressure_diastolic: Optional[int] = Field(default=None, ge=30, le=150)
    sp_o2: Optional[int] = Field(default=None, ge=50, le=100)
    temperature: Optional[float] = Field(default=None, ge=30.0, le=45.0)
    respiratory_rate: Optional[int] = Field(default=None, ge=5, le=60)
    source: str = Field(default="PATIENT_INPUT", max_length=50)
