from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_hospital_staff, log_audit
from app.models.user import User
from app.models.hospital import HospitalPatient, HospitalResource
from app.models.medra_demo import (
    Emergency,
    Ambulance,
    Hospital,
    EmergencyAction,
    EmergencyAssignment,
)
from app.models.system import AuditLog, Notification
from app.schemas.hospital_ops import (
    HospitalPatientCreate,
    HospitalPatientVerify,
    HospitalResourceUpdate,
    EmergencyStatusUpdate,)

router = APIRouter(
    prefix="/api/hospital",
    tags=["Hospital Portal"],
)

HOSPITAL_INCOMING_STATUSES = (
    "HOSPITAL_SELECTED",
    "HOSPITAL_ACCEPTED",
    "HOSPITAL_ARRIVED",
    "HOSPITAL_RECEIVED",
)

# Valid transitions for the hospital's emergency workflow.
ALLOWED_HOSPITAL_TRANSITIONS = {
    "HOSPITAL_SELECTED": {"HOSPITAL_ACCEPTED"},
    "HOSPITAL_ACCEPTED": {"HOSPITAL_ARRIVED"},
    "HOSPITAL_ARRIVED": {"HOSPITAL_RECEIVED"},
    "HOSPITAL_RECEIVED": {"RESOLVED"},
}


def get_hospital_scope(user: User) -> int | None:
    """
    Return the hospital ID assigned to a hospital staff member.

    Admin accounts have network-wide scope.
    """
    if user.role == "admin":
        return None

    if user.hospital_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hospital staff account is not assigned to a hospital",
        )

    return user.hospital_id


def get_emergency_reference(emergency_id: int) -> str:
    return f"MEDRA-EMG-{emergency_id:04d}"


def get_patient_reference(patient_id: int) -> str:
    return f"MEDRA-PAT-{patient_id:04d}"


# =========================================================
# HOSPITAL DASHBOARD
# =========================================================

@router.get("/dashboard-stats")
def get_hospital_dashboard_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    patient_query = db.query(HospitalPatient)
    resource_query = db.query(HospitalResource)
    emergency_query = db.query(Emergency)

    if hospital_id is not None:
        patient_query = patient_query.filter(
            HospitalPatient.hospital_id == hospital_id
        )

        resource_query = resource_query.filter(
            HospitalResource.hospital_id == hospital_id
        )

        emergency_query = (
            emergency_query
            .join(EmergencyAssignment)
            .filter(EmergencyAssignment.hospital_id == hospital_id)
        )

    total_patients = patient_query.count()

    pending_verifications = patient_query.filter(
        HospitalPatient.verification_status == "Pending review"
    ).count()

    active_emergencies = emergency_query.filter(
        Emergency.status.in_(HOSPITAL_INCOMING_STATUSES)
    ).count()

    resources = resource_query.all()

    total_beds = sum(resource.total_count for resource in resources)
    occupied_beds = sum(resource.occupied_count for resource in resources)
    available_beds = max(0, total_beds - occupied_beds)

    recent_emergencies = (
        emergency_query
        .filter(Emergency.status.in_(HOSPITAL_INCOMING_STATUSES))
        .order_by(desc(Emergency.created_at))
        .limit(5)
        .all()
    )

    emergency_list = []

    for emergency in recent_emergencies:
        assignment = emergency.assignment

        emergency_list.append({
            "id": emergency.id,
            "reference": get_emergency_reference(emergency.id),
            "type": emergency.emergency_type,
            "status": emergency.status,
            "priority": emergency.priority,
            "ambulance": (
                assignment.ambulance.vehicle_number
                if assignment and assignment.ambulance
                else "Unassigned"
            ),
            "created_at": (
                emergency.created_at.isoformat()
                if emergency.created_at
                else None
            ),
        })

    hospital = None

    if hospital_id is not None:
        hospital = (
            db.query(Hospital)
            .filter(Hospital.id == hospital_id)
            .first()
        )

    occupancy_percentage = (
        round(occupied_beds / total_beds * 100, 1)
        if total_beds > 0
        else 0
    )

    return {
        "hospital_name": hospital.name if hospital else "Hospital Network",
        "staff_name": user.full_name,
        "staff_role": user.role,
        "metrics": {
            "total_registered_patients": total_patients,
            "pending_verifications": pending_verifications,
            "active_emergencies": active_emergencies,
            "total_beds": total_beds,
            "occupied_beds": occupied_beds,
            "available_beds": available_beds,
            "bed_occupancy_percentage": occupancy_percentage,
        },
        "recent_arrivals": emergency_list,
    }


# =========================================================
# HOSPITAL EMERGENCIES
# =========================================================

@router.get("/emergencies")
def get_hospital_emergencies(
    priority: str | None = Query(default=None),
    status_filter: str | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    query = (
        db.query(Emergency)
        .join(EmergencyAssignment)
    )

    if hospital_id is not None:
        query = query.filter(
            EmergencyAssignment.hospital_id == hospital_id
        )

    query = query.filter(
        Emergency.status.in_(HOSPITAL_INCOMING_STATUSES)
    )

    if status_filter and status_filter.lower() != "all":
        query = query.filter(
            Emergency.status == status_filter.upper()
        )

    if priority and priority.lower() != "all":
        query = query.filter(
            Emergency.priority == priority.upper()
        )

    emergencies = (
        query
        .order_by(desc(Emergency.created_at))
        .all()
    )

    search_term = search.strip().lower() if search else None
    results = []

    for emergency in emergencies:
        assignment = emergency.assignment
        patient = emergency.user

        item = {
            "id": emergency.id,
            "reference": get_emergency_reference(emergency.id),
            "type": emergency.emergency_type,
            "priority": emergency.priority,
            "status": emergency.status,
            "description": emergency.description,
            "latitude": emergency.latitude,
            "longitude": emergency.longitude,
            "patient_name": (
                patient.full_name
                if patient
                else "Anonymous / Emergency"
            ),
            "patient_mobile": (
                patient.mobile
                if patient and patient.mobile
                else "Not provided"
            ),
            "ambulance_vehicle": (
                assignment.ambulance.vehicle_number
                if assignment and assignment.ambulance
                else "Unassigned"
            ),
            "ambulance_driver": (
                assignment.ambulance.driver_name
                if assignment and assignment.ambulance
                else "Pending"
            ),
            "created_at": (
                emergency.created_at.isoformat()
                if emergency.created_at
                else None
            ),
            "ambulance_location_updated_at": (
                assignment.ambulance.location_updated_at.isoformat()
                if (
                    assignment
                    and assignment.ambulance
                    and assignment.ambulance.location_updated_at
                )
                else None
            ),
        }

        if search_term:
            searchable_fields = (
                item["reference"],
                item["type"] or "",
                item["patient_name"],
                item["status"],
                item["patient_mobile"],
                item["ambulance_vehicle"],
            )

            if not any(
                search_term in str(value).lower()
                for value in searchable_fields
            ):
                continue

        results.append(item)

    return {
        "emergencies": results,
        "total": len(results),
    }


# =========================================================
# UPDATE EMERGENCY STATUS
# =========================================================

@router.patch("/emergencies/{emergency_id}/status")
def update_emergency_status(
    emergency_id: int,
    request: EmergencyStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    emergency_query = db.query(Emergency).filter(
        Emergency.id == emergency_id
    )

    # Restrict hospital staff to emergencies assigned to their hospital.
    if hospital_id is not None:
        emergency_query = (
            emergency_query
            .join(EmergencyAssignment)
            .filter(EmergencyAssignment.hospital_id == hospital_id)
        )

    emergency = emergency_query.with_for_update().first()

    if not emergency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emergency record not found or not assigned to this hospital",
        )

    assignment = emergency.assignment

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Emergency has no hospital assignment",
        )

    requested_status = request.status.strip().upper()
    old_status = assignment.status

    allowed_next_statuses = ALLOWED_HOSPITAL_TRANSITIONS.get(
        old_status,
        set(),
    )

    if requested_status not in allowed_next_statuses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Invalid hospital status transition: "
                f"{old_status} to {requested_status}"
            ),
        )

    try:
        assignment.status = requested_status
        emergency.status = requested_status

        if request.notes:
            assignment.notes = request.notes.strip()

        if (
            requested_status == "RESOLVED"
            and assignment.ambulance is not None
        ):
            assignment.ambulance.status = "AVAILABLE"

        db.add(
            EmergencyAction(
                emergency_id=emergency.id,
                user_id=user.id,
                ambulance_id=assignment.ambulance_id,
                action_type="STATUS_UPDATED",
                previous_value=old_status,
                new_value=requested_status,
                notes=request.notes,
            )
        )

        db.add(
            Notification(
                user_id=emergency.user_id,
                role="patient",
                title="Emergency status updated",
                message=(
                    f"Emergency {get_emergency_reference(emergency.id)} "
                    f"is now {requested_status}."
                ),
                type="EMERGENCY",
            )
        )

        db.commit()
        db.refresh(emergency)

    except Exception:
        db.rollback()
        raise

    log_audit(
        db,
        action="EMERGENCY_STATUS_UPDATED",
        resource_type="Emergency",
        user=user,
        resource_id=emergency.id,
        details=(
            f"Status changed from {old_status} to {requested_status}. "
            f"Notes: {request.notes or ''}"
        ),
    )

    return {
        "message": f"Emergency status updated to {requested_status}",
        "id": emergency.id,
        "status": emergency.status,
    }


# =========================================================
# REGISTERED HOSPITAL PATIENTS
# =========================================================

@router.get("/patients")
def get_hospital_patients(
    query: str | None = Query(default=None),
    status_filter: str | None = Query(default=None),
    arrival_filter: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    patient_query = db.query(HospitalPatient)

    if hospital_id is not None:
        patient_query = patient_query.filter(
            HospitalPatient.hospital_id == hospital_id
        )

    if status_filter and status_filter.lower() != "all":
        patient_query = patient_query.filter(
            HospitalPatient.status == status_filter
        )

    if arrival_filter and arrival_filter.lower() != "all":
        patient_query = patient_query.filter(
            HospitalPatient.arrival_type == arrival_filter
        )

    patients = (
        patient_query
        .order_by(desc(HospitalPatient.created_at))
        .all()
    )

    results = []
    search_term = query.strip().lower() if query else None

    for patient in patients:
        reference = get_patient_reference(patient.id)
        full_name = f"{patient.first_name} {patient.last_name}".strip()

        if search_term:
            searchable_fields = (
                reference,
                full_name,
                patient.phone or "",
                patient.email or "",
            )

            if not any(
                search_term in str(value).lower()
                for value in searchable_fields
            ):
                continue

        results.append({
            "id": patient.id,
            "reference": reference,
            "name": full_name,
            "first_name": patient.first_name,
            "last_name": patient.last_name,
            "date_of_birth": (
                patient.date_of_birth.isoformat()
                if patient.date_of_birth
                else None
            ),
            "gender": patient.gender,
            "phone": patient.phone or "Not provided",
            "email": patient.email or "Not provided",
            "arrival_type": patient.arrival_type,
            "arrival_method": patient.arrival_method,
            "arrival_date": patient.arrival_date,
            "arrival_time": patient.arrival_time,
            "priority": patient.priority,
            "referral_source": patient.referral_source,
            "notes": patient.notes,
            "verification_status": patient.verification_status,
            "verified_at": (
                patient.verified_at.isoformat()
                if patient.verified_at
                else None
            ),
            "status": patient.status,
            "created_at": (
                patient.created_at.isoformat()
                if patient.created_at
                else None
            ),
        })

    return {
        "patients": results,
        "total": len(results),
        "registered": sum(
            1 for patient in results
            if patient["status"] == "Registered"
        ),
        "pending": sum(
            1 for patient in results
            if patient["verification_status"] == "Pending review"
        ),
        "emergency": sum(
            1 for patient in results
            if patient["arrival_type"] == "Emergency"
        ),
    }


@router.post(
    "/patients",
    status_code=status.HTTP_201_CREATED,
)
def register_hospital_patient(
    request: HospitalPatientCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    # A hospital patient record must belong to a specific hospital.
    if hospital_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "A specific hospital must be selected before "
                "registering a patient."
            ),
        )

    patient = HospitalPatient(
        hospital_id=hospital_id,
        first_name=request.first_name.strip(),
        last_name=request.last_name.strip(),
        date_of_birth=request.date_of_birth,
        gender=request.gender,
        phone=request.phone.strip() if request.phone else None,
        email=str(request.email).strip().lower() if request.email else None,
        arrival_type=request.arrival_type,
        arrival_method=request.arrival_method,
        arrival_date=request.arrival_date,
        arrival_time=request.arrival_time,
        priority=request.priority,
        referral_source=request.referral_source,
        notes=request.notes,
        verification_status="Pending review",
        status="Registered",
    )

    try:
        db.add(patient)
        db.commit()
        db.refresh(patient)
    except Exception:
        db.rollback()
        raise

    log_audit(
        db,
        action="HOSPITAL_PATIENT_REGISTERED",
        resource_type="HospitalPatient",
        user=user,
        resource_id=patient.id,
        details=(
            f"Patient: {patient.first_name} {patient.last_name}, "
            f"Priority: {patient.priority}"
        ),
    )

    return {
        "message": "Patient successfully registered",
        "id": patient.id,
        "reference": get_patient_reference(patient.id),
        "name": f"{patient.first_name} {patient.last_name}",
        "verification_status": patient.verification_status,
        "status": patient.status,
    }


@router.get("/patients/{patient_id}")
def get_hospital_patient_details(
    patient_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    patient_query = db.query(HospitalPatient).filter(
        HospitalPatient.id == patient_id
    )

    if hospital_id is not None:
        patient_query = patient_query.filter(
            HospitalPatient.hospital_id == hospital_id
        )

    patient = patient_query.first()

    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient record not found",
        )

    return {
        "id": patient.id,
        "reference": get_patient_reference(patient.id),
        "first_name": patient.first_name,
        "last_name": patient.last_name,
        "name": f"{patient.first_name} {patient.last_name}",
        "date_of_birth": (
            patient.date_of_birth.isoformat()
            if patient.date_of_birth
            else None
        ),
        "gender": patient.gender,
        "phone": patient.phone,
        "email": patient.email,
        "arrival_type": patient.arrival_type,
        "arrival_method": patient.arrival_method,
        "arrival_date": patient.arrival_date,
        "arrival_time": patient.arrival_time,
        "priority": patient.priority,
        "referral_source": patient.referral_source,
        "notes": patient.notes,
        "verification_status": patient.verification_status,
        "verified_at": (
            patient.verified_at.isoformat()
            if patient.verified_at
            else None
        ),
        "status": patient.status,
        "created_at": (
            patient.created_at.isoformat()
            if patient.created_at
            else None
        ),
    }


@router.post("/patients/{patient_id}/verify")
def verify_hospital_patient(
    patient_id: int,
    request: HospitalPatientVerify,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    patient_query = db.query(HospitalPatient).filter(
        HospitalPatient.id == patient_id
    )

    if hospital_id is not None:
        patient_query = patient_query.filter(
            HospitalPatient.hospital_id == hospital_id
        )

    patient = patient_query.first()

    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient record not found",
        )

    patient.verification_status = request.verification_status
    patient.verified_by_user_id = user.id
    patient.verified_at = datetime.now(timezone.utc)

    if request.notes:
        patient.notes = (
            f"{patient.notes or ''}\n"
            f"[Verification Note by {user.full_name}]: {request.notes}"
        ).strip()

    try:
        db.commit()
        db.refresh(patient)
    except Exception:
        db.rollback()
        raise

    log_audit(
        db,
        action="PATIENT_VERIFIED",
        resource_type="HospitalPatient",
        user=user,
        resource_id=patient.id,
        details=f"Status set to {patient.verification_status}",
    )

    return {
        "message": (
            "Patient verification recorded as "
            f"{patient.verification_status}"
        ),
        "id": patient.id,
        "reference": get_patient_reference(patient.id),
        "verification_status": patient.verification_status,
        "verified_by": user.full_name,
        "verified_at": (
            patient.verified_at.isoformat()
            if patient.verified_at
            else None
        ),
    }


# =========================================================
# HOSPITAL RESOURCES AND BED CAPACITY
# =========================================================

@router.get("/resources")
def get_hospital_resources(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    resource_query = db.query(HospitalResource)

    if hospital_id is not None:
        resource_query = resource_query.filter(
            HospitalResource.hospital_id == hospital_id
        )

    resources = resource_query.all()

    return {
        "resources": [
            {
                "id": resource.id,
                "hospital_id": resource.hospital_id,
                "resource_type": resource.resource_type,
                "total_count": resource.total_count,
                "occupied_count": resource.occupied_count,
                "available_count": max(
                    0,
                    resource.total_count - resource.occupied_count,
                ),
                "updated_at": (
                    resource.updated_at.isoformat()
                    if resource.updated_at
                    else None
                ),
            }
            for resource in resources
        ]
    }


@router.put("/resources/{resource_id}")
def update_hospital_resource(
    resource_id: int,
    request: HospitalResourceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    resource_query = db.query(HospitalResource).filter(
        HospitalResource.id == resource_id
    )

    if hospital_id is not None:
        resource_query = resource_query.filter(
            HospitalResource.hospital_id == hospital_id
        )

    resource = resource_query.first()

    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource item not found",
        )

    new_total = (
        request.total_count
        if request.total_count is not None
        else resource.total_count
    )

    new_occupied = request.occupied_count

    if new_total < 0 or new_occupied < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resource counts cannot be negative",
        )

    if new_occupied > new_total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Occupied count cannot exceed total capacity",
        )

    resource.total_count = new_total
    resource.occupied_count = new_occupied

    try:
        db.commit()
        db.refresh(resource)
    except Exception:
        db.rollback()
        raise

    log_audit(
        db,
        action="RESOURCE_UPDATED",
        resource_type="HospitalResource",
        user=user,
        resource_id=resource.id,
        details=(
            f"{resource.resource_type}: "
            f"Occupied={resource.occupied_count}, "
            f"Total={resource.total_count}"
        ),
    )

    return {
        "message": f"{resource.resource_type} capacity updated successfully",
        "id": resource.id,
        "resource_type": resource.resource_type,
        "total_count": resource.total_count,
        "occupied_count": resource.occupied_count,
        "available_count": max(
            0,
            resource.total_count - resource.occupied_count,
        ),
    }


# =========================================================
# HOSPITAL AUDIT LOGS
# =========================================================

@router.get("/audit-logs")
def get_hospital_audit_logs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    hospital_id = get_hospital_scope(user)

    log_query = db.query(AuditLog)

    # Hospital staff see their own logs.
    # Admin accounts can review logs across the network.
    if hospital_id is not None:
        log_query = log_query.filter(
            AuditLog.user_id == user.id
        )

    logs = (
        log_query
        .order_by(desc(AuditLog.timestamp))
        .limit(25)
        .all()
    )

    return {
        "logs": [
            {
                "id": log.id,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "user_email": log.user_email,
                "details": log.details,
                "timestamp": (
                    log.timestamp.isoformat()
                    if log.timestamp
                    else None
                ),
            }
            for log in logs
        ]
    }
