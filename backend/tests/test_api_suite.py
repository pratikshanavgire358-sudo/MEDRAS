import unittest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestMedraAPI(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Obtain tokens for each role
        resp = client.post("/api/auth/login", json={"email": "patient@medra.org", "password": "Password@123"})
        cls.patient_token = resp.json()["access_token"]
        cls.patient_headers = {"Authorization": f"Bearer {cls.patient_token}"}

        resp = client.post("/api/auth/login", json={"email": "hospital@medra.org", "password": "Password@123"})
        cls.hospital_token = resp.json()["access_token"]
        cls.hospital_headers = {"Authorization": f"Bearer {cls.hospital_token}"}

        resp = client.post("/api/auth/login", json={"email": "ambulance@medra.org", "password": "Password@123"})
        cls.ambulance_token = resp.json()["access_token"]
        cls.ambulance_headers = {"Authorization": f"Bearer {cls.ambulance_token}"}

        resp = client.post("/api/auth/login", json={"email": "admin@medra.org", "password": "Password@123"})
        cls.admin_token = resp.json()["access_token"]
        cls.admin_headers = {"Authorization": f"Bearer {cls.admin_token}"}

    # 1. HEALTH CHECKS
    def test_01_health_check(self):
        resp = client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["database"], "connected")
        self.assertIn("PostgreSQL", data["database_version"])

    def test_02_auth_health(self):
        resp = client.get("/api/auth/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "online")

    # 2. AUTHENTICATION & PROFILES
    def test_03_login_invalid_password(self):
        resp = client.post("/api/auth/login", json={"email": "patient@medra.org", "password": "WrongPassword"})
        self.assertEqual(resp.status_code, 401)

    def test_04_auth_me_profile(self):
        resp = client.get("/api/auth/me", headers=self.patient_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["email"], "patient@medra.org")
        self.assertEqual(data["role"], "patient")
        self.assertEqual(data["full_name"], "Rajesh Sharma")

    # 3. PATIENT MODULE
    def test_05_patient_profile(self):
        resp = client.get("/api/patient/profile", headers=self.patient_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["full_name"], "Rajesh Sharma")

        update_resp = client.put(
            "/api/patient/profile",
            headers=self.patient_headers,
            json={"blood_group": "O+", "emergency_contact_name": "Sunita Sharma"}
        )
        self.assertEqual(update_resp.status_code, 200)
        self.assertEqual(update_resp.json()["blood_group"], "O+")

    def test_06_patient_emergency_sos(self):
        resp = client.post(
            "/api/patient/emergency",
            headers=self.patient_headers,
            json={
                "emergency_type": "Severe Cardiac Chest Pain",
                "description": "Patient experiencing crushing chest pressure and radiating arm pain.",
                "latitude": 17.6599,
                "longitude": 75.9064
            }
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertIn("emergency_id", data)
        self.assertIn("reference", data)
        self.assertIsNotNone(data["ambulance"])
        self.assertIsNotNone(data["hospital"])

    def test_07_patient_emergencies_list(self):
        resp = client.get("/api/patient/emergencies", headers=self.patient_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("emergencies", data)
        self.assertGreater(len(data["emergencies"]), 0)

    def test_08_patient_vitals(self):
        post_resp = client.post(
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
        self.assertEqual(post_resp.status_code, 201)

        get_resp = client.get("/api/patient/vitals", headers=self.patient_headers)
        self.assertEqual(get_resp.status_code, 200)
        self.assertGreater(len(get_resp.json()["vitals"]), 0)

    # 4. HOSPITAL MODULE
    def test_09_hospital_dashboard_stats(self):
        resp = client.get("/api/hospital/dashboard-stats", headers=self.hospital_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("metrics", data)
        self.assertIn("total_beds", data["metrics"])
        self.assertIn("available_beds", data["metrics"])

    def test_10_hospital_patient_registration(self):
        resp = client.post(
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
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertIn("id", data)
        self.assertIn("reference", data)
        patient_id = data["id"]

        # Verify patient
        verify_resp = client.post(
            f"/api/hospital/patients/{patient_id}/verify",
            headers=self.hospital_headers,
            json={"verification_status": "Verified", "notes": "Identity confirmed via Aadhaar & ER triage card"}
        )
        self.assertEqual(verify_resp.status_code, 200)
        self.assertEqual(verify_resp.json()["verification_status"], "Verified")

    def test_11_hospital_resources(self):
        resp = client.get("/api/hospital/resources", headers=self.hospital_headers)
        self.assertEqual(resp.status_code, 200)
        resources = resp.json()["resources"]
        self.assertGreater(len(resources), 0)
        res_id = resources[0]["id"]

        update_resp = client.put(
            f"/api/hospital/resources/{res_id}",
            headers=self.hospital_headers,
            json={"occupied_count": 5}
        )
        self.assertEqual(update_resp.status_code, 200)

    # 5. AMBULANCE MODULE
    def test_12_ambulance_dashboard(self):
        resp = client.get("/api/ambulance/dashboard-stats", headers=self.ambulance_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("vehicle_number", data)
        self.assertIn("status", data)

    def test_13_ambulance_availability(self):
        resp = client.patch(
            "/api/ambulance/availability",
            headers=self.ambulance_headers,
            json={"status": "AVAILABLE"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "AVAILABLE")

    # 6. ADMIN MODULE
    def test_14_admin_metrics(self):
        resp = client.get("/api/admin/metrics", headers=self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("users", data)
        self.assertIn("emergencies", data)
        self.assertTrue(data["system"]["database_connected"])

    def test_15_admin_users(self):
        resp = client.get("/api/admin/users", headers=self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        users = resp.json()["users"]
        self.assertGreater(len(users), 0)
        # Ensure password_hash is never exposed
        for u in users:
            self.assertNotIn("password_hash", u)
            self.assertNotIn("password", u)

    def test_16_admin_audit_logs(self):
        resp = client.get("/api/admin/audit-logs", headers=self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        logs = resp.json()["logs"]
        self.assertGreater(len(logs), 0)

    # 7. ABDM BOUNDARY
    def test_17_abdm_boundary(self):
        resp = client.get("/api/abdm/status", headers=self.patient_headers)
        self.assertEqual(resp.status_code, 200)
        self.assertIn("notice", resp.json())
        self.assertEqual(resp.json()["mode"], "DEMO_SIMULATION_ONLY")

        verify_resp = client.post(
            "/api/abdm/verify-demo",
            headers=self.patient_headers,
            json={"abha_number": "91-1234-5678-9012", "consent_confirmed": True}
        )
        self.assertEqual(verify_resp.status_code, 200)
        self.assertEqual(verify_resp.json()["mode"], "DEMO_MODE")
        self.assertTrue(verify_resp.json()["verified"])


if __name__ == "__main__":
    unittest.main()
