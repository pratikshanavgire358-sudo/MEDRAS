import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class AccountProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    mobile: Optional[str] = Field(default=None, max_length=20)

    @field_validator("full_name")
    @classmethod
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            raise ValueError("Name cannot be null")
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Name must contain at least two characters")
        return value

    @field_validator("mobile")
    @classmethod
    def normalize_mobile(cls, value: Optional[str]) -> Optional[str]:
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
