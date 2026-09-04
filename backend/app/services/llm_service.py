import json
import re
import logging
import httpx
from typing import Dict, Any, Optional
from app.core.config import settings

logger = logging.getLogger("rythubandhu.llm_service")

# Safety Limits
MAX_TRANSCRIPT_LENGTH = 4000

AGRICULTURAL_EXTRACTION_SYSTEM_PROMPT = """You are an expert Agricultural Meaning Extraction AI for the RythuBandhu platform.
Your task is to analyze a farmer's voice transcript (which may be in Telugu, English, Tamil, Hindi, or a mixed Indian language) and extract structured agricultural information.

CRITICAL RULES:
1. STRICT TRUTHFULNESS: DO NOT invent, hallucinate, or assume any information not stated by the farmer.
2. If the crop is not mentioned in the transcript, set "crop": null. Do NOT guess or default to paddy.
3. If duration is not mentioned, set "duration": null. Do NOT guess.
4. If severity, affected area, or environmental context are not mentioned, set them to null.
5. NO DEFINITIVE DIAGNOSIS: Do not confidently diagnose a crop disease from voice alone. If symptoms resemble common conditions, list them as preliminary possibilities in "possible_conditions" (array of strings), or empty array [] if uncertain.
6. AEO HUMAN REVIEW: Always set "requires_aeo_review": true because human Agricultural Extension Officers are the final authority.
7. SUMMARY: Provide a clear, objective 1-2 sentence summary in English describing the farmer's report.
8. OUTPUT FORMAT: Return ONLY a valid, parseable JSON object without markdown formatting, quotes wrapping, or explanations.

JSON SCHEMA:
{
  "crop": "name of the crop if mentioned, else null",
  "symptoms": ["list of observed symptoms like yellowing, leaf holes, wilting, curling"],
  "affected_part": "part of the plant affected (e.g. leaves, stem, root, fruit, flower) or null",
  "duration": "duration of the issue if mentioned (e.g. 3 days, 1 week) or null",
  "severity": "severity if described (e.g. mild, severe, spreading) or null",
  "affected_area": "acreage or area affected if mentioned or null",
  "context": "weather or field context (e.g. after rain, excess moisture) or null",
  "farmer_concern": "the farmer's primary concern or null",
  "possible_conditions": ["preliminary conditions or diseases to inspect, if reasonable"],
  "summary": "Farmer reports yellowing of chilli leaves for the past 3 days with white insects.",
  "requires_aeo_review": true
}
"""


def _parse_llm_json(raw_text: str) -> Dict[str, Any]:
    """
    Safely parses JSON from LLM output, stripping markdown fences or wrapping text if present.
    """
    cleaned = raw_text.strip()
    
    # Strip markdown code blocks (```json ... ``` or ``` ...)
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    # Try direct parse
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Extract first outer JSON object {...}
    json_match = re.search(r'(\{[\s\S]*\})', cleaned)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Malformed LLM JSON response: {raw_text[:200]}")


async def extract_agricultural_meaning(
    transcript: str,
    language_hint: Optional[str] = "Telugu",
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Sends the speech transcript to Gemini LLM to extract structured agricultural information.
    Guarantees strict truthfulness, unconfirmed diagnosis safety, and mandatory AEO review.
    """
    if not transcript or not transcript.strip():
        raise ValueError("Transcript is empty. Cannot extract agricultural meaning.")

    clean_transcript = transcript.strip()
    if len(clean_transcript) > MAX_TRANSCRIPT_LENGTH:
        logger.warning(f"[LLM] Transcript length ({len(clean_transcript)}) exceeds limit; truncating to {MAX_TRANSCRIPT_LENGTH} chars.")
        clean_transcript = clean_transcript[:MAX_TRANSCRIPT_LENGTH]

    # Build candidate keys pool
    candidate_keys = [api_key] if api_key else settings.get_gemini_keys()
    if not candidate_keys:
        fallback_single = settings.GEMINI_API_KEY or settings.GOOGLE_API_KEY
        if fallback_single:
            candidate_keys = [fallback_single]

    if not candidate_keys:
        raise ValueError("Gemini/Google API key is not configured in backend environment.")

    logger.info(f"[LLM] Extracting agricultural meaning via model {settings.LLM_MODEL_NAME} (lang: {language_hint}, len: {len(clean_transcript)}, keys: {len(candidate_keys)})")

    user_prompt = f"""Language Context: {language_hint}
Farmer's Spoken Transcript:
\"\"\"{clean_transcript}\"\"\"

Extract the structured agricultural meaning as strict JSON following your instructions."""

    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": AGRICULTURAL_EXTRACTION_SYSTEM_PROMPT
                    },
                    {
                        "text": user_prompt
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "maxOutputTokens": 2048
        }
    }

    last_err = None
    data = None
    candidate_models = ["gemini-3.5-flash", "gemini-3.5-flash-lite", settings.LLM_MODEL_NAME]
    # Deduplicate while preserving order
    candidate_models = list(dict.fromkeys([m for m in candidate_models if m]))

    for key_idx, key in enumerate(candidate_keys):
        for model_name in candidate_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={key}"
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(url, json=payload)
                    
                    if response.status_code == 200:
                        data = response.json()
                        break
                    else:
                        logger.warning(f"[LLM] Gemini key #{key_idx + 1} with model {model_name} returned status {response.status_code}: {response.text[:150]}")
                        last_err = RuntimeError(f"Gemini API returned error {response.status_code}: {response.text[:200]}")
            except Exception as conn_err:
                logger.warning(f"[LLM] Connection error with key #{key_idx + 1}: {str(conn_err)}")
                last_err = conn_err
        if data:
            break

    if not data:
        raise last_err or RuntimeError("All configured Gemini API keys failed.")

    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No response generated from LLM.")

    raw_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
    structured_data = _parse_llm_json(raw_text)

    # Normalize fields
    crop_detected = structured_data.get("crop")
    if crop_detected and isinstance(crop_detected, str) and crop_detected.strip().lower() in ["null", "none", "unknown", ""]:
        crop_detected = None

    symptoms = structured_data.get("symptoms", [])
    if not isinstance(symptoms, list):
        symptoms = [str(symptoms)] if symptoms else []

    possible_conditions = structured_data.get("possible_conditions", [])
    if not isinstance(possible_conditions, list):
        possible_conditions = [str(possible_conditions)] if possible_conditions else []

    llm_summary = structured_data.get("summary") or clean_transcript[:200]

    # Enforce requires_aeo_review ALWAYS = True
    structured_data["requires_aeo_review"] = True

    logger.info(f"[LLM] Successfully extracted meaning: crop={crop_detected}, symptoms={len(symptoms)}, conditions={len(possible_conditions)}")

    return {
        "structured_data": structured_data,
        "crop_detected": crop_detected,
        "symptoms": symptoms,
        "possible_conditions": possible_conditions,
        "llm_summary": llm_summary,
        "requires_aeo_review": True,
        "model_name": settings.LLM_MODEL_NAME,
        "model_version": "2.0-flash",
    }
