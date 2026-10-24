from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, text
from pydantic import BaseModel
from typing import Literal

from app.core.database import get_db
from app.models.user import User
from app.models.hospital import HospitalPatient, HospitalResource
from app.models.medra_demo import Emergency, Ambulance, Hospital, EmergencyAssignment
from app.models.system import AuditLog
from app.schemas.ambulance_ops import AmbulanceCrewAssignment
from app.core.dependencies import get_current_admin, log_audit

router = APIRouter(
    prefix="/api/admin",
    tags=["Admin Portal"]
)


class UserStatusUpdate(BaseModel):
    is_active: bool


class UserRoleUpdate(BaseModel):
    role: Literal["patient", "ambulance", "hospital", "admin"]


class HospitalStaffAssignment(BaseModel):
    hospital_id: int | None


@router.get("/metrics")
def get_admin_metrics(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    total_users = db.query(User).count()
    patient_count = db.query(User).filter(User.role == "patient").count()
    ambulance_count = db.query(User).filter(User.role == "ambulance").count()
    hospital_staff_count = db.query(User).filter(User.role == "hospital").count()
    admin_count = db.query(User).filter(User.role == "admin").count()

    total_emergencies = db.query(Emergency).count()
    active_emergencies = db.query(Emergency).filter(
        Emergency.status.in_(["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRIAGED"])
    ).count()
    resolved_emergencies = db.query(Emergency).filter(Emergency.status == "RESOLVED").count()

    total_ambulances = db.query(Ambulance).count()
    available_ambulances = db.query(Ambulance).filter(Ambulance.status == "AVAILABLE").count()
    total_hospitals = db.query(Hospital).count()

    # DB Health check
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    return {
        "admin_name": user.full_name,
        "users": {
            "total": total_users,
            "patients": patient_count,
            "ambulance_crew": ambulance_count,
            "hospital_staff": hospital_staff_count,
            "administrators": admin_count,
        },
        "emergencies": {
            "total": total_emergencies,
            "active": active_emergencies,
            "resolved": resolved_emergencies,
        },
        "resources": {
            "total_ambulances": total_ambulances,
            "available_ambulances": available_ambulances,
            "total_hospitals": total_hospitals,
        },
        "system": {
            "database_connected": db_ok,
            "status": "healthy" if db_ok else "degraded",
            "server_time": datetime.now(timezone.utc).isoformat(),
        }
    }


@router.get("/users")
def get_admin_users(
    role: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    q = db.query(User).order_by(desc(User.created_at))

    if role and role != "all":
        q = q.filter(User.role == role)

    users = q.all()
    results = []

    for u in users:
        if search:
            s = search.lower()
            if not (s in u.full_name.lower() or s in u.email.lower() or (u.mobile and s in u.mobile)):
                continue

        # Strictly omit password_hash
        results.append({
            "id": u.id,
            "full_name": u.full_name,
            "email": u.email,
            "mobile": u.mobile or "Not provided",
            "role": u.role,
            "ambulance_subrole": u.ambulance_subrole,
            "ambulance_id": u.ambulance_id,
            "hospital_id": u.hospital_id,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        })

    return {"users": results, "total": len(results)}


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: int,
    request: UserStatusUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == admin.id and not request.is_active:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own administrator account")

    target.is_active = request.is_active
    db.commit()
    db.refresh(target)

    log_audit(
        db,
        action="USER_STATUS_UPDATED",
        resource_type="User",
        user=admin,
        resource_id=target.id,
        details=f"User {target.email} active set to {target.is_active}"
    )

    return {
        "message": f"User account {'activated' if target.is_active else 'deactivated'} successfully",
        "id": target.id,
        "is_active": target.is_active
    }


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    request: UserRoleUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    old_role = target.role
    if target.ambulance_subrole == "EC_DRIVER":
        db.query(Ambulance).filter(Ambulance.driver_user_id == target.id).update(
            {Ambulance.driver_user_id: None}
        )
    target.ambulance_subrole = None
    target.ambulance_id = None
    target.role = request.role
    if request.role != "hospital":
        target.hospital_id = None
    db.commit()
    db.refresh(target)

    log_audit(
        db,
        action="USER_ROLE_CHANGED",
        resource_type="User",
        user=admin,
        resource_id=target.id,
        details=f"User {target.email} role changed from {old_role} to {request.role}"
    )

    return {
        "message": f"User role changed to {target.role}",
        "id": target.id,
        "role": target.role
    }


@router.get("/hospitals")
def get_admin_hospitals(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    hospitals = db.query(Hospital).order_by(Hospital.name).all()
    return {
        "hospitals": [
            {
                "id": hospital.id,
                "name": hospital.name,
                "address": hospital.address,
                "emergency_available": hospital.emergency_available,
            }
            for hospital in hospitals
        ]
    }


@router.patch("/users/{user_id}/hospital")
def assign_hospital_staff(
    user_id: int,
    request: HospitalStaffAssignment,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role != "hospital":
        raise HTTPException(status_code=409, detail="Only hospital staff accounts can be assigned to a hospital")

    if request.hospital_id is not None:
        hospital = db.query(Hospital).filter(Hospital.id == request.hospital_id).first()
        if not hospital:
            raise HTTPException(status_code=404, detail="Hospital not found")
    target.hospital_id = request.hospital_id
    db.commit()
    db.refresh(target)
    log_audit(
        db,
        action="HOSPITAL_STAFF_ASSIGNED",
        resource_type="User",
        user=admin,
        resource_id=target.id,
        details=f"Hospital ID: {target.hospital_id}",
    )
    return {"user_id": target.id, "hospital_id": target.hospital_id}


@router.put("/users/{user_id}/ambulance-crew")
def assign_ambulance_crew(
    user_id: int,
    request: AmbulanceCrewAssignment,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    target = db.query(User).filter(User.id == user_id).with_for_update().first()
    ambulance = db.query(Ambulance).filter(Ambulance.id == request.ambulance_id).with_for_update().first()
    if not target:
        raise HTTPException(status_code=404, detail="Crew account not found")
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    if target.role != "ambulance":
        raise HTTPException(status_code=409, detail="Crew account must have the ambulance role")
    if request.subrole == "EC_DRIVER" and ambulance.driver_user_id not in (None, target.id):
        raise HTTPException(status_code=409, detail="Ambulance already has a different assigned driver")

    if target.ambulance_subrole == "EC_DRIVER":
        db.query(Ambulance).filter(Ambulance.driver_user_id == target.id).update(
            {Ambulance.driver_user_id: None}
        )
    target.ambulance_id = ambulance.id
    target.ambulance_subrole = request.subrole
    if request.subrole == "EC_DRIVER":
        ambulance.driver_user_id = target.id

    db.commit()
    log_audit(
        db,
        action="AMBULANCE_CREW_ASSIGNED",
        resource_type="User",
        user=admin,
        resource_id=target.id,
        details=f"Ambulance crew subrole {request.subrole} assigned to ambulance {ambulance.id}",
    )
    return {
        "message": "Ambulance crew assignment saved",
        "user_id": target.id,
        "ambulance_id": ambulance.id,
        "subrole": target.ambulance_subrole,
    }


@router.get("/emergencies")
def get_admin_emergencies(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    emergencies = db.query(Emergency).order_by(desc(Emergency.created_at)).all()
    results = []

    for emg in emergencies:
        assignment = emg.assignment
        results.append({
            "id": emg.id,
            "reference": f"MEDRA-EMG-{emg.id:04d}",
            "type": emg.emergency_type,
            "status": emg.status,
            "caller": emg.user.full_name if emg.user else "Anonymous",
            "caller_email": emg.user.email if emg.user else "N/A",
            "ambulance": assignment.ambulance.vehicle_number if assignment and assignment.ambulance else "Unassigned",
            "hospital": assignment.hospital.name if assignment and assignment.hospital else "Unassigned",
            "created_at": emg.created_at.isoformat() if emg.created_at else None,
        })

    return {"emergencies": results}


@router.get("/audit-logs")
def get_admin_audit_logs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    logs = db.query(AuditLog).order_by(desc(AuditLog.timestamp)).limit(50).all()
    return {
        "logs": [
            {
                "id": l.id,
                "action": l.action,
                "resource_type": l.resource_type,
                "resource_id": l.resource_id,
                "user_email": l.user_email or "System",
                "details": l.details,
                "timestamp": l.timestamp.isoformat() if l.timestamp else None,
            }
            for l in logs
        ]
    }


@router.get("/system-health")
def get_system_health(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    try:
        ver = db.execute(text("SELECT version()")).scalar()
        db_alive = True
    except Exception as e:
        ver = str(e)
        db_alive = False

    return {
        "api_status": "healthy",
        "database_connected": db_alive,
        "database_version": ver if db_alive else "Unavailable",
        "auth_security": "JWT Bearer + Argon2 Password Hashing",
        "tables": [
            "users", "patient_profiles", "demo_medical_records", "emergencies",
            "ambulances", "hospitals", "emergency_assignments", "hospital_patients",
            "hospital_resources", "vital_observations", "notifications", "audit_logs"
        ],
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
