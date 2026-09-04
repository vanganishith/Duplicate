import base64
import os
import json
import logging
import httpx
from typing import Optional, Tuple
from app.core.config import settings

logger = logging.getLogger("rythubandhu.stt_service")

# Safety Limits
MIN_AUDIO_BYTES = 100
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB max limit

LANGUAGE_CODE_MAP = {
    "telugu": "te-IN",
    "te": "te-IN",
    "te-in": "te-IN",
    "english": "en-IN",
    "en": "en-IN",
    "en-in": "en-IN",
    "tamil": "ta-IN",
    "ta": "ta-IN",
    "ta-in": "ta-IN",
    "hindi": "hi-IN",
    "hi": "hi-IN",
    "hi-in": "hi-IN",
}


def get_language_code(lang_str: Optional[str]) -> str:
    """
    Resolves language string to BCP-47 language tag (e.g. 'te-IN', 'en-IN').
    """
    if not lang_str:
        return "te-IN"
    return LANGUAGE_CODE_MAP.get(lang_str.strip().lower(), "te-IN")


async def transcribe_audio_gstt_rest(
    audio_bytes: bytes,
    language_code: str = "te-IN",
    api_key: Optional[str] = None
) -> str:
    """
    PRIMARY STT PATH:
    Transcribes audio using Google Speech-to-Text v1 REST API.
    """
    key = api_key or settings.GOOGLE_API_KEY or settings.GEMINI_API_KEY
    if not key:
        raise ValueError("Google API key is not configured in backend environment.")

    logger.info(f"[STT] Starting Google STT REST transcription (size: {len(audio_bytes)} bytes, lang: {language_code})")
    url = f"https://speech.googleapis.com/v1/speech:recognize?key={key}"
    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

    # Include alternative language codes for mixed-language / code-switching support
    alt_codes = [c for c in ["te-IN", "en-IN", "hi-IN", "ta-IN"] if c != language_code]

    payload = {
        "config": {
            "languageCode": language_code,
            "alternativeLanguageCodes": alt_codes,
            "enableAutomaticPunctuation": True,
            "model": "default",
        },
        "audio": {
            "content": audio_b64
        }
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=payload)
        
        if response.status_code != 200:
            err_text = response.text
            logger.warning(f"[STT] Google STT returned non-200 status {response.status_code}: {err_text[:200]}")
            raise RuntimeError(f"Google STT API returned status {response.status_code}: {err_text}")
        
        data = response.json()
        results = data.get("results", [])
        if not results:
            logger.warning("[STT] Google STT returned empty results list.")
            raise ValueError("No speech could be recognized in the audio.")

        transcript_parts = []
        for result in results:
            alternatives = result.get("alternatives", [])
            if alternatives:
                transcript_parts.append(alternatives[0].get("transcript", ""))

        transcript = " ".join(transcript_parts).strip()
        if not transcript:
            raise ValueError("Empty transcript returned from speech recognition.")
            
        logger.info(f"[STT] Google STT completed successfully (length: {len(transcript)} chars)")
        return transcript


async def transcribe_audio_gemini(
    audio_bytes: bytes,
    content_type: str = "audio/webm",
    language_hint: str = "Telugu",
    api_key: Optional[str] = None
) -> str:
    """
    Transcribes audio using Gemini Multimodal Audio API with multi-key rotation and retry.
    """
    candidate_keys = [api_key] if api_key else settings.get_gemini_keys()
    if not candidate_keys:
        fallback_single = settings.GEMINI_API_KEY
        if fallback_single:
            candidate_keys = [fallback_single]

    if not candidate_keys:
        raise ValueError("Gemini API key is not configured in backend environment.")

    logger.info(f"[STT] Invoking Gemini Multimodal audio transcription (model: {settings.LLM_MODEL_NAME}, lang: {language_hint}, keys: {len(candidate_keys)})")
    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

    prompt = (
        f"You are an expert speech transcriber for Indian agricultural farmers. "
        f"Transcribe this voice recording verbatim in its original spoken language (primarily {language_hint}, English, Telugu, Tamil, or Hindi). "
        f"Return ONLY the exact spoken transcript without translation, explanations, quotes, or markdown formatting."
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": content_type,
                            "data": audio_b64
                        }
                    },
                    {
                        "text": prompt
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 1024
        }
    }

    last_err = None
    data = None

    for key_idx, key in enumerate(candidate_keys):
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.LLM_MODEL_NAME}:generateContent?key={key}"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload)
                if response.status_code == 200:
                    data = response.json()
                    break
                else:
                    logger.warning(f"[STT] Gemini key #{key_idx + 1} failed with status {response.status_code}: {response.text[:150]}")
                    last_err = RuntimeError(f"Gemini transcription failed with status {response.status_code}: {response.text}")
        except Exception as conn_err:
            logger.warning(f"[STT] Connection error with key #{key_idx + 1}: {str(conn_err)}")
            last_err = conn_err

    if not data:
        raise last_err or RuntimeError("All configured Gemini API keys failed.")

    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No transcription generated from audio.")

    parts = candidates[0].get("content", {}).get("parts", [])
    if not parts:
        raise ValueError("Empty transcription generated from audio.")

    transcript = parts[0].get("text", "").strip()
    logger.info(f"[STT] Gemini transcription completed (length: {len(transcript)} chars)")
from app.services.indic_asr_service import transcribe_with_indic_conformer, INDIC_CONFORMER_MODEL_ID, INDIC_CONFORMER_VERSION


async def transcribe_audio(
    audio_bytes: bytes,
    content_type: str = "audio/webm",
    language: Optional[str] = "Telugu"
) -> Tuple[str, str]:
    """
    Authoritative Final ASR Entry Point in Phase 4.
    Attempts AI4Bharat IndicConformer on the complete finalized audio recording.
    If local IndicConformer encounters an issue or requires fallback, gracefully
    falls back to Google STT REST / Gemini Multimodal to guarantee high availability.
    Returns tuple: (transcript, detected_language).
    """
    if not audio_bytes or len(audio_bytes) < MIN_AUDIO_BYTES:
        raise ValueError("Audio recording is empty or too short. Please speak clearly.")
    
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError("Audio recording exceeds the maximum allowable size (25 MB).")

    # 1. Primary: AI4Bharat IndicConformer
    try:
        transcript, detected_language, _ = await transcribe_with_indic_conformer(
            audio_bytes=audio_bytes,
            language=language or "Telugu",
            content_type=content_type
        )
        if transcript and transcript.strip():
            return transcript.strip(), detected_language
    except Exception as indic_err:
        logger.warning(f"[STT] IndicConformer failed or bypassed: {str(indic_err)}. Attempting Google STT / Gemini fallback...")

    # 2. Secondary: Google STT REST
    lang_code = get_language_code(language)
    try:
        transcript = await transcribe_audio_gstt_rest(
            audio_bytes=audio_bytes,
            language_code=lang_code
        )
        if transcript and transcript.strip():
            logger.info(f"[STT] Google STT fallback succeeded: '{transcript}'")
            return transcript.strip(), language or "Telugu"
    except Exception as gstt_err:
        logger.warning(f"[STT] Google STT fallback failed: {str(gstt_err)}. Attempting Gemini fallback...")

    # 3. Tertiary: Gemini Multimodal Audio
    try:
        transcript = await transcribe_audio_gemini(
            audio_bytes=audio_bytes,
            content_type=content_type or "audio/webm",
            language_hint=language or "Telugu"
        )
        if transcript and transcript.strip():
            logger.info(f"[STT] Gemini audio fallback succeeded: '{transcript}'")
            return transcript.strip(), language or "Telugu"
    except Exception as gem_err:
        logger.error(f"[STT] All STT engines failed: {str(gem_err)}")
        raise RuntimeError(f"Audio transcription failed across all available STT engines. Details: {str(gem_err)}")
