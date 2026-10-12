from sqlalchemy import (
    Boolean,
    Column,
    Date,
    ForeignKey,
    Integer,
    String
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class PatientProfile(Base):
    __tablename__ = "patient_profiles"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        unique=True,
        nullable=False,
        index=True
    )

    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(30), nullable=True)
    blood_group = Column(String(5), nullable=True)
    address = Column(String(300), nullable=True)

    emergency_contact_name = Column(String(100), nullable=True)
    emergency_contact_mobile = Column(String(20), nullable=True)

    # This flag alone does not verify or link an ABHA account.
    abha_linked = Column(Boolean, nullable=False, default=False)

    user = relationship("User")