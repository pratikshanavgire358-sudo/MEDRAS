import unittest
import asyncio
from unittest.mock import patch

from fastapi import FastAPI
import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.models.user import User
from app.models.medra_demo import Ambulance, Emergency, EmergencyAction, Hospital, EmergencyAssignment
from app.models.patient_profile import PatientProfile
from app.models.system import AuditLog, Notification
from app.models.vitals import VitalObservation
from app.models.hospital import HospitalPatient, HospitalResource
from app.routes.auth import create_access_token, router as auth_router
from app.routes.patient import router as patient_router
from app.routes.ambulance import router as ambulance_router
from app.routes.admin import router as admin_router
from app.routes.hospital import router as hospital_router


test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSession = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
app = FastAPI()
app.include_router(auth_router)
app.include_router(patient_router)
app.include_router(ambulance_router)
app.include_router(admin_router)
app.include_router(hospital_router)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
class InProcessClient:
    def request(self, method, url, **kwargs):
        async def send_request():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
            ) as async_client:
                return await async_client.request(method, url, **kwargs)

        return asyncio.run(send_request())

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def patch(self, url, **kwargs):
        return self.request("PATCH", url, **kwargs)


client = InProcessClient()


class TestEmergencyWorkflow(unittest.TestCase):
    def setUp(self):
        Base.metadata.create_all(bind=test_engine)
        self.db = TestSession()
        self.patient = User(full_name="Test Patient", email="patient@test.invalid", role="patient", is_active=True)
        self.driver = User(
            full_name="Test Driver",
            email="driver@test.invalid",
            role="ambulance",
            ambulance_subrole="EC_DRIVER",
            is_active=True,
        )
        self.doctor = User(
            full_name="Test Doctor",
            email="doctor@test.invalid",
            role="ambulance",
            ambulance_subrole="EV_DOCTOR",
            is_active=True,
        )
        self.hospital_staff = User(
            full_name="Test Hospital Staff",
            email="hospital@test.invalid",
            role="hospital",
            is_active=True,
        )
        self.admin = User(full_name="Test Admin", email="admin@test.invalid", role="admin", is_active=True)
        self.db.add_all([self.patient, self.driver, self.doctor, self.hospital_staff, self.admin])
        self.db.flush()
        self.ambulance = Ambulance(
            vehicle_number="TEST-AMB-1",
            driver_name=self.driver.full_name,
            driver_user_id=self.driver.id,
            latitude=17.0,
            longitude=75.0,
            status="AVAILABLE",
        )
        self.db.add(self.ambulance)
        self.db.flush()
        self.driver.ambulance_id = self.ambulance.id
        self.doctor.ambulance_id = self.ambulance.id
        self.hospital = Hospital(
            name="Test Hospital",
            address="Test Address",
            latitude=17.1,
            longitude=75.1,
            emergency_available=True,
        )
        self.db.add(self.hospital)
        self.db.flush()
        self.hospital_staff.hospital_id = self.hospital.id
        self.db.commit()
        self.patient_headers = self.headers(self.patient)
        self.driver_headers = self.headers(self.driver)
        self.doctor_headers = self.headers(self.doctor)
        self.hospital_headers = self.headers(self.hospital_staff)
        self.admin_headers = self.headers(self.admin)

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=test_engine)

    @staticmethod
    def headers(user):
        return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}

    def create_sos(self, description="Patient needs emergency assistance"):
        return client.post(
            "/api/patient/emergency",
            headers=self.patient_headers,
            json={
                "emergency_type": "Medical emergency",
                "description": description,
                "latitude": 17.2,
                "longitude": 75.2,
                "idempotency_key": "3a6d0c07-8f83-4aa2-91ba-86420aaf3320",
            },
        )

    def test_sos_is_persisted_and_patient_status_reads_same_record(self):
        response = self.create_sos()
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["status"], "REQUESTED")
        self.assertIsNone(payload["ambulance"])
        self.assertTrue(payload["reference"].startswith("MEDRA-EMG-"))

        listing = client.get("/api/patient/emergencies", headers=self.patient_headers)
        emergency = listing.json()["emergencies"][0]
        self.assertEqual(emergency["id"], payload["emergency_id"])
        self.assertEqual(emergency["reference"], payload["reference"])
        self.assertEqual(emergency["status"], "REQUESTED")

        active = client.get("/api/patient/emergencies/active", headers=self.patient_headers)
        self.assertTrue(active.json()["has_active"])
        self.assertEqual(active.json()["emergency"]["id"], payload["emergency_id"])

        retry = self.create_sos()
        self.assertEqual(retry.status_code, 201)
        self.assertEqual(retry.json()["emergency_id"], payload["emergency_id"])
        self.assertEqual(self.db.query(Emergency).count(), 1)

    def test_sos_requires_patient_authorization(self):
        payload = {"emergency_type": "Medical emergency", "description": "Test"}

        unauthenticated = client.post("/api/patient/emergency", json=payload)
        self.assertEqual(unauthenticated.status_code, 401)

        wrong_role = client.post(
            "/api/patient/emergency",
            headers=self.driver_headers,
            json=payload,
        )
        self.assertEqual(wrong_role.status_code, 403)
        self.assertEqual(self.db.query(Emergency).count(), 0)

    def test_sos_rejects_unpaired_coordinates(self):
        response = client.post(
            "/api/patient/emergency",
            headers=self.patient_headers,
            json={
                "emergency_type": "Medical emergency",
                "description": "Test",
                "latitude": 17.2,
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.db.query(Emergency).count(), 0)

    def test_firebase_login_exchanges_verified_identity_for_medra_jwt(self):
        claims = {
            "uid": "firebase-patient-uid",
            "email": self.patient.email,
            "email_verified": True,
        }

        with patch("app.routes.auth.verify_firebase_id_token", return_value=claims):
            response = client.post(
                "/api/auth/firebase",
                json={"firebase_id_token": "test-firebase-token"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["token_type"], "bearer")
        self.assertEqual(payload["user"]["id"], self.patient.id)
        self.db.refresh(self.patient)
        self.assertEqual(self.patient.firebase_uid, claims["uid"])

        protected = client.get(
            "/api/patient/emergencies",
            headers={"Authorization": f"Bearer {payload['access_token']}"},
        )
        self.assertEqual(protected.status_code, 200)

    def test_firebase_login_requires_verified_email_for_account_linking(self):
        claims = {
            "uid": "firebase-unverified-uid",
            "email": self.patient.email,
            "email_verified": False,
        }

        with patch("app.routes.auth.verify_firebase_id_token", return_value=claims):
            response = client.post(
                "/api/auth/firebase",
                json={"firebase_id_token": "test-firebase-token"},
            )

        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.patient.firebase_uid)

    def test_pending_priority_and_rejection_are_persisted(self):
        response = self.create_sos()
        emergency_id = response.json()["emergency_id"]
        pending = client.get("/api/ambulance/emergencies/pending", headers=self.driver_headers)
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json()["emergencies"][0]["id"], emergency_id)
        refreshed = client.get("/api/ambulance/emergencies/pending", headers=self.driver_headers)
        self.assertEqual(refreshed.json()["emergencies"][0]["id"], emergency_id)
        self.assertEqual(self.db.query(Emergency).filter(Emergency.id == emergency_id).one().status, "REQUESTED")

        priority = client.patch(
            f"/api/ambulance/emergencies/{emergency_id}/priority",
            headers=self.driver_headers,
            json={"priority": "CRITICAL"},
        )
        self.assertEqual(priority.status_code, 200)
        self.assertEqual(priority.json()["priority"], "CRITICAL")

        invalid_priority = client.patch(
            f"/api/ambulance/emergencies/{emergency_id}/priority",
            headers=self.driver_headers,
            json={"priority": "URGENT"},
        )
        self.assertEqual(invalid_priority.status_code, 422)

        rejection = client.post(
            f"/api/ambulance/emergencies/{emergency_id}/reject",
            headers=self.driver_headers,
        )
        self.assertEqual(rejection.status_code, 200)
        record = self.db.query(Emergency).filter(Emergency.id == emergency_id).one()
        self.assertEqual(record.status, "REQUESTED")
        self.assertEqual(record.priority, "CRITICAL")
        self.assertIsNone(record.assignment)
        self.assertEqual(
            self.db.query(EmergencyAction).filter(
                EmergencyAction.emergency_id == emergency_id,
                EmergencyAction.action_type == "REJECTED",
            ).count(),
            1,
        )
        self.assertEqual(client.get("/api/patient/emergencies", headers=self.patient_headers).json()["emergencies"][0]["id"], emergency_id)

    def test_acceptance_ownership_and_status_transitions(self):
        emergency_id = self.create_sos().json()["emergency_id"]
        accepted = client.post(
            f"/api/ambulance/emergencies/{emergency_id}/accept",
            headers=self.driver_headers,
        )
        self.assertEqual(accepted.status_code, 200)
        assignment_id = accepted.json()["assignment_id"]
        self.assertEqual(accepted.json()["status"], "ACCEPTED")
        self.assertIsNone(self.db.query(EmergencyAssignment).filter(
            EmergencyAssignment.id == assignment_id
        ).one().hospital_id)

        duplicate = client.post(
            f"/api/ambulance/emergencies/{emergency_id}/accept",
            headers=self.driver_headers,
        )
        self.assertEqual(duplicate.status_code, 409)

        other_driver = User(
            full_name="Other Driver",
            email="other-driver@test.invalid",
            role="ambulance",
            ambulance_subrole="EC_DRIVER",
            is_active=True,
        )
        self.db.add(other_driver)
        self.db.flush()
        other_ambulance = Ambulance(
            vehicle_number="TEST-AMB-2",
            driver_name=other_driver.full_name,
            driver_user_id=other_driver.id,
            latitude=17.3,
            longitude=75.3,
            status="AVAILABLE",
        )
        self.db.add(other_ambulance)
        self.db.flush()
        other_driver.ambulance_id = other_ambulance.id
        self.db.commit()
        unauthorized_change = client.patch(
            f"/api/ambulance/assignment/{assignment_id}/status",
            headers=self.headers(other_driver),
            json={"status": "EN_ROUTE"},
        )
        self.assertEqual(unauthorized_change.status_code, 404)

        select_hospital = client.patch(
            f"/api/ambulance/assignment/{assignment_id}/hospital",
            headers=self.driver_headers,
            json={"hospital_id": self.hospital.id},
        )
        self.assertEqual(select_hospital.status_code, 200)
        self.assertEqual(select_hospital.json()["hospital_id"], self.hospital.id)

        other_hospital = Hospital(
            name="Other Hospital",
            address="Other Address",
            latitude=16.9,
            longitude=74.9,
            emergency_available=True,
        )
        other_staff = User(
            full_name="Other Hospital Staff",
            email="other-hospital@test.invalid",
            role="hospital",
            is_active=True,
        )
        self.db.add_all([other_hospital, other_staff])
        self.db.flush()
        other_staff.hospital_id = other_hospital.id
        self.db.commit()
        other_hospital_response = client.get(
            "/api/hospital/emergencies",
            headers=self.headers(other_staff),
        )
        self.assertEqual(other_hospital_response.status_code, 200)
        self.assertEqual(other_hospital_response.json()["total"], 0)

        for new_status, expected_status in [
            ("EN_ROUTE", "EN_ROUTE"),
            ("PATIENT_PICKED_UP", "HOSPITAL_SELECTED"),
        ]:
            changed = client.patch(
                f"/api/ambulance/assignment/{assignment_id}/status",
                headers=self.driver_headers,
                json={"status": new_status},
            )
            self.assertEqual(changed.status_code, 200)
            patient_status = client.get("/api/patient/emergencies", headers=self.patient_headers).json()["emergencies"][0]["status"]
            self.assertEqual(patient_status, expected_status)

        incoming = client.get("/api/hospital/emergencies", headers=self.hospital_headers)
        self.assertEqual(incoming.status_code, 200)
        self.assertEqual(incoming.json()["total"], 1)
        self.assertEqual(incoming.json()["emergencies"][0]["status"], "HOSPITAL_SELECTED")

        hospital_accepted = client.patch(
            f"/api/hospital/emergencies/{emergency_id}/status",
            headers=self.hospital_headers,
            json={"status": "HOSPITAL_ACCEPTED"},
        )
        self.assertEqual(hospital_accepted.status_code, 200)

        for new_status in ["HOSPITAL_ARRIVED"]:
            changed = client.patch(
                f"/api/ambulance/assignment/{assignment_id}/status",
                headers=self.driver_headers,
                json={"status": new_status},
            )
            self.assertEqual(changed.status_code, 200)

        received = client.patch(
            f"/api/hospital/emergencies/{emergency_id}/status",
            headers=self.hospital_headers,
            json={"status": "HOSPITAL_RECEIVED"},
        )
        self.assertEqual(received.status_code, 200)

        changed = client.patch(
            f"/api/ambulance/assignment/{assignment_id}/status",
            headers=self.driver_headers,
            json={"status": "RESOLVED"},
        )
        self.assertEqual(changed.status_code, 200)

        patient_status = client.get("/api/patient/emergencies", headers=self.patient_headers).json()["emergencies"][0]["status"]
        self.assertEqual(patient_status, "RESOLVED")
        latest = client.get("/api/patient/emergencies/active", headers=self.patient_headers).json()
        self.assertFalse(latest["has_active"])
        self.assertEqual(latest["emergency"]["status"], "RESOLVED")

        assignment = self.db.query(EmergencyAssignment).filter(EmergencyAssignment.id == assignment_id).one()
        self.assertEqual(assignment.status, "RESOLVED")
        self.assertEqual(assignment.ambulance.status, "AVAILABLE")

    def test_active_ambulance_location_is_updated_and_authorized(self):
        emergency_id = self.create_sos().json()["emergency_id"]
        accepted = client.post(
            f"/api/ambulance/emergencies/{emergency_id}/accept",
            headers=self.driver_headers,
        )
        self.assertEqual(accepted.status_code, 200)

        location = client.patch(
            "/api/ambulance/location",
            headers=self.driver_headers,
            json={"latitude": 17.25, "longitude": 75.25},
        )
        self.assertEqual(location.status_code, 200)
        active = client.get("/api/patient/emergencies/active", headers=self.patient_headers).json()["emergency"]
        self.assertEqual(active["ambulance"]["latitude"], 17.25)
        self.assertIsNotNone(active["ambulance_location_updated_at"])

        invalid = client.patch(
            "/api/ambulance/location",
            headers=self.driver_headers,
            json={"latitude": 91, "longitude": 75},
        )
        self.assertEqual(invalid.status_code, 422)

    def test_doctor_only_sees_assigned_emergency_and_can_save_assessment(self):
        emergency_id = self.create_sos().json()["emergency_id"]
        accepted = client.post(
            f"/api/ambulance/emergencies/{emergency_id}/accept",
            headers=self.driver_headers,
        )
        self.assertEqual(accepted.status_code, 200)
        client.post(
            "/api/patient/vitals",
            headers=self.patient_headers,
            json={"emergency_id": emergency_id, "heart_rate": 90, "sp_o2": 97},
        )

        assigned = client.get("/api/ambulance/doctor/emergencies", headers=self.doctor_headers)
        self.assertEqual(assigned.status_code, 200)
        cases = assigned.json()["emergencies"]
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["emergency_id"], emergency_id)
        self.assertEqual(cases[0]["vitals"][0]["heart_rate"], 90)
        self.assertNotIn("patient_phone", cases[0])
        self.assertNotIn("email", cases[0])

        assessment = client.post(
            f"/api/ambulance/doctor/emergencies/{emergency_id}/assessment",
            headers=self.doctor_headers,
            json={"notes": "Patient assessed; continue monitoring.", "priority": "HIGH", "next_step": "Continue monitoring"},
        )
        self.assertEqual(assessment.status_code, 201)
        refreshed = client.get("/api/ambulance/doctor/emergencies", headers=self.doctor_headers).json()["emergencies"][0]
        self.assertEqual(refreshed["priority"], "HIGH")
        self.assertEqual(refreshed["assessments"][0]["notes"], "Patient assessed; continue monitoring.")

    def test_assignment_requires_authenticated_assigned_driver(self):
        emergency_id = self.create_sos().json()["emergency_id"]
        missing_subrole = User(full_name="Unassigned", email="unassigned@test.invalid", role="ambulance", is_active=True)
        self.db.add(missing_subrole)
        self.db.commit()
        headers = self.headers(missing_subrole)
        response = client.get("/api/ambulance/emergencies/pending", headers=headers)
        self.assertEqual(response.status_code, 403)

        unauthenticated = client.get("/api/ambulance/emergencies/pending")
        self.assertEqual(unauthenticated.status_code, 401)
        self.assertGreater(emergency_id, 0)


if __name__ == "__main__":
    unittest.main()
