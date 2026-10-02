"""FastAPI application entrypoint (ADR-0002/0003)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, auth, billing, clinical, health, scheduling
from app.core.config import settings
from app.db import mongo
from app.db.indexes import ensure_indexes


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await ensure_indexes(mongo.db)   # idempotent; carries the §4 invariants
    yield
    mongo.client.close()


app = FastAPI(
    title="Hospital Management System API",
    version="0.1.0",
    description="HMS backend for the networks course project. Roles and flows per docs/adr/.",
    lifespan=lifespan,
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
for module in (admin, billing, clinical, scheduling):
    app.include_router(module.router, prefix="/api")