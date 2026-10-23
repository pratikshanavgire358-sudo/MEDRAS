from typing import Optional, Literal
from pydantic import BaseModel, Field


class AmbulanceStatusUpdate(BaseModel):
    status: Literal["AVAILABLE", "BUSY", "OFFLINE", "DISPATCHED"]


class AssignmentStatusUpdate(BaseModel):
    status: Literal[
        "ACCEPTED",
        "EN_ROUTE",
        "PATIENT_PICKED_UP",
        "HOSPITAL_ARRIVED",
        "RESOLVED",
    ]
    notes: Optional[str] = Field(default="", max_length=1000)


class EmergencyPriorityUpdate(BaseModel):
    priority: Literal["LOW", "NORMAL", "HIGH", "CRITICAL"]


class EmergencyAssessmentCreate(BaseModel):
    notes: str = Field(min_length=1, max_length=2000)
    next_step: Optional[str] = Field(default=None, max_length=200)
    priority: Optional[Literal["LOW", "NORMAL", "HIGH", "CRITICAL"]] = None


class AmbulanceCrewAssignment(BaseModel):
    ambulance_id: int = Field(gt=0)
    subrole: Literal["EC_DRIVER", "EV_DOCTOR"]


class AmbulanceLocationUpdate(BaseModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)


class HospitalSelectionUpdate(BaseModel):
    hospital_id: int = Field(gt=0)
