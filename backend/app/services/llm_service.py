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
Your task is to analyze a farmer's local-language voice transcript directly (supporting Telugu, Hindi, Tamil, Kannada, Marathi, English, and other Indian languages) and perform two critical steps:

1. AGRICULTURAL INTENT VALIDATION:
Determine whether the farmer is genuinely reporting an agricultural or farming problem.
- Agricultural examples: crop diseases, pest attacks, leaf discoloration/holes/curling, plant wilting, stunted growth, weed infestation, soil issues, irrigation/water problems, crop damage, fruit/pod decay, farming-related production problems.
- Non-agricultural examples: general conversation, greeting only, travel, politics, mobile phones/vehicles, entertainment, household chores, unrelated personal chats, random unintelligible noise.

If NOT agriculture-related:
Set "agriculture_related": false. Provide a polite reason in English. Set "complaint": null and "photo_guidance": [].

2. AGRICULTURAL COMPLAINT UNDERSTANDING (only if agriculture_related is true):
Extract structured details based strictly on what the farmer stated or reasonably described.
CRITICAL RULES:
- STRICT TRUTHFULNESS: DO NOT invent, hallucinate, or guess details not mentioned.
- If crop is not mentioned, set "crop": null.
- If plant part is not mentioned, set "plant_part": null.
- If duration, progression, severity, or affected area are not mentioned, set them to null.
- DO NOT say any disease is confirmed. Preliminary conditions or suspicions must remain strictly tentative.
- DO NOT translate or lose meaning; understand the Indian language directly.

3. DYNAMIC PHOTO GUIDANCE:
If agriculture_related is true, generate 1 to 4 practical, specific photo recommendations explaining what visual evidence the Agricultural Extension Officer (AEO) needs to see based on the reported problem (e.g. close-up of affected leaf, several leaves on plant, whole plant/field view).

RETURN ONLY A STRICT VALID JSON OBJECT with NO markdown fences, matching this schema:
{
  "agriculture_related": true,
  "reason": "Brief reason for intent classification",
  "complaint": {
    "crop": "crop name if stated, else null",
    "plant_part": "leaves/stem/roots/fruit/etc if stated, else null",
    "symptoms": ["list", "of", "symptoms"],
    "duration": "duration if stated, else null",
    "progression": "progression/spreading if stated, else null",
    "severity": "severity if stated, else null",
    "suspected_problem": "tentative issue if mentioned, else null",
    "affected_area": "acreage or area if stated, else null",
    "farmer_concern": "primary concern if stated, else null",
    "relevant_context": "weather/soil/field context if stated, else null"
  },
  "photo_guidance": [
    "Specific photo guidance item 1",
    "Specific photo guidance item 2"
  ]
}
"""

STAGE2_MULTIMODAL_SYSTEM_PROMPT = """You are an expert Multimodal Agricultural Reasoning AI for KisaanSaathi.
You are evaluating farmer-uploaded photos alongside the farmer's confirmed agricultural voice complaint and local YOLO11 plant disease detector findings.

CRITICAL RULES:
1. STRICT ABOUT AGRICULTURAL INTENT, FLEXIBLE ABOUT VISUAL MATCH:
Do NOT require an exact disease match. Determine if each image provides reasonably relevant agricultural visual evidence related to the reported issue.
- RELEVANT: Image shows the reported crop/plant or visible agricultural symptoms/foliage.
- LIMITED_EVIDENCE: Crop/plant is visible, but symptoms or details are distant, blurred, or partially obscured.
- NON_RELEVANT: Clear image of something completely unrelated to the agricultural complaint (e.g. vehicle, room, animal, clothing, non-crop object).
- NON_AGRICULTURAL: Clearly non-agricultural subject (e.g. human selfie, machinery, indoor room, paperwork).
- ANALYSIS_FAILED: Corrupted, pitch-black, or completely unidentifiable image.

2. IMAGE-LEVEL INDEPENDENT EVALUATION:
Evaluate every photo independently and assign image_index (1-based), status, relationship_to_complaint, visual_evidence list, and limitations list.

3. OVERALL RELEVANCE & INCIDENT ACCEPTANCE:
- If AT LEAST ONE image is RELEVANT or LIMITED_EVIDENCE -> overall_relevance is "RELEVANT" or "LIMITED_EVIDENCE".
- If ALL images are NON_RELEVANT, NON_AGRICULTURAL, or ANALYSIS_FAILED -> overall_relevance is "NON_RELEVANT".

4. AI ASSESSMENT SYNTHESIS:
Compare farmer description with visual evidence.
- relationship: "CONSISTENT", "PARTIALLY_CONSISTENT", "LIMITED_EVIDENCE", or "INCONSISTENT".
- NEVER state that a disease is confirmed by AI. Use phrases like "Visual evidence is consistent with...", "Possible...", "The image shows...", "Further field verification is recommended."
- requires_aeo_verification: ALWAYS true.

5. SAFE AEO VERIFICATION APPROACH:
Generate ONLY a safe, verification-oriented approach for the human Agricultural Extension Officer (AEO).
STRICT SAFETY ENFORCEMENT:
- DO NOT independently prescribe pesticide dosages, chemical dosages, medicine, or hazardous treatment.
- The guidance MUST focus on: field inspection, checking symptom severity, checking spread, verifying the suspected condition in field, inspecting healthy vs affected foliage, and checking crop-management conditions according to approved advisory.

RETURN ONLY A STRICT VALID JSON OBJECT matching this schema:
{
  "overall_relevance": "RELEVANT",
  "images": [
    {
      "image_index": 1,
      "status": "RELEVANT",
      "relationship_to_complaint": "Tomato foliage and affected leaves are visible.",
      "visual_evidence": ["brown spots on leaves", "leaf curling"],
      "limitations": ["low lighting on lower foliage"]
    }
  ],
  "assessment": {
    "relationship": "CONSISTENT",
    "summary": "Visual evidence is consistent with early leaf spot symptoms reported by the farmer.",
    "requires_aeo_verification": true
  },
  "safe_aeo_approach": "Inspect affected and healthy leaves in the field, verify symptom spread and severity, check soil moisture conditions, and consult official agricultural department advisories before recommending treatment."
}
"""


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


async def validate_and_understand_agricultural_complaint(
    transcript: str,
    language_hint: Optional[str] = "Telugu"
) -> Dict[str, Any]:
    """
    Stage 1: Text-only Featherless Qwen3-VL analysis.
    1. Validates whether the transcript is actually agriculture-related.
    2. Understands the complaint and extracts structured details without hallucination.
    3. Generates tailored 1-4 photo guidance points for the AEO evidence requirements.
    """
    if not transcript or not transcript.strip():
        return {
            "agriculture_related": False,
            "reason": "Transcript is empty.",
            "complaint": None,
            "photo_guidance": []
        }

    clean_transcript = transcript.strip()
    if len(clean_transcript) > MAX_TRANSCRIPT_LENGTH:
        clean_transcript = clean_transcript[:MAX_TRANSCRIPT_LENGTH]

    user_prompt = f"""Spoken Farmer Transcript (Language: {language_hint}):
\"\"\"{clean_transcript}\"\"\"

Analyze this transcript for agricultural intent, extract structured details, and generate tailored photo guidance."""

    messages = [
        {"role": "system", "content": STAGE1_INTENT_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    try:
        raw_output = await _call_featherless_chat(messages)
        parsed = _parse_llm_json(raw_output)

        is_agri = bool(parsed.get("agriculture_related", False))
        reason = str(parsed.get("reason") or ("Agriculture-related issue detected" if is_agri else "Non-agricultural conversation"))

        if not is_agri:
            return {
                "agriculture_related": False,
                "reason": reason,
                "complaint": None,
                "photo_guidance": []
            }

        complaint = parsed.get("complaint") or {}
        crop = complaint.get("crop")
        if crop and isinstance(crop, str) and crop.strip().lower() in ["null", "none", "unknown", ""]:
            crop = None

        symptoms = complaint.get("symptoms") or []
        if not isinstance(symptoms, list):
            symptoms = [str(symptoms)] if symptoms else []

        photo_guidance = parsed.get("photo_guidance") or []
        if not isinstance(photo_guidance, list):
            photo_guidance = [str(photo_guidance)] if photo_guidance else []

        if not photo_guidance:
            target_part = complaint.get("plant_part") or "affected area"
            target_crop = crop or "plant"
            photo_guidance = [
                f"Close-up photo of the {target_part} showing clear symptoms",
                f"Photo showing several affected leaves or parts on the {target_crop}",
                f"Photo of the entire {target_crop} in the field context"
            ]

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
            "reason": reason,
            "complaint": structured_complaint,
            "photo_guidance": photo_guidance
        }

    except Exception as exc:
        logger.warning(f"[LLM] Featherless Stage 1 call failed or key missing: {exc}. Using intelligent fallback.")
        lower_t = clean_transcript.lower()
        agri_keywords = [
            "leaf", "leaves", "crop", "paddy", "rice", "cotton", "chilli", "mirapa", "tomato", "maize",
            "plant", "plants", "pest", "pests", "insect", "insects", "yellow", "yellowing", "spot", "spots",
            "wilt", "wilting", "rot", "rotting", "fungus", "disease", "farm", "field", "acidity", "yield",
            "వరి", "పత్తి", "మిరప", "మొక్కజొన్న", "రైతు", "చేను", "ఆకులు", "పురుగు", "తెగులు"
        ]
        has_agri_word = any(kw in lower_t for kw in agri_keywords)

        if not has_agri_word:
            return {
                "agriculture_related": False,
                "reason": "The spoken words do not appear to mention agricultural crops, plants, or symptoms.",
                "complaint": None,
                "photo_guidance": []
            }

        crop_map = {
            "tomato": "Tomato",
            "టమోటా": "Tomato",
            "chilli": "Chilli",
            "mirapa": "Chilli",
            "మిరప": "Chilli",
            "cotton": "Cotton",
            "పత్తి": "Cotton",
            "paddy": "Paddy",
            "rice": "Paddy",
            "వరి": "Paddy",
            "maize": "Maize",
            "మొక్కజొన్న": "Maize"
        }
        detected_crop = None
        for k, v in crop_map.items():
            if k in lower_t:
                detected_crop = v
                break

        return {
            "agriculture_related": True,
            "reason": "Agricultural keywords detected in transcript.",
            "complaint": {
                "crop": detected_crop,
                "plant_part": "Leaves" if "leaf" in lower_t or "leaves" in lower_t or "ఆకు" in lower_t else None,
                "symptoms": ["Observed symptoms reported in voice transcript"],
                "duration": None,
                "progression": None,
                "severity": None,
                "suspected_problem": None,
                "affected_area": None,
                "farmer_concern": clean_transcript[:180],
                "relevant_context": None
            },
            "photo_guidance": [
                "1. Close-up photo of an affected leaf or plant part",
                "2. Photo showing several affected leaves on the plant",
                "3. Photo of the entire plant showing overall condition"
            ]
        }


async def evaluate_multimodal_evidence(
    complaint: Dict[str, Any],
    photos_data: List[Dict[str, Any]],
    yolo_findings: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Stage 2: Multimodal Featherless Qwen3-VL reasoning.
    Sends complaint + 1-4 images + YOLO11 findings.
    Evaluates each image independently and provides incident-level acceptance and safe AEO approach.
    """
    if not photos_data:
        return {
            "overall_relevance": "NON_RELEVANT",
            "images": [],
            "assessment": {
                "relationship": "LIMITED_EVIDENCE",
                "summary": "No photos were provided for visual evaluation.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Field verification recommended by AEO officer."
        }

    content_parts = []

    complaint_summary = json.dumps(complaint or {}, indent=2)
    yolo_summary = json.dumps(yolo_findings or [], indent=2)

    prompt_text = f"""FARMER'S COMPLAINT DETAILS:
{complaint_summary}

LOCAL YOLO11 DETECTIONS (FOR CONTEXT):
{yolo_summary}

Please inspect the attached photos ({len(photos_data)} photo(s)). Evaluate each photo independently, assess overall consistency, and provide a safe AEO verification approach."""

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
        raw_output = await _call_featherless_chat(messages, max_tokens=2500)
        parsed = _parse_llm_json(raw_output)

        images = parsed.get("images") or []
        overall_rel = parsed.get("overall_relevance", "RELEVANT")
        assessment = parsed.get("assessment") or {}
        safe_approach = parsed.get("safe_aeo_approach") or (
            "Inspect affected and healthy leaves in the field, verify symptom spread and severity, "
            "and check crop-management conditions according to applicable agricultural advisory."
        )

        assessment["requires_aeo_verification"] = True

        return {
            "overall_relevance": overall_rel,
            "images": images,
            "assessment": assessment,
            "safe_aeo_approach": safe_approach
        }

    except Exception as exc:
        logger.warning(f"[LLM] Multimodal Featherless call failed or key missing: {exc}. Generating structured fallback from YOLO11 findings.")
        image_evals = []
        has_any_useful = False

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
                "relationship_to_complaint": rel_text,
                "visual_evidence": [d.get("class_name", "symptom") for d in dets],
                "limitations": ["Evaluated via local detection pipeline"]
            })

        overall_rel = "RELEVANT" if has_any_useful else "NON_RELEVANT"
        relationship = "PARTIALLY_CONSISTENT" if has_any_useful else "LIMITED_EVIDENCE"

        return {
            "overall_relevance": overall_rel,
            "images": image_evals,
            "assessment": {
                "relationship": relationship,
                "summary": "Visual evidence is partially consistent with the reported issue. Human AEO field verification is required.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Inspect affected and healthy leaves, verify the suspected condition in the field, assess severity and spread, check relevant crop-management conditions, and follow the applicable agricultural advisory before recommending treatment."
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

