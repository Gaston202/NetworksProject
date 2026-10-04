"""Unit tests for the self-service profile schemas (no database needed)."""
import os

import pytest
from pydantic import ValidationError

# Settings require these at import time; the tests never connect to Atlas.
os.environ.setdefault("MONGODB_URL", "mongodb://localhost:27017")
os.environ.setdefault("SECRET_KEY", "test-only-secret")

from app.schemas import PasswordChangeIn, ProfileUpdateIn  # noqa: E402


def test_profile_update_rejects_role_escalation():
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ProfileUpdateIn(role="admin")


def test_profile_update_rejects_email_change():
    with pytest.raises(ValidationError):
        ProfileUpdateIn(email="someone@else.com")


def test_profile_update_tracks_only_sent_fields():
    payload = ProfileUpdateIn(phone="+216 55 214 870")
    assert payload.model_dump(exclude_unset=True) == {"phone": "+216 55 214 870"}


def test_blank_contact_fields_clear_the_value():
    assert ProfileUpdateIn(address="   ").address is None


def test_phone_rejects_letters():
    with pytest.raises(ValidationError):
        ProfileUpdateIn(phone="call me maybe")


def test_password_change_enforces_new_password_rules():
    with pytest.raises(ValidationError):
        PasswordChangeIn(current_password="old-password", new_password="short")
    with pytest.raises(ValidationError, match="72 bytes"):
        PasswordChangeIn(current_password="old-password", new_password="é" * 40)
