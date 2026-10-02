"""Application settings, loaded from environment / .env via pydantic-settings."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # The database is MongoDB Atlas (ADR-0004) - no default: a missing
    # MONGODB_URL fails loudly at startup rather than reaching for a local DB.
    mongodb_url: str
    mongodb_db: str = "hms"

    # No default either: a missing SECRET_KEY must not fall back to a
    # publicly known value anyone could sign admin tokens with.
    secret_key: str
    access_token_expire_minutes: int = 60

    # CORS allow-list. Deployed, nginx serves SPA and API same-origin
    # (ADR-0016), so only the Vite dev server needs an entry.
    cors_origins: str = "http://localhost:5173"

    seed_password: str = "hms-demo-1234"

    # Derived billing (ADR-0012): every completed appointment invoices this fee.
    consultation_fee: float = 25.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()