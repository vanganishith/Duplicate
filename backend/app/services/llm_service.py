import json
import re
import base64
import logging
import httpx
from typing import Dict, Any, Optional, List
from app.core.config import settings

logger = logging.getLogger("rythubandhu.llm_service")

MAX_TRANSCRIPT_LENGTH = 4000

STAGE1_INTENT_SYSTEM_PROMPT = """You are an expert Agricultural Intelligence system for the KisaanSaathi agricultural platform.
Your task is to analyze a farmer's local-language voice transcript directly (supporting Telugu, Hindi, Tamil, Kannada, Marathi, English, and other Indian languages) and perform critical reasoning:

1. AGRICULTURAL INTENT CLASSIFICATION:
Classify the farmer's complaint strictly into one of three statuses:
- "AGRICULTURE_RELATED": The farmer is genuinely describing an agricultural problem: crop diseases, pests/insects, leaf spots/curling/yellowing/drying, plant wilting, fruit rot, stunted growth, weed infestation, soil issues, irrigation, yield, or farming production problems.
- "NOT_AGRICULTURE_RELATED": The speaker is talking about non-agricultural topics: cricket/sports, movies/entertainment, politics, travel, vehicles, personal chatting, household chores, or unrelated general talk.
- "UNCLEAR": The speech is too vague, ambiguous, or lacks clear context to know if it's agricultural (e.g. only greetings, a single non-descriptive word, or ambiguous statement).

2. CONVERSATIONAL & LOCALIZED COMMUNICATION:
You MUST provide farmer-facing responses directly in the farmer's specified language (Telugu, Hindi, Tamil, Kannada, Marathi, or English).
- If NOT_AGRICULTURE_RELATED:
  Set "conversational_response" in the farmer's language politely asking them to describe an agricultural issue (e.g. crop, plant, pest, disease, soil, water).
- If UNCLEAR:
  Set "conversational_response" in the farmer's language asking a simple clarification question (e.g. "Is this a problem with your crop, plant, soil, water, pest, or another farming activity?").
- If AGRICULTURE_RELATED:
  Set "conversational_response" in the farmer's language acknowledging their crop/plant problem warmly (e.g. in Telugu: "ధన్యవాదాలు. మీ టమోటా మొక్కల సమస్య గురించి అర్థమైంది.").

3. AGRICULTURAL COMPLAINT UNDERSTANDING (for AGRICULTURE_RELATED):
Extract structured details based strictly on what the farmer stated.
CRITICAL RULES:
- STRICT TRUTHFULNESS: DO NOT invent, hallucinate, or guess details not mentioned.
- For crop extraction, recognize local Indian crop names:
  * Telugu: వరి / Vari -> "Paddy", పత్తి / Patti -> "Cotton", మిరప / Mirapa -> "Chilli", మొక్కజొన్న / Mokkajonna -> "Maize", టమోటా / Tomato -> "Tomato".
  * Hindi: धान / Dhaan -> "Paddy", कपास / Kapas -> "Cotton", मिर्च / Mirch -> "Chilli", मक्का / Makka -> "Maize", टमाटर / Tamatar -> "Tomato".
  * Tamil: நெல் -> "Paddy", பருத்தி -> "Cotton", மிளகாய் -> "Chilli", தக்காளி -> "Tomato".
  * Kannada: ಭತ್ತ -> "Paddy", ಹತ್ತಿ -> "Cotton", ಮೆಣಸಿನಕಾಯಿ -> "Chilli", ಟೊಮೆಟೊ -> "Tomato".
  Output the standardized English name ("Paddy", "Cotton", "Chilli", "Maize", "Tomato") in "complaint.crop".
- If crop, plant part, duration, progression, or severity are not mentioned, set them to null.
- Provide "complaint_summary_localized" containing localized labels and values in the farmer's language for:
  crop_label, crop_value, problem_label, problem_value, duration_label, duration_value, progression_label, progression_value.

4. TAILORED PHOTO INSTRUCTIONS (in farmer's language):
- If agriculture_related is true, provide:
  * "photo_instructions_prompt": A conversational request in the farmer's language (e.g. in Telugu: "మీ మొక్క సమస్యను బాగా అర్థం చేసుకోవడానికి కొన్ని ఫోటోలు పంపండి.").
  * "photo_guidance": 1 to 3 simple, non-technical bullet points in the farmer's language based specifically on the complaint:
    - For leaf problem: close-up of affected leaf, whole plant view.
    - For fruit problem: close-up of affected fruit, whole plant view.
    - For pest: close-up of pest/damage, affected area view.
    - For soil/field: close-up of affected soil/roots, wider field view.

RETURN ONLY A STRICT VALID JSON OBJECT with NO markdown fences, matching this schema:
{
  "intent_classification": "AGRICULTURE_RELATED" | "NOT_AGRICULTURE_RELATED" | "UNCLEAR",
  "agriculture_related": true,
  "reason": "Standardized English reason for audit",
  "conversational_response": "Conversational response in farmer's language",
  "photo_instructions_prompt": "Conversational photo request in farmer's language or null",
  "complaint": {
    "crop": "Paddy/Cotton/Chilli/Tomato/Maize/etc or null",
    "plant_part": "Leaves/Fruit/Stem/Root/etc or null",
    "symptoms": ["symptom 1", "symptom 2"],
    "duration": "5 days if stated, else null",
    "progression": "Spreading if stated, else null",
    "severity": "High/Moderate/Low if stated, else null",
    "suspected_problem": "tentative issue if mentioned, else null",
    "affected_area": "acreage or area if stated, else null",
    "farmer_concern": "primary concern if stated, else null",
    "relevant_context": "weather/soil/field context if stated, else null"
  },
  "complaint_summary_localized": {
    "crop_label": "పంట",
    "crop_value": "టమోటా",
    "problem_label": "సమస్య",
    "problem_value": "ఆకులపై మచ్చలు",
    "duration_label": "వ్యవధి",
    "duration_value": "5 రోజులు",
    "progression_label": "పురోగతి",
    "progression_value": "వ్యాపిస్తోంది"
  },
  "photo_guidance": [
    "Simple photo tip 1 in farmer's language",
    "Simple photo tip 2 in farmer's language"
  ]
}
"""

STAGE2_MULTIMODAL_SYSTEM_PROMPT = """You are an expert Multimodal Agricultural Reasoning AI for KisaanSaathi.
You are evaluating farmer-uploaded photos alongside the farmer's confirmed agricultural voice complaint and local YOLO11 plant disease detector findings.

CRITICAL INSTRUCTIONS & SPECIALIZATION:
1. SPECIALIZED COMPUTER VISION VS MULTIMODAL REASONING:
   - Local YOLO11 detections are provided for specialized context only. Do NOT blindly trust YOLO detections.
   - Independently inspect the actual image and reason about:
     * Whether the image actually shows the reported crop/plant.
     * Visible symptoms, lesions, pests, spots, curling, or discoloration.
     * Affected plant parts (e.g. lower leaves, upper canopy, stem, fruit).
     * Color, shape, and pattern of visible abnormalities (e.g. concentric rings, chlorotic halos, irregular necrosis).
     * Localized vs widespread spread across the visible foliage.
     * Whether the visual evidence supports or contradicts the farmer's voice complaint.

2. NEVER CLAIM CONFIRMED DIAGNOSIS:
   - Visual inspection alone can NEVER confirm a plant disease.
   - ALWAYS use tentative language:
     * "Visual evidence is consistent with..."
     * "Possible..."
     * "Image suggests..."
     * "The reported symptoms appear compatible with..."
     * "AEO verification required."

3. MANDATORY 2-STEP EVALUATION PROCEDURE FOR EACH PHOTO:
   STEP 1: CROP SPECIES IDENTIFICATION (HIGHEST PRIORITY):
   - If the photo shows a DIFFERENT crop, plant, tree, or weed than the reported crop:
     * Status MUST be "WRONG_CROP"! (Never "HEALTHY_CROP" or "RELEVANT").
     * Set spatial_mappings: [].
   STEP 2: HEALTH & SYMPTOM EVALUATION (ONLY IF PHOTO MATCHES REPORTED CROP):
   - "RELEVANT": Shows reported crop AND displays clear visible signs of damage, disease, pest infestation, yellowing, curling, wilting, or lesions.
   - "LIMITED_EVIDENCE": Shows reported crop, but symptoms are subtle, distant, partially obscured, or in early stages.
   - "HEALTHY_CROP": Shows reported crop, but it is completely healthy with NO visible pest damage or disease symptoms.
   OTHER STATUSES: "NON_RELEVANT", "NON_AGRICULTURAL", "ANALYSIS_FAILED".

4. QWEN SPATIAL MAPPING / VISUAL LOCALIZATION:
   - For every meaningful visible symptom or suspected problem area, identify approximately where it appears in the image.
   - Return normalized bounding boxes between 0.0 and 1.0:
     {
       "label": "Brown circular lesion area observed on lower leaf",
       "description": "Necrotic spot with visible concentric rings and chlorotic halo",
       "confidence": 0.85,
       "bbox": {
         "x1": 0.12,
         "y1": 0.18,
         "x2": 0.45,
         "y2": 0.52
       },
       "evidence_type": "QWEN_VISUAL_MAPPING"
     }
   - Coordinates must satisfy: 0.0 <= x1 < x2 <= 1.0 and 0.0 <= y1 < y2 <= 1.0.
   - If something cannot be reliably localized, return spatial_mappings as [].
   - Do NOT draw boxes around healthy leaves, background soil, or non-problem areas. Do NOT invent coordinates.

5. VOICE ↔ IMAGE CROSS-VALIDATION:
   - Compare the farmer's voice complaint with the actual image.
   - relationship: "CONSISTENT" | "PARTIALLY_CONSISTENT" | "INCONSISTENT" | "INSUFFICIENT_EVIDENCE".
   - reasoning: Explain WHY the image supports or contradicts the farmer's description.
   - supporting_visual_evidence: list of specific visual observations supporting complaint.
   - missing_visual_evidence: list of expected signs that are not visible in the photo.
   - contradictions: list of contradictions between voice and image (if any).

6. SAFE AEO VERIFICATION APPROACH:
   - Actionable field verification guidance for the Agricultural Extension Officer.
   - NEVER prescribe pesticide or chemical dosages. Focus on field inspection and official advisories.

RETURN ONLY A STRICT VALID JSON OBJECT matching this schema:
{
  "overall_relevance": "RELEVANT" | "LIMITED_EVIDENCE" | "WRONG_CROP" | "HEALTHY_CROP" | "NON_RELEVANT",
  "images": [
    {
      "image_index": 1,
      "status": "RELEVANT",
      "quality": "good",
      "agriculture_relevance": "relevant",
      "visible_crop": "Tomato",
      "visible_symptoms": ["Brown circular leaf lesions", "Chlorotic halos"],
      "evidence_strength": "STRONG",
      "relationship_to_complaint": "Tomato foliage shows distinct brown spots matching farmer complaint.",
      "visual_evidence": ["Brown circular lesions on lower leaves"],
      "limitations": [],
      "spatial_mappings": [
        {
          "label": "Brown circular lesion area observed on lower leaf",
          "description": "Necrotic circular lesion on leaf blade",
          "confidence": 0.82,
          "bbox": {
            "x1": 0.15,
            "y1": 0.20,
            "x2": 0.48,
            "y2": 0.55
          },
          "evidence_type": "QWEN_VISUAL_MAPPING"
        }
      ]
    }
  ],
  "voice_image_assessment": {
    "relationship": "CONSISTENT",
    "confidence": 0.85,
    "reasoning": "Farmer reports round brown spots on tomato leaves for 5 days. Visual inspection reveals brown foliar lesions on tomato leaves compatible with the reported symptoms. AEO verification is required.",
    "supporting_visual_evidence": ["Brown circular lesions visible on leaves"],
    "missing_visual_evidence": [],
    "contradictions": []
  },
  "multimodal_assessment": {
    "model": "Qwen/Qwen3-VL-30B-A3B-Instruct",
    "voice_image_relationship": "CONSISTENT",
    "confidence": 0.85,
    "reasoning": "Visual evidence is broadly consistent with the farmer's report of spots on tomato leaves. Bounding boxes highlight the affected lesion areas. AEO verification required.",
    "supporting_evidence": ["Brown circular lesions visible on foliage"],
    "contradictions": [],
    "missing_evidence": [],
    "possible_conditions": ["Possible early stage fungal foliar spot or blight"],
    "evidence_strength": "STRONG",
    "why_ai_reached_assessment": "The image shows the reported crop (tomato) with foliar necrotic spotting that matches the farmer's description of expanding round brown spots.",
    "recommended_aeo_checks": [
      "Inspect underside of leaves for sporulation or concentric rings",
      "Check if lower older leaves are primarily affected",
      "Assess overall field incidence and moisture conditions"
    ]
  },
  "assessment": {
    "relationship": "CONSISTENT",
    "summary": "Visual evidence is consistent with tomato leaf spots reported by the farmer.",
    "requires_aeo_verification": true
  },
  "safe_aeo_approach": "Inspect affected and healthy leaves in the field, verify symptom spread and severity, check soil moisture conditions, and consult official agricultural department advisories before recommending treatment."
}
"""


def _sanitize_bbox(bbox: Any) -> Optional[Dict[str, float]]:
    """
    Validates and clamps normalized coordinates to [0.0, 1.0].
    Enforces 0.0 <= x1 < x2 <= 1.0 and 0.0 <= y1 < y2 <= 1.0.
    Rejects degenerate, pixel-coordinate (>2.0), or inverted boxes.
    """
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        bbox_dict = {"x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]}
    elif isinstance(bbox, dict):
        bbox_dict = bbox
    else:
        return None

    try:
        x1 = float(bbox_dict.get("x1", 0.0))
        y1 = float(bbox_dict.get("y1", 0.0))
        x2 = float(bbox_dict.get("x2", 0.0))
        y2 = float(bbox_dict.get("y2", 0.0))

        # Reject pixel coordinates (> 2.0 indicates pixel domain rather than normalized 0..1)
        if x1 > 2.0 or y1 > 2.0 or x2 > 2.0 or y2 > 2.0:
            return None

        # Clamp coordinates to [0.0, 1.0]
        x1 = max(0.0, min(1.0, x1))
        y1 = max(0.0, min(1.0, y1))
        x2 = max(0.0, min(1.0, x2))
        y2 = max(0.0, min(1.0, y2))

        if x2 <= x1 or y2 <= y1:
            return None

        if (x2 - x1) < 0.005 or (y2 - y1) < 0.005:
            return None

        return {
            "x1": round(x1, 4),
            "y1": round(y1, 4),
            "x2": round(x2, 4),
            "y2": round(y2, 4)
        }
    except (ValueError, TypeError):
        return None


def _parse_llm_json(raw_text: str) -> Dict[str, Any]:
    """
    Safely parses JSON from LLM output, stripping markdown fences or wrapping text if present.
    """
    cleaned = raw_text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    json_match = re.search(r'(\{[\s\S]*\})', cleaned)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Malformed LLM JSON response: {raw_text[:300]}")


async def _call_featherless_chat(messages: List[Dict[str, Any]], temperature: float = 0.1, max_tokens: int = 2048) -> str:
    """
    Calls Featherless AI OpenAI-compatible chat completions API with Qwen/Qwen3-VL-30B-A3B-Instruct.
    """
    api_key = settings.FEATHERLESS_API_KEY
    base_url = settings.FEATHERLESS_BASE_URL.rstrip("/")
    model_name = settings.FEATHERLESS_MODEL_NAME

    if not api_key or not api_key.strip():
        logger.warning("[Featherless] API key is not configured. Raising ValueError for caller fallback.")
        raise ValueError("Featherless API key is not configured in backend environment.")

    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"}
    }

    logger.info(f"[Featherless] Calling {model_name} at {url}")

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code != 200:
            err_msg = f"Featherless API returned status {response.status_code}: {response.text[:300]}"
            logger.error(f"[Featherless] {err_msg}")
            raise RuntimeError(err_msg)

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise ValueError("Featherless API returned empty choices.")

        content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise ValueError("Featherless API returned empty content.")

        return content


def _build_localized_farmer_response(
    intent_classification: str,
    language: Optional[str],
    crop: Optional[str] = None,
    plant_part: Optional[str] = None,
    symptoms: Optional[List[str]] = None,
    duration: Optional[str] = None,
    progression: Optional[str] = None,
    suspected_problem: Optional[str] = None,
) -> Dict[str, Any]:
    lang = (language or "Telugu").strip().lower()
    is_te = "te" in lang or "telugu" in lang
    is_hi = "hi" in lang or "hindi" in lang
    is_ta = "ta" in lang or "tamil" in lang
    is_kn = "kn" in lang or "kannada" in lang
    is_mr = "mr" in lang or "marathi" in lang

    crop_names = {
        "Tomato": {"te": "టమోటా", "hi": "टमाटर", "ta": "தக்காளி", "kn": "ಟೊಮೆಟೊ", "mr": "टोमॅटो"},
        "Paddy": {"te": "వరి", "hi": "धान", "ta": "நெல்", "kn": "ಭತ್ತ", "mr": "भात"},
        "Cotton": {"te": "పత్తి", "hi": "कपास", "ta": "பருத்தி", "kn": "ಹತ್ತಿ", "mr": "कापूस"},
        "Chilli": {"te": "మిరప", "hi": "मिर्च", "ta": "மிளகாய்", "kn": "ಮೆಣಸಿನಕಾಯಿ", "mr": "मिरची"},
        "Maize": {"te": "మొక్కజొన్న", "hi": "मक्का", "ta": "மக்காச்சோளம்", "kn": "ಮೆಕ್ಕೆಜೋಳ", "mr": "मका"},
    }

    crop_disp = crop or ("పంట" if is_te else "फसल" if is_hi else "Crop")
    if crop and crop in crop_names:
        if is_te: crop_disp = crop_names[crop]["te"]
        elif is_hi: crop_disp = crop_names[crop]["hi"]
        elif is_ta: crop_disp = crop_names[crop]["ta"]
        elif is_kn: crop_disp = crop_names[crop]["kn"]
        elif is_mr: crop_disp = crop_names[crop]["mr"]

    symptom_text = ", ".join(symptoms) if symptoms else (suspected_problem or ("సమస్య గమనించబడింది" if is_te else "Problem observed"))

    if intent_classification == "NOT_AGRICULTURE_RELATED":
        if is_te:
            msg = "దయచేసి పంట, మొక్క, పురుగులు, తెగుళ్లు, నేల, నీరు లేదా ఇతర వ్యవసాయ సమస్యల గురించి వివరించండి."
        elif is_hi:
            msg = "कृपया किसी फसल, पौधे, कीट, रोग, मिट्टी, पानी या अन्य कृषि समस्या के बारे में बताएं।"
        elif is_ta:
            msg = "பயிர், செடி, பூச்சி, நோய், மண், நீர் அல்லது விவசாய பிரச்சனை பற்றி கூறுங்கள்."
        elif is_kn:
            msg = "ದಯವಿಟ್ಟು ಬೆಳೆ, ಸಸ್ಯ, ಕೀಟ, ರೋಗ, ಮಣ್ಣು, ನೀರು ಅಥವಾ ಇತರ ಕೃಷಿ ಸಮಸ್ಯೆಯ ಬಗ್ಗೆ ತಿಳಿಸಿ."
        elif is_mr:
            msg = "कृपया पीक, वनस्पती, कीटक, रोग, माती, पाणी किंवा शेतीसंबंधित समस्येबद्दल सांगा."
        else:
            msg = "Could you please tell me about a farming problem, such as a crop, plant, pest, disease, soil, water, or other agricultural issue?"
        return {
            "conversational_response": msg,
            "photo_instructions_prompt": None,
            "photo_guidance": [],
            "complaint_summary_localized": {}
        }

    if intent_classification == "UNCLEAR":
        if is_te:
            msg = "ఇది మీ పంట, మొక్క, నేల, నీరు, పురుగులు లేదా వ్యవసాయానికి సంబంధించిన సమస్యేనా? దయచేసి స్పష్టంగా చెప్పండి."
        elif is_hi:
            msg = "क्या यह आपकी फसल, पौधे, मिट्टी, पानी, कीट या किसी अन्य कृषि गतिविधि की समस्या है? कृपया स्पष्ट बताएं।"
        elif is_ta:
            msg = "இது உங்கள் பயிர், செடி, மண், நீர் அல்லது விவசாயம் சார்ந்த பிரச்சனையா? தயவுசெய்து தெளிவாக கூறுங்கள்."
        elif is_kn:
            msg = "ಇದು ನಿಮ್ಮ ಬೆಳೆ, ಸಸ್ಯ, ಮಣ್ಣು, ನೀರು, ಕೀಟ ಅಥವಾ ಕೃಷಿ ಸಂಬಂಧಿತ ಸಮಸ್ಯೆಯೇ? ದಯವಿಟ್ಟು ಸ್ಪಷ್ಟವಾಗಿ ತಿಳಿಸಿ."
        elif is_mr:
            msg = "ही तुमच्या पिकाची, वनस्पतीची, मातीची किंवा शेतीची समस्या आहे का? कृपया स्पष्ट सांगा."
        else:
            msg = "Is this a problem with your crop, plant, soil, water, pest, or another farming activity?"
        return {
            "conversational_response": msg,
            "photo_instructions_prompt": None,
            "photo_guidance": [],
            "complaint_summary_localized": {}
        }

    # AGRICULTURE_RELATED
    if is_te:
        conv_resp = f"ధన్యవాదాలు. మీ {crop_disp} మొక్కల సమస్య గురించి అర్థమైంది."
        photo_prompt = "మీ మొక్క సమస్యను బాగా అర్థం చేసుకోవడానికి కొన్ని ఫోటోలు పంపండి."
        guidance = [
            "మచ్చలు లేదా మార్పు కనిపిస్తున్న ఆకును దగ్గరగా ఫోటో తీయండి.",
            "మొక్క మొత్తం కనిపించేలా ఒక ఫోటో తీయండి."
        ]
        summary = {
            "crop_label": "పంట",
            "crop_value": crop_disp,
            "problem_label": "సమస్య",
            "problem_value": symptom_text,
            "duration_label": "వ్యవధి",
            "duration_value": duration or "తెలియజేయలేదు",
            "progression_label": "పురోగతి",
            "progression_value": progression or "వ్యాపిస్తోంది"
        }
    elif is_hi:
        conv_resp = f"धन्यवाद। आपकी {crop_disp} की समस्या समझ में आ गई।"
        photo_prompt = "अपनी पौधे की समस्या को अच्छी तरह समझने के लिए कृपया कुछ फोटो भेजें।"
        guidance = [
            "प्रभावित भाग की पास से साफ फोटो लें।",
            "पूरे पौधे की एक फोटो लें।"
        ]
        summary = {
            "crop_label": "फसल",
            "crop_value": crop_disp,
            "problem_label": "समस्या",
            "problem_value": symptom_text,
            "duration_label": "अवधि",
            "duration_value": duration or "उल्लेखित नहीं",
            "progression_label": "प्रगति",
            "progression_value": progression or "देखी गई"
        }
    elif is_ta:
        conv_resp = f"நன்றி. உங்கள் {crop_disp} பிரச்சனை புரிந்தது."
        photo_prompt = "செடியின் பிரச்சனையை சரியாகப் புரிந்து கொள்ள சில புகைப்படங்களை அனுப்பவும்."
        guidance = [
            "பாதிக்கப்பட்ட பகுதியின் நெருக்கமான புகைப்படம் எடுக்கவும்.",
            "முழு செடியையும் காட்டும் ஒரு புகைப்படம் எடுக்கவும்."
        ]
        summary = {
            "crop_label": "பயிர்",
            "crop_value": crop_disp,
            "problem_label": "பிரச்சனை",
            "problem_value": symptom_text,
            "duration_label": "கால அளவு",
            "duration_value": duration or "குறிப்பிடப்படவில்லை",
            "progression_label": "நிலை",
            "progression_value": progression or "கண்டறியப்பட்டது"
        }
    elif is_kn:
        conv_resp = f"ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ {crop_disp} ಸಮಸ್ಯೆ ಅರ್ಥವಾಯಿತು."
        photo_prompt = "ನಿಮ್ಮ ಸಸ್ಯದ ಸಮಸ್ಯೆಯನ್ನು ಚೆನ್ನಾಗಿ ಅರ್ಥಮಾಡಿಕೊಳ್ಳಲು ದಯವಿಟ್ಟು ಕೆಲವು ಫೋಟೋಗಳನ್ನು ಕಳುಹಿಸಿ."
        guidance = [
            "ಸಮಸ್ಯೆ ಇರುವ ಭಾಗದ ಹತ್ತಿರದ ಸ್ಪಷ್ಟ ಫೋಟೋ ತೆಗೆದುಕೊಳ್ಳಿ.",
            "ಇಡೀ ಸಸ್ಯವನ್ನು ತೋರಿಸುವ ಫೋಟೋ ತೆಗೆದುಕೊಳ್ಳಿ."
        ]
        summary = {
            "crop_label": "ಬೆಳೆ",
            "crop_value": crop_disp,
            "problem_label": "ಸಮಸ್ಯೆ",
            "problem_value": symptom_text,
            "duration_label": "ಅವಧಿ",
            "duration_value": duration or "ತಿಳಿಸಿಲ್ಲ",
            "progression_label": "ಪ್ರಗತಿ",
            "progression_value": progression or "ಹೆಚ್ಚುತ್ತಿದೆ"
        }
    elif is_mr:
        conv_resp = f"धन्यवाद. तुमच्या {crop_disp} समस्येबद्दल समजले."
        photo_prompt = "समस्या चांगल्या प्रकारे समजून घेण्यासाठी कृपया काही फोटो पाठवा."
        guidance = [
            "प्रभावित भागाचा जवळून स्पष्ट फोटो घ्या.",
            "संपूर्ण रोपाचा एक फोटो घ्या."
        ]
        summary = {
            "crop_label": "पीक",
            "crop_value": crop_disp,
            "problem_label": "समस्या",
            "problem_value": symptom_text,
            "duration_label": "कालावधी",
            "duration_value": duration or "नमूद नाही",
            "progression_label": "प्रगती",
            "progression_value": progression or "निरीक्षण केले"
        }
    else:
        conv_resp = f"Thank you. I understood that you are having a problem with your {crop or 'crop'} plants."
        photo_prompt = "Please take a clear photo of the affected parts so I can understand the problem better."
        guidance = [
            "Take a clear close-up photo of the affected plant part.",
            "Take a wider photo showing the whole plant."
        ]
        summary = {
            "crop_label": "Crop",
            "crop_value": crop or "Not specified",
            "problem_label": "Problem",
            "problem_value": symptom_text,
            "duration_label": "Duration",
            "duration_value": duration or "Not stated",
            "progression_label": "Progress",
            "progression_value": progression or "Observed"
        }

    return {
        "conversational_response": conv_resp,
        "photo_instructions_prompt": photo_prompt,
        "photo_guidance": guidance,
        "complaint_summary_localized": summary
    }


async def validate_and_understand_agricultural_complaint(
    transcript: str,
    language_hint: Optional[str] = "Telugu"
) -> Dict[str, Any]:
    """
    Stage 1: Text-only Featherless Qwen3-VL analysis.
    1. Validates whether the transcript is genuinely agriculture-related.
    2. Understands the complaint and extracts structured details without hallucination.
    3. Generates conversational responses and tailored photo guidance in the farmer's language.
    """
    if not transcript or not transcript.strip():
        loc = _build_localized_farmer_response("NOT_AGRICULTURE_RELATED", language_hint)
        return {
            "agriculture_related": False,
            "intent_classification": "NOT_AGRICULTURE_RELATED",
            "reason": "Transcript is empty.",
            "conversational_response": loc["conversational_response"],
            "photo_instructions_prompt": None,
            "complaint": None,
            "complaint_summary_localized": {},
            "photo_guidance": []
        }

    clean_transcript = transcript.strip()
    if len(clean_transcript) > MAX_TRANSCRIPT_LENGTH:
        clean_transcript = clean_transcript[:MAX_TRANSCRIPT_LENGTH]

    user_prompt = f"""Spoken Farmer Transcript (Language: {language_hint}):
\"\"\"{clean_transcript}\"\"\"

Analyze this transcript for agricultural intent, extract structured details, and generate conversational responses and tailored photo guidance in {language_hint}."""

    messages = [
        {"role": "system", "content": STAGE1_INTENT_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    try:
        raw_output = await _call_featherless_chat(messages)
        parsed = _parse_llm_json(raw_output)

        is_agri = bool(parsed.get("agriculture_related", False))
        intent_class = parsed.get("intent_classification") or ("AGRICULTURE_RELATED" if is_agri else "NOT_AGRICULTURE_RELATED")
        reason = str(parsed.get("reason") or ("Agriculture-related issue detected" if is_agri else "Non-agricultural conversation"))

        complaint = parsed.get("complaint") or {}
        crop = complaint.get("crop")
        if crop and isinstance(crop, str) and crop.strip().lower() in ["null", "none", "unknown", ""]:
            crop = None

        symptoms = complaint.get("symptoms") or []
        if not isinstance(symptoms, list):
            symptoms = [str(symptoms)] if symptoms else []

        # Localized helper fallback in case LLM omitted conversational fields
        loc_fallback = _build_localized_farmer_response(
            intent_classification=intent_class,
            language=language_hint,
            crop=crop,
            plant_part=complaint.get("plant_part"),
            symptoms=symptoms,
            duration=complaint.get("duration"),
            progression=complaint.get("progression"),
            suspected_problem=complaint.get("suspected_problem"),
        )

        conversational_response = parsed.get("conversational_response") or loc_fallback["conversational_response"]
        photo_prompt = parsed.get("photo_instructions_prompt") or loc_fallback["photo_instructions_prompt"]
        localized_summary = parsed.get("complaint_summary_localized") or loc_fallback["complaint_summary_localized"]

        photo_guidance = parsed.get("photo_guidance") or []
        if not isinstance(photo_guidance, list) or len(photo_guidance) == 0:
            photo_guidance = loc_fallback["photo_guidance"]

        if not is_agri or intent_class == "NOT_AGRICULTURE_RELATED":
            return {
                "agriculture_related": False,
                "intent_classification": "NOT_AGRICULTURE_RELATED",
                "reason": reason,
                "conversational_response": conversational_response,
                "photo_instructions_prompt": None,
                "complaint": None,
                "complaint_summary_localized": {},
                "photo_guidance": []
            }

        if intent_class == "UNCLEAR":
            return {
                "agriculture_related": False,
                "intent_classification": "UNCLEAR",
                "reason": reason,
                "conversational_response": conversational_response,
                "photo_instructions_prompt": None,
                "complaint": None,
                "complaint_summary_localized": {},
                "photo_guidance": []
            }

        structured_complaint = {
            "crop": crop,
            "plant_part": complaint.get("plant_part"),
            "symptoms": symptoms,
            "duration": complaint.get("duration"),
            "progression": complaint.get("progression"),
            "severity": complaint.get("severity"),
            "suspected_problem": complaint.get("suspected_problem"),
            "affected_area": complaint.get("affected_area"),
            "farmer_concern": complaint.get("farmer_concern"),
            "relevant_context": complaint.get("relevant_context")
        }

        return {
            "agriculture_related": True,
            "intent_classification": "AGRICULTURE_RELATED",
            "reason": reason,
            "conversational_response": conversational_response,
            "photo_instructions_prompt": photo_prompt,
            "complaint": structured_complaint,
            "complaint_summary_localized": localized_summary,
            "photo_guidance": photo_guidance
        }

    except Exception as exc:
        logger.warning(f"[LLM] Featherless Stage 1 call failed or key missing: {exc}. Using intelligent fallback.")
        lower_t = clean_transcript.lower()
        agri_keywords = [
            "leaf", "leaves", "crop", "paddy", "rice", "cotton", "chilli", "mirapa", "tomato", "maize",
            "plant", "plants", "pest", "pests", "insect", "insects", "yellow", "yellowing", "spot", "spots",
            "wilt", "wilting", "rot", "rotting", "fungus", "disease", "farm", "field", "acidity", "yield",
            "వరి", "పత్తి", "మిరప", "మొక్కజొన్న", "రైతు", "చేను", "ఆకులు", "పురుగు", "తెగులు", "మచ్చలు", "ఎండిపోవడం"
        ]
        has_agri_word = any(kw in lower_t for kw in agri_keywords)

        if not has_agri_word:
            loc = _build_localized_farmer_response("NOT_AGRICULTURE_RELATED", language_hint)
            return {
                "agriculture_related": False,
                "intent_classification": "NOT_AGRICULTURE_RELATED",
                "reason": "The spoken words do not appear to mention agricultural crops, plants, or symptoms.",
                "conversational_response": loc["conversational_response"],
                "photo_instructions_prompt": None,
                "complaint": None,
                "complaint_summary_localized": {},
                "photo_guidance": []
            }

        crop_map = {
            "tomato": "Tomato",
            "టమోటా": "Tomato",
            "టమాట": "Tomato",
            "tamatar": "Tomato",
            "chilli": "Chilli",
            "mirapa": "Chilli",
            "మిరప": "Chilli",
            "mirch": "Chilli",
            "cotton": "Cotton",
            "పత్తి": "Cotton",
            "kapas": "Cotton",
            "paddy": "Paddy",
            "rice": "Paddy",
            "వరి": "Paddy",
            "dhan": "Paddy",
            "maize": "Maize",
            "మొక్కజొన్న": "Maize",
            "makka": "Maize"
        }
        detected_crop = None
        for k, v in crop_map.items():
            if k in lower_t:
                detected_crop = v
                break

        plant_part = "Leaves" if any(w in lower_t for w in ["leaf", "leaves", "ఆకు", "ఆకులు", "పత్తి", "पत्ती", "पत्ते"]) else None
        symptoms = []
        if any(w in lower_t for w in ["spot", "spots", "మచ్చలు", "మచ్చ", "धब्बा", "दाग"]):
            symptoms.append("Leaf spots")
        if any(w in lower_t for w in ["yellow", "yellowing", "పసుపు", "पीला"]):
            symptoms.append("Yellowing leaves")
        if any(w in lower_t for w in ["curl", "curling", "ముడుచు", "मुड़"]):
            symptoms.append("Leaf curling")
        if any(w in lower_t for w in ["dry", "drying", "wilt", "wilting", "ఎండి", "सूख"]):
            symptoms.append("Drying / wilting foliage")
        if not symptoms:
            symptoms = ["Observed symptoms reported in voice transcript"]

        duration = None
        duration_match = re.search(r'(\d+)\s*(days?|రోజులు|రోజుల|दिन)', lower_t)
        if duration_match:
            duration = f"{duration_match.group(1)} days"

        progression = "Spreading" if any(w in lower_t for w in ["spread", "increasing", "వ్యాపి", "పెరుగు", "फैल"]) else None

        loc = _build_localized_farmer_response(
            intent_classification="AGRICULTURE_RELATED",
            language=language_hint,
            crop=detected_crop,
            plant_part=plant_part,
            symptoms=symptoms,
            duration=duration,
            progression=progression,
        )

        return {
            "agriculture_related": True,
            "intent_classification": "AGRICULTURE_RELATED",
            "reason": "Agricultural keywords detected in transcript.",
            "conversational_response": loc["conversational_response"],
            "photo_instructions_prompt": loc["photo_instructions_prompt"],
            "complaint": {
                "crop": detected_crop,
                "plant_part": plant_part,
                "symptoms": symptoms,
                "duration": duration,
                "progression": progression,
                "severity": None,
                "suspected_problem": None,
                "affected_area": None,
                "farmer_concern": clean_transcript[:180],
                "relevant_context": None
            },
            "complaint_summary_localized": loc["complaint_summary_localized"],
            "photo_guidance": loc["photo_guidance"]
        }


async def evaluate_multimodal_evidence(
    complaint: Dict[str, Any],
    photos_data: List[Dict[str, Any]],
    yolo_findings: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Stage 2: Multimodal Featherless Qwen3-VL reasoning.
    Sends complaint + 1-4 images + YOLO11 findings to Qwen/Qwen3-VL-30B-A3B-Instruct.
    Returns:
    - overall_relevance, images (per-image evaluation & spatial mappings)
    - voice_image_assessment (consistency, reasoning, evidence)
    - multimodal_assessment (structured AEO synthesis & checks)
    - visual_mappings (independent Qwen normalized spatial bounding boxes)
    - vision (yolo detections + Qwen visual findings)
    - safe_aeo_approach
    """
    if not photos_data:
        fallback_assessment = {
            "relationship": "LIMITED_EVIDENCE",
            "summary": "No photos were provided for visual evaluation.",
            "requires_aeo_verification": True
        }
        return {
            "overall_relevance": "NON_RELEVANT",
            "images": [],
            "assessment": fallback_assessment,
            "voice_image_assessment": {
                "relationship": "INSUFFICIENT_EVIDENCE",
                "confidence": 0.0,
                "reasoning": "No photographic evidence was uploaded to cross-verify the farmer's voice complaint.",
                "supporting_visual_evidence": [],
                "missing_visual_evidence": ["Crop photos"],
                "contradictions": []
            },
            "multimodal_assessment": {
                "model": settings.FEATHERLESS_MODEL_NAME,
                "voice_image_relationship": "INSUFFICIENT_EVIDENCE",
                "confidence": 0.0,
                "reasoning": "No photographic evidence submitted. AEO manual field verification required.",
                "supporting_evidence": [],
                "contradictions": [],
                "missing_evidence": ["All visual evidence"],
                "recommended_aeo_checks": ["Request in-person photo or schedule field inspection"]
            },
            "visual_mappings": [],
            "vision": {
                "yolo_detections": yolo_findings or [],
                "qwen_visual_findings": []
            },
            "safe_aeo_approach": "Field verification recommended by AEO officer."
        }

    content_parts = []

    complaint_summary = json.dumps(complaint or {}, indent=2)
    yolo_summary = json.dumps(yolo_findings or [], indent=2)

    reported_crop = (complaint or {}).get("crop") or "Unknown"

    prompt_text = f"""EXPECTED / REPORTED CROP FROM COMPLAINT: {reported_crop}

FARMER'S COMPLAINT DETAILS:
{complaint_summary}

LOCAL YOLO11 DETECTIONS (FOR CONTEXT):
{yolo_summary}

Please inspect the attached {len(photos_data)} photo(s).
MANDATORY STEP 1: For each photo, check whether it actually shows the REPORTED CROP ({reported_crop}).
- If a photo shows a DIFFERENT crop or plant (e.g. photo shows Paddy/Rice when reported crop is Cotton, or photo shows Banana/Coconut/Mango/Tomato/Chilli/Weed), classify status as "WRONG_CROP" and spatial_mappings as [].
MANDATORY STEP 2: For photos matching the reported crop:
- Classify status ("RELEVANT" / "LIMITED_EVIDENCE" / "HEALTHY_CROP").
- For every meaningful visible symptom or lesion area, identify approximately where it appears in the image. Return normalized bounding boxes (0.0 to 1.0) with label, description, confidence, evidence_type: 'QWEN_VISUAL_MAPPING'.
- Do NOT draw boxes around healthy leaves or background objects.
MANDATORY STEP 3: Produce voice ↔ image cross-validation and structured multimodal assessment explaining WHY the image supports or contradicts the farmer's description without claiming confirmed diagnosis."""

    content_parts.append({"type": "text", "text": prompt_text})

    for p in photos_data:
        p_bytes = p.get("bytes")
        p_idx = p.get("index", 0) + 1
        if p_bytes:
            b64_img = base64.b64encode(p_bytes).decode("utf-8")
            content_parts.append({"type": "text", "text": f"\n--- Photo #{p_idx} ---"})
            content_parts.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{b64_img}"
                }
            })

    messages = [
        {"role": "system", "content": STAGE2_MULTIMODAL_SYSTEM_PROMPT},
        {"role": "user", "content": content_parts}
    ]

    try:
        raw_output = await _call_featherless_chat(messages, max_tokens=3000)
        parsed = _parse_llm_json(raw_output)

        raw_images = parsed.get("images") or []
        overall_rel = parsed.get("overall_relevance", "RELEVANT")
        assessment = parsed.get("assessment") or {}
        safe_approach = parsed.get("safe_aeo_approach") or (
            "Inspect affected and healthy leaves in the field, verify symptom spread and severity, "
            "and check crop-management conditions according to applicable agricultural advisory."
        )

        voice_image_assessment = parsed.get("voice_image_assessment") or {}
        multimodal_assessment = parsed.get("multimodal_assessment") or {}

        # Synthesize relationship and reasoning
        rel = voice_image_assessment.get("relationship") or assessment.get("relationship") or "CONSISTENT"
        reasoning = (
            multimodal_assessment.get("reasoning")
            or voice_image_assessment.get("reasoning")
            or assessment.get("summary")
            or "Visual evidence is consistent with the reported symptoms."
        )

        assessment["relationship"] = rel
        assessment["summary"] = reasoning
        assessment["requires_aeo_verification"] = True

        # Process and sanitize per-image spatial mappings
        all_visual_mappings = []
        sanitized_images = []
        qwen_visual_findings = []

        for idx, img in enumerate(raw_images):
            img_idx = img.get("image_index", idx + 1)
            raw_mappings = img.get("spatial_mappings") or []
            clean_mappings = []

            for m in raw_mappings:
                clean_box = _sanitize_bbox(m.get("bbox") or m.get("bbox_normalized"))
                if clean_box:
                    map_item = {
                        "image_index": img_idx,
                        "image_id": f"image_{img_idx}",
                        "label": str(m.get("label") or "Visual finding"),
                        "description": str(m.get("description") or m.get("label") or "Observed symptom area"),
                        "confidence": float(m.get("confidence") or 0.82),
                        "bbox_normalized": clean_box,
                        "source": "QWEN3_VL",
                        "evidence_type": "QWEN_VISUAL_MAPPING"
                    }
                    clean_mappings.append(map_item)
                    all_visual_mappings.append(map_item)

            img_copy = dict(img)
            img_copy["spatial_mappings"] = clean_mappings
            sanitized_images.append(img_copy)

            if img.get("visual_evidence") and isinstance(img["visual_evidence"], list):
                qwen_visual_findings.extend(img["visual_evidence"])

        # Ensure structured multimodal_assessment format
        final_multimodal_assessment = {
            "model": settings.FEATHERLESS_MODEL_NAME,
            "voice_image_relationship": rel,
            "confidence": float(multimodal_assessment.get("confidence") or voice_image_assessment.get("confidence") or 0.85),
            "reasoning": reasoning,
            "supporting_evidence": (
                multimodal_assessment.get("supporting_evidence")
                or voice_image_assessment.get("supporting_visual_evidence")
                or []
            ),
            "contradictions": (
                multimodal_assessment.get("contradictions")
                or voice_image_assessment.get("contradictions")
                or []
            ),
            "missing_evidence": (
                multimodal_assessment.get("missing_evidence")
                or voice_image_assessment.get("missing_visual_evidence")
                or []
            ),
            "possible_conditions": multimodal_assessment.get("possible_conditions") or [
                f"Possible symptoms consistent with {reported_crop} leaf stress"
            ],
            "evidence_strength": multimodal_assessment.get("evidence_strength") or ("STRONG" if rel == "CONSISTENT" else "MODERATE"),
            "why_ai_reached_assessment": (
                multimodal_assessment.get("why_ai_reached_assessment")
                or reasoning
            ),
            "recommended_aeo_checks": multimodal_assessment.get("recommended_aeo_checks") or [
                "Inspect affected foliage in field for pattern and spread",
                "Verify underside of leaves for pest or fungal activity",
                "Assess overall crop vigor and field moisture conditions"
            ]
        }

        final_voice_image_assessment = {
            "relationship": rel,
            "confidence": float(voice_image_assessment.get("confidence") or 0.85),
            "reasoning": reasoning,
            "supporting_visual_evidence": final_multimodal_assessment["supporting_evidence"],
            "missing_visual_evidence": final_multimodal_assessment["missing_evidence"],
            "contradictions": final_multimodal_assessment["contradictions"]
        }

        return {
            "overall_relevance": overall_rel,
            "images": sanitized_images,
            "assessment": assessment,
            "safe_aeo_approach": safe_approach,
            "multimodal_assessment": final_multimodal_assessment,
            "voice_image_assessment": final_voice_image_assessment,
            "visual_mappings": all_visual_mappings,
            "vision": {
                "yolo_detections": yolo_findings or [],
                "qwen_visual_findings": list(set(qwen_visual_findings))
            }
        }

    except Exception as exc:
        logger.warning(f"[LLM] Multimodal Featherless call failed or key missing: {exc}. Generating structured fallback from YOLO11 findings.")
        image_evals = []
        has_any_useful = False
        all_visual_mappings = []

        for idx, p in enumerate(photos_data):
            p_idx = p.get("index", idx) + 1
            matching_yolo = next((y for y in (yolo_findings or []) if y.get("photo_index") == idx or y.get("index") == idx), None)
            dets = matching_yolo.get("detections", []) if matching_yolo else []
            usable = matching_yolo.get("usable", True) if matching_yolo else True

            if not usable:
                status = "NON_AGRICULTURAL"
                rel_text = "Image failed usability/agricultural relevance checks."
            elif dets:
                status = "RELEVANT"
                rel_text = f"Visual agricultural evidence detected ({len(dets)} symptom markers observed)."
                has_any_useful = True
            else:
                status = "LIMITED_EVIDENCE"
                rel_text = "Crop foliage visible but specific disease symptoms require closer field verification."
                has_any_useful = True

            image_evals.append({
                "image_index": p_idx,
                "status": status,
                "quality": "moderate",
                "agriculture_relevance": "relevant" if has_any_useful else "limited",
                "visible_crop": reported_crop,
                "visible_symptoms": [d.get("class_name", d.get("label", "symptom")) for d in dets],
                "evidence_strength": "MODERATE" if dets else "LIMITED",
                "relationship_to_complaint": rel_text,
                "visual_evidence": [d.get("class_name", d.get("label", "symptom")) for d in dets],
                "limitations": ["Evaluated via local detection pipeline fallback"],
                "spatial_mappings": []
            })

        overall_rel = "RELEVANT" if has_any_useful else "NON_RELEVANT"
        relationship = "PARTIALLY_CONSISTENT" if has_any_useful else "LIMITED_EVIDENCE"
        fallback_reasoning = (
            f"Visual evidence is {relationship.lower().replace('_', ' ')} with the reported {reported_crop} issue. "
            f"Local computer vision detected {sum(len(img.get('visual_evidence', [])) for img in image_evals)} potential symptom marker(s). "
            f"Multimodal AI assessment unavailable — manual AEO review required."
        )

        fallback_multimodal = {
            "model": f"{settings.FEATHERLESS_MODEL_NAME} (Fallback)",
            "voice_image_relationship": relationship,
            "confidence": 0.70,
            "reasoning": fallback_reasoning,
            "supporting_evidence": [f"Visual symptom markers observed on {reported_crop}"],
            "contradictions": [],
            "missing_evidence": ["Full multimodal inference pending"],
            "possible_conditions": [f"Suspected {reported_crop} stress"],
            "evidence_strength": "MODERATE" if has_any_useful else "LIMITED",
            "why_ai_reached_assessment": "Local specialized YOLO11 detections processed while higher-level multimodal cloud model was temporarily unreachable.",
            "recommended_aeo_checks": [
                "Inspect affected foliage directly in the field",
                "Verify severity and spread across plot",
                "Check irrigation and weather conditions"
            ]
        }

        fallback_voice_img = {
            "relationship": relationship,
            "confidence": 0.70,
            "reasoning": fallback_reasoning,
            "supporting_visual_evidence": fallback_multimodal["supporting_evidence"],
            "missing_visual_evidence": fallback_multimodal["missing_evidence"],
            "contradictions": []
        }

        return {
            "overall_relevance": overall_rel,
            "images": image_evals,
            "assessment": {
                "relationship": relationship,
                "summary": fallback_reasoning,
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Inspect affected and healthy leaves, verify the suspected condition in the field, assess severity and spread, check relevant crop-management conditions, and follow the applicable agricultural advisory before recommending treatment.",
            "multimodal_assessment": fallback_multimodal,
            "voice_image_assessment": fallback_voice_img,
            "visual_mappings": [],
            "vision": {
                "yolo_detections": yolo_findings or [],
                "qwen_visual_findings": []
            }
        }


async def extract_agricultural_meaning(
    transcript: str,
    language_hint: Optional[str] = "Telugu",
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Backwards-compatible wrapper calling validate_and_understand_agricultural_complaint.
    """
    result = await validate_and_understand_agricultural_complaint(transcript, language_hint)
    complaint = result.get("complaint") or {}

    structured_data = {
        "agriculture_related": result.get("agriculture_related", True),
        "reason": result.get("reason"),
        "crop": complaint.get("crop"),
        "plant_part": complaint.get("plant_part"),
        "symptoms": complaint.get("symptoms", []),
        "duration": complaint.get("duration"),
        "progression": complaint.get("progression"),
        "severity": complaint.get("severity"),
        "suspected_problem": complaint.get("suspected_problem"),
        "farmer_concern": complaint.get("farmer_concern"),
        "photo_guidance": result.get("photo_guidance", []),
        "requires_aeo_review": True
    }

    return {
        "structured_data": structured_data,
        "crop_detected": complaint.get("crop"),
        "symptoms": complaint.get("symptoms", []),
        "possible_conditions": [complaint.get("suspected_problem")] if complaint.get("suspected_problem") else [],
        "llm_summary": complaint.get("farmer_concern") or transcript[:200],
        "requires_aeo_review": True,
        "model_name": settings.FEATHERLESS_MODEL_NAME,
        "model_version": "3.0-vl"
    }


FOLLOWUP_COMPARISON_SYSTEM_PROMPT = """You are an expert Agricultural Multimodal Reasoning AI for KisaanSaathi.
You are comparing a farmer's follow-up update with previous case evidence to evaluate chronological disease/symptom progression.

CRITICAL RULES:
1. Objectively evaluate whether the crop condition is:
   - "IMPROVING": Visible reduction in symptoms, healthier new growth, reduced discoloration/wilting.
   - "UNCHANGED": Symptoms remain at the same level without notable improvement or spread.
   - "WORSENING": Clear increase in symptom severity, expanding lesion size, higher pest density, or increased wilting/blight.
   - "INSUFFICIENT_EVIDENCE": The new update or photos are too blurry, too distant, or non-comparable to reliably determine progression.
2. STRICT OBJECTIVITY:
   - DO NOT infer worsening merely because lighting, camera angle, or framing differs.
   - Base your assessment strictly on visible plant tissue symptoms and the farmer's stated update.
3. The human Agricultural Extension Officer (AEO) remains the final decision maker. Your evaluation is preliminary.

RETURN ONLY A STRICT VALID JSON OBJECT matching this schema:
{
  "outcome": "IMPROVING" | "UNCHANGED" | "WORSENING" | "INSUFFICIENT_EVIDENCE",
  "reason": "Detailed, evidence-grounded explanation comparing previous vs current state",
  "visual_markers_change": "Observed change in symptoms or tissue condition",
  "recommended_aeo_action": "MONITOR" | "FIELD_VISIT" | "REOPEN" | "ESCALATE"
}
"""


async def compare_followup_evidence(
    previous_evidence: Dict[str, Any],
    followup_text: str,
    followup_photos: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Featherless Qwen3-VL multimodal comparison between initial complaint evidence and new follow-up update.
    Returns structured outcome (IMPROVING, UNCHANGED, WORSENING, INSUFFICIENT_EVIDENCE) and reason.
    """
    clean_text = (followup_text or "").strip()
    
    content_parts = []
    prev_summary = json.dumps(previous_evidence or {}, indent=2)
    prompt_text = f"""PREVIOUS CASE EVIDENCE & FINDINGS:
{prev_summary}

FARMER'S CURRENT FOLLOW-UP UPDATE:
"{clean_text}"

Please compare the new follow-up update (and attached photo if provided) with the previous case evidence.
Determine whether the crop is IMPROVING, UNCHANGED, WORSENING, or INSUFFICIENT_EVIDENCE."""

    content_parts.append({"type": "text", "text": prompt_text})

    if followup_photos:
        for idx, p in enumerate(followup_photos):
            p_bytes = p.get("bytes")
            if p_bytes:
                b64 = base64.b64encode(p_bytes).decode("utf-8")
                content_parts.append({"type": "text", "text": f"\n--- Follow-up Photo #{idx + 1} ---"})
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                })

    messages = [
        {"role": "system", "content": FOLLOWUP_COMPARISON_SYSTEM_PROMPT},
        {"role": "user", "content": content_parts}
    ]

    try:
        raw_output = await _call_featherless_chat(messages, max_tokens=1500)
        parsed = _parse_llm_json(raw_output)
        outcome = parsed.get("outcome", "INSUFFICIENT_EVIDENCE")
        if outcome not in ("IMPROVING", "UNCHANGED", "WORSENING", "INSUFFICIENT_EVIDENCE"):
            outcome = "INSUFFICIENT_EVIDENCE"

        return {
            "outcome": outcome,
            "reason": parsed.get("reason", "Follow-up comparison evaluated by Qwen3-VL."),
            "visual_markers_change": parsed.get("visual_markers_change", "N/A"),
            "recommended_aeo_action": parsed.get("recommended_aeo_action", "MONITOR")
        }
    except Exception as exc:
        logger.warning(f"[LLM] Followup comparison call failed or key missing: {exc}. Using deterministic fallback.")
        lower = clean_text.lower()
        worsening_words = ["worse", "increasing", "spreading", "more spots", "more damage", "dying", "sever", "తీవ్ర", "పెరిగింది", "ఎక్కువైంది", "నష్టం"]
        improving_words = ["better", "recovering", "new leaves", "improved", "less", "healthy now", "తగ్గింది", "బాగుంది", "నయమైంది"]

        if any(w in lower for w in worsening_words):
            return {
                "outcome": "WORSENING",
                "reason": "Farmer indicates increasing symptoms or spreading crop damage in follow-up note.",
                "visual_markers_change": "Farmer reported worsening symptoms.",
                "recommended_aeo_action": "FIELD_VISIT"
            }
        elif any(w in lower for w in improving_words):
            return {
                "outcome": "IMPROVING",
                "reason": "Farmer indicates recovery or healthy new foliage in follow-up note.",
                "visual_markers_change": "Farmer reported improvement in crop condition.",
                "recommended_aeo_action": "MONITOR"
            }
        elif len(clean_text) > 0:
            return {
                "outcome": "UNCHANGED",
                "reason": "Condition reported without significant change or clear trend.",
                "visual_markers_change": "No decisive directional change reported.",
                "recommended_aeo_action": "MONITOR"
            }
        else:
            return {
                "outcome": "INSUFFICIENT_EVIDENCE",
                "reason": "Follow-up update provided insufficient detail to determine progression.",
                "visual_markers_change": "Insufficient evidence.",
                "recommended_aeo_action": "MONITOR"
            }


SIMILAR_ISSUES_SYSTEM_PROMPT = """You are an expert Agricultural Intelligence system for KisaanSaathi.
Your task is to compare a farmer's newly reported crop problem against candidate historical agricultural cases and determine genuine symptom and problem similarity.

CRITICAL REASONING RULES:
1. SEMANTIC & SYMPTOM SIMILARITY:
   - The match MUST be based on actual symptoms, affected plant parts, and biological conditions (e.g. leaf spots, necrotic lesions, yellowing, blight, powdery mildew, wilting, leaf curl).
   - DO NOT match issues solely because the crop is the same! For example, a tomato leaf spot issue MUST NOT match a tomato price complaint, a tomato irrigation/watering problem, or tomato fruit cracking.
   - Genuine similarity means both cases describe compatible damage patterns or pathology.

2. LOCALIZED EXPLANATIONS:
   - For each genuinely similar case, provide a concise, farmer-friendly explanation ("why_similar") in the requested language (e.g. Telugu, Hindi, Tamil, Kannada, English) explaining WHY this previous case is similar to what they are seeing (e.g. in Telugu: "టమాటా ఆకులపై ఇలాంటి గోధుమ రంగు మచ్చలు గతంలో నమోదయ్యాయి.").

3. STRICT TRUTHFULNESS:
   - If a candidate is NOT genuinely similar in symptoms/problem, set "is_genuinely_similar": false and "similarity_score" below 0.4.
   - Set "is_genuinely_similar": true ONLY if the candidate truly shares compatible agricultural symptoms.

RETURN ONLY A VALID JSON OBJECT matching this schema:
{
  "matches": [
    {
      "candidate_id": "string",
      "is_genuinely_similar": true,
      "similarity_score": 0.85,
      "why_similar": "Concise localized explanation in requested language"
    }
  ]
}
"""


def _deterministic_symptom_similarity_fallback(
    current_case: Dict[str, Any],
    candidate_cases: List[Dict[str, Any]],
    language: str = "Telugu"
) -> List[Dict[str, Any]]:
    """
    Deterministic rule-based fallback when Featherless Qwen3-VL is unavailable.
    Compares crop, symptom keywords, and disease types with precision.
    """
    is_te = "te" in language.lower() or "telugu" in language.lower()
    is_hi = "hi" in language.lower() or "hindi" in language.lower()
    is_ta = "ta" in language.lower() or "tamil" in language.lower()
    is_kn = "kn" in language.lower() or "kannada" in language.lower()

    cur_crop = str(current_case.get("crop") or "").strip().lower()
    cur_prob = str(current_case.get("problem") or current_case.get("description") or "").lower()
    cur_syms = [str(s).lower() for s in (current_case.get("symptoms") or [])]
    cur_all_text = f"{cur_prob} {' '.join(cur_syms)}"

    # Symptom categories
    categories = {
        "spots": ["spot", "spots", "lesion", "lesions", "మచ్చలు", "మచ్చ", "धब्बे", "புள்ளி", "ಚುಕ್ಕೆ"],
        "drying": ["dry", "drying", "wither", "blight", "ఎండి", "ఎండిపో", "सूख", "உலர்தல்", "ಒಣಗ"],
        "wilting": ["wilt", "wilting", "droop", "వాడిపో", "వాడటం", "मुरझा", "வாடுதல்", "ಬಾಡು"],
        "yellowing": ["yellow", "yellowing", "chlorosis", "పసుపు", "పీత", "पीला", "மஞ்சள்", "ಹಳದಿ"],
        "rot": ["rot", "rotting", "decay", "కుళ్ళు", "కుళ్ళి", "सड़न", "அழுகல்", "ಕೊಳೆ"],
        "curling": ["curl", "curling", "ముడుచు", "ముడత", "मुड़ना", "சுருள்", "ಮುದುಡು"],
        "pest": ["insect", "pest", "caterpillar", "worm", "పురుగు", "కీటకం", "कीट", "பூச்சி", "ಕೀಟ"],
    }

    # Identify current active categories
    cur_cats = set()
    for cat, keywords in categories.items():
        if any(kw in cur_all_text for kw in keywords):
            cur_cats.add(cat)

    results = []
    for cand in candidate_cases:
        cid = str(cand.get("id") or cand.get("candidate_id") or "")
        cand_crop = str(cand.get("crop") or "").strip().lower()
        cand_prob = str(cand.get("problem") or cand.get("description") or "").lower()
        cand_syms = [str(s).lower() for s in (cand.get("symptoms") or [])]
        cand_all_text = f"{cand_prob} {' '.join(cand_syms)}"

        # 1. Unrelated non-symptom filters (e.g. price, marketing, subsidies, irrigation only)
        unrelated_kws = ["price", "market", "mandi", "subsidy", "loan", "ధర", "మార్కెట్", "రేటు", "भाव", "बाजार"]
        if any(uk in cand_all_text for uk in unrelated_kws) and not any(kw in cand_all_text for kw in ["spot", "blight", "pest", "disease", "మచ్చలు"]):
            results.append({
                "candidate_id": cid,
                "is_genuinely_similar": False,
                "similarity_score": 0.1,
                "why_similar": None
            })
            continue

        # 2. Crop alignment
        crop_match = (
            cur_crop == cand_crop or
            ("tomato" in cur_crop and "టమాటా" in cand_crop) or
            ("టమాటా" in cur_crop and "tomato" in cand_crop) or
            ("cotton" in cur_crop and "పత్తి" in cand_crop) or
            ("పత్తి" in cur_crop and "cotton" in cand_crop) or
            ("paddy" in cur_crop and "వరి" in cand_crop) or
            ("వరి" in cur_crop and "paddy" in cand_crop) or
            ("chilli" in cur_crop and "మిరప" in cand_crop) or
            ("మిరప" in cur_crop and "chilli" in cand_crop)
        )

        # 3. Overlap of active categories
        cand_cats = set()
        for cat, keywords in categories.items():
            if any(kw in cand_all_text for kw in keywords):
                cand_cats.add(cat)

        cat_overlap = len(cur_cats.intersection(cand_cats))

        # Direct token overlap
        cur_tokens = set(re.findall(r'\b\w{4,}\b', cur_all_text))
        cand_tokens = set(re.findall(r'\b\w{4,}\b', cand_all_text))
        token_overlap = len(cur_tokens.intersection(cand_tokens))

        if crop_match and (cat_overlap >= 1 or token_overlap >= 2):
            score = 0.65 + min(0.3, cat_overlap * 0.15 + token_overlap * 0.05)
            # Build localized explanation
            shared_cat = list(cur_cats.intersection(cand_cats))
            feature = shared_cat[0] if shared_cat else "లక్షణాలు"
            if is_te:
                if "spots" in shared_cat:
                    why = "టమాటా ఆకులపై ఇలాంటి మచ్చలు గతంలో నమోదయ్యాయి."
                elif "drying" in shared_cat or "wilting" in shared_cat:
                    why = "మొక్కలు వాడిపోవడం, ఆకులు ఎండిపోయే లక్షణాలు సరిపోలుతున్నాయి."
                else:
                    why = "ఇలాంటి పంట లక్షణాలు గతంలో నమోదయ్యాయి."
            elif is_hi:
                if "spots" in shared_cat:
                    why = "पत्तियों पर इसी तरह के धब्बे पहले दर्ज किए गए थे।"
                else:
                    why = "फसल में इसी प्रकार के लक्षण पहले दर्ज किए गए थे।"
            elif is_ta:
                why = "இதே போன்ற பயிர் பாதிப்பு அறிகுறிகள் முன்னதாக பதிவாகியுள்ளன."
            elif is_kn:
                why = "ಇದೇ ರೀತಿಯ ಬೆಳೆ ಲಕ್ಷಣಗಳು ಈ ಹಿಂದೆ ವರದಿಯಾಗಿವೆ."
            else:
                if "spots" in shared_cat:
                    why = "Similar leaf spots and drying symptoms were previously reported on this crop."
                else:
                    why = "Similar foliar crop symptoms were previously reported."

            results.append({
                "candidate_id": cid,
                "is_genuinely_similar": True,
                "similarity_score": round(score, 2),
                "why_similar": why
            })
        elif crop_match and cat_overlap == 0:
            # Same crop but completely different problem (e.g. fruit cracking vs leaf spots)
            results.append({
                "candidate_id": cid,
                "is_genuinely_similar": False,
                "similarity_score": 0.25,
                "why_similar": None
            })
        else:
            # Different crop
            results.append({
                "candidate_id": cid,
                "is_genuinely_similar": False,
                "similarity_score": 0.15,
                "why_similar": None
            })

    return results


async def evaluate_candidate_similarity_qwen(
    current_case: Dict[str, Any],
    candidate_cases: List[Dict[str, Any]],
    language: str = "Telugu"
) -> List[Dict[str, Any]]:
    """
    Compares the newly reported complaint against candidate historical cases using Featherless Qwen3-VL.
    Returns a list of similarity evaluation objects per candidate:
    [
      {
        "candidate_id": "...",
        "is_genuinely_similar": bool,
        "similarity_score": float,
        "why_similar": str or None
      }
    ]
    """
    if not candidate_cases:
        return []

    cur_crop = current_case.get("crop") or "Unknown"
    cur_problem = current_case.get("problem") or current_case.get("description") or ""
    cur_symptoms = current_case.get("symptoms") or []
    cur_duration = current_case.get("duration") or ""
    cur_condition = current_case.get("possible_condition") or ""

    candidates_summary = []
    for cand in candidate_cases:
        candidates_summary.append({
            "candidate_id": str(cand.get("id") or cand.get("candidate_id")),
            "crop": cand.get("crop") or "Unknown",
            "problem": cand.get("problem") or cand.get("description") or "",
            "symptoms": cand.get("symptoms") or [],
            "diagnosis": cand.get("confirmed_diagnosis") or cand.get("possible_condition") or "",
            "status": cand.get("status") or ""
        })

    user_prompt = f"""Current Farmer Complaint (Target Language: {language}):
- Crop: {cur_crop}
- Problem Description: {cur_problem}
- Symptoms: {cur_symptoms}
- Duration / Progression: {cur_duration}
- Preliminary Condition: {cur_condition}

Historical Candidate Cases:
{json.dumps(candidates_summary, indent=2, ensure_ascii=False)}

Evaluate each candidate against the current complaint for genuine agricultural/symptom similarity.
Produce "why_similar" in {language} for genuine matches."""

    messages = [
        {"role": "system", "content": SIMILAR_ISSUES_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    try:
        raw_output = await _call_featherless_chat(messages, temperature=0.1, max_tokens=3000)
        parsed = _parse_llm_json(raw_output)
        matches = parsed.get("matches", [])
        if isinstance(matches, list) and len(matches) > 0:
            return matches
    except Exception as exc:
        logger.warning(f"[LLM] evaluate_candidate_similarity_qwen failed ({exc}). Using deterministic fallback.")

    return _deterministic_symptom_similarity_fallback(current_case, candidate_cases, language=language)



