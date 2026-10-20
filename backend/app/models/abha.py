from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, func
from app.core.database import Base


class AbhaDemoLink(Base):
    """Links a MEDRA patient account to a synthetic ABHA dataset record."""
    __tablename__ = "abha_demo_links"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    demo_patient_id = Column(String(40), nullable=False, index=True)
    abha_number = Column(String(20), nullable=False)
    linked_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AbhaConsent(Base):
    """A demo consent grant scoped to one hospital user and selected record categories."""
    __tablename__ = "abha_consents"

    id = Column(Integer, primary_key=True, index=True)
    patient_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    hospital_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    purpose = Column(String(250), nullable=False)
    record_categories = Column(Text, nullable=False, default="medical_history,medications,allergies")
    granted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
