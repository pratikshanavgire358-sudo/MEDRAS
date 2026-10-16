from typing import Optional, Literal
from pydantic import BaseModel, Field


class AmbulanceStatusUpdate(BaseModel):
    status: Literal["AVAILABLE", "BUSY", "OFFLINE", "DISPATCHED"]


class AssignmentStatusUpdate(BaseModel):
    status: Literal["ASSIGNED", "ACCEPTED", "EN_ROUTE", "PATIENT_PICKED_UP", "HOSPITAL_ARRIVED", "COMPLETED", "CANCELLED"]
    notes: Optional[str] = Field(default="", max_length=1000)


class AmbulanceLocationUpdate(BaseModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
