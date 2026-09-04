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
    key = api_key or settings.GOOGLE_API_KEY
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


from app.services.indic_asr_service import transcribe_with_indic_conformer, INDIC_CONFORMER_MODEL_ID, INDIC_CONFORMER_VERSION


async def transcribe_audio(
    audio_bytes: bytes,
    content_type: str = "audio/webm",
    language: Optional[str] = "Telugu"
) -> Tuple[str, str]:
    """
    Authoritative Speech Recognition Entry Point.
    Uses AI4Bharat IndicConformer on the finalized voice recording.
    If IndicConformer encounters an issue, gracefully falls back to Google STT REST if configured.
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
        logger.warning(f"[STT] IndicConformer failed or bypassed: {str(indic_err)}. Attempting Google STT fallback...")

    # 2. Secondary: Google STT REST (if configured)
    if settings.GOOGLE_API_KEY:
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
            logger.warning(f"[STT] Google STT fallback failed: {str(gstt_err)}")

    raise RuntimeError("Speech recognition could not process the voice recording. Please speak clearly and try again.")
