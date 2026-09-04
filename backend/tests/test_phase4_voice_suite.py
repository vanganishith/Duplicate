import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
import uuid
import json

from app.main import app
from app.services.stt_service import get_language_code, transcribe_audio, transcribe_audio_gemini
from app.services.llm_service import extract_agricultural_meaning, _parse_llm_json
from app.services.voice_service import process_voice_for_incident


class TestPhase4VoiceHardenedSuite(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_language_code_resolution(self):
        self.assertEqual(get_language_code("Telugu"), "te-IN")
        self.assertEqual(get_language_code("English"), "en-IN")
        self.assertEqual(get_language_code("Tamil"), "ta-IN")
        self.assertEqual(get_language_code("Hindi"), "hi-IN")
        self.assertEqual(get_language_code(None), "te-IN")

    # =========================================================================
    # 1. Telugu voice -> transcript
    # =========================================================================
    @patch("app.services.stt_service.transcribe_with_indic_conformer")
    async def _async_test_telugu_stt(self, mock_indic_conformer):
        mock_indic_conformer.return_value = ("వరి పొలంలో ఆకులు పసుపు రంగులోకి మారాయి", "Telugu", "ai4bharat-indicconformer")

        transcript, lang = await transcribe_audio(b"dummy-audio-bytes-content" * 10, language="Telugu")
        self.assertEqual(transcript, "వరి పొలంలో ఆకులు పసుపు రంగులోకి మారాయి")
        self.assertEqual(lang, "Telugu")

    def test_1_telugu_voice_to_transcript(self):
        import asyncio
        asyncio.run(self._async_test_telugu_stt())

    # =========================================================================
    # 2. English voice -> transcript
    # =========================================================================
    @patch("app.services.stt_service.transcribe_with_indic_conformer")
    async def _async_test_english_stt(self, mock_indic_conformer):
        mock_indic_conformer.return_value = ("Cotton leaves have black spots after rain", "English", "ai4bharat-indicconformer")

        transcript, lang = await transcribe_audio(b"dummy-audio-bytes-content" * 10, language="English")
        self.assertEqual(transcript, "Cotton leaves have black spots after rain")
        self.assertEqual(lang, "English")

    def test_2_english_voice_to_transcript(self):
        import asyncio
        asyncio.run(self._async_test_english_stt())

    # =========================================================================
    # 3. Code-switched speech
    # =========================================================================
    @patch("app.services.voice_service.transcribe_audio")
    @patch("app.services.voice_service.extract_agricultural_meaning")
    @patch("app.services.voice_service.get_supabase_client")
    def test_3_code_switched_speech(self, mock_get_supabase, mock_llm, mock_stt):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        incident_id = str(uuid.uuid4())
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": incident_id, "description": "Voice Report", "status": "NEW"
        }]

        mock_stt.return_value = ("నా Chilli crop లో leaves upward curl అవుతున్నాయి, whiteflies ఉన్నాయి.", "Telugu")
        mock_llm.return_value = {
            "structured_data": {
                "crop": "Chilli",
                "symptoms": ["upward leaf curling", "whiteflies presence"],
                "possible_conditions": ["Chilli Leaf Curl Virus"],
                "summary": "Farmer reports chilli leaf curling and whitefly infestation.",
                "requires_aeo_review": True
            },
            "crop_detected": "Chilli",
            "symptoms": ["upward leaf curling", "whiteflies presence"],
            "possible_conditions": ["Chilli Leaf Curl Virus"],
            "llm_summary": "Farmer reports chilli leaf curling and whitefly infestation.",
            "requires_aeo_review": True,
            "model_name": "gemini-2.0-flash",
            "model_version": "2.0-flash"
        }
        mock_db.table.return_value.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4())}]

        response = self.client.post(
            f"/api/v1/incidents/{incident_id}/voice",
            data={"language": "Telugu"},
            files={"audio": ("mixed.webm", b"fake-audio-bytes-header-data-1234567890" * 5, "audio/webm")}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["crop_detected"], "Chilli")
        self.assertIn("upward leaf curling", data["symptoms"])

    # =========================================================================
    # 4. Crop extraction
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_crop_extraction(self, mock_client_cls):
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "crop": "Maize",
                            "symptoms": ["stem borer holes"],
                            "possible_conditions": ["Fall Armyworm"],
                            "summary": "Maize stem damage reported.",
                            "requires_aeo_review": True
                        })
                    }]
                }
            }]
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.GEMINI_API_KEY", "test-key"):
            res = await extract_agricultural_meaning("మొక్కజొన్న పంటలో కాండం తొలిచే పురుగు వచ్చింది")
            self.assertEqual(res["crop_detected"], "Maize")

    def test_4_crop_extraction(self):
        import asyncio
        asyncio.run(self._async_test_crop_extraction())

    # =========================================================================
    # 5. Symptom extraction
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_symptom_extraction(self, mock_client_cls):
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "crop": "Paddy",
                            "symptoms": ["yellow leaves", "brown spots", "drying tip"],
                            "possible_conditions": ["Brown Spot", "Blast"],
                            "summary": "Paddy leaves yellowing and drying.",
                            "requires_aeo_review": True
                        })
                    }]
                }
            }]
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.GEMINI_API_KEY", "test-key"):
            res = await extract_agricultural_meaning("Paddy leaves have brown spots and drying tips")
            self.assertEqual(len(res["symptoms"]), 3)
            self.assertIn("brown spots", res["symptoms"])

    def test_5_symptom_extraction(self):
        import asyncio
        asyncio.run(self._async_test_symptom_extraction())

    # =========================================================================
    # 6. Missing crop -> null (no guessing)
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_missing_crop(self, mock_client_cls):
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "crop": None,
                            "symptoms": ["yellowing"],
                            "possible_conditions": [],
                            "summary": "Yellowing reported without crop specified.",
                            "requires_aeo_review": True
                        })
                    }]
                }
            }]
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.GEMINI_API_KEY", "test-key"):
            res = await extract_agricultural_meaning("ఆకులు ఎండిపోతున్నాయి")
            self.assertIsNone(res["crop_detected"])

    def test_6_missing_crop_null(self):
        import asyncio
        asyncio.run(self._async_test_missing_crop())

    # =========================================================================
    # 7. Missing duration -> null
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_missing_duration(self, mock_client_cls):
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "crop": "Tomato",
                            "duration": None,
                            "symptoms": ["wilting"],
                            "possible_conditions": ["Bacterial Wilt"],
                            "summary": "Tomato wilting.",
                            "requires_aeo_review": True
                        })
                    }]
                }
            }]
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.GEMINI_API_KEY", "test-key"):
            res = await extract_agricultural_meaning("Tomato plants are wilting")
            self.assertIsNone(res["structured_data"].get("duration"))

    def test_7_missing_duration_null(self):
        import asyncio
        asyncio.run(self._async_test_missing_duration())

    # =========================================================================
    # 8. LLM malformed JSON recovery
    # =========================================================================
    def test_8_llm_malformed_json(self):
        # Case A: wrapped in markdown code fence
        fenced = "```json\n{\"crop\": \"Cotton\", \"symptoms\": [\"leaf curl\"], \"possible_conditions\": []}\n```"
        parsed = _parse_llm_json(fenced)
        self.assertEqual(parsed["crop"], "Cotton")

        # Case B: conversational wrapper with JSON inside
        wrapped = "Here is the extraction:\n{\"crop\": \"Paddy\", \"symptoms\": [\"yellowing\"], \"summary\": \"Paddy yellowing\"}\nHope this helps!"
        parsed_wrapped = _parse_llm_json(wrapped)
        self.assertEqual(parsed_wrapped["crop"], "Paddy")

        # Case C: completely invalid JSON raises ValueError
        invalid = "This is not JSON at all."
        with self.assertRaises(ValueError):
            _parse_llm_json(invalid)

    # =========================================================================
    # 9. STT failure handling
    # =========================================================================
    @patch("app.services.voice_service.transcribe_audio")
    @patch("app.services.voice_service.get_supabase_client")
    def test_9_stt_failure(self, mock_get_supabase, mock_stt):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        incident_id = str(uuid.uuid4())
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": incident_id, "description": "Original report", "status": "NEW"
        }]

        mock_stt.side_effect = RuntimeError("Google STT network timeout")

        response = self.client.post(
            f"/api/v1/incidents/{incident_id}/voice",
            files={"audio": ("error.webm", b"fake-audio-bytes-header-data-1234567890" * 5, "audio/webm")}
        )
        self.assertEqual(response.status_code, 500)
        self.assertIn("detail", response.json())

    # =========================================================================
    # 10. LLM failure handling (graceful fallback)
    # =========================================================================
    @patch("app.services.voice_service.transcribe_audio")
    @patch("app.services.voice_service.extract_agricultural_meaning")
    @patch("app.services.voice_service.get_supabase_client")
    def test_10_llm_failure(self, mock_get_supabase, mock_llm, mock_stt):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        incident_id = str(uuid.uuid4())
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": incident_id, "description": "Original report", "status": "NEW"
        }]

        mock_stt.return_value = ("నా పత్తి చేనులో పురుగు పట్టింది.", "Telugu")
        mock_llm.side_effect = RuntimeError("Gemini quota exceeded")

        ai_id = str(uuid.uuid4())
        mock_db.table.return_value.insert.return_value.execute.return_value.data = [{
            "id": ai_id,
            "incident_id": incident_id,
            "transcript": "నా పత్తి చేనులో పురుగు పట్టింది.",
            "model_name": "fallback",
            "requires_aeo_review": True
        }]

        response = self.client.post(
            f"/api/v1/incidents/{incident_id}/voice",
            files={"audio": ("audio.webm", b"fake-audio-bytes-header-data-1234567890" * 5, "audio/webm")}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["transcript"], "నా పత్తి చేనులో పురుగు పట్టింది.")
        self.assertTrue(data["requires_aeo_review"])

    # =========================================================================
    # 11. Incident survives STT failure in multipart upload
    # =========================================================================
    @patch("app.services.incident_service.get_supabase_client")
    @patch("app.services.incident_service.upload_incident_audio")
    @patch("app.services.voice_service.transcribe_audio")
    def test_11_incident_survives_stt_failure_in_upload(self, mock_stt, mock_upload_audio, mock_get_supabase):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        farmer_id = "farmer-uuid-1111"
        incident_id = "incident-uuid-2222"

        mock_farmers = MagicMock()
        mock_farmers.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": farmer_id, "name": "Venkatesh", "phone": "+919876543210"
        }]

        mock_incidents = MagicMock()
        mock_incidents.insert.return_value.execute.return_value.data = [{
            "id": incident_id, "farmer_id": farmer_id, "description": "Original text problem"
        }]
        mock_incidents.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": incident_id, "description": "Original text problem", "status": "NEW"
        }]

        def table_router(tbl):
            if tbl == "farmers":
                return mock_farmers
            elif tbl == "incidents":
                return mock_incidents
            return MagicMock()

        mock_db.table.side_effect = table_router

        # STT fails
        mock_stt.side_effect = RuntimeError("Speech-to-Text connection failed")

        response = self.client.post(
            "/api/v1/incidents/upload",
            data={"farmer_name": "Venkatesh", "farmer_phone": "9876543210", "description": "Original text problem"},
            files={"audio": ("voice.webm", b"fake-audio-bytes-header-data-1234567890" * 5, "audio/webm")}
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["incident_id"], incident_id)
        # Incident is intact, but voice_ai_error is recorded
        self.assertIn("voice_ai_error", data)

    # =========================================================================
    # 12. Incident survives LLM failure
    # =========================================================================
    @patch("app.services.voice_service.transcribe_audio")
    @patch("app.services.voice_service.extract_agricultural_meaning")
    @patch("app.services.voice_service.get_supabase_client")
    def test_12_incident_survives_llm_failure(self, mock_get_supabase, mock_llm, mock_stt):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        incident_id = str(uuid.uuid4())
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": incident_id, "description": "Farmer original report", "status": "NEW"
        }]

        mock_stt.return_value = ("పొలంలో తెగులు సోకింది", "Telugu")
        mock_llm.side_effect = RuntimeError("Gemini 503 Service Unavailable")

        mock_db.table.return_value.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4())}]

        response = self.client.post(
            f"/api/v1/incidents/{incident_id}/voice",
            files={"audio": ("audio.webm", b"fake-audio-bytes-header-data-1234567890" * 5, "audio/webm")}
        )
        self.assertEqual(response.status_code, 200)
        # Status was updated to AI_ANALYZED with fallback record
        mock_db.table.return_value.update.assert_called_with({"status": "AI_ANALYZED"})

    # =========================================================================
    # 13. ai_analysis references correct incident
    # =========================================================================
    @patch("app.services.voice_service.transcribe_audio")
    @patch("app.services.voice_service.extract_agricultural_meaning")
    @patch("app.services.voice_service.get_supabase_client")
    def test_13_ai_analysis_references_correct_incident(self, mock_get_supabase, mock_llm, mock_stt):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        target_incident_id = str(uuid.uuid4())
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": target_incident_id, "description": "Specific incident", "status": "NEW"
        }]

        mock_stt.return_value = ("వరిలో ఎండిపోవడం గమనించాము", "Telugu")
        mock_llm.return_value = {
            "structured_data": {"crop": "Paddy", "symptoms": ["drying"]},
            "crop_detected": "Paddy",
            "symptoms": ["drying"],
            "possible_conditions": [],
            "llm_summary": "Paddy drying reported",
            "requires_aeo_review": True,
            "model_name": "gemini-2.0-flash",
            "model_version": "2.0-flash"
        }

        mock_db.table.return_value.insert.return_value.execute.return_value.data = [{
            "id": str(uuid.uuid4()),
            "incident_id": target_incident_id
        }]

        response = self.client.post(
            f"/api/v1/incidents/{target_incident_id}/voice",
            files={"audio": ("rec.webm", b"fake-audio-bytes-header-data-1234567890" * 5, "audio/webm")}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["incident_id"], target_incident_id)

    # =========================================================================
    # 14. requires_aeo_review = true is always strictly enforced
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_requires_aeo_review_enforcement(self, mock_client_cls):
        # Even if the LLM falsely claimed requires_aeo_review: false
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "crop": "Cotton",
                            "symptoms": ["bollworm"],
                            "possible_conditions": ["Pink Bollworm"],
                            "summary": "Cotton pest damage.",
                            "requires_aeo_review": False  # malicious or buggy LLM output
                        })
                    }]
                }
            }]
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.GEMINI_API_KEY", "test-key"):
            res = await extract_agricultural_meaning("Cotton pest damage observed")
            # Must be strictly True
            self.assertTrue(res["requires_aeo_review"])
            self.assertTrue(res["structured_data"]["requires_aeo_review"])

    def test_14_requires_aeo_review_always_true(self):
        import asyncio
        asyncio.run(self._async_test_requires_aeo_review_enforcement())

    # =========================================================================
    # 15. Multiple voice submissions for the same farmer create separate incident analyses
    # =========================================================================
    @patch("app.services.incident_service.get_supabase_client")
    def test_15_multiple_voice_submissions_same_farmer_separate_incidents(self, mock_get_supabase):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        farmer_id = "farmer-uuid-9999"
        mock_farmers_table = MagicMock()
        mock_farmers_table.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": farmer_id,
            "name": "Anil Reddy",
            "phone": "+919123456789"
        }]

        inc1_id = str(uuid.uuid4())
        inc2_id = str(uuid.uuid4())

        mock_incidents_table = MagicMock()
        mock_incidents_table.insert.return_value.execute.side_effect = [
            MagicMock(data=[{"id": inc1_id, "farmer_id": farmer_id, "description": "Incident 1"}]),
            MagicMock(data=[{"id": inc2_id, "farmer_id": farmer_id, "description": "Incident 2"}]),
        ]

        def router(t):
            if t == "farmers":
                return mock_farmers_table
            elif t == "incidents":
                return mock_incidents_table
            return MagicMock()

        mock_db.table.side_effect = router

        # Incident 1
        res1 = self.client.post("/api/v1/incidents", json={
            "farmer_name": "Anil Reddy", "farmer_phone": "9123456789", "description": "Incident 1"
        })
        self.assertEqual(res1.status_code, 201)
        self.assertEqual(res1.json()["farmer_id"], farmer_id)

        # Incident 2
        res2 = self.client.post("/api/v1/incidents", json={
            "farmer_name": "Anil Reddy", "farmer_phone": "+91 9123456789", "description": "Incident 2"
        })
        self.assertEqual(res2.status_code, 201)
        self.assertEqual(res2.json()["farmer_id"], farmer_id)
        self.assertNotEqual(res1.json()["incident_id"], res2.json()["incident_id"])


if __name__ == "__main__":
    unittest.main()
