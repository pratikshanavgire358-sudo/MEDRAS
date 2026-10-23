from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import case, desc
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.models.user import User
from app.models.medra_demo import Ambulance, Emergency, EmergencyAction, Hospital, EmergencyAssignment
from app.models.hospital import HospitalResource
from app.models.vitals import VitalObservation
from app.models.system import Notification
from app.schemas.ambulance_ops import (
    AmbulanceStatusUpdate,
    AssignmentStatusUpdate,
    AmbulanceLocationUpdate,
    EmergencyPriorityUpdate,
    EmergencyAssessmentCreate,
    HospitalSelectionUpdate,
)
from app.core.dependencies import get_current_ambulance_crew, log_audit

router = APIRouter(
    prefix="/api/ambulance",
    tags=["Ambulance Portal"]
)

ACTIVE_ASSIGNMENT_STATUSES = (
    "ASSIGNED",
    "ACCEPTED",
    "EN_ROUTE",
    "PATIENT_PICKED_UP",
    "HOSPITAL_SELECTED",
    "HOSPITAL_ACCEPTED",
    "HOSPITAL_ARRIVED",
    "HOSPITAL_RECEIVED",
)


def get_driver_ambulance(db: Session, user: User) -> Ambulance:
    if user.role != "ambulance" or user.ambulance_subrole != "EC_DRIVER" or not user.ambulance_id:
        raise HTTPException(status_code=403, detail="An assigned EC Driver account is required")

    ambulance = db.query(Ambulance).filter(
        Ambulance.id == user.ambulance_id,
        Ambulance.driver_user_id == user.id,
    ).first()
    if not ambulance:
        raise HTTPException(status_code=403, detail="No ambulance is assigned to this driver")
    return ambulance


def get_doctor_ambulance(db: Session, user: User) -> Ambulance:
    if user.role != "ambulance" or user.ambulance_subrole != "EV_DOCTOR" or not user.ambulance_id:
        raise HTTPException(status_code=403, detail="An assigned EV Doctor account is required")

    ambulance = db.query(Ambulance).filter(Ambulance.id == user.ambulance_id).first()
    if not ambulance:
        raise HTTPException(status_code=403, detail="No ambulance is assigned to this doctor")
    return ambulance


@router.get("/emergencies/pending")
def get_pending_emergencies(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    get_driver_ambulance(db, user)
    rejected_ids = db.query(EmergencyAction.emergency_id).filter(
        EmergencyAction.user_id == user.id,
        EmergencyAction.action_type == "REJECTED",
    )
    priority_rank = case(
        (Emergency.priority == "CRITICAL", 4),
        (Emergency.priority == "HIGH", 3),
        (Emergency.priority == "NORMAL", 2),
        else_=1,
    )
    emergencies = (
        db.query(Emergency)
        .filter(
            Emergency.status == "REQUESTED",
            ~Emergency.id.in_(rejected_ids),
        )
        .order_by(priority_rank.desc(), Emergency.created_at.asc())
        .limit(100)
        .all()
    )

    return {
        "emergencies": [
            {
                "id": emergency.id,
                "reference": f"MEDRA-EMG-{emergency.id:04d}",
                "emergency_type": emergency.emergency_type,
                "description": emergency.description,
                "patient_name": emergency.user.full_name if emergency.user else "Patient",
                "priority": emergency.priority,
                "status": emergency.status,
                "pickup_latitude": emergency.latitude,
                "pickup_longitude": emergency.longitude,
                "created_at": emergency.created_at.isoformat() if emergency.created_at else None,
            }
            for emergency in emergencies
            if emergency.assignment is None
        ]
    }


@router.post("/emergencies/{emergency_id}/accept", status_code=status.HTTP_200_OK)
def accept_emergency(
    emergency_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)
    emergency = db.query(Emergency).filter(Emergency.id == emergency_id).with_for_update().first()
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency not found")
    if emergency.status != "REQUESTED" or emergency.assignment is not None:
        raise HTTPException(status_code=409, detail="Emergency is no longer available for acceptance")
    if db.query(EmergencyAction.id).filter(
        EmergencyAction.emergency_id == emergency.id,
        EmergencyAction.user_id == user.id,
        EmergencyAction.action_type == "REJECTED",
    ).first():
        raise HTTPException(status_code=409, detail="This driver has already rejected the emergency")

    ambulance = db.query(Ambulance).filter(Ambulance.id == ambulance.id).with_for_update().first()
    if ambulance.status != "AVAILABLE":
        raise HTTPException(status_code=409, detail="Assigned ambulance is not available")
    active_assignment = db.query(EmergencyAssignment.id).filter(
        EmergencyAssignment.ambulance_id == ambulance.id,
        EmergencyAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
    ).first()
    if active_assignment:
        raise HTTPException(status_code=409, detail="Ambulance already has an active emergency")

    assignment = EmergencyAssignment(
        emergency_id=emergency.id,
        ambulance_id=ambulance.id,
        hospital_id=None,
        status="ACCEPTED",
    )
    emergency.status = "ACCEPTED"
    ambulance.status = "DISPATCHED"
    db.add(assignment)
    db.add(EmergencyAction(
        emergency_id=emergency.id,
        user_id=user.id,
        ambulance_id=ambulance.id,
        action_type="ACCEPTED",
        previous_value="REQUESTED",
        new_value="ACCEPTED",
    ))
    db.add(Notification(
        user_id=emergency.user_id,
        role="patient",
        title="Ambulance accepted your SOS",
        message=f"{ambulance.vehicle_number} accepted emergency MEDRA-EMG-{emergency.id:04d}.",
        type="EMERGENCY",
    ))

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Emergency or ambulance was assigned by another request")
    db.refresh(assignment)
    log_audit(db, action="EMERGENCY_ACCEPTED", resource_type="Emergency", user=user, resource_id=emergency.id)
    return {
        "message": "Emergency accepted and assigned",
        "emergency_id": emergency.id,
        "assignment_id": assignment.id,
        "status": emergency.status,
        "ambulance_id": ambulance.id,
        "hospital_id": None,
    }


@router.post("/emergencies/{emergency_id}/reject", status_code=status.HTTP_200_OK)
def reject_emergency(
    emergency_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)
    emergency = db.query(Emergency).filter(Emergency.id == emergency_id).with_for_update().first()
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency not found")
    if emergency.status != "REQUESTED" or emergency.assignment is not None:
        raise HTTPException(status_code=409, detail="Only pending emergencies can be rejected")
    if db.query(EmergencyAction.id).filter(
        EmergencyAction.emergency_id == emergency.id,
        EmergencyAction.user_id == user.id,
        EmergencyAction.action_type == "REJECTED",
    ).first():
        raise HTTPException(status_code=409, detail="Emergency was already rejected by this driver")

    db.add(EmergencyAction(
        emergency_id=emergency.id,
        user_id=user.id,
        ambulance_id=ambulance.id,
        action_type="REJECTED",
        previous_value="REQUESTED",
        new_value="REQUESTED",
    ))
    db.commit()
    log_audit(db, action="EMERGENCY_REJECTED", resource_type="Emergency", user=user, resource_id=emergency.id)
    return {"message": "Rejection recorded; emergency remains available to other drivers", "emergency_id": emergency.id}


@router.patch("/emergencies/{emergency_id}/priority")
def update_emergency_priority(
    emergency_id: int,
    request: EmergencyPriorityUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)
    emergency = db.query(Emergency).filter(Emergency.id == emergency_id).with_for_update().first()
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency not found")
    if emergency.status != "REQUESTED" or emergency.assignment is not None:
        raise HTTPException(status_code=409, detail="Priority can only be changed while the emergency is pending")

    old_priority = emergency.priority
    emergency.priority = request.priority
    db.add(EmergencyAction(
        emergency_id=emergency.id,
        user_id=user.id,
        ambulance_id=ambulance.id,
        action_type="PRIORITY_UPDATED",
        previous_value=old_priority,
        new_value=request.priority,
    ))
    db.commit()
    log_audit(
        db,
        action="EMERGENCY_PRIORITY_UPDATED",
        resource_type="Emergency",
        user=user,
        resource_id=emergency.id,
        details=f"Priority changed from {old_priority} to {request.priority}",
    )
    return {"emergency_id": emergency.id, "priority": emergency.priority}


@router.get("/hospitals")
def get_available_hospitals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    get_driver_ambulance(db, user)
    hospitals = db.query(Hospital).filter(Hospital.emergency_available.is_(True)).order_by(Hospital.name).all()
    return {
        "hospitals": [
            {
                "id": hospital.id,
                "name": hospital.name,
                "address": hospital.address,
                "latitude": hospital.latitude,
                "longitude": hospital.longitude,
                "emergency_available": hospital.emergency_available,
                "capabilities": [
                    {
                        "resource_type": resource.resource_type,
                        "available": max(0, resource.total_count - resource.occupied_count),
                    }
                    for resource in db.query(HospitalResource).filter(
                        HospitalResource.hospital_id == hospital.id
                    ).all()
                ],
            }
            for hospital in hospitals
        ]
    }


@router.patch("/assignment/{assignment_id}/hospital")
def select_assignment_hospital(
    assignment_id: int,
    request: HospitalSelectionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)
    assignment = db.query(EmergencyAssignment).filter(
        EmergencyAssignment.id == assignment_id,
        EmergencyAssignment.ambulance_id == ambulance.id,
    ).with_for_update().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.status not in ("ACCEPTED", "EN_ROUTE", "PATIENT_PICKED_UP", "HOSPITAL_SELECTED"):
        raise HTTPException(status_code=409, detail="Hospital selection is closed for this assignment")

    hospital = db.query(Hospital).filter(
        Hospital.id == request.hospital_id,
        Hospital.emergency_available.is_(True),
    ).first()
    if not hospital:
        raise HTTPException(status_code=404, detail="Available hospital not found")

    old_status = assignment.status
    previous_hospital_id = assignment.hospital_id
    assignment.hospital_id = hospital.id
    if old_status == "PATIENT_PICKED_UP":
        assignment.status = "HOSPITAL_SELECTED"
        if assignment.emergency:
            assignment.emergency.status = "HOSPITAL_SELECTED"
    db.add(EmergencyAction(
        emergency_id=assignment.emergency_id,
        user_id=user.id,
        ambulance_id=ambulance.id,
        action_type="HOSPITAL_SELECTED",
        previous_value=str(previous_hospital_id) if previous_hospital_id else None,
        new_value=str(hospital.id),
    ))
    db.add_all([
        Notification(
            user_id=staff.id,
            role="hospital",
            title="Incoming emergency assigned",
            message=f"Emergency MEDRA-EMG-{assignment.emergency_id:04d} is routed to {hospital.name}.",
            type="EMERGENCY",
        )
        for staff in db.query(User).filter(
            User.role == "hospital",
            User.hospital_id == hospital.id,
            User.is_active.is_(True),
        ).all()
    ])
    db.commit()
    db.refresh(assignment)
    log_audit(
        db,
        action="EMERGENCY_HOSPITAL_SELECTED",
        resource_type="EmergencyAssignment",
        user=user,
        resource_id=assignment.id,
        details=f"Hospital ID: {hospital.id}",
    )
    return {
        "assignment_id": assignment.id,
        "emergency_id": assignment.emergency_id,
        "hospital_id": hospital.id,
        "hospital_name": hospital.name,
        "status": assignment.status,
    }


@router.patch("/location")
def update_ambulance_location(
    request: AmbulanceLocationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)
    active_assignment = db.query(EmergencyAssignment.id).filter(
        EmergencyAssignment.ambulance_id == ambulance.id,
        EmergencyAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
    ).first()
    if not active_assignment:
        raise HTTPException(status_code=409, detail="Location sharing is only available during an active assignment")

    ambulance.latitude = request.latitude
    ambulance.longitude = request.longitude
    ambulance.location_updated_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "latitude": ambulance.latitude,
        "longitude": ambulance.longitude,
        "location_updated_at": ambulance.location_updated_at.isoformat(),
    }


@router.get("/doctor/emergencies")
def get_doctor_emergencies(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_doctor_ambulance(db, user)
    assignments = (
        db.query(EmergencyAssignment)
        .filter(
            EmergencyAssignment.ambulance_id == ambulance.id,
            EmergencyAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
        )
        .order_by(desc(EmergencyAssignment.assigned_at))
        .all()
    )
    results = []
    for assignment in assignments:
        emergency = assignment.emergency
        if not emergency:
            continue
        patient = emergency.user
        vitals = db.query(VitalObservation).filter(
            VitalObservation.emergency_id == emergency.id,
            VitalObservation.user_id == emergency.user_id,
        ).order_by(desc(VitalObservation.recorded_at)).limit(10).all()
        actions = db.query(EmergencyAction).filter(
            EmergencyAction.emergency_id == emergency.id,
            EmergencyAction.action_type == "CLINICAL_ASSESSMENT",
        ).order_by(desc(EmergencyAction.created_at)).all()
        results.append({
            "assignment_id": assignment.id,
            "emergency_id": emergency.id,
            "reference": f"MEDRA-EMG-{emergency.id:04d}",
            "status": emergency.status,
            "assignment_status": assignment.status,
            "emergency_type": emergency.emergency_type,
            "description": emergency.description,
            "priority": emergency.priority,
            "patient_name": patient.full_name if patient else None,
            "pickup_latitude": emergency.latitude,
            "pickup_longitude": emergency.longitude,
            "vitals": [
                {
                    "heart_rate": vital.heart_rate,
                    "blood_pressure_systolic": vital.blood_pressure_systolic,
                    "blood_pressure_diastolic": vital.blood_pressure_diastolic,
                    "sp_o2": vital.sp_o2,
                    "temperature": vital.temperature,
                    "respiratory_rate": vital.respiratory_rate,
                    "recorded_at": vital.recorded_at.isoformat() if vital.recorded_at else None,
                }
                for vital in vitals
            ],
            "assessments": [
                {
                    "notes": action.notes,
                    "next_step": action.new_value,
                    "created_at": action.created_at.isoformat() if action.created_at else None,
                }
                for action in actions
            ],
        })
    return {
        "unit": {
            "ambulance_id": ambulance.id,
            "vehicle_number": ambulance.vehicle_number,
            "status": ambulance.status,
        },
        "emergencies": results,
    }


@router.post("/doctor/emergencies/{emergency_id}/assessment", status_code=status.HTTP_201_CREATED)
def create_doctor_assessment(
    emergency_id: int,
    request: EmergencyAssessmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_doctor_ambulance(db, user)
    assignment = db.query(EmergencyAssignment).filter(
        EmergencyAssignment.emergency_id == emergency_id,
        EmergencyAssignment.ambulance_id == ambulance.id,
        EmergencyAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="No active assigned emergency is available to assess")

    notes = request.notes.strip()
    if not notes:
        raise HTTPException(status_code=422, detail="Assessment notes cannot be blank")
    action = EmergencyAction(
        emergency_id=emergency_id,
        user_id=user.id,
        ambulance_id=ambulance.id,
        action_type="CLINICAL_ASSESSMENT",
        new_value=request.next_step,
        notes=notes,
    )
    db.add(action)
    if request.priority and assignment.emergency.priority != request.priority:
        previous_priority = assignment.emergency.priority
        assignment.emergency.priority = request.priority
        db.add(EmergencyAction(
            emergency_id=emergency_id,
            user_id=user.id,
            ambulance_id=ambulance.id,
            action_type="PRIORITY_UPDATED",
            previous_value=previous_priority,
            new_value=request.priority,
        ))
    db.commit()
    db.refresh(action)
    log_audit(
        db,
        action="CLINICAL_ASSESSMENT_RECORDED",
        resource_type="Emergency",
        user=user,
        resource_id=emergency_id,
    )
    return {
        "message": "Clinical assessment saved",
        "emergency_id": emergency_id,
        "assessment_id": action.id,
        "created_at": action.created_at.isoformat() if action.created_at else None,
    }


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
            EmergencyAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES)
        )
        .order_by(desc(EmergencyAssignment.assigned_at))
        .first()
    )

    completed_runs = (
        db.query(EmergencyAssignment)
        .filter(
            EmergencyAssignment.ambulance_id == ambulance.id,
            EmergencyAssignment.status.in_(["COMPLETED", "RESOLVED"])
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
            "emergency_type": emg.emergency_type if emg else None,
            "description": emg.description if emg else None,
            "priority": emg.priority if emg else None,
            "pickup_latitude": emg.latitude if emg else None,
            "pickup_longitude": emg.longitude if emg else None,
            "patient_name": patient.full_name if patient else None,
            "patient_phone": patient.mobile if patient else None,
            "destination_hospital": {
                "name": hosp.name,
                "address": hosp.address,
                "latitude": hosp.latitude,
                "longitude": hosp.longitude,
            } if hosp else None,
            "ambulance_location_updated_at": (
                ambulance.location_updated_at.isoformat() if ambulance.location_updated_at else None
            ),
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
        "location_updated_at": ambulance.location_updated_at.isoformat() if ambulance.location_updated_at else None,
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
            EmergencyAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES)
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
            "emergency_type": emg.emergency_type if emg else None,
            "description": emg.description if emg else None,
            "priority": emg.priority if emg else None,
            "pickup_latitude": emg.latitude if emg else None,
            "pickup_longitude": emg.longitude if emg else None,
            "patient_name": patient.full_name if patient else None,
            "patient_phone": patient.mobile if patient else None,
            "hospital": {
                "id": hosp.id if hosp else None,
                "name": hosp.name if hosp else None,
                "address": hosp.address if hosp else None,
                "latitude": hosp.latitude if hosp else None,
                "longitude": hosp.longitude if hosp else None,
            } if hosp else None,
            "ambulance_location_updated_at": (
                ambulance.location_updated_at.isoformat() if ambulance.location_updated_at else None
            ),
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
    ambulance = get_driver_ambulance(db, user)
    assignment = db.query(EmergencyAssignment).filter(
        EmergencyAssignment.id == assignment_id,
        EmergencyAssignment.ambulance_id == ambulance.id,
    ).with_for_update().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    old_status = assignment.status
    allowed_transitions = {
        "ACCEPTED": {"EN_ROUTE"},
        "EN_ROUTE": {"PATIENT_PICKED_UP"},
        "PATIENT_PICKED_UP": {"HOSPITAL_SELECTED"},
        "HOSPITAL_ACCEPTED": {"HOSPITAL_ARRIVED"},
        "HOSPITAL_ARRIVED": {"RESOLVED"},
        "HOSPITAL_RECEIVED": {"RESOLVED"},
    }
    if assignment.status == "PATIENT_PICKED_UP" and assignment.hospital_id:
        allowed_transitions["PATIENT_PICKED_UP"].add("HOSPITAL_ARRIVED")
    if request.status not in allowed_transitions.get(old_status, set()):
        raise HTTPException(
            status_code=409,
            detail=f"Invalid assignment status transition: {old_status} to {request.status}",
        )

    assignment.status = request.status
    if request.status == "PATIENT_PICKED_UP" and assignment.hospital_id:
        assignment.status = "HOSPITAL_SELECTED"
    if request.notes:
        assignment.notes = request.notes

    if assignment.emergency:
        assignment.emergency.status = assignment.status
    if assignment.status == "RESOLVED":
        assignment.ambulance.status = "AVAILABLE"
    db.add(EmergencyAction(
        emergency_id=assignment.emergency_id,
        user_id=user.id,
        ambulance_id=ambulance.id,
        action_type="STATUS_UPDATED",
        previous_value=old_status,
        new_value=assignment.status,
        notes=request.notes,
    ))

    db.commit()
    db.refresh(assignment)

    log_audit(
        db,
        action="AMBULANCE_ASSIGNMENT_STATUS_UPDATE",
        resource_type="EmergencyAssignment",
        user=user,
        resource_id=assignment.id,
        details=f"Status: {old_status} -> {assignment.status}"
    )

    return {
        "message": f"Assignment status updated to {assignment.status}",
        "assignment_id": assignment.id,
        "status": assignment.status,
    }


@router.post("/assignment/{assignment_id}/cancel")
def cancel_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)
    assignment = db.query(EmergencyAssignment).filter(
        EmergencyAssignment.id == assignment_id,
        EmergencyAssignment.ambulance_id == ambulance.id,
    ).with_for_update().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.status not in ("ACCEPTED", "EN_ROUTE", "PATIENT_PICKED_UP"):
        raise HTTPException(status_code=409, detail="This assignment can no longer be cancelled by the ambulance")

    previous_status = assignment.status
    assignment.status = "CANCELLED"
    if assignment.emergency:
        assignment.emergency.status = "CANCELLED"
    ambulance.status = "AVAILABLE"
    db.add(EmergencyAction(
        emergency_id=assignment.emergency_id,
        user_id=user.id,
        ambulance_id=ambulance.id,
        action_type="CANCELLED",
        previous_value=previous_status,
        new_value="CANCELLED",
    ))
    db.commit()
    log_audit(
        db,
        action="EMERGENCY_CANCELLED",
        resource_type="EmergencyAssignment",
        user=user,
        resource_id=assignment.id,
    )
    return {"assignment_id": assignment.id, "status": assignment.status}


@router.patch("/availability")
def update_ambulance_availability(
    request: AmbulanceStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ambulance_crew),
):
    ambulance = get_driver_ambulance(db, user)
    active_assignment = db.query(EmergencyAssignment.id).filter(
        EmergencyAssignment.ambulance_id == ambulance.id,
        EmergencyAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
    ).first()
    if active_assignment and request.status != "DISPATCHED":
        raise HTTPException(status_code=409, detail="Availability cannot change during an active assignment")
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
                "destination": a.hospital.name if a.hospital else None,
                "status": a.status,
                "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
            }
            for a in assignments
        ]
    }
