from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Date,
    ForeignKey,
    Text,
    func
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class HospitalPatient(Base):
    __tablename__ = "hospital_patients"

    id = Column(Integer, primary_key=True, index=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), nullable=True, index=True)
    patient_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(30), nullable=True)
    phone = Column(String(20), nullable=True)
    email = Column(String(255), nullable=True)

    arrival_type = Column(String(50), nullable=False, default="Emergency")
    arrival_method = Column(String(50), nullable=False, default="Ambulance")
    arrival_date = Column(String(30), nullable=True)
    arrival_time = Column(String(30), nullable=True)

    priority = Column(String(30), nullable=False, default="Critical")
    referral_source = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)

    verification_status = Column(String(50), nullable=False, default="Pending review")
    verified_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)

    status = Column(String(50), nullable=False, default="Registered")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    hospital = relationship("Hospital")
    patient_user = relationship("User", foreign_keys=[patient_user_id])
    verified_by = relationship("User", foreign_keys=[verified_by_user_id])


class HospitalResource(Base):
    __tablename__ = "hospital_resources"

    id = Column(Integer, primary_key=True, index=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), nullable=False, index=True)
    resource_type = Column(String(100), nullable=False)  # ICU Bed, Emergency Bed, Ventilator, Oxygen Unit, General Bed
    total_count = Column(Integer, nullable=False, default=10)
    occupied_count = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    hospital = relationship("Hospital")
