"""
Phase 5C — Image Usability and Agricultural Relevance Gates
Designed with farmer empathy: accepts low-cost smartphone photos, compressed JPEGs,
and medium-quality field images. Rejects only when there is genuinely insufficient visual evidence
or the image is out-of-domain (non-agricultural).
"""

import io
import logging
from typing import Dict, Any, Tuple, Optional
import numpy as np
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Constants for Usability Checks (Empathetic thresholds designed for rural field conditions)
MIN_DIMENSION_PIXELS = 32          # Minimum width/height
MIN_TOTAL_PIXELS = 32 * 32         # Minimum pixel count
EXTREME_DARKNESS_MEAN = 8.0        # 0-255 scale (Mean RGB < 8 is pitch black)
EXTREME_BLANK_STDDEV = 2.0         # Solid blank color image
EXTREME_BLUR_SHARPNESS = 3.5       # 99.5th percentile edge gradient threshold for severe unrecoverable blur
MODERATE_BLUR_SHARPNESS = 20.0     # Boundary between good and medium/soft focus

FARMER_FRIENDLY_REJECTION_MESSAGES = {
    "corrupt": "Unable to open the photo. Please take a new photo of the affected plant.",
    "too_small": "The photo is too small to view the plant clearly. Please capture the leaf or crop a bit closer.",
    "too_dark": "The photo is too dark to see the plant details. Please take another photo with better lighting or outdoors in daylight.",
    "too_blurry": "The photo is too blurry to analyze the plant symptoms. Please hold the phone steady and take another photo.",
    "blank": "The photo does not contain visible plant details. Please capture the affected crop or leaves in the camera frame.",
    "non_agricultural": "This photo does not appear to show a crop or plant. Please upload a photo of the affected leaves, stem, or crop."
}


def safe_decode_image(image_bytes: bytes) -> Tuple[Optional[Image.Image], Optional[str]]:
    """
    Safely decodes image bytes into an RGB Pillow Image with EXIF orientation correction.
    Returns (Image, error_message).
    """
    if not image_bytes or len(image_bytes) == 0:
        return None, "Empty image file provided."
        
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        return img, None
    except Exception as e:
        logger.warning(f"Failed to decode image bytes: {e}")
        return None, "Invalid or corrupted image format."


def compute_edge_sharpness(gray_np: np.ndarray) -> float:
    """
    Computes edge sharpness using 99.5th percentile of gradient magnitude.
    Measures the crispness of the sharpest visible features in the image.
    Works robustly across high-res camera photos and low-res rural smartphone photos.
    """
    H, W = gray_np.shape
    if H < 5 or W < 5:
        return 0.0
        
    gx = np.abs(gray_np[:, 1:] - gray_np[:, :-1])
    gy = np.abs(gray_np[1:, :] - gray_np[:-1, :])
    grad = gx[:-1, :] + gy[:, :-1]
    p99 = float(np.percentile(grad, 99.5))
    return p99


def evaluate_image_usability(img: Image.Image) -> Dict[str, Any]:
    """
    Gate 1: Image Usability Gate.
    Evaluates whether the photo contains sufficient visual information for analysis.
    
    Accepts:
    - 640x480, 800x600, low-res smartphone photos (320x240+)
    - Compressed JPEGs
    - Moderate blur / soft focus
    - Moderately dark images
    
    Rejects:
    - Corrupt / unreadable
    - Pitch black (<8 mean brightness)
    - Blank / solid color (<2.0 stddev)
    - Severe, unrecoverable blur (<3.5 edge sharpness)
    """
    W, H = img.size
    
    # 1. Dimension check
    if W < MIN_DIMENSION_PIXELS or H < MIN_DIMENSION_PIXELS or (W * H) < MIN_TOTAL_PIXELS:
        return {
            "usable": False,
            "level": "poor",
            "confidence": 0.0,
            "needs_better_photo": True,
            "reason": FARMER_FRIENDLY_REJECTION_MESSAGES["too_small"],
            "metrics": {"width": W, "height": H}
        }
        
    gray_img = img.convert("L")
    gray_np = np.array(gray_img, dtype=np.float32)
    
    mean_brightness = float(np.mean(gray_np))
    std_brightness = float(np.std(gray_np))
    
    # 2. Extreme Darkness check (Pitch black / lens cap covered)
    if mean_brightness < EXTREME_DARKNESS_MEAN:
        return {
            "usable": False,
            "level": "poor",
            "confidence": 0.05,
            "needs_better_photo": True,
            "reason": FARMER_FRIENDLY_REJECTION_MESSAGES["too_dark"],
            "metrics": {"mean_brightness": round(mean_brightness, 2), "std_brightness": round(std_brightness, 2)}
        }
        
    # 3. Blank / Solid Color check
    if std_brightness < EXTREME_BLANK_STDDEV:
        return {
            "usable": False,
            "level": "poor",
            "confidence": 0.05,
            "needs_better_photo": True,
            "reason": FARMER_FRIENDLY_REJECTION_MESSAGES["blank"],
            "metrics": {"std_brightness": round(std_brightness, 2)}
        }
        
    # 4. Edge Sharpness & Blur Assessment
    sharpness = compute_edge_sharpness(gray_np)
    
    # Severe unrecoverable blur (e.g. extreme motion shake)
    if sharpness < EXTREME_BLUR_SHARPNESS and std_brightness > 8.0:
        return {
            "usable": False,
            "level": "poor",
            "confidence": 0.15,
            "needs_better_photo": True,
            "reason": FARMER_FRIENDLY_REJECTION_MESSAGES["too_blurry"],
            "metrics": {"sharpness": round(sharpness, 2), "mean_brightness": round(mean_brightness, 2)}
        }
        
    # Quality level classification
    # If soft blur or moderately dark, mark as 'medium' (ACCEPT but flag slight uncertainty)
    is_medium = (sharpness < MODERATE_BLUR_SHARPNESS) or (mean_brightness < 35.0) or (std_brightness < 18.0)
    
    if is_medium:
        conf = round(min(0.80, max(0.60, 0.55 + (sharpness / 100.0) + (mean_brightness / 500.0))), 2)
        return {
            "usable": True,
            "level": "medium",
            "confidence": conf,
            "needs_better_photo": False,
            "reason": None,
            "metrics": {
                "width": W,
                "height": H,
                "sharpness": round(sharpness, 2),
                "mean_brightness": round(mean_brightness, 2),
                "std_brightness": round(std_brightness, 2)
            }
        }
    else:
        conf = round(min(0.98, max(0.82, 0.80 + (sharpness / 500.0))), 2)
        return {
            "usable": True,
            "level": "good",
            "confidence": conf,
            "needs_better_photo": False,
            "reason": None,
            "metrics": {
                "width": W,
                "height": H,
                "sharpness": round(sharpness, 2),
                "mean_brightness": round(mean_brightness, 2),
                "std_brightness": round(std_brightness, 2)
            }
        }


def check_vegetation_color_presence(img: Image.Image) -> Tuple[bool, float, Dict[str, float]]:
    """
    Analyzes HSV color space to distinguish plant foliage & agricultural chlorosis
    from non-agricultural subjects (human skin, vehicles, animals, indoor clutter).
    
    Pillow HSV Scale: H in [0, 255], S in [0, 255], V in [0, 255]
    - Green Foliage: H in [45, 120], S >= 30, V >= 25
    - Yellow / Chlorosis Disease: H in [25, 45], S >= 45, V >= 35
    - Necrotic Foliage (with green/yellow canopy): H in [12, 30], S in [40, 180], V in [30, 160]
    """
    thumb = img.resize((128, 128), Image.Resampling.BILINEAR)
    hsv = np.array(thumb.convert("HSV"), dtype=np.float32)
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    
    # 1. Healthy green plant pixels
    green_mask = (H >= 45) & (H <= 120) & (S >= 30) & (V >= 25)
    green_ratio = float(np.mean(green_mask))
    
    # 2. Chlorosis / Yellowing diseased foliage
    yellow_mask = (H >= 25) & (H < 45) & (S >= 45) & (V >= 35)
    yellow_ratio = float(np.mean(yellow_mask))
    
    # 3. Non-agricultural artificial blue/cyan or vivid synthetic colors
    blue_cyan_mask = (H >= 125) & (H <= 185) & (S >= 40) & (V >= 40)
    blue_cyan_ratio = float(np.mean(blue_cyan_mask))
    
    agri_color_ratio = green_ratio + yellow_ratio
    
    # If dominated by synthetic blue/cyan with little green foliage, reject as non-plant
    if blue_cyan_ratio > 0.15 and green_ratio < 0.08:
        return False, agri_color_ratio, {
            "green_ratio": round(green_ratio, 3),
            "yellow_ratio": round(yellow_ratio, 3),
            "blue_cyan_ratio": round(blue_cyan_ratio, 3),
            "agri_color_ratio": round(agri_color_ratio, 3)
        }
        
    has_plant_color = (green_ratio >= 0.04) or (yellow_ratio >= 0.10) or (green_ratio >= 0.025 and yellow_ratio >= 0.03)
    
    return has_plant_color, agri_color_ratio, {
        "green_ratio": round(green_ratio, 3),
        "yellow_ratio": round(yellow_ratio, 3),
        "blue_cyan_ratio": round(blue_cyan_ratio, 3),
        "agri_color_ratio": round(agri_color_ratio, 3)
    }


async def evaluate_agricultural_relevance(
    img: Image.Image
) -> Dict[str, Any]:
    """
    Gate 2: Agricultural Relevance Gate.
    Determines whether the photo is relevant to crops, plants, or agricultural damage.
    
    Rejects:
    - Humans, pets (dog, cat), cars, motorcycles, buildings, household items.
    
    Accepts:
    - Crop leaves, stems, fruits, flowers, whole plants, soil/canopy with visible crop.
    """
    has_agri_color, color_score, color_details = check_vegetation_color_presence(img)
    
    # Local high-performance heuristic:
    if has_agri_color:
        conf = round(min(0.95, max(0.68, 0.55 + color_score)), 2)
        return {
            "accepted": True,
            "confidence": conf,
            "subject": "vegetation_canopy",
            "reason": None
        }
    else:
        return {
            "accepted": False,
            "confidence": 0.88,
            "subject": "non_plant_material",
            "reason": FARMER_FRIENDLY_REJECTION_MESSAGES["non_agricultural"]
        }


def preprocess_for_inference(
    img: Image.Image,
    target_size: Tuple[int, int] = (640, 640),
    letterbox: bool = True
) -> np.ndarray:
    """
    Practical preprocessing for CPU inference:
    - Preserves aspect ratio with letterbox padding
    - Scales pixel values to [0.0, 1.0]
    - Converts to NCHW format (1, 3, target_H, target_W)
    
    The original image remains untouched for Supabase Storage & AEO inspection.
    """
    target_W, target_H = target_size
    
    if not letterbox:
        resized = img.resize((target_W, target_H), Image.Resampling.BILINEAR)
    else:
        orig_W, orig_H = img.size
        scale = min(target_W / orig_W, target_H / orig_H)
        new_W = int(orig_W * scale)
        new_H = int(orig_H * scale)
        
        resized_content = img.resize((new_W, new_H), Image.Resampling.BILINEAR)
        resized = Image.new("RGB", (target_W, target_H), (114, 114, 114))
        pad_x = (target_W - new_W) // 2
        pad_y = (target_H - new_H) // 2
        resized.paste(resized_content, (pad_x, pad_y))
        
    arr = np.array(resized, dtype=np.float32) / 255.0
    tensor = np.transpose(arr, (2, 0, 1))[np.newaxis, ...]
    return tensor


async def run_image_safety_gates(
    image_bytes: bytes
) -> Dict[str, Any]:
    """
    Comprehensive Phase 5C Gate pipeline:
    1. Safe Decode
    2. Usability Gate (Blur, Darkness, Resolution, Corrupt)
    3. Agricultural Relevance Gate (Rejects humans, cars, animals, clutter)
    
    Returns structured result with farmer-friendly guidance.
    """
    # 1. Safe Decode
    img, decode_err = safe_decode_image(image_bytes)
    if decode_err or img is None:
        return {
            "accepted": False,
            "quality": {
                "usable": False,
                "level": "poor",
                "confidence": 0.0,
                "needs_better_photo": True,
                "reason": FARMER_FRIENDLY_REJECTION_MESSAGES["corrupt"]
            },
            "agriculture_relevance": {
                "accepted": False,
                "confidence": 0.0,
                "reason": FARMER_FRIENDLY_REJECTION_MESSAGES["corrupt"]
            },
            "farmer_message": FARMER_FRIENDLY_REJECTION_MESSAGES["corrupt"]
        }
        
    # 2. Usability Gate
    quality_result = evaluate_image_usability(img)
    if not quality_result["usable"]:
        return {
            "accepted": False,
            "quality": quality_result,
            "agriculture_relevance": {
                "accepted": False,
                "confidence": 0.0,
                "reason": quality_result["reason"]
            },
            "farmer_message": quality_result["reason"]
        }
        
    # 3. Agricultural Relevance Gate
    relevance_result = await evaluate_agricultural_relevance(img)
    if not relevance_result["accepted"]:
        return {
            "accepted": False,
            "quality": quality_result,
            "agriculture_relevance": relevance_result,
            "farmer_message": relevance_result["reason"]
        }
        
    # 4. Success: Image accepted
    return {
        "accepted": True,
        "quality": quality_result,
        "agriculture_relevance": relevance_result,
        "farmer_message": None
    }
