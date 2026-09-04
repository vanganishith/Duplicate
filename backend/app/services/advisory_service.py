import os
import re
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import httpx
from gtts import gTTS
from app.core.config import settings
from app.database.session import get_supabase_client
from app.services.incident_service import get_incident_by_id

logger = logging.getLogger("rythubandhu.advisory_service")

LANGUAGE_CODES = {
    "telugu": "te",
    "te": "te",
    "hindi": "hi",
    "hi": "hi",
    "tamil": "ta",
    "ta": "ta",
    "english": "en",
    "en": "en",
    "kannada": "kn",
    "kn": "kn",
    "marathi": "mr",
    "mr": "mr",
}

LANGUAGE_NAMES = {
    "te": "Telugu",
    "hi": "Hindi",
    "ta": "Tamil",
    "en": "English",
    "kn": "Kannada",
    "mr": "Marathi",
}

UPLOADS_ADVISORY_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "uploads",
    "advisory_audio"
)
os.makedirs(UPLOADS_ADVISORY_DIR, exist_ok=True)


def normalize_language_code(lang_str: Optional[str]) -> str:
    """Normalizes language name or code to a 2-letter ISO code."""
    if not lang_str:
        return "te"
    clean = lang_str.strip().lower()
    return LANGUAGE_CODES.get(clean, "te")


def get_language_display_name(lang_code: str) -> str:
    """Returns human-readable language name for display."""
    return LANGUAGE_NAMES.get(lang_code.lower(), "Telugu")


def localize_advisory_text(advisory_text: str, target_language: str) -> str:
    """
    Phase 12: Translates/localizes the officer's exact advisory into the target language.
    
    CRITICAL SAFETY RULES:
    1. AEO is the agricultural authority. Gemini ONLY translates the human officer's words.
    2. Gemini must NOT invent, modify, or add any agricultural treatments.
    3. If Gemini is unavailable or quota exceeded, falls back safely to original text.
    """
    if not advisory_text or not advisory_text.strip():
        return ""

    clean_text = advisory_text.strip()
    lang_code = normalize_language_code(target_language)
    target_name = get_language_display_name(lang_code)

    # If target is English and source is predominantly English, return directly
    if lang_code == "en":
        return clean_text

    keys = settings.get_gemini_keys()
    if not keys:
        logger.warning("No valid Gemini API key found. Returning original text for advisory.")
        return clean_text

    system_instruction = (
        f"You are a faithful translator for agricultural officer advisories in the RythuBandhu platform.\n"
        f"Your ONLY job is to accurately translate the agricultural officer's exact advisory message into {target_name}.\n\n"
        f"CRITICAL SAFETY RULES:\n"
        f"1. DO NOT add, modify, omit, or invent any agricultural treatment, chemical, dosage, or advice.\n"
        f"2. Translate ONLY the exact words and meaning provided by the officer.\n"
        f"3. Maintain a clear, simple, and respectful tone for Indian farmers.\n"
        f"4. Output ONLY the translated message in {target_name} script (no Romanized transliteration, no quotes, no conversational filler).\n"
    )

    model_name = getattr(settings, "LLM_MODEL_NAME", "gemini-1.5-flash")

    for key in keys:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent?key={key}"
        )

        payload = {
            "system_instruction": {
                "parts": [{"text": system_instruction}]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": f"Translate this officer advisory to {target_name}:\n{clean_text}"}]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 1024,
            }
        }

        try:
            with httpx.Client(timeout=6.0) as client:
                response = client.post(url, json=payload)
                if response.status_code == 200:
                    data = response.json()
                    candidates = data.get("candidates", [])
                    if candidates and len(candidates) > 0:
                        content_parts = candidates[0].get("content", {}).get("parts", [])
                        if content_parts and len(content_parts) > 0:
                            translated = content_parts[0].get("text", "").strip()
                            if translated:
                                return translated
                else:
                    logger.warning("Gemini localization API returned status %s", response.status_code)
        except Exception as e:
            logger.warning("Gemini key error (%s), trying next candidate...", str(e))

    return clean_text


def generate_advisory_tts(text: str, language_code: str, incident_id: str) -> Optional[str]:
    """
    Phase 12: Generates audio speech file from localized advisory text using gTTS.
    Saves to /uploads/advisory_audio/ and returns the web-accessible URL.
    
    If TTS generation fails (e.g. offline/network issue), gracefully returns None
    so text advisory remains fully preserved and functional.
    """
    if not text or not text.strip():
        return None

    lang = normalize_language_code(language_code)
    clean_text = text.strip()

    # Clean text of markdown or special characters before speech
    speech_text = re.sub(r'[*_#`~]', '', clean_text)
    speech_text = re.sub(r'\s+', ' ', speech_text).strip()

    file_name = f"advisory_{incident_id}_{lang}.mp3"
    file_path = os.path.join(UPLOADS_ADVISORY_DIR, file_name)

    try:
        tts = gTTS(text=speech_text, lang=lang, slow=False)
        tts.save(file_path)
        logger.info("Generated TTS audio for incident %s (%s) at %s", incident_id, lang, file_path)
        return f"/uploads/advisory_audio/{file_name}"
    except Exception as e:
        logger.warning("gTTS audio generation failed for incident %s: %s", incident_id, str(e))
        return None


def create_or_update_officer_advisory(
    incident_id: str,
    advisory_text: str,
    target_language: str = "Telugu",
    officer_id: Optional[str] = "AEO001"
) -> Dict[str, Any]:
    """
    Phase 12: Processes and records an official AEO advisory for an incident.
    1. Preserves original AEO advisory text.
    2. Localizes text to farmer's preferred language using Gemini (translation only).
    3. Generates TTS audio using gTTS.
    4. Persists to database in ai_analysis.structured_data['advisory'].
    """
    if not advisory_text or not advisory_text.strip():
        raise ValueError("Advisory message cannot be empty.")

    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} not found.")

    original_text = advisory_text.strip()
    lang_code = normalize_language_code(target_language)
    lang_name = get_language_display_name(lang_code)

    # 1. Localize text
    localized_text = localize_advisory_text(original_text, target_language=lang_name)

    # 2. Generate TTS audio
    audio_url = generate_advisory_tts(localized_text, language_code=lang_code, incident_id=incident_id)

    now_iso = datetime.now(timezone.utc).isoformat()
    advisory_record = {
        "original_advisory": original_text,
        "target_language": lang_name,
        "language_code": lang_code,
        "localized_advisory": localized_text,
        "audio_url": audio_url,
        "officer_id": officer_id or "AEO001",
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    # 3. Persist into ai_analysis structured_data
    ai_res = client.table("ai_analysis").select("id, structured_data").eq("incident_id", incident_id).execute()
    existing_sd = {}
    if ai_res.data and len(ai_res.data) > 0:
        sd = ai_res.data[0].get("structured_data")
        if isinstance(sd, dict):
            existing_sd = dict(sd)

    existing_sd["advisory"] = advisory_record

    # Also log advisory in timeline
    current_timeline = list(existing_sd.get("timeline", []))
    current_timeline.append({
        "status": incident.get("status", "ACTION_TAKEN"),
        "label": "AEO Advisory Sent",
        "note": f"Advisory sent in {lang_name}: {original_text[:120]}...",
        "officer_id": officer_id or "AEO001",
        "timestamp": now_iso
    })
    existing_sd["timeline"] = current_timeline

    client.table("ai_analysis").insert({
        "incident_id": incident_id,
        "structured_data": existing_sd,
        "requires_aeo_review": True
    }).execute()

    return {
        "success": True,
        "incident_id": incident_id,
        "advisory": advisory_record,
        "message": f"Advisory localized in {lang_name} and saved successfully.",
    }


def get_incident_advisory(incident_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves the official AEO advisory record for an incident if present."""
    client = get_supabase_client()
    if not client:
        return None

    try:
        ai_res = client.table("ai_analysis").select("structured_data").eq("incident_id", incident_id).execute()
        if ai_res.data:
            for row in ai_res.data:
                sd = row.get("structured_data")
                if isinstance(sd, dict) and "advisory" in sd:
                    return sd["advisory"]
    except Exception:
        pass

    return None
