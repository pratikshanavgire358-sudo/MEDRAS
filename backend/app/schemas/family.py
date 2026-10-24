import re
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class FamilyMemberCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    relationship: str = Field(min_length=1, max_length=50)
    mobile: Optional[str] = Field(default=None, max_length=20)
    email: Optional[EmailStr] = None

    @field_validator("full_name", "relationship")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank")
        return value

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not re.fullmatch(r"\+?[0-9 ()-]{7,20}", value):
            raise ValueError("Enter a valid contact number")
        return value


class FamilyMemberUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    relationship: Optional[str] = Field(default=None, min_length=1, max_length=50)
    mobile: Optional[str] = Field(default=None, max_length=20)
    email: Optional[EmailStr] = None

    @field_validator("full_name", "relationship")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            raise ValueError("This field cannot be null")
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank")
        return value

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not re.fullmatch(r"\+?[0-9 ()-]{7,20}", value):
            raise ValueError("Enter a valid contact number")
        return value

    @model_validator(mode="after")
    def require_update_field(self):
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        return self
