"""
Phase 5D — Vision API Endpoints
Provides real-time agricultural disease detection and bounding-box visual diagnostics.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status
from typing import Optional
from app.services.vision_service import analyze_crop_image

router = APIRouter(tags=["Vision AI"])


@router.post(
    "/vision/analyze",
    summary="Analyze crop photo for disease symptoms and bounding boxes",
    description="Runs safe usability gates, agricultural relevance checks, and real YOLO11 object detection."
)
async def analyze_crop_photo_endpoint(
    photo: UploadFile = File(..., description="Crop photo file (JPEG/PNG/WebP)"),
    confidence_threshold: Optional[float] = Form(0.20, description="Minimum confidence threshold for detections")
):
    """
    Analyzes an uploaded crop photo.
    Returns detected disease bounding boxes (mapped to original image resolution)
    along with quality assessment, agricultural relevance, and mandatory AEO review flag.
    """
    if not photo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Photo file is required."
        )
        
    try:
        photo_bytes = await photo.read()
        if not photo_bytes or len(photo_bytes) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty photo file received."
            )
            
        thresh = float(confidence_threshold) if confidence_threshold is not None else 0.20
        result = analyze_crop_image(
            image_bytes=photo_bytes,
            confidence_threshold=thresh
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to process image: {str(e)}",
            "detections": [],
            "requires_aeo_review": True
        }
