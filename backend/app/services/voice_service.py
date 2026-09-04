import uuid
import logging
from typing import Dict, Any, Optional
from app.services.stt_service import transcribe_audio
from app.services.llm_service import extract_agricultural_meaning
from app.services.incident_service import upload_incident_audio
from app.database.session import get_supabase_client

logger = logging.getLogger("rythubandhu.voice_service")


async def process_voice_for_incident(
    incident_id: str,
    audio_bytes: bytes,
    filename: Optional[str] = "recording.webm",
    content_type: Optional[str] = "audio/webm",
    language: Optional[str] = "Telugu"
) -> Dict[str, Any]:
    """
    Phase 4: Full Voice AI pipeline for agricultural incidents.
    
    1. Verifies incident exists
    2. Uploads audio to Supabase Storage and records audio_url on incident
    3. Transcribes audio via Google STT (Primary) / Gemini Multimodal (Fallback)
    4. Extracts structured agricultural meaning via LLM (strict truthfulness, requires_aeo_review=True)
    5. Inserts results into existing `ai_analysis` table referencing incident_id
    6. Updates incident status to 'AI_ANALYZED' without modifying original description
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    logger.info(f"[VoicePipeline] Processing voice recording for incident {incident_id} (size: {len(audio_bytes)} bytes, lang: {language})")

    # 1. Verify incident exists
    inc_res = client.table("incidents").select("id, description, status, audio_url").eq("id", incident_id).execute()
    if not inc_res.data or len(inc_res.data) == 0:
        logger.error(f"[VoicePipeline] Incident {incident_id} not found in database.")
        raise ValueError(f"Incident {incident_id} does not exist.")

    incident = inc_res.data[0]

    # 2. Upload audio file to Supabase Storage (if configured) and update incident audio_url
    try:
        audio_url = upload_incident_audio(
            file_bytes=audio_bytes,
            filename=filename or "recording.webm",
            content_type=content_type or "audio/webm"
        )
        if audio_url:
            client.table("incidents").update({"audio_url": audio_url}).eq("id", incident_id).execute()
            logger.info(f"[VoicePipeline] Audio uploaded to storage: {audio_url}")
    except Exception as storage_err:
        logger.warning(f"[VoicePipeline] Storage upload skipped/failed: {str(storage_err)}")

    # 3. Transcribe Audio (Google STT primary -> Gemini fallback)
    logger.info(f"[VoicePipeline] Transcribing audio for incident {incident_id}...")
    transcript, detected_language = await transcribe_audio(
        audio_bytes=audio_bytes,
        content_type=content_type or "audio/webm",
        language=language or "Telugu"
    )
    logger.info(f"[VoicePipeline] Transcript generated: \"{transcript[:80]}...\" (lang: {detected_language})")

    # 4. Extract Agricultural Meaning via LLM
    logger.info(f"[VoicePipeline] Extracting agricultural meaning via LLM for incident {incident_id}...")
    ai_meaning = {}
    try:
        ai_meaning = await extract_agricultural_meaning(
            transcript=transcript,
            language_hint=detected_language
        )
    except Exception as llm_err:
        logger.warning(f"[VoicePipeline] LLM extraction failed ({str(llm_err)}); generating fallback ai_analysis record to preserve transcript.")
        ai_meaning = {
            "structured_data": {"transcript": transcript, "error": str(llm_err)},
            "crop_detected": None,
            "symptoms": [],
            "possible_conditions": [],
            "llm_summary": f"Voice Transcript: {transcript}",
            "requires_aeo_review": True,
            "model_name": "fallback",
            "model_version": "1.0",
        }

    # 5. Insert or Update ai_analysis table without clobbering vision results
    existing_res = client.table("ai_analysis").select("*").eq("incident_id", incident_id).execute()
    
    voice_structured_data = ai_meaning.get("structured_data")
    
    if existing_res.data and len(existing_res.data) > 0:
        existing_row = existing_res.data[0]
        existing_id = existing_row["id"]
        
        current_sd = existing_row.get("structured_data")
        if isinstance(current_sd, dict):
            merged_sd = dict(current_sd)
            merged_sd["voice"] = voice_structured_data
        else:
            merged_sd = {"voice": voice_structured_data, "vision": current_sd} if current_sd else {"voice": voice_structured_data}
            
        update_payload = {
            "transcript": transcript,
            "detected_language": detected_language,
            "crop_detected": ai_meaning.get("crop_detected") or existing_row.get("crop_detected"),
            "symptoms": ai_meaning.get("symptoms", []) or existing_row.get("symptoms", []),
            "possible_conditions": ai_meaning.get("possible_conditions", []) or existing_row.get("possible_conditions", []),
            "llm_summary": ai_meaning.get("llm_summary") or existing_row.get("llm_summary"),
            "structured_data": merged_sd,
            "requires_aeo_review": True
        }
        
        update_res = client.table("ai_analysis").update(update_payload).eq("id", existing_id).execute()
        ai_record = update_res.data[0] if update_res.data else existing_row
        logger.info(f"[VoicePipeline] Merged voice AI into existing ai_analysis record {existing_id} for incident {incident_id}")
    else:
        ai_analysis_payload = {
            "incident_id": incident_id,
            "transcript": transcript,
            "detected_language": detected_language,
            "crop_detected": ai_meaning.get("crop_detected"),
            "symptoms": ai_meaning.get("symptoms", []),
            "possible_conditions": ai_meaning.get("possible_conditions", []),
            "vision_prediction": None,
            "vision_confidence": None,
            "llm_summary": ai_meaning.get("llm_summary"),
            "structured_data": {"voice": voice_structured_data} if voice_structured_data else None,
            "model_name": "ai4bharat-indicconformer",
            "model_version": "1.0",
            "requires_aeo_review": True,
        }
        insert_res = client.table("ai_analysis").insert(ai_analysis_payload).execute()
        if not insert_res.data or len(insert_res.data) == 0:
            logger.error(f"[VoicePipeline] Failed to insert ai_analysis record for incident {incident_id}")
            raise RuntimeError("Failed to insert AI analysis record into database.")
        ai_record = insert_res.data[0]
        logger.info(f"[VoicePipeline] ai_analysis saved successfully with id: {ai_record.get('id')}")

    # 6. Update incident status to AI_ANALYZED (Never modify description or original farmer data)
    client.table("incidents").update({"status": "AI_ANALYZED"}).eq("id", incident_id).execute()

    return {
        "success": True,
        "incident_id": incident_id,
        "ai_analysis_id": str(ai_record["id"]),
        "transcript": transcript,
        "detected_language": detected_language,
        "crop_detected": ai_meaning.get("crop_detected"),
        "symptoms": ai_meaning.get("symptoms", []),
        "possible_conditions": ai_meaning.get("possible_conditions", []),
        "summary": ai_meaning.get("llm_summary"),
        "structured_data": ai_meaning.get("structured_data"),
        "requires_aeo_review": True,
        "ai_analysis": ai_record
    }
