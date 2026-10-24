import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import database
from app.core.database import Base, get_db
from app.core.security import hash_password
from app.models.hospital import HospitalResource
from app.models.medra_demo import Ambulance, Hospital
from app.models.patient_profile import PatientProfile
from app.models.system import AuditLog
from app.models.user import User
import app.main as main_module
from app.main import app


test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
database.engine = test_engine
database.SessionLocal.configure(bind=test_engine)
main_module.engine = test_engine

TestSession = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


class TestMedraAPI(unittest.TestCase):

    # =========================================================
    # TEST SETUP: AUTHENTICATE DEMO ACCOUNTS
    # =========================================================

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Base.metadata.create_all(bind=test_engine)
        cls._create_test_data()

        cls.patient_token = cls._get_token(
            "patient@medra.org", "patient"
        )
        cls.patient_headers = {
            "Authorization": f"Bearer {cls.patient_token}"
        }

        cls.hospital_token = cls._get_token(
            "hospital@medra.org", "hospital"
        )
        cls.hospital_headers = {
            "Authorization": f"Bearer {cls.hospital_token}"
        }

        cls.ambulance_token = cls._get_token(
            "ambulance@medra.org", "ambulance"
        )
        cls.ambulance_headers = {
            "Authorization": f"Bearer {cls.ambulance_token}"
        }

        cls.admin_token = cls._get_token(
            "admin@medra.org", "admin"
        )
        cls.admin_headers = {
            "Authorization": f"Bearer {cls.admin_token}"
        }

    @classmethod
    def _get_token(cls, email, role):
        """Authenticate a demo account and return its access token."""

        response = client.post(
            "/api/auth/login",
            json={
                "email": email,
                "password": "Password@123"
            }
        )

        # Display the actual login error if authentication fails.
        if response.status_code != 200:
            raise AssertionError(
                f"\n{role.upper()} LOGIN FAILED"
                f"\nEmail: {email}"
                f"\nHTTP Status: {response.status_code}"
                f"\nResponse: {response.text}"
                "\nCheck the demo account, password, database "
                "configuration, and backend logs."
            )

        try:
            data = response.json()
        except ValueError as exc:
            raise AssertionError(
                f"{role.upper()} login returned invalid JSON: "
                f"{response.text}"
            ) from exc

        token = data.get("access_token")

        if not token:
            raise AssertionError(
                f"{role.upper()} login response has no access_token."
                f"\nResponse: {response.text}"
            )

        return token

    @classmethod
    def _get_or_create_user(cls, db, full_name, email, mobile, role):
        user = db.query(User).filter(User.email == email).one_or_none()
        if user is None:
            user = User(email=email)
            db.add(user)

        user.full_name = full_name
        user.mobile = mobile
        user.password_hash = hash_password("Password@123")
        user.role = role
        user.is_active = True
        db.flush()
        return user

    @classmethod
    def _create_test_data(cls):
        with TestSession() as db:
            hospital = db.query(Hospital).filter(
                Hospital.name == "MEDRA API Test Hospital"
            ).one_or_none()
            if hospital is None:
                hospital = Hospital(
                    name="MEDRA API Test Hospital",
                    address="1 Test Road",
                    latitude=17.6625,
                    longitude=75.9110,
                    phone="0000000000",
                    email="hospital.test@medra.org",
                    emergency_available=True,
                )
                db.add(hospital)
                db.flush()

            patient = cls._get_or_create_user(
                db,
                "Rajesh Sharma",
                "patient@medra.org",
                "9000000001",
                "patient",
            )
            hospital_user = cls._get_or_create_user(
                db,
                "MEDRA Test Hospital Staff",
                "hospital@medra.org",
                "9000000002",
                "hospital",
            )
            ambulance_user = cls._get_or_create_user(
                db,
                "MEDRA Test Ambulance Crew",
                "ambulance@medra.org",
                "9000000003",
                "ambulance",
            )
            admin_user = cls._get_or_create_user(
                db,
                "MEDRA Test Administrator",
                "admin@medra.org",
                "9000000004",
                "admin",
            )

            profile = db.query(PatientProfile).filter(
                PatientProfile.user_id == patient.id
            ).one_or_none()
            if profile is None:
                profile = PatientProfile(
                    user_id=patient.id,
                    blood_group="O+",
                    emergency_contact_name="Sunita Sharma",
                    emergency_contact_mobile="9000000011",
                )
                db.add(profile)

            hospital_user.hospital_id = hospital.id

            ambulance = db.query(Ambulance).filter(
                Ambulance.vehicle_number == "TEST-AMB-001"
            ).one_or_none()
            if ambulance is None:
                ambulance = Ambulance(
                    vehicle_number="TEST-AMB-001",
                    driver_name=ambulance_user.full_name,
                    driver_user_id=ambulance_user.id,
                    latitude=17.6586,
                    longitude=75.9046,
                    status="AVAILABLE",
                )
                db.add(ambulance)
                db.flush()
            ambulance_user.ambulance_subrole = "EC_DRIVER"
            ambulance_user.ambulance_id = ambulance.id

            resource = db.query(HospitalResource).filter(
                HospitalResource.hospital_id == hospital.id
            ).first()
            if resource is None:
                db.add(
                    HospitalResource(
                        hospital_id=hospital.id,
                        resource_type="Emergency Bed",
                        total_count=20,
                        occupied_count=8,
                    )
                )

            audit_log = db.query(AuditLog).first()
            if audit_log is None:
                db.add(
                    AuditLog(
                        user_id=admin_user.id,
                        user_email=admin_user.email,
                        action="TEST_SETUP",
                        resource_type="User",
                        resource_id=str(admin_user.id),
                        details="Isolated API test fixture",
                    )
                )

            db.commit()

    @classmethod
    def tearDownClass(cls):
        Base.metadata.drop_all(bind=test_engine)
        super().tearDownClass()

    # =========================================================
    # 1. HEALTH CHECKS
    # =========================================================

    def test_01_health_check(self):
        response = client.get("/api/health")

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["database"], "connected")
        with test_engine.connect() as connection:
            sqlite_version = connection.exec_driver_sql(
                "SELECT sqlite_version()"
            ).scalar_one()
        self.assertEqual(data["database_version"], sqlite_version)

    def test_02_auth_health(self):
        response = client.get("/api/auth/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "online")

    # =========================================================
    # 2. AUTHENTICATION AND PROFILES
    # =========================================================

    def test_03_login_invalid_password(self):
        response = client.post(
            "/api/auth/login",
            json={
                "email": "patient@medra.org",
                "password": "WrongPassword"
            }
        )

        self.assertEqual(response.status_code, 401)

    def test_04_auth_me_profile(self):
        response = client.get(
            "/api/auth/me",
            headers=self.patient_headers
        )

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertEqual(data["email"], "patient@medra.org")
        self.assertEqual(data["role"], "patient")
        self.assertEqual(data["full_name"], "Rajesh Sharma")

    # =========================================================
    # 3. PATIENT MODULE
    # =========================================================

    def test_05_patient_profile(self):
        response = client.get(
            "/api/patient/profile",
            headers=self.patient_headers
        )

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertEqual(data["full_name"], "Rajesh Sharma")

        update_response = client.put(
            "/api/patient/profile",
            headers=self.patient_headers,
            json={
                "blood_group": "O+",
                "emergency_contact_name": "Sunita Sharma"
            }
        )

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(
            update_response.json()["blood_group"], "O+"
        )

    def test_06_patient_emergency_sos(self):
        response = client.post(
            "/api/patient/emergency",
            headers=self.patient_headers,
            json={
                "emergency_type": "Severe Cardiac Chest Pain",
                "description": (
                    "Patient experiencing crushing chest pressure "
                    "and radiating arm pain."
                ),
                "latitude": 17.6599,
                "longitude": 75.9064
            }
        )

        self.assertEqual(response.status_code, 201)

        data = response.json()

        self.assertIn("emergency_id", data)
        self.assertIn("reference", data)
        self.assertEqual(data["status"], "REQUESTED")
        self.assertIsNone(data["ambulance"])
        self.assertIsNone(data["hospital"])

    def test_07_patient_emergencies_list(self):
        response = client.get(
            "/api/patient/emergencies",
            headers=self.patient_headers
        )

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertIn("emergencies", data)
        self.assertGreater(len(data["emergencies"]), 0)

    def test_08_patient_vitals(self):
        post_response = client.post(
            "/api/patient/vitals",
            headers=self.patient_headers,
            json={
                "heart_rate": 84,
                "blood_pressure_systolic": 122,
                "blood_pressure_diastolic": 78,
                "sp_o2": 98,
                "temperature": 37.0,
                "respiratory_rate": 16,
                "source": "PATIENT_INPUT"
            }
        )

        self.assertEqual(post_response.status_code, 201)

        get_response = client.get(
            "/api/patient/vitals",
            headers=self.patient_headers
        )

        self.assertEqual(get_response.status_code, 200)
        self.assertGreater(
            len(get_response.json()["vitals"]), 0
        )

    # =========================================================
    # 4. HOSPITAL MODULE
    # =========================================================

    def test_09_hospital_dashboard_stats(self):
        response = client.get(
            "/api/hospital/dashboard-stats",
            headers=self.hospital_headers
        )

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertIn("metrics", data)
        self.assertIn("total_beds", data["metrics"])
        self.assertIn("available_beds", data["metrics"])

    def test_10_hospital_patient_registration(self):
        response = client.post(
            "/api/hospital/patients",
            headers=self.hospital_headers,
            json={
                "first_name": "Vijay",
                "last_name": "Shinde",
                "date_of_birth": "1990-07-21",
                "gender": "Male",
                "phone": "9850123456",
                "email": "vijay.shinde@example.com",
                "arrival_type": "Emergency",
                "arrival_method": "Ambulance",
                "arrival_date": "2026-10-16",
                "arrival_time": "16:00",
                "priority": "Critical",
                "referral_source": "Highway Accident Site",
                "notes": "Head injury, GCS 13, CT Brain ordered."
            }
        )

        self.assertEqual(response.status_code, 201)

        data = response.json()

        self.assertIn("id", data)
        self.assertIn("reference", data)

        patient_id = data["id"]

        # Verify the registered patient.
        verify_response = client.post(
            f"/api/hospital/patients/{patient_id}/verify",
            headers=self.hospital_headers,
            json={
                "verification_status": "Verified",
                "notes": (
                    "Identity confirmed via Aadhaar and ER triage card"
                )
            }
        )

        self.assertEqual(verify_response.status_code, 200)
        self.assertEqual(
            verify_response.json()["verification_status"],
            "Verified"
        )

    def test_11_hospital_resources(self):
        response = client.get(
            "/api/hospital/resources",
            headers=self.hospital_headers
        )

        self.assertEqual(response.status_code, 200)

        resources = response.json()["resources"]

        self.assertGreater(len(resources), 0)

        resource_id = resources[0]["id"]

        update_response = client.put(
            f"/api/hospital/resources/{resource_id}",
            headers=self.hospital_headers,
            json={"occupied_count": 5}
        )

        self.assertEqual(update_response.status_code, 200)

    # =========================================================
    # 5. AMBULANCE MODULE
    # =========================================================

    def test_12_ambulance_dashboard(self):
        response = client.get(
            "/api/ambulance/dashboard-stats",
            headers=self.ambulance_headers
        )

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertIn("vehicle_number", data)
        self.assertIn("status", data)

    def test_13_ambulance_availability(self):
        response = client.patch(
            "/api/ambulance/availability",
            headers=self.ambulance_headers,
            json={"status": "AVAILABLE"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "AVAILABLE")

    # =========================================================
    # 6. ADMIN MODULE
    # =========================================================

    def test_14_admin_metrics(self):
        response = client.get(
            "/api/admin/metrics",
            headers=self.admin_headers
        )

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertIn("users", data)
        self.assertIn("emergencies", data)
        self.assertTrue(data["system"]["database_connected"])

    def test_15_admin_users(self):
        response = client.get(
            "/api/admin/users",
            headers=self.admin_headers
        )

        self.assertEqual(response.status_code, 200)

        users = response.json()["users"]

        self.assertGreater(len(users), 0)

        # Ensure sensitive password data is never exposed.
        for user in users:
            self.assertNotIn("password_hash", user)
            self.assertNotIn("password", user)

    def test_16_admin_audit_logs(self):
        response = client.get(
            "/api/admin/audit-logs",
            headers=self.admin_headers
        )

        self.assertEqual(response.status_code, 200)

        logs = response.json()["logs"]

        self.assertGreater(len(logs), 0)

    # =========================================================
    # 7. ABDM DEMO BOUNDARY
    # =========================================================

    def test_17_abdm_boundary(self):
        verify_response = client.post(
            "/api/abdm/verify-demo",
            headers=self.patient_headers,
            json={
                "abha_number": "91-1234-5678-9012",
                "consent_confirmed": True
            }
        )

        self.assertEqual(verify_response.status_code, 200)

        verify_data = verify_response.json()

        self.assertEqual(verify_data["mode"], "DEMO_MODE")
        self.assertTrue(verify_data["verified"])
        self.assertEqual(verify_data["status"], "DEMO_LINKED")
        self.assertIn("No real ABDM verification", verify_data["notice"])


if __name__ == "__main__":
    unittest.main(verbosity=2)