import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from types import SimpleNamespace

from app.core.database import Base, get_db
from app.models.user import User
from app.models.medra_demo import Ambulance, Hospital
from app.models.patient_profile import PatientProfile
from app.models.system import AuditLog
from app.routes.auth import auth_role_fields, password_hasher, router as auth_router


test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSession = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
app = FastAPI()
app.include_router(auth_router)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


class TestAuthLogin(unittest.TestCase):
    def setUp(self):
        Base.metadata.create_all(bind=test_engine)
        self.db = TestSession()
        self.user = User(
            full_name="Login Test",
            email="login.test@example.com",
            password_hash=password_hasher.hash("Local-Test-Password-928!"),
            role="patient",
            is_active=True,
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=test_engine)

    def test_successful_login_returns_jwt_accepted_by_me(self):
        response = client.post(
            "/api/auth/login",
            json={
                "email": "LOGIN.TEST@EXAMPLE.COM",
                "password": "Local-Test-Password-928!",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["token_type"], "bearer")
        self.assertEqual(payload["user"]["email"], self.user.email)
        self.assertNotIn("password_hash", payload["user"])

        profile = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {payload['access_token']}"},
        )
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["id"], self.user.id)

    def test_invalid_credentials_return_401(self):
        unknown_user = client.post(
            "/api/auth/login",
            json={
                "email": "unknown.login.test@example.com",
                "password": "Local-Test-Password-928!",
            },
        )
        wrong_password = client.post(
            "/api/auth/login",
            json={
                "email": self.user.email,
                "password": "Incorrect-Test-Password-928!",
            },
        )

        self.assertEqual(unknown_user.status_code, 401)
        self.assertEqual(wrong_password.status_code, 401)

    def test_inactive_user_returns_403(self):
        self.user.is_active = False
        self.db.commit()

        response = client.post(
            "/api/auth/login",
            json={
                "email": self.user.email,
                "password": "Local-Test-Password-928!",
            },
        )

        self.assertEqual(response.status_code, 403)

    def test_audit_logging_failure_does_not_break_login(self):
        with patch(
            "app.core.dependencies.AuditLog",
            side_effect=RuntimeError("test audit failure"),
        ):
            response = client.post(
                "/api/auth/login",
                json={
                    "email": self.user.email,
                    "password": "Local-Test-Password-928!",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["access_token"])

    def test_me_rejects_missing_and_invalid_tokens(self):
        missing_token = client.get("/api/auth/me")
        invalid_token = client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalid-token"},
        )

        self.assertEqual(missing_token.status_code, 401)
        self.assertEqual(invalid_token.status_code, 401)

    def test_auth_role_fields_support_older_user_models(self):
        user_without_dispatch_fields = SimpleNamespace(role="patient")

        self.assertEqual(
            auth_role_fields(user_without_dispatch_fields),
            {"ambulance_subrole": None, "ambulance_id": None},
        )


if __name__ == "__main__":
    unittest.main()
