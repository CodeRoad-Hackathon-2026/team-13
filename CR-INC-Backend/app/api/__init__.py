from fastapi import APIRouter

from app.api import agents, approvals, dashboard, feedback, incidents, ingest, services

router = APIRouter()
router.include_router(incidents.router)
router.include_router(approvals.router)
router.include_router(dashboard.router)
router.include_router(feedback.router)
router.include_router(ingest.router)
router.include_router(services.router)
router.include_router(agents.router)

__all__ = ["router"]
