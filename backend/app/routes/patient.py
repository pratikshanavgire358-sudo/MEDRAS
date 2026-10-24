from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_patient, log_audit
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.models.family_member import FamilyMember
from app.models.medra_demo import (
    DemoMedicalRecord,
    Emergency,
    EmergencyAction,
    Ambulance,
    Hospital,
    EmergencyAssignment,
)
from app.models.vitals import VitalObservation
from app.models.hospital import HospitalResource
from app.models.system import Notification, NotificationRead
from app.schemas.family import FamilyMemberCreate, FamilyMemberUpdate
from app.schemas.patient_profile import PatientProfileUpdate
from app.schemas.patient_ops import (
    EmergencyCreateRequest,
    VitalObservationCreate,
)

router = APIRouter(
    prefix="/api/patient",
    tags=["Patient Portal"],
)

ACTIVE_EMERGENCY_STATUSES = [
    "REQUESTED",
    "ASSIGNED",
    "ACCEPTED",
    "EN_ROUTE",
    "PATIENT_PICKED_UP",
    "HOSPITAL_ARRIVED",
]

TERMINAL_EMERGENCY_STATUSES = ["RESOLVED", "CANCELLED"]


def get_or_create_profile(db: Session, user_id: int) -> PatientProfile:
    profile = (
        db.query(PatientProfile)
        .filter(PatientProfile.user_id == user_id)
        .first()
    )

    if profile is None:
        profile = PatientProfile(user_id=user_id)
        db.add(profile)

        try:
            db.commit()
            db.refresh(profile)
        except Exception:
            db.rollback()
            raise

    return profile


def emergency_response(emergency: Emergency, user: User):
    assignment = emergency.assignment

    return {
        "message": (
            "Emergency SOS registered and waiting for ambulance acceptance"
            if emergency.status == "REQUESTED"
            else "Emergency SOS is already registered"
        ),
        "emergency_id": emergency.id,
        "reference": f"MEDRA-EMG-{emergency.id:04d}",
        "patient_name": user.full_name,
        "emergency_type": emergency.emergency_type,
        "description": emergency.description,
        "latitude": emergency.latitude,
        "longitude": emergency.longitude,
        "status": emergency.status,
        "type": emergency.emergency_type,
        "priority": emergency.priority,
        "ambulance": (
            {
                "vehicle_number": assignment.ambulance.vehicle_number,
                "driver_name": assignment.ambulance.driver_name,
            }
            if assignment and assignment.ambulance
            else None
        ),
        "hospital": (
            {
                "name": assignment.hospital.name,
                "address": assignment.hospital.address,
            }
            if assignment and assignment.hospital
            else None
        ),
        "created_at": (
            emergency.created_at.isoformat()
            if emergency.created_at
            else None
        ),
    }


@router.get("/profile")
def get_patient_profile(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    profile = get_or_create_profile(db, user.id)

    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "mobile": user.mobile,
        "role": user.role,
        "date_of_birth": (
            profile.date_of_birth.isoformat()
            if profile.date_of_birth
            else None
        ),
        "gender": profile.gender,
        "blood_group": profile.blood_group,
        "address": profile.address,
        "emergency_contact_name": profile.emergency_contact_name,
        "emergency_contact_mobile": profile.emergency_contact_mobile,
        "abha_linked": profile.abha_linked,
    }


@router.put("/profile")
def update_patient_profile(
    request: PatientProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    profile = get_or_create_profile(db, user.id)
    updates = request.model_dump(exclude_unset=True)

    for field, value in updates.items():
        setattr(profile, field, value)

    try:
        db.commit()
        db.refresh(profile)

        log_audit(
            db,
            action="PATIENT_PROFILE_UPDATED",
            resource_type="PatientProfile",
            user=user,
            resource_id=profile.id,
        )
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save patient profile.",
        )

    return {
        "message": "Patient profile updated successfully",
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "mobile": user.mobile,
        "role": user.role,
        "date_of_birth": (
            profile.date_of_birth.isoformat()
            if profile.date_of_birth
            else None
        ),
        "gender": profile.gender,
        "blood_group": profile.blood_group,
        "address": profile.address,
        "emergency_contact_name": profile.emergency_contact_name,
        "emergency_contact_mobile": profile.emergency_contact_mobile,
        "abha_linked": profile.abha_linked,
    }


@router.post("/emergency", status_code=status.HTTP_201_CREATED)
def create_patient_emergency(
    request: EmergencyCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    idempotency_key = (
        str(request.idempotency_key)
        if request.idempotency_key
        else None
    )

    try:
        # Make retries of the same request idempotent.
        if idempotency_key:
            existing = db.query(Emergency).filter(
                Emergency.user_id == user.id,
                Emergency.idempotency_key == idempotency_key,
            ).first()

            if existing:
                return emergency_response(existing, user)

        # Check every active emergency, not just the latest one.
        active_emergency = db.query(Emergency).filter(
            Emergency.user_id == user.id,
            Emergency.status.in_(ACTIVE_EMERGENCY_STATUSES),
        ).order_by(desc(Emergency.created_at)).first()

        if active_emergency:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "An active emergency already exists.",
                    "emergency_id": active_emergency.id,
                    "reference": (
                        f"MEDRA-EMG-{active_emergency.id:04d}"
                    ),
                    "status": active_emergency.status,
                },
            )

        emergency = Emergency(
            user_id=user.id,
            emergency_type=request.emergency_type,
            description=request.description or None,
            latitude=request.latitude,
            longitude=request.longitude,
            status="REQUESTED",
            priority="NORMAL",
            idempotency_key=idempotency_key,
        )

        db.add(emergency)
        db.flush()

        db.add(
            EmergencyAction(
                emergency_id=emergency.id,
                user_id=user.id,
                action_type="SOS_CREATED",
                new_value="REQUESTED",
            )
        )

        db.add(
            Notification(
                user_id=user.id,
                role="patient",
                title="Emergency SOS received",
                message=(
                    f"Emergency SOS MEDRA-EMG-{emergency.id:04d} "
                    "is waiting for an eligible ambulance to accept."
                ),
                type="EMERGENCY",
            )
        )

        db.commit()
        db.refresh(emergency)

    except HTTPException:
        db.rollback()
        raise

    except IntegrityError:
        db.rollback()

        # Check whether a retry created the same request concurrently.
        if idempotency_key:
            existing = db.query(Emergency).filter(
                Emergency.user_id == user.id,
                Emergency.idempotency_key == idempotency_key,
            ).first()

            if existing:
                return emergency_response(existing, user)

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The emergency request conflicts with an existing record.",
        )

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to register the emergency. Please try again.",
        )

    log_audit(
        db,
        action="EMERGENCY_CREATED",
        resource_type="Emergency",
        user=user,
        resource_id=emergency.id,
        details=None,
    )

    return emergency_response(emergency, user)


@router.get("/emergencies")
def get_patient_emergencies(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    emergencies = (
        db.query(Emergency)
        .filter(Emergency.user_id == user.id)
        .order_by(desc(Emergency.created_at))
        .all()
    )

    results = []

    for emg in emergencies:
        assignment = emg.assignment

        results.append({
            "id": emg.id,
            "reference": f"MEDRA-EMG-{emg.id:04d}",
            "emergency_type": emg.emergency_type,
            "description": emg.description,
            "status": emg.status,
            "priority": emg.priority,
            "latitude": emg.latitude,
            "longitude": emg.longitude,
            "created_at": (
                emg.created_at.isoformat()
                if emg.created_at
                else None
            ),
            "ambulance": (
                {
                    "vehicle_number": assignment.ambulance.vehicle_number,
                    "driver_name": assignment.ambulance.driver_name,
                    "status": assignment.ambulance.status,
                }
                if assignment and assignment.ambulance
                else None
            ),
            "hospital": (
                {
                    "name": assignment.hospital.name,
                    "address": assignment.hospital.address,
                }
                if assignment and assignment.hospital
                else None
            ),
        })

    return {"emergencies": results}


@router.get("/emergencies/active")
def get_active_patient_emergency(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    emergency = (
        db.query(Emergency)
        .filter(
            Emergency.user_id == user.id,
            Emergency.status.notin_(TERMINAL_EMERGENCY_STATUSES),
        )
        .order_by(desc(Emergency.created_at))
        .first()
    )

    if not emergency:
        latest_emergency = (
            db.query(Emergency)
            .filter(Emergency.user_id == user.id)
            .order_by(desc(Emergency.created_at))
            .first()
        )
        if latest_emergency is None:
            return {"has_active": False, "emergency": None}

        return {
            "has_active": False,
            "emergency": {
                "id": latest_emergency.id,
                "reference": f"MEDRA-EMG-{latest_emergency.id:04d}",
                "emergency_type": latest_emergency.emergency_type,
                "description": latest_emergency.description,
                "status": latest_emergency.status,
                "priority": latest_emergency.priority,
                "latitude": latest_emergency.latitude,
                "longitude": latest_emergency.longitude,
                "created_at": (
                    latest_emergency.created_at.isoformat()
                    if latest_emergency.created_at
                    else None
                ),
            },
        }

    assignment = emergency.assignment

    return {
        "has_active": True,
        "emergency": {
            "id": emergency.id,
            "reference": f"MEDRA-EMG-{emergency.id:04d}",
            "emergency_type": emergency.emergency_type,
            "description": emergency.description,
            "status": emergency.status,
            "priority": emergency.priority,
            "latitude": emergency.latitude,
            "longitude": emergency.longitude,
            "ambulance_location_updated_at": (
                assignment.ambulance.location_updated_at.isoformat()
                if (
                    assignment
                    and assignment.ambulance
                    and assignment.ambulance.location_updated_at
                )
                else None
            ),
            "created_at": (
                emergency.created_at.isoformat()
                if emergency.created_at
                else None
            ),
            "ambulance": (
                {
                    "id": assignment.ambulance.id,
                    "vehicle_number": assignment.ambulance.vehicle_number,
                    "driver_name": assignment.ambulance.driver_name,
                    "latitude": assignment.ambulance.latitude,
                    "longitude": assignment.ambulance.longitude,
                    "status": assignment.ambulance.status,
                }
                if assignment and assignment.ambulance
                else None
            ),
            "hospital": (
                {
                    "id": assignment.hospital.id,
                    "name": assignment.hospital.name,
                    "address": assignment.hospital.address,
                    "latitude": assignment.hospital.latitude,
                    "longitude": assignment.hospital.longitude,
                }
                if assignment and assignment.hospital
                else None
            ),
        },
    }


@router.get("/medical-records")
def get_patient_medical_records(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    records = (
        db.query(DemoMedicalRecord)
        .filter(DemoMedicalRecord.user_id == user.id)
        .order_by(desc(DemoMedicalRecord.record_date))
        .all()
    )

    return {
        "patient_name": user.full_name,
        "patient_id": user.id,
        "notice": (
            "Official ABDM/ABHA repository integration requires certified "
            "sandbox credentials. Synthetic demonstration records are "
            "labelled MOCK_DATA."
        ),
        "records": [
            {
                "id": record.id,
                "record_type": record.record_type,
                "provider_name": record.provider_name,
                "record_date": (
                    record.record_date.isoformat()
                    if record.record_date
                    else None
                ),
                "summary": record.summary,
                "data_source": record.data_source,
            }
            for record in records
        ],
    }


@router.get("/vitals")
def get_patient_vitals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    vitals = (
        db.query(VitalObservation)
        .filter(VitalObservation.user_id == user.id)
        .order_by(desc(VitalObservation.recorded_at))
        .limit(20)
        .all()
    )

    return {
        "vitals": [
            {
                "id": v.id,
                "heart_rate": v.heart_rate,
                "blood_pressure": (
                    f"{v.blood_pressure_systolic}/"
                    f"{v.blood_pressure_diastolic}"
                    if (
                        v.blood_pressure_systolic is not None
                        and v.blood_pressure_diastolic is not None
                    )
                    else None
                ),
                "blood_pressure_systolic": v.blood_pressure_systolic,
                "blood_pressure_diastolic": v.blood_pressure_diastolic,
                "sp_o2": v.sp_o2,
                "temperature": v.temperature,
                "respiratory_rate": v.respiratory_rate,
                "source": v.source,
                "recorded_at": (
                    v.recorded_at.isoformat()
                    if v.recorded_at
                    else None
                ),
            }
            for v in vitals
        ]
    }


@router.post("/vitals", status_code=status.HTTP_201_CREATED)
def record_patient_vitals(
    request: VitalObservationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    active_emergency = None

    if request.emergency_id is not None:
        active_emergency = db.query(Emergency).filter(
            Emergency.id == request.emergency_id,
            Emergency.user_id == user.id,
            Emergency.status.in_(ACTIVE_EMERGENCY_STATUSES),
        ).first()

        if not active_emergency:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Active emergency not found for this patient",
            )
    else:
        active_emergency = db.query(Emergency).filter(
            Emergency.user_id == user.id,
            Emergency.status.in_(ACTIVE_EMERGENCY_STATUSES),
        ).order_by(desc(Emergency.created_at)).first()

    vital = VitalObservation(
        user_id=user.id,
        emergency_id=(
            active_emergency.id if active_emergency else None
        ),
        heart_rate=request.heart_rate,
        blood_pressure_systolic=request.blood_pressure_systolic,
        blood_pressure_diastolic=request.blood_pressure_diastolic,
        sp_o2=request.sp_o2,
        temperature=request.temperature,
        respiratory_rate=request.respiratory_rate,
        source=request.source or "PATIENT_INPUT",
    )

    try:
        db.add(vital)
        db.commit()
        db.refresh(vital)

        log_audit(
            db,
            action="VITALS_RECORDED",
            resource_type="VitalObservation",
            user=user,
            resource_id=vital.id,
            details=(
                f"HR: {vital.heart_rate}, "
                f"BP: {vital.blood_pressure_systolic}/"
                f"{vital.blood_pressure_diastolic}, "
                f"SpO2: {vital.sp_o2}"
            ),
        )
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save vital observations.",
        )

    return {
        "message": "Vitals logged successfully",
        "vital": {
            "id": vital.id,
            "heart_rate": vital.heart_rate,
            "blood_pressure": (
                f"{vital.blood_pressure_systolic}/"
                f"{vital.blood_pressure_diastolic}"
                if (
                    vital.blood_pressure_systolic is not None
                    and vital.blood_pressure_diastolic is not None
                )
                else None
            ),
            "sp_o2": vital.sp_o2,
            "temperature": vital.temperature,
            "respiratory_rate": vital.respiratory_rate,
            "recorded_at": (
                vital.recorded_at.isoformat()
                if vital.recorded_at
                else None
            ),
        },
    }


@router.get("/hospitals")
def get_nearby_hospitals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    hospitals = db.query(Hospital).all()
    results = []

    for hospital in hospitals:
        resources = db.query(HospitalResource).filter(
            HospitalResource.hospital_id == hospital.id
        ).all()

        results.append({
            "id": hospital.id,
            "name": hospital.name,
            "address": hospital.address,
            "latitude": hospital.latitude,
            "longitude": hospital.longitude,
            "phone": hospital.phone or "0217-2600000",
            "emergency_available": hospital.emergency_available,
            "resources": [
                {
                    "resource_type": resource.resource_type,
                    "total": resource.total_count,
                    "available": max(
                        0,
                        resource.total_count - resource.occupied_count,
                    ),
                }
                for resource in resources
            ],
        })

    return {"hospitals": results}


@router.get("/ambulances")
def get_nearby_ambulances(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    ambulances = db.query(Ambulance).all()

    return {
        "ambulances": [
            {
                "id": ambulance.id,
                "vehicle_number": ambulance.vehicle_number,
                "driver_name": ambulance.driver_name,
                "status": ambulance.status,
            }
            for ambulance in ambulances
        ]
    }


@router.get("/notifications")
def get_patient_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Patient account required")

    notifications = (
        db.query(Notification)
        .filter(
            (Notification.user_id == user.id)
            | (
                Notification.user_id.is_(None)
                & (
                    (Notification.role == "patient")
                    | Notification.role.is_(None)
                )
            )
        )
        .order_by(desc(Notification.created_at))
        .all()
    )
    shared_read_ids = {
        notification_id
        for (notification_id,) in db.query(NotificationRead.notification_id).filter(
            NotificationRead.user_id == user.id,
        ).all()
    }
    serialized_notifications = []
    for notification in notifications:
        is_read = (
            notification.is_read
            if notification.user_id == user.id
            else notification.id in shared_read_ids
        )
        serialized_notifications.append({
            "id": notification.id,
            "title": notification.title,
            "message": notification.message,
            "type": notification.type,
            "is_read": is_read,
            "can_mark_read": True,
            "created_at": (
                notification.created_at.isoformat()
                if notification.created_at
                else None
            ),
        })

    return {
        "unread_count": sum(
            not notification["is_read"]
            for notification in serialized_notifications
        ),
        "notifications": serialized_notifications,
    }


def _require_patient_owner(user: User) -> None:
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Patient account required")


def _family_member_response(member: FamilyMember) -> dict:
    return {
        "id": member.id,
        "full_name": member.full_name,
        "relationship": member.relation,
        "mobile": member.mobile,
        "email": member.email,
        "created_at": member.created_at.isoformat() if member.created_at else None,
    }


@router.get("/family-members")
def get_family_members(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    _require_patient_owner(user)
    members = (
        db.query(FamilyMember)
        .filter(FamilyMember.user_id == user.id)
        .order_by(FamilyMember.full_name, FamilyMember.id)
        .all()
    )
    return {"family_members": [_family_member_response(member) for member in members]}


@router.post("/family-members", status_code=status.HTTP_201_CREATED)
def create_family_member(
    request: FamilyMemberCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    _require_patient_owner(user)
    member = FamilyMember(
        user_id=user.id,
        full_name=request.full_name,
        relation=request.relationship,
        mobile=request.mobile,
        email=str(request.email) if request.email else None,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    log_audit(
        db,
        action="FAMILY_MEMBER_CREATED",
        resource_type="FamilyMember",
        user=user,
        resource_id=member.id,
    )
    return _family_member_response(member)


@router.patch("/family-members/{member_id}")
def update_family_member(
    member_id: int,
    request: FamilyMemberUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    _require_patient_owner(user)
    member = db.query(FamilyMember).filter(
        FamilyMember.id == member_id,
        FamilyMember.user_id == user.id,
    ).first()
    if member is None:
        raise HTTPException(status_code=404, detail="Family member not found")

    updates = request.model_dump(exclude_unset=True)
    if "full_name" in updates:
        member.full_name = updates["full_name"]
    if "relationship" in updates:
        member.relation = updates["relationship"]
    if "mobile" in updates:
        member.mobile = updates["mobile"]
    if "email" in updates:
        member.email = str(updates["email"]) if updates["email"] else None

    db.commit()
    db.refresh(member)
    log_audit(
        db,
        action="FAMILY_MEMBER_UPDATED",
        resource_type="FamilyMember",
        user=user,
        resource_id=member.id,
    )
    return _family_member_response(member)


@router.delete("/family-members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_family_member(
    member_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    _require_patient_owner(user)
    member = db.query(FamilyMember).filter(
        FamilyMember.id == member_id,
        FamilyMember.user_id == user.id,
    ).first()
    if member is None:
        raise HTTPException(status_code=404, detail="Family member not found")

    member_id_value = member.id
    db.delete(member)
    db.commit()
    log_audit(
        db,
        action="FAMILY_MEMBER_DELETED",
        resource_type="FamilyMember",
        user=user,
        resource_id=member_id_value,
    )
    return None


@router.patch("/notifications/{notification_id}/read")
def mark_patient_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    _require_patient_owner(user)
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        (
            (Notification.user_id == user.id)
            | (
                Notification.user_id.is_(None)
                & (
                    (Notification.role == "patient")
                    | Notification.role.is_(None)
                )
            )
        ),
    ).first()
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notification.user_id == user.id:
        notification.is_read = True
    else:
        read_state = db.query(NotificationRead).filter(
            NotificationRead.user_id == user.id,
            NotificationRead.notification_id == notification.id,
        ).first()
        if read_state is None:
            db.add(NotificationRead(
                user_id=user.id,
                notification_id=notification.id,
            ))
    db.commit()
    return {"id": notification.id, "is_read": True}


@router.post("/notifications/read-all")
def mark_all_patient_notifications_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    _require_patient_owner(user)
    notifications = db.query(Notification).filter(
        (Notification.user_id == user.id)
        | (
            Notification.user_id.is_(None)
            & (
                (Notification.role == "patient")
                | Notification.role.is_(None)
            )
        )
    ).all()
    shared_read_ids = {
        notification_id
        for (notification_id,) in db.query(NotificationRead.notification_id).filter(
            NotificationRead.user_id == user.id,
        ).all()
    }
    marked_read = 0
    for notification in notifications:
        is_read = (
            notification.is_read
            if notification.user_id == user.id
            else notification.id in shared_read_ids
        )
        if is_read:
            continue
        if notification.user_id == user.id:
            notification.is_read = True
        else:
            db.add(NotificationRead(
                user_id=user.id,
                notification_id=notification.id,
            ))
        marked_read += 1
    db.commit()
    return {"marked_read": marked_read, "unread_count": 0}
