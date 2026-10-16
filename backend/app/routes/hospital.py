from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_, func

from app.core.database import get_db
from app.models.user import User
from app.models.hospital import HospitalPatient, HospitalResource
from app.models.medra_demo import Emergency, Ambulance, Hospital, EmergencyAssignment
from app.models.system import AuditLog, Notification
from app.schemas.hospital_ops import (
    HospitalPatientCreate,
    HospitalPatientVerify,
    HospitalResourceUpdate,
    EmergencyStatusUpdate,
)
from app.core.dependencies import get_current_hospital_staff, log_audit

router = APIRouter(
    prefix="/api/hospital",
    tags=["Hospital Portal"]
)


@router.get("/dashboard-stats")
def get_hospital_dashboard_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    total_patients = db.query(HospitalPatient).count()
    pending_verifications = db.query(HospitalPatient).filter(
        HospitalPatient.verification_status == "Pending review"
    ).count()

    active_emergencies = db.query(Emergency).filter(
        Emergency.status.in_(["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRIAGED"])
    ).count()

    resources = db.query(HospitalResource).all()
    total_beds = sum(r.total_count for r in resources) if resources else 45
    occupied_beds = sum(r.occupied_count for r in resources) if resources else 28
    available_beds = max(0, total_beds - occupied_beds)

    recent_emergencies = (
        db.query(Emergency)
        .order_by(desc(Emergency.created_at))
        .limit(5)
        .all()
    )

    emergency_list = []
    for emg in recent_emergencies:
        assignment = emg.assignment
        emergency_list.append({
            "id": emg.id,
            "reference": f"MEDRA-EMG-{emg.id:04d}",
            "type": emg.emergency_type,
            "status": emg.status,
            "priority": "Critical" if emg.status in ["REQUESTED", "ASSIGNED"] else "High",
            "ambulance": assignment.ambulance.vehicle_number if assignment and assignment.ambulance else "Unassigned",
            "created_at": emg.created_at.isoformat() if emg.created_at else None
        })

    return {
        "hospital_name": "Solapur District Emergency & Trauma Center",
        "staff_name": user.full_name,
        "staff_role": user.role,
        "metrics": {
            "total_registered_patients": total_patients,
            "pending_verifications": pending_verifications,
            "active_emergencies": active_emergencies,
            "total_beds": total_beds,
            "occupied_beds": occupied_beds,
            "available_beds": available_beds,
            "bed_occupancy_percentage": round((occupied_beds / total_beds * 100) if total_beds > 0 else 0, 1),
        },
        "recent_arrivals": emergency_list
    }


@router.get("/emergencies")
def get_hospital_emergencies(
    priority: str | None = None,
    status_filter: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    query = db.query(Emergency).order_by(desc(Emergency.created_at))

    if status_filter and status_filter != "all":
        query = query.filter(Emergency.status == status_filter)

    emergencies = query.all()
    results = []

    for emg in emergencies:
        assignment = emg.assignment
        patient = emg.user

        item = {
            "id": emg.id,
            "reference": f"MEDRA-EMG-{emg.id:04d}",
            "type": emg.emergency_type,
            "priority": "Critical" if emg.status in ["REQUESTED", "ASSIGNED"] else "High",
            "status": emg.status,
            "description": emg.description,
            "latitude": emg.latitude,
            "longitude": emg.longitude,
            "patient_name": patient.full_name if patient else "Anonymous / Emergency",
            "patient_mobile": patient.mobile if patient else "Not provided",
            "ambulance_vehicle": assignment.ambulance.vehicle_number if assignment and assignment.ambulance else "En route search",
            "ambulance_driver": assignment.ambulance.driver_name if assignment and assignment.ambulance else "Pending",
            "created_at": emg.created_at.isoformat() if emg.created_at else None,
        }

        if search:
            s = search.lower()
            if not (
                s in item["reference"].lower()
                or s in item["type"].lower()
                or s in item["patient_name"].lower()
                or s in item["status"].lower()
            ):
                continue

        results.append(item)

    return {"emergencies": results, "total": len(results)}


@router.patch("/emergencies/{emergency_id}/status")
def update_emergency_status(
    emergency_id: int,
    request: EmergencyStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    emergency = db.query(Emergency).filter(Emergency.id == emergency_id).first()
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency record not found")

    old_status = emergency.status
    emergency.status = request.status

    if emergency.assignment:
        emergency.assignment.status = request.status
        if request.notes:
            emergency.assignment.notes = request.notes

    # If marked resolved, free up ambulance
    if request.status in ["RESOLVED", "CANCELLED"] and emergency.assignment and emergency.assignment.ambulance:
        emergency.assignment.ambulance.status = "AVAILABLE"

    db.commit()
    db.refresh(emergency)

    log_audit(
        db,
        action="EMERGENCY_STATUS_UPDATED",
        resource_type="Emergency",
        user=user,
        resource_id=emergency.id,
        details=f"Status changed from {old_status} to {request.status}. Notes: {request.notes}"
    )

    return {
        "message": f"Emergency status updated to {request.status}",
        "id": emergency.id,
        "status": emergency.status
    }


@router.get("/patients")
def get_hospital_patients(
    query: str | None = None,
    status_filter: str | None = None,
    arrival_filter: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    q = db.query(HospitalPatient).order_by(desc(HospitalPatient.created_at))

    if status_filter and status_filter != "all":
        q = q.filter(HospitalPatient.status == status_filter)

    if arrival_filter and arrival_filter != "all":
        q = q.filter(HospitalPatient.arrival_type == arrival_filter)

    patients = q.all()
    results = []

    for p in patients:
        reference = f"MEDRA-PAT-{p.id:04d}"
        full_name = f"{p.first_name} {p.last_name}"

        if query:
            match = (
                query.lower() in reference.lower()
                or query.lower() in full_name.lower()
                or (p.phone and query in p.phone)
                or (p.email and query.lower() in p.email.lower())
            )
            if not match:
                continue

        results.append({
            "id": p.id,
            "reference": reference,
            "name": full_name,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "date_of_birth": p.date_of_birth.isoformat() if p.date_of_birth else None,
            "gender": p.gender,
            "phone": p.phone or "Not provided",
            "email": p.email or "Not provided",
            "arrival_type": p.arrival_type,
            "arrival_method": p.arrival_method,
            "arrival_date": p.arrival_date,
            "arrival_time": p.arrival_time,
            "priority": p.priority,
            "referral_source": p.referral_source,
            "notes": p.notes,
            "verification_status": p.verification_status,
            "verified_at": p.verified_at.isoformat() if p.verified_at else None,
            "status": p.status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })

    return {
        "patients": results,
        "total": len(results),
        "registered": sum(1 for p in results if p["status"] == "Registered"),
        "pending": sum(1 for p in results if p["verification_status"] == "Pending review"),
        "emergency": sum(1 for p in results if p["arrival_type"] == "Emergency"),
    }


@router.post("/patients", status_code=status.HTTP_201_CREATED)
def register_hospital_patient(
    request: HospitalPatientCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    patient = HospitalPatient(
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

    db.add(patient)
    db.commit()
    db.refresh(patient)

    log_audit(
        db,
        action="HOSPITAL_PATIENT_REGISTERED",
        resource_type="HospitalPatient",
        user=user,
        resource_id=patient.id,
        details=f"Patient: {patient.first_name} {patient.last_name}, Priority: {patient.priority}"
    )

    return {
        "message": "Patient successfully registered and saved to PostgreSQL",
        "id": patient.id,
        "reference": f"MEDRA-PAT-{patient.id:04d}",
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
    p = db.query(HospitalPatient).filter(HospitalPatient.id == patient_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Patient record not found")

    return {
        "id": p.id,
        "reference": f"MEDRA-PAT-{p.id:04d}",
        "first_name": p.first_name,
        "last_name": p.last_name,
        "name": f"{p.first_name} {p.last_name}",
        "date_of_birth": p.date_of_birth.isoformat() if p.date_of_birth else None,
        "gender": p.gender,
        "phone": p.phone,
        "email": p.email,
        "arrival_type": p.arrival_type,
        "arrival_method": p.arrival_method,
        "arrival_date": p.arrival_date,
        "arrival_time": p.arrival_time,
        "priority": p.priority,
        "referral_source": p.referral_source,
        "notes": p.notes,
        "verification_status": p.verification_status,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.post("/patients/{patient_id}/verify")
def verify_hospital_patient(
    patient_id: int,
    request: HospitalPatientVerify,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    p = db.query(HospitalPatient).filter(HospitalPatient.id == patient_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Patient record not found")

    p.verification_status = request.verification_status
    p.verified_by_user_id = user.id
    p.verified_at = datetime.now(timezone.utc)
    if request.notes:
        p.notes = f"{p.notes or ''}\n[Verification Note by {user.full_name}]: {request.notes}".strip()

    db.commit()
    db.refresh(p)

    log_audit(
        db,
        action="PATIENT_VERIFIED",
        resource_type="HospitalPatient",
        user=user,
        resource_id=p.id,
        details=f"Status set to {request.verification_status}"
    )

    return {
        "message": f"Patient verification recorded as {request.verification_status}",
        "id": p.id,
        "reference": f"MEDRA-PAT-{p.id:04d}",
        "verification_status": p.verification_status,
        "verified_by": user.full_name,
        "verified_at": p.verified_at.isoformat()
    }


@router.get("/resources")
def get_hospital_resources(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    resources = db.query(HospitalResource).all()

    # Seed initial standard resources if empty
    if not resources:
        initial = [
            HospitalResource(hospital_id=1, resource_type="ICU Bed", total_count=12, occupied_count=8),
            HospitalResource(hospital_id=1, resource_type="Emergency Bed", total_count=20, occupied_count=14),
            HospitalResource(hospital_id=1, resource_type="Oxygen Unit", total_count=30, occupied_count=15),
            HospitalResource(hospital_id=1, resource_type="Ventilator", total_count=10, occupied_count=6),
            HospitalResource(hospital_id=1, resource_type="General Ward Bed", total_count=50, occupied_count=32),
        ]
        db.add_all(initial)
        db.commit()
        resources = db.query(HospitalResource).all()

    return {
        "resources": [
            {
                "id": r.id,
                "hospital_id": r.hospital_id,
                "resource_type": r.resource_type,
                "total_count": r.total_count,
                "occupied_count": r.occupied_count,
                "available_count": max(0, r.total_count - r.occupied_count),
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in resources
        ]
    }


@router.put("/resources/{resource_id}")
def update_hospital_resource(
    resource_id: int,
    request: HospitalResourceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    r = db.query(HospitalResource).filter(HospitalResource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Resource item not found")

    if request.total_count is not None:
        if request.occupied_count > request.total_count:
            raise HTTPException(status_code=400, detail="Occupied count cannot exceed total count")
        r.total_count = request.total_count

    if request.occupied_count > r.total_count:
        raise HTTPException(status_code=400, detail="Occupied count cannot exceed total capacity")

    r.occupied_count = request.occupied_count
    db.commit()
    db.refresh(r)

    log_audit(
        db,
        action="RESOURCE_UPDATED",
        resource_type="HospitalResource",
        user=user,
        resource_id=r.id,
        details=f"{r.resource_type}: Occupied={r.occupied_count}, Total={r.total_count}"
    )

    return {
        "message": f"{r.resource_type} capacity updated successfully",
        "id": r.id,
        "resource_type": r.resource_type,
        "total_count": r.total_count,
        "occupied_count": r.occupied_count,
        "available_count": max(0, r.total_count - r.occupied_count),
    }


@router.get("/audit-logs")
def get_hospital_audit_logs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_hospital_staff),
):
    logs = (
        db.query(AuditLog)
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
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            }
            for log in logs
        ]
    }
