from datetime import datetime, date, timezone
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.models.medra_demo import (
    DemoMedicalRecord,
    Ambulance,
    Hospital,
    Emergency,
    EmergencyAssignment,
)
from app.models.hospital import HospitalPatient, HospitalResource
from app.models.vitals import VitalObservation
from app.models.system import Notification, AuditLog

hasher = PasswordHash.recommended()


def get_or_create_user(db: Session, full_name: str, email: str, role: str, mobile: str) -> User:
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            full_name=full_name,
            email=email,
            mobile=mobile,
            password_hash=hasher.hash("Password@123"),
            role=role,
            is_active=True
        )
        db.add(user)
        db.flush()

        if role == "patient":
            profile = PatientProfile(
                user_id=user.id,
                date_of_birth=date(1992, 5, 14),
                gender="Male",
                blood_group="O+",
                address="Near Civil Lines, Solapur 413001",
                emergency_contact_name="Sunita Sharma",
                emergency_contact_mobile="9876543211",
                abha_linked=False,
            )
            db.add(profile)
        db.commit()
        db.refresh(user)
        print(f"Created demo {role} user: {email} / Password@123")
    else:
        # Ensure password is reset to known demo credentials for Avishkar demo
        user.password_hash = hasher.hash("Password@123")
        user.role = role
        db.commit()
        print(f"Updated demo credentials for {email} / Password@123")
    return user


def seed_demo_data():
    db: Session = SessionLocal()

    try:
        # 1. Standard Demo Accounts for Judges / Avishkar Presentation
        patient = get_or_create_user(db, "Rajesh Sharma", "patient@medra.org", "patient", "9876543210")
        hospital_user = get_or_create_user(db, "Dr. Ramesh Kulkarni (ER Head)", "hospital@medra.org", "hospital", "9876543220")
        ambulance_user = get_or_create_user(db, "Vikas Jadhav (Paramedic Driver)", "ambulance@medra.org", "ambulance", "9876543230")
        admin_user = get_or_create_user(db, "MEDRA Master Administrator", "admin@medra.org", "admin", "9876543240")

        # 2. Demo Hospitals
        hosp1 = db.query(Hospital).filter(Hospital.name == "Solapur District Trauma & Medical Center").first()
        if not hosp1:
            hosp1 = Hospital(
                name="Solapur District Trauma & Medical Center",
                address="Near Civil Court, Solapur, Maharashtra 413003",
                latitude=17.6625,
                longitude=75.9110,
                phone="0217-2624500",
                email="er@solapurhospital.gov.in",
                emergency_available=True,
            )
            db.add(hosp1)
            db.flush()

        hosp2 = db.query(Hospital).filter(Hospital.name == "Ashwini Sahakari Rugnalaya").first()
        if not hosp2:
            hosp2 = Hospital(
                name="Ashwini Sahakari Rugnalaya",
                address="North Sadar Bazar, Solapur 413003",
                latitude=17.6710,
                longitude=75.9080,
                phone="0217-2319900",
                email="info@ashwinihospital.com",
                emergency_available=True,
            )
            db.add(hosp2)
            db.flush()

        hospital_user.hospital_id = hosp1.id

        # 3. Demo Ambulances
        amb1 = db.query(Ambulance).filter(Ambulance.vehicle_number == "MH-13-EM-108").first()
        if not amb1:
            amb1 = Ambulance(
                vehicle_number="MH-13-EM-108",
                driver_name=ambulance_user.full_name,
                driver_user_id=ambulance_user.id,
                latitude=17.6586,
                longitude=75.9046,
                status="AVAILABLE"
            )
            db.add(amb1)
            db.flush()
        else:
            amb1.driver_user_id = ambulance_user.id

        ambulance_user.ambulance_subrole = "EC_DRIVER"
        ambulance_user.ambulance_id = amb1.id

        # 4. Hospital Resources
        if db.query(HospitalResource).count() == 0:
            db.add_all([
                HospitalResource(hospital_id=hosp1.id, resource_type="ICU Bed", total_count=12, occupied_count=8),
                HospitalResource(hospital_id=hosp1.id, resource_type="Emergency Bed", total_count=20, occupied_count=14),
                HospitalResource(hospital_id=hosp1.id, resource_type="Oxygen Unit", total_count=30, occupied_count=15),
                HospitalResource(hospital_id=hosp1.id, resource_type="Ventilator", total_count=10, occupied_count=6),
                HospitalResource(hospital_id=hosp1.id, resource_type="General Ward Bed", total_count=50, occupied_count=32),
            ])
            print("Hospital resources seeded.")

        # 5. Hospital Patients
        if db.query(HospitalPatient).count() == 0:
            db.add_all([
                HospitalPatient(
                    hospital_id=hosp1.id,
                    first_name="Anand",
                    last_name="Deshmukh",
                    date_of_birth=date(1985, 4, 12),
                    gender="Male",
                    phone="9823011223",
                    email="anand.deshmukh@example.com",
                    arrival_type="Emergency",
                    arrival_method="Ambulance",
                    arrival_date=str(date.today()),
                    arrival_time="14:30",
                    priority="Critical",
                    referral_source="Highway Accident Site",
                    notes="Acute chest trauma, vital stabilization in progress.",
                    verification_status="Verified",
                    status="Admitted",
                ),
                HospitalPatient(
                    hospital_id=hosp1.id,
                    first_name="Pooja",
                    last_name="Patil",
                    date_of_birth=date(1996, 11, 23),
                    gender="Female",
                    phone="9422055667",
                    email="pooja.patil@example.com",
                    arrival_type="Emergency",
                    arrival_method="Self / Private",
                    arrival_date=str(date.today()),
                    arrival_time="15:10",
                    priority="High",
                    referral_source="Clinic Referral",
                    notes="Severe respiratory distress and high fever.",
                    verification_status="Pending review",
                    status="Under Triage",
                ),
                HospitalPatient(
                    hospital_id=hosp1.id,
                    first_name="Suresh",
                    last_name="Kadam",
                    date_of_birth=date(1968, 8, 5),
                    gender="Male",
                    phone="9890123456",
                    email="suresh.kadam@example.com",
                    arrival_type="Routine",
                    arrival_method="Walk-in",
                    arrival_date=str(date.today()),
                    arrival_time="10:00",
                    priority="Medium",
                    referral_source="OPD Registration",
                    notes="Post-operative checkup and hypertension review.",
                    verification_status="Verified",
                    status="Registered",
                ),
            ])
            print("Hospital patients seeded.")

        # 6. Patient Vitals
        if db.query(VitalObservation).filter(VitalObservation.user_id == patient.id).count() == 0:
            db.add_all([
                VitalObservation(
                    user_id=patient.id,
                    heart_rate=76,
                    blood_pressure_systolic=120,
                    blood_pressure_diastolic=80,
                    sp_o2=98,
                    temperature=36.8,
                    respiratory_rate=16,
                    source="DEVICE_SIMULATOR"
                ),
                VitalObservation(
                    user_id=patient.id,
                    heart_rate=82,
                    blood_pressure_systolic=124,
                    blood_pressure_diastolic=82,
                    sp_o2=97,
                    temperature=37.0,
                    respiratory_rate=17,
                    source="PATIENT_INPUT"
                )
            ])
            print("Vitals observations seeded.")

        # 7. Demo Medical Records
        if db.query(DemoMedicalRecord).filter(DemoMedicalRecord.user_id == patient.id).count() == 0:
            db.add_all([
                DemoMedicalRecord(
                    user_id=patient.id,
                    record_type="Prescription",
                    provider_name=hosp1.name,
                    record_date=datetime.now(timezone.utc),
                    summary="Tab Paracetamol 650mg SOS, Tab Amoxicillin 500mg TDS x 5 days. For acute pharyngitis.",
                    data_source="MOCK_DATA"
                ),
                DemoMedicalRecord(
                    user_id=patient.id,
                    record_type="Diagnostic Report",
                    provider_name="Solapur Clinical Diagnostics",
                    record_date=datetime.now(timezone.utc),
                    summary="CBC with Differential: Hb 14.2 g/dL, Platelets 240,000 /mcL, TLC 7,800 /mcL. Normal range.",
                    data_source="MOCK_DATA"
                )
            ])
            print("Demo medical records seeded.")

        # 8. Notifications
        if db.query(Notification).count() == 0:
            db.add_all([
                Notification(
                    user_id=patient.id,
                    role="patient",
                    title="Welcome to MEDRA",
                    message="Your patient portal account is configured for rapid emergency response.",
                    type="INFO"
                ),
                Notification(
                    user_id=hospital_user.id,
                    role="hospital",
                    title="Hospital Trauma System Active",
                    message="ER resource synchronization and ambulance tracking are active.",
                    type="INFO"
                )
            ])

        db.commit()
        print("MEDRA database seed complete.")

    except Exception as e:
        db.rollback()
        print(f"Error seeding data: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo_data()