from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    func
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    role = Column(String(30), nullable=True, index=True)  # patient, hospital, ambulance, admin, or None for all
    title = Column(String(150), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String(30), nullable=False, default="INFO")  # EMERGENCY, STATUS_UPDATE, ALERT, INFO
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User")


class NotificationRead(Base):
    __tablename__ = "notification_reads"

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    notification_id = Column(
        Integer,
        ForeignKey("notifications.id", ondelete="CASCADE"),
        primary_key=True,
    )
    read_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    user_email = Column(String(255), nullable=True)
    action = Column(String(100), nullable=False)  # PATIENT_VERIFIED, EMERGENCY_DISPATCHED, RESOURCE_UPDATED, USER_LOGIN, etc.
    resource_type = Column(String(50), nullable=False)  # HospitalPatient, Emergency, User, HospitalResource
    resource_id = Column(String(50), nullable=True)
    details = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User")
