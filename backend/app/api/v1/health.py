from fastapi import APIRouter

router = APIRouter()


@router.get("/health", tags=["Health"])
async def health_check():
    """
    Health check endpoint to verify backend operational status.
    """
    return {"status": "ok"}
