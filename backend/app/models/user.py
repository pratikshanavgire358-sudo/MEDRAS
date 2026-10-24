from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func
)

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    firebase_uid = Column(
        String(128),
        unique=True,
        index=True,
        nullable=True
    )

    full_name = Column(String(100), nullable=False)

    email = Column(
        String(255),
        unique=True,
        index=True,
        nullable=False
    )

    mobile = Column(
        String(20),
        unique=True,
        nullable=True
    )

    password_hash = Column(
        String(255),
        nullable=True
    )

    role = Column(
        String(30),
        nullable=False,
        default="patient"
    )

    ambulance_subrole = Column(String(20), nullable=True)
    ambulance_id = Column(
        Integer,
        ForeignKey(
            "ambulances.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_users_ambulance_id_ambulances",
        ),
        nullable=True,
        index=True,
    )
    hospital_id = Column(
        Integer,
        ForeignKey(
            "hospitals.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_users_hospital_id_hospitals",
        ),
        nullable=True,
        index=True,
    )

    is_active = Column(
        Boolean,
        nullable=False,
        default=True
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )