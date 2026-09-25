"""FastAPI application entrypoint (ADR-0002/0003)."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, health
from app.core.config import settings

app = FastAPI(
    title="Hospital Management System API",
    version="0.1.0",
    description="HMS backend for the networks course project. Roles and flows per docs/adr/.",
)

# The SPA lives on a different origin (nginx on hms-desktop) — ADR-0011.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,  # Bearer tokens, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")