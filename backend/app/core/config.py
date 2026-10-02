"""Application settings, loaded from environment / .env via pydantic-settings."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # The database is MongoDB Atlas (ADR-0004) - no default: a missing
    # MONGODB_URL fails loudly at startup rather than reaching for a local DB.
    mongodb_url: str
    mongodb_db: str = "hms"

    # Transitional: still used by the SQLAlchemy modules until Task 7
    # lands; removed with the SQLA stack in the final task.
    database_url: str = "postgresql+psycopg2://hms:hms_dev_password@localhost:5433/hms"
    secret_key: str = "dev-only-insecure-secret-change-me"
    access_token_expire_minutes: int = 60

    # Origins the SPA may be served from (CORS allow-list)
    cors_origins: str = "http://localhost:5173,http://localhost:8080,http://10.0.2.20"

    seed_password: str = "hms-demo-1234"

    # Derived billing (ADR-0012): every completed appointment invoices this fee.
    consultation_fee: float = 25.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()