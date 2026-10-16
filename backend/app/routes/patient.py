from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.core.database import get_db
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.models.medra_demo import DemoMedicalRecord, Emergency, Ambulance, Hospital, EmergencyAssignment
from app.models.vitals import VitalObservation
from app.models.hospital import HospitalResource
from app.models.system import Notification
from app.schemas.patient_profile import PatientProfileUpdate
from app.schemas.patient_ops import EmergencyCreateRequest, VitalObservationCreate
from app.core.dependencies import get_current_patient, log_audit

router = APIRouter(
    prefix="/api/patient",
    tags=["Patient Portal"]
)


def get_or_create_profile(db: Session, user_id: int) -> PatientProfile:
    profile = db.query(PatientProfile).filter(PatientProfile.user_id == user_id).first()
    if profile is None:
        profile = PatientProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


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
        "date_of_birth": profile.date_of_birth.isoformat() if profile.date_of_birth else None,
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
        log_audit(db, action="PATIENT_PROFILE_UPDATED", resource_type="PatientProfile", user=user, resource_id=profile.id)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Unable to save patient profile: {str(e)}",
        )

    return {
        "message": "Patient profile updated successfully",
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "mobile": user.mobile,
        "role": user.role,
        "date_of_birth": profile.date_of_birth.isoformat() if profile.date_of_birth else None,
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
    # Default coordinates fallback to Solapur center if not provided
    lat = request.latitude if request.latitude is not None else 17.6599
    lng = request.longitude if request.longitude is not None else 75.9064

    emergency = Emergency(
        user_id=user.id,
        emergency_type=request.emergency_type,
        description=request.description or f"Emergency SOS initiated by {user.full_name}",
        latitude=lat,
        longitude=lng,
        status="ASSIGNED",
    )
    db.add(emergency)
    db.flush()

    # Find available ambulance
    ambulance = db.query(Ambulance).filter(Ambulance.status == "AVAILABLE").first()
    if not ambulance:
        ambulance = db.query(Ambulance).first()

    # Find nearest available hospital
    hospital = db.query(Hospital).filter(Hospital.emergency_available.is_(True)).first()
    if not hospital:
        hospital = db.query(Hospital).first()

    assignment = None
    if ambulance and hospital:
        assignment = EmergencyAssignment(
            emergency_id=emergency.id,
            ambulance_id=ambulance.id,
            hospital_id=hospital.id,
            status="ASSIGNED",
            notes=f"Auto-assigned to {ambulance.vehicle_number} and {hospital.name}"
        )
        db.add(assignment)
        ambulance.status = "DISPATCHED"

    # Create notifications
    notif = Notification(
        user_id=user.id,
        role="patient",
        title="Emergency Request Dispatched",
        message=f"Emergency SOS #{emergency.id} received. Ambulance {ambulance.vehicle_number if ambulance else 'Pending'} assigned.",
        type="EMERGENCY"
    )
    db.add(notif)

    # Hospital alert
    hospital_notif = Notification(
        role="hospital",
        title="Incoming Emergency Arrival",
        message=f"Critical emergency #{emergency.id} ({request.emergency_type}) heading to destination.",
        type="EMERGENCY"
    )
    db.add(hospital_notif)

    db.commit()
    db.refresh(emergency)

    log_audit(
        db,
        action="EMERGENCY_CREATED",
        resource_type="Emergency",
        user=user,
        resource_id=emergency.id,
        details=f"Type: {emergency.emergency_type}, Lat: {lat}, Lng: {lng}"
    )

    return {
        "message": "Emergency SOS registered and dispatched successfully",
        "emergency_id": emergency.id,
        "reference": f"MEDRA-EMG-{emergency.id:04d}",
        "status": emergency.status,
        "type": emergency.emergency_type,
        "ambulance": {
            "id": ambulance.id,
            "vehicle_number": ambulance.vehicle_number,
            "driver_name": ambulance.driver_name,
            "latitude": ambulance.latitude,
            "longitude": ambulance.longitude,
            "status": ambulance.status,
        } if ambulance else None,
        "hospital": {
            "id": hospital.id,
            "name": hospital.name,
            "address": hospital.address,
            "latitude": hospital.latitude,
            "longitude": hospital.longitude,
        } if hospital else None,
        "created_at": emergency.created_at.isoformat() if emergency.created_at else None
    }


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
            "latitude": emg.latitude,
            "longitude": emg.longitude,
            "created_at": emg.created_at.isoformat() if emg.created_at else None,
            "ambulance": {
                "vehicle_number": assignment.ambulance.vehicle_number,
                "driver_name": assignment.ambulance.driver_name,
                "status": assignment.ambulance.status,
            } if assignment and assignment.ambulance else None,
            "hospital": {
                "name": assignment.hospital.name,
                "address": assignment.hospital.address,
            } if assignment and assignment.hospital else None,
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
            Emergency.status.in_(["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRIAGED"])
        )
        .order_by(desc(Emergency.created_at))
        .first()
    )

    if not emergency:
        return {"has_active": False, "emergency": None}

    assignment = emergency.assignment
    return {
        "has_active": True,
        "emergency": {
            "id": emergency.id,
            "reference": f"MEDRA-EMG-{emergency.id:04d}",
            "emergency_type": emergency.emergency_type,
            "description": emergency.description,
            "status": emergency.status,
            "latitude": emergency.latitude,
            "longitude": emergency.longitude,
            "created_at": emergency.created_at.isoformat() if emergency.created_at else None,
            "ambulance": {
                "id": assignment.ambulance.id,
                "vehicle_number": assignment.ambulance.vehicle_number,
                "driver_name": assignment.ambulance.driver_name,
                "latitude": assignment.ambulance.latitude,
                "longitude": assignment.ambulance.longitude,
                "status": assignment.ambulance.status,
            } if assignment and assignment.ambulance else None,
            "hospital": {
                "id": assignment.hospital.id,
                "name": assignment.hospital.name,
                "address": assignment.hospital.address,
                "latitude": assignment.hospital.latitude,
                "longitude": assignment.hospital.longitude,
            } if assignment and assignment.hospital else None,
        }
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
        "notice": "Official ABDM/ABHA repository integration requires certified sandbox credentials. Synthetic demonstration records are labelled MOCK_DATA.",
        "records": [
            {
                "id": record.id,
                "record_type": record.record_type,
                "provider_name": record.provider_name,
                "record_date": record.record_date.isoformat() if record.record_date else None,
                "summary": record.summary,
                "data_source": record.data_source,
            }
            for record in records
        ]
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
                "blood_pressure": f"{v.blood_pressure_systolic}/{v.blood_pressure_diastolic}" if v.blood_pressure_systolic and v.blood_pressure_diastolic else None,
                "blood_pressure_systolic": v.blood_pressure_systolic,
                "blood_pressure_diastolic": v.blood_pressure_diastolic,
                "sp_o2": v.sp_o2,
                "temperature": v.temperature,
                "respiratory_rate": v.respiratory_rate,
                "source": v.source,
                "recorded_at": v.recorded_at.isoformat() if v.recorded_at else None,
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
    vital = VitalObservation(
        user_id=user.id,
        heart_rate=request.heart_rate,
        blood_pressure_systolic=request.blood_pressure_systolic,
        blood_pressure_diastolic=request.blood_pressure_diastolic,
        sp_o2=request.sp_o2,
        temperature=request.temperature,
        respiratory_rate=request.respiratory_rate,
        source=request.source or "PATIENT_INPUT",
    )

    db.add(vital)
    db.commit()
    db.refresh(vital)

    log_audit(
        db,
        action="VITALS_RECORDED",
        resource_type="VitalObservation",
        user=user,
        resource_id=vital.id,
        details=f"HR: {vital.heart_rate}, BP: {vital.blood_pressure_systolic}/{vital.blood_pressure_diastolic}, SpO2: {vital.sp_o2}"
    )

    return {
        "message": "Vitals logged successfully",
        "vital": {
            "id": vital.id,
            "heart_rate": vital.heart_rate,
            "blood_pressure": f"{vital.blood_pressure_systolic}/{vital.blood_pressure_diastolic}" if vital.blood_pressure_systolic else None,
            "sp_o2": vital.sp_o2,
            "temperature": vital.temperature,
            "respiratory_rate": vital.respiratory_rate,
            "recorded_at": vital.recorded_at.isoformat() if vital.recorded_at else None,
        }
    }


@router.get("/hospitals")
def get_nearby_hospitals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    hospitals = db.query(Hospital).all()
    results = []

    for h in hospitals:
        resources = db.query(HospitalResource).filter(HospitalResource.hospital_id == h.id).all()
        results.append({
            "id": h.id,
            "name": h.name,
            "address": h.address,
            "latitude": h.latitude,
            "longitude": h.longitude,
            "phone": h.phone or "0217-2600000",
            "emergency_available": h.emergency_available,
            "resources": [
                {
                    "resource_type": r.resource_type,
                    "total": r.total_count,
                    "available": max(0, r.total_count - r.occupied_count)
                }
                for r in resources
            ]
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
                "id": a.id,
                "vehicle_number": a.vehicle_number,
                "driver_name": a.driver_name,
                "latitude": a.latitude,
                "longitude": a.longitude,
                "status": a.status,
            }
            for a in ambulances
        ]
    }


@router.get("/notifications")
def get_patient_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_patient),
):
    notifs = (
        db.query(Notification)
        .filter((Notification.user_id == user.id) | (Notification.role == "patient") | (Notification.role.is_(None)))
        .order_by(desc(Notification.created_at))
        .limit(15)
        .all()
    )

    return {
        "notifications": [
            {
                "id": n.id,
                "title": n.title,
                "message": n.message,
                "type": n.type,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in notifs
        ]
    }
