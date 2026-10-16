from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.core.database import get_db
from app.models.user import User
from app.models.medra_demo import Ambulance, Emergency, Hospital, EmergencyAssignment
from app.models.system import Notification
from app.schemas.ambulance_ops import AmbulanceStatusUpdate, AssignmentStatusUpdate, AmbulanceLocationUpdate
from app.core.dependencies import get_current_ambulance_crew, log_audit

router = APIRouter(
    prefix="/api/ambulance",
    tags=["Ambulance Portal"]
)


def get_driver_ambulance(db: Session, user: User) -> Ambulance:
    ambulance = db.query(Ambulance).filter(Ambulance.driver_user_id == user.id).first()
    if not ambulance:
        # Fallback to first available or demo ambulance for demonstration
        ambulance = db.query(Ambulance).first()
        if not ambulance:
            ambulance = Ambulance(
                vehicle_number="MH-13-EM-108",
                driver_name=user.full_name,
                driver_user_id=user.id,
                latitude=17.6599,
                longitude=75.9064,
                status="AVAILABLE"
            )
            db.add(ambulance)
            db.commit()
            db.refresh(ambulance)
    return ambulance


@router.get("/dashboard-stats")
def get_ambulance_dashboard_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)

    # Find active assignment
    active_assignment = (
        db.query(EmergencyAssignment)
        .filter(
            EmergencyAssignment.ambulance_id == ambulance.id,
            EmergencyAssignment.status.in_(["ASSIGNED", "ACCEPTED", "EN_ROUTE", "PATIENT_PICKED_UP", "HOSPITAL_ARRIVED"])
        )
        .order_by(desc(EmergencyAssignment.assigned_at))
        .first()
    )

    completed_runs = (
        db.query(EmergencyAssignment)
        .filter(
            EmergencyAssignment.ambulance_id == ambulance.id,
            EmergencyAssignment.status == "COMPLETED"
        )
        .count()
    )

    assignment_info = None
    if active_assignment:
        emg = active_assignment.emergency
        hosp = active_assignment.hospital
        patient = emg.user if emg else None

        assignment_info = {
            "assignment_id": active_assignment.id,
            "emergency_id": emg.id if emg else None,
            "reference": f"MEDRA-EMG-{emg.id:04d}" if emg else None,
            "status": active_assignment.status,
            "emergency_type": emg.emergency_type if emg else "Emergency",
            "description": emg.description if emg else "",
            "pickup_latitude": emg.latitude if emg else 17.6599,
            "pickup_longitude": emg.longitude if emg else 75.9064,
            "patient_name": patient.full_name if patient else "Emergency Caller",
            "patient_phone": patient.mobile if patient else "9876543210",
            "destination_hospital": {
                "name": hosp.name if hosp else "Solapur General Hospital",
                "address": hosp.address if hosp else "Civil Lines, Solapur",
                "latitude": hosp.latitude if hosp else 17.6625,
                "longitude": hosp.longitude if hosp else 75.9110,
            },
            "assigned_at": active_assignment.assigned_at.isoformat() if active_assignment.assigned_at else None,
        }

    return {
        "driver_name": user.full_name,
        "driver_email": user.email,
        "vehicle_number": ambulance.vehicle_number,
        "ambulance_id": ambulance.id,
        "status": ambulance.status,
        "latitude": ambulance.latitude,
        "longitude": ambulance.longitude,
        "completed_runs": completed_runs,
        "active_assignment": assignment_info,
    }


@router.get("/assignment")
def get_active_assignment(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)

    assignment = (
        db.query(EmergencyAssignment)
        .filter(
            EmergencyAssignment.ambulance_id == ambulance.id,
            EmergencyAssignment.status.in_(["ASSIGNED", "ACCEPTED", "EN_ROUTE", "PATIENT_PICKED_UP", "HOSPITAL_ARRIVED"])
        )
        .order_by(desc(EmergencyAssignment.assigned_at))
        .first()
    )

    if not assignment:
        return {"has_active": False, "assignment": None}

    emg = assignment.emergency
    hosp = assignment.hospital
    patient = emg.user if emg else None

    return {
        "has_active": True,
        "assignment": {
            "assignment_id": assignment.id,
            "emergency_id": emg.id if emg else None,
            "reference": f"MEDRA-EMG-{emg.id:04d}" if emg else None,
            "status": assignment.status,
            "emergency_type": emg.emergency_type if emg else "Medical Emergency",
            "description": emg.description if emg else "",
            "pickup_latitude": emg.latitude if emg else 17.6599,
            "pickup_longitude": emg.longitude if emg else 75.9064,
            "patient_name": patient.full_name if patient else "Emergency Caller",
            "patient_mobile": patient.mobile if patient else "Not provided",
            "hospital": {
                "id": hosp.id if hosp else None,
                "name": hosp.name if hosp else "Solapur General Hospital",
                "address": hosp.address if hosp else "Civil Hospital, Solapur",
                "latitude": hosp.latitude if hosp else 17.6625,
                "longitude": hosp.longitude if hosp else 75.9110,
            },
            "assigned_at": assignment.assigned_at.isoformat() if assignment.assigned_at else None,
        }
    }


@router.patch("/assignment/{assignment_id}/status")
def update_assignment_status(
    assignment_id: int,
    request: AssignmentStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    assignment = db.query(EmergencyAssignment).filter(EmergencyAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    old_status = assignment.status
    assignment.status = request.status
    if request.notes:
        assignment.notes = request.notes

    # Keep emergency status in sync
    if assignment.emergency:
        assignment.emergency.status = request.status

    # If completed, reset ambulance status to AVAILABLE
    if request.status in ["COMPLETED", "CANCELLED"]:
        if assignment.ambulance:
            assignment.ambulance.status = "AVAILABLE"

    db.commit()
    db.refresh(assignment)

    log_audit(
        db,
        action="AMBULANCE_ASSIGNMENT_STATUS_UPDATE",
        resource_type="EmergencyAssignment",
        user=user,
        resource_id=assignment.id,
        details=f"Status: {old_status} -> {request.status}"
    )

    return {
        "message": f"Assignment status updated to {request.status}",
        "assignment_id": assignment.id,
        "status": assignment.status,
    }


@router.patch("/availability")
def update_ambulance_availability(
    request: AmbulanceStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)
    ambulance.status = request.status
    db.commit()
    db.refresh(ambulance)

    log_audit(
        db,
        action="AMBULANCE_AVAILABILITY_CHANGED",
        resource_type="Ambulance",
        user=user,
        resource_id=ambulance.id,
        details=f"Status set to {request.status}"
    )

    return {
        "message": f"Ambulance status updated to {request.status}",
        "vehicle_number": ambulance.vehicle_number,
        "status": ambulance.status
    }


@router.get("/history")
def get_ambulance_history(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)

    assignments = (
        db.query(EmergencyAssignment)
        .filter(EmergencyAssignment.ambulance_id == ambulance.id)
        .order_by(desc(EmergencyAssignment.assigned_at))
        .limit(20)
        .all()
    )

    return {
        "history": [
            {
                "id": a.id,
                "reference": f"MEDRA-EMG-{a.emergency.id:04d}" if a.emergency else "N/A",
                "emergency_type": a.emergency.emergency_type if a.emergency else "Medical Emergency",
                "destination": a.hospital.name if a.hospital else "Solapur Hospital",
                "status": a.status,
                "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
            }
            for a in assignments
        ]
    }
