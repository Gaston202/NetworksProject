"""Unit tests for password handling at bcrypt's 72-byte limit (no database needed)."""
import os

import pytest
from pydantic import ValidationError

# Settings require these at import time; the tests never connect to Atlas.
os.environ.setdefault("MONGODB_URL", "mongodb://localhost:27017")
os.environ.setdefault("SECRET_KEY", "test-only-secret")

from app.core.security import hash_password, verify_password  # noqa: E402
from app.schemas import RegisterIn, StaffCreateIn  # noqa: E402

BCRYPT_MAX_BYTES = 72


def _register(password: str) -> RegisterIn:
    return RegisterIn(full_name="Test User", email="t@example.com", password=password)


def test_register_accepts_password_at_byte_limit():
    assert _register("a" * BCRYPT_MAX_BYTES).password == "a" * BCRYPT_MAX_BYTES


def test_register_rejects_password_over_byte_limit():
    with pytest.raises(ValidationError, match="72 bytes"):
        _register("a" * (BCRYPT_MAX_BYTES + 1))


def test_register_counts_bytes_not_characters():
    # 'é' is 2 bytes in UTF-8: 40 characters = 80 bytes, over the limit.
    with pytest.raises(ValidationError, match="72 bytes"):
        _register("é" * 40)


def test_staff_create_rejects_password_over_byte_limit():
    with pytest.raises(ValidationError, match="72 bytes"):
        StaffCreateIn(full_name="Dr Test", email="d@example.com",
                      password="a" * 100, role="doctor")


def test_verify_returns_false_for_overlong_password_instead_of_raising():
    hashed = hash_password("correct-horse")
    assert verify_password("a" * 200, hashed) is False


def test_verify_round_trip():
    hashed = hash_password("correct-horse")
    assert verify_password("correct-horse", hashed) is True
    assert verify_password("wrong-horse", hashed) is False
