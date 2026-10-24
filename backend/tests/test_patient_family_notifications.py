import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.dependencies import get_current_patient
from app.models.system import Notification
from app.models.user import User
from app.routes.patient import router as patient_router


test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSession = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
app = FastAPI()
app.include_router(patient_router)
client = TestClient(app)
test_identity = SimpleNamespace(id=None, role="patient", email="test@example.com")


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


def override_patient():
    return test_identity


app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_current_patient] = override_patient


class TestPatientFamilyNotifications(unittest.TestCase):
    def setUp(self):
        Base.metadata.create_all(bind=test_engine)
        self.db = TestSession()
        self.patient = User(
            full_name="Test Patient",
            email="family.patient@example.test",
            role="patient",
            is_active=True,
        )
        self.other_patient = User(
            full_name="Other Patient",
            email="family.other@example.test",
            role="patient",
            is_active=True,
        )
        self.db.add_all([self.patient, self.other_patient])
        self.db.commit()
        test_identity.id = self.patient.id
        test_identity.role = "patient"

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=test_engine)

    def test_family_member_create_update_delete_and_owner_isolation(self):
        created = client.post(
            "/api/patient/family-members",
            json={
                "full_name": "  Casey Patient  ",
                "relationship": " Sister ",
                "mobile": "+1 555-123-4567",
                "email": "casey@example.com",
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        member = created.json()
        self.assertEqual(member["full_name"], "Casey Patient")
        self.assertEqual(member["relationship"], "Sister")

        test_identity.id = self.other_patient.id
        self.assertEqual(
            client.get("/api/patient/family-members").json()["family_members"],
            [],
        )
        self.assertEqual(
            client.patch(
                f"/api/patient/family-members/{member['id']}",
                json={"full_name": "Changed"},
            ).status_code,
            404,
        )

        test_identity.id = self.patient.id
        updated = client.patch(
            f"/api/patient/family-members/{member['id']}",
            json={"mobile": "+1 555-987-6543"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["mobile"], "+1 555-987-6543")
        self.assertEqual(
            client.delete(f"/api/patient/family-members/{member['id']}").status_code,
            204,
        )

    def test_family_member_validates_required_and_contact_fields(self):
        missing_relationship = client.post(
            "/api/patient/family-members",
            json={"full_name": "Casey"},
        )
        invalid_mobile = client.post(
            "/api/patient/family-members",
            json={
                "full_name": "Casey",
                "relationship": "Sibling",
                "mobile": "not a phone",
            },
        )
        self.assertEqual(missing_relationship.status_code, 422)
        self.assertEqual(invalid_mobile.status_code, 422)
        self.assertEqual(
            client.patch(
                "/api/patient/family-members/1",
                json={"full_name": None},
            ).status_code,
            422,
        )

    def test_only_patient_role_can_access_family_and_notifications(self):
        test_identity.role = "admin"
        self.assertEqual(client.get("/api/patient/family-members").status_code, 403)
        self.assertEqual(client.get("/api/patient/notifications").status_code, 403)

    def test_notifications_are_scoped_and_read_actions_are_persisted(self):
        own = Notification(
            user_id=self.patient.id,
            role="patient",
            title="Emergency update",
            message="Your SOS status changed.",
            type="EMERGENCY",
        )
        other = Notification(
            user_id=self.other_patient.id,
            role="patient",
            title="Private update",
            message="Another patient's update.",
            type="INFO",
        )
        shared = Notification(
            user_id=None,
            role="patient",
            title="Service notice",
            message="A notice for all patients.",
            type="INFO",
        )
        self.db.add_all([own, other, shared])
        self.db.commit()
        self.db.refresh(own)
        self.db.refresh(shared)

        response = client.get("/api/patient/notifications")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["unread_count"], 2)
        self.assertEqual(len(response.json()["notifications"]), 2)
        self.assertEqual(
            client.patch(f"/api/patient/notifications/{other.id}/read").status_code,
            404,
        )
        marked = client.patch(f"/api/patient/notifications/{own.id}/read")
        self.assertEqual(marked.status_code, 200)
        self.assertTrue(marked.json()["is_read"])
        shared_marked = client.patch(
            f"/api/patient/notifications/{shared.id}/read"
        )
        self.assertEqual(shared_marked.status_code, 200)

        second = Notification(
            user_id=self.patient.id,
            role="patient",
            title="Another update",
            message="Details.",
            type="INFO",
        )
        self.db.add(second)
        self.db.commit()
        marked_all = client.post("/api/patient/notifications/read-all")
        self.assertEqual(marked_all.status_code, 200)
        self.assertEqual(marked_all.json()["marked_read"], 1)
        self.assertEqual(marked_all.json()["unread_count"], 0)

        test_identity.id = self.other_patient.id
        other_patient_notifications = client.get("/api/patient/notifications").json()
        shared_for_other = next(
            notification
            for notification in other_patient_notifications["notifications"]
            if notification["id"] == shared.id
        )
        self.assertFalse(shared_for_other["is_read"])


if __name__ == "__main__":
    unittest.main()
