from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Float,
    Text,
    Boolean,
    func,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class DemoMedicalRecord(Base):
    __tablename__ = "demo_medical_records"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    record_type = Column(String(50), nullable=False)
    provider_name = Column(String(150), nullable=False)
    record_date = Column(DateTime(timezone=True), nullable=True)
    summary = Column(Text, nullable=True)

    data_source = Column(
        String(30),
        nullable=False,
        default="MOCK_DATA",
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user = relationship("User")


class Emergency(Base):
    __tablename__ = "emergencies"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_emergencies_user_idempotency_key"),
    )

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    emergency_type = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)

    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    status = Column(
        String(30),
        nullable=False,
        default="REQUESTED",
    )

    priority = Column(String(12), nullable=False, default="NORMAL", server_default="NORMAL")
    idempotency_key = Column(String(36), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user = relationship("User")
    assignment = relationship("EmergencyAssignment", back_populates="emergency", uselist=False)


class Ambulance(Base):
    __tablename__ = "ambulances"

    id = Column(Integer, primary_key=True, index=True)

    vehicle_number = Column(
        String(30),
        unique=True,
        nullable=False,
    )

    driver_name = Column(String(100), nullable=False)

    driver_user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        index=True
    )

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    status = Column(
        String(30),
        nullable=False,
        default="AVAILABLE",
    )
    location_updated_at = Column(DateTime(timezone=True), nullable=True)

    driver_user = relationship("User", foreign_keys=[driver_user_id])
    assignments = relationship("EmergencyAssignment", back_populates="ambulance")


class Hospital(Base):
    __tablename__ = "hospitals"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String(150), nullable=False)
    address = Column(String(300), nullable=False)

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    phone = Column(String(30), nullable=True)
    email = Column(String(255), nullable=True)

    emergency_available = Column(
        Boolean,
        nullable=False,
        default=True,
    )

    assignments = relationship("EmergencyAssignment", back_populates="hospital")


class EmergencyAssignment(Base):
    __tablename__ = "emergency_assignments"

    id = Column(Integer, primary_key=True, index=True)

    emergency_id = Column(
        Integer,
        ForeignKey("emergencies.id"),
        nullable=False,
        unique=True,
    )

    ambulance_id = Column(
        Integer,
        ForeignKey("ambulances.id"),
        nullable=False,
    )

    hospital_id = Column(
        Integer,
        ForeignKey("hospitals.id"),
        nullable=True,
    )

    status = Column(
        String(30),
        nullable=False,
        default="ASSIGNED",
    )

    notes = Column(Text, nullable=True)

    assigned_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    emergency = relationship("Emergency", back_populates="assignment")
    ambulance = relationship("Ambulance", back_populates="assignments")
    hospital = relationship("Hospital", back_populates="assignments")


class EmergencyAction(Base):
    __tablename__ = "emergency_actions"

    id = Column(Integer, primary_key=True, index=True)
    emergency_id = Column(Integer, ForeignKey("emergencies.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ambulance_id = Column(Integer, ForeignKey("ambulances.id"), nullable=True, index=True)
    action_type = Column(String(30), nullable=False)
    previous_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)