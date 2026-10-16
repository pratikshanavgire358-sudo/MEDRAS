from sqlalchemy import (
    Column,
    Integer,
    Float,
    String,
    DateTime,
    ForeignKey,
    func
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class VitalObservation(Base):
    __tablename__ = "vital_observations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    emergency_id = Column(Integer, ForeignKey("emergencies.id"), nullable=True, index=True)

    heart_rate = Column(Integer, nullable=True)  # bpm (e.g. 72)
    blood_pressure_systolic = Column(Integer, nullable=True)  # mmHg (e.g. 120)
    blood_pressure_diastolic = Column(Integer, nullable=True)  # mmHg (e.g. 80)
    sp_o2 = Column(Integer, nullable=True)  # percentage (e.g. 98)
    temperature = Column(Float, nullable=True)  # Celsius (e.g. 37.0)
    respiratory_rate = Column(Integer, nullable=True)  # breaths/min (e.g. 18)

    source = Column(String(50), nullable=False, default="PATIENT_INPUT")  # PATIENT_INPUT, DEVICE_SIMULATOR, CLINICAL_STAFF
    recorded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User")
    emergency = relationship("Emergency")
