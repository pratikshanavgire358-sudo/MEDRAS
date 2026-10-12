from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.user import User
from app.models.medra_demo import (
    DemoMedicalRecord,
    Ambulance,
    Hospital,
)


def seed_demo_data():
    db: Session = SessionLocal()

    try:
        # Use existing patient accounts.
        patients = (
            db.query(User)
            .filter(User.role == "patient")
            .order_by(User.id)
            .limit(2)
            .all()
        )

        if not patients:
            print(
                "No patient accounts found. "
                "Register a patient before seeding demo records."
            )
            return

        # Add medical records only if a patient has none.
        for patient in patients:
            existing = (
                db.query(DemoMedicalRecord)
                .filter(DemoMedicalRecord.user_id == patient.id)
                .first()
            )

            if existing:
                continue

            db.add_all([
                DemoMedicalRecord(
                    user_id=patient.id,
                    record_type="Prescription",
                    provider_name="DEMO Hospital",
                    record_date=datetime.now(timezone.utc),
                    summary=(
                        "Synthetic prescription record "
                        "for application testing. Not real medical advice."
                    ),
                    data_source="MOCK_DATA",
                ),
                DemoMedicalRecord(
                    user_id=patient.id,
                    record_type="Diagnostic Report",
                    provider_name="DEMO Diagnostic Centre",
                    record_date=datetime.now(timezone.utc),
                    summary=(
                        "Synthetic diagnostic record. "
                        "Contains no real patient results."
                    ),
                    data_source="MOCK_DATA",
                ),
            ])

        # Use fictional, clearly marked demo resources.
        if db.query(Ambulance).count() == 0:
            db.add_all([
                Ambulance(
                    vehicle_number="DEMO-AMB-001",
                    driver_name="Demo Driver One",
                    latitude=17.6599,
                    longitude=75.9064,
                    status="AVAILABLE",
                ),
                Ambulance(
                    vehicle_number="DEMO-AMB-002",
                    driver_name="Demo Driver Two",
                    latitude=17.6700,
                    longitude=75.9100,
                    status="AVAILABLE",
                ),
            ])

        if db.query(Hospital).count() == 0:
            db.add_all([
                Hospital(
                    name="DEMO Hospital One",
                    address="Demo Location, Solapur",
                    latitude=17.6599,
                    longitude=75.9064,
                    emergency_available=True,
                ),
                Hospital(
                    name="DEMO Hospital Two",
                    address="Demo Location, Solapur",
                    latitude=17.6700,
                    longitude=75.9100,
                    emergency_available=True,
                ),
            ])

        db.commit()

        print("MEDRAS demo dataset created successfully.")

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    seed_demo_data()