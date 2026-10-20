from sqlalchemy import Column, Integer, String, DateTime, JSON, Index, func
from app.core.database import Base


class IOTTelemetry(Base):
    """Append-only store for validated ESP32 telemetry messages."""
    __tablename__ = "iot_telemetry"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(100), nullable=False, index=True)
    topic = Column(String(255), nullable=False, default="http")
    transport = Column(String(20), nullable=False, default="MQTT")
    payload = Column(JSON, nullable=False)
    received_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    __table_args__ = (Index("ix_iot_telemetry_device_received", "device_id", "received_at"),)
