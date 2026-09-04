from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.health import router as health_router
from app.api.v1.incidents import router as incidents_router
from app.api.v1.vision import router as vision_router

from contextlib import asynccontextmanager
from app.services.indic_asr_service import warmup_indic_conformer_cache
from app.services.vision_service import VisionModelEngine

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up IndicConformer ASR and Vision Model once on application startup
    try:
        warmup_indic_conformer_cache()
    except Exception:
        pass
    try:
        VisionModelEngine.get_instance()
    except Exception:
        pass
    yield

app = FastAPI(
    title=settings.APP_NAME,
    description="Agricultural incident-response platform backend",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Direct root /health endpoint as required
@app.get("/health", tags=["Health"])
async def root_health():
    return {"status": "ok"}

import os
from fastapi.staticfiles import StaticFiles

# Versioned API routes (/api/v1)
app.include_router(health_router, prefix=settings.API_V1_PREFIX)
app.include_router(incidents_router, prefix=settings.API_V1_PREFIX)
app.include_router(vision_router, prefix=settings.API_V1_PREFIX)

# Also expose /api directly for backward-compatibility & simplicity
app.include_router(incidents_router, prefix="/api")
app.include_router(vision_router, prefix="/api")

# Mount local uploads for audio and photo playback
UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

