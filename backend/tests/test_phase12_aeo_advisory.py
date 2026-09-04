import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.services.advisory_service import (
    normalize_language_code,
    get_language_display_name,
    localize_advisory_text,
    generate_advisory_tts,
    create_or_update_officer_advisory,
    get_incident_advisory
)


class TestPhase12AeoAdvisory(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_language_normalization(self):
        self.assertEqual(normalize_language_code("Telugu"), "te")
        self.assertEqual(normalize_language_code("TE"), "te")
        self.assertEqual(normalize_language_code("Hindi"), "hi")
        self.assertEqual(normalize_language_code("Tamil"), "ta")
        self.assertEqual(normalize_language_code("English"), "en")
        self.assertEqual(normalize_language_code("Kannada"), "kn")
        self.assertEqual(normalize_language_code("Marathi"), "mr")
        self.assertEqual(normalize_language_code(None), "te")

    def test_language_display_name(self):
        self.assertEqual(get_language_display_name("te"), "Telugu")
        self.assertEqual(get_language_display_name("hi"), "Hindi")
        self.assertEqual(get_language_display_name("en"), "English")

    def test_localize_advisory_english_direct(self):
        text = "Spray neem oil at 5ml per liter of water."
        result = localize_advisory_text(text, target_language="English")
        self.assertEqual(result, text)

    @patch("app.services.advisory_service.httpx.Client")
    def test_localize_advisory_gemini_translation(self, mock_client_cls):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "లీటరు నీటికి 5 మి.లీ వేప నూనెను పిచికారీ చేయండి."}]
                    }
                }
            ]
        }
        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch("app.core.config.settings.GEMINI_API_KEY", "test-key"):
            result = localize_advisory_text("Spray neem oil at 5ml per liter.", target_language="Telugu")
            self.assertEqual(result, "లీటరు నీటికి 5 మి.లీ వేప నూనెను పిచికారీ చేయండి.")

    @patch("app.services.advisory_service.gTTS")
    def test_generate_advisory_tts_success(self, mock_gtts_cls):
        mock_tts = MagicMock()
        mock_gtts_cls.return_value = mock_tts

        url = generate_advisory_tts("లీటరు నీటికి వేప నూనె పిచికారీ చేయండి.", "te", "inc-adv-1")
        self.assertIsNotNone(url)
        self.assertIn("/uploads/advisory_audio/advisory_inc-adv-1_te.mp3", url)
        mock_tts.save.assert_called_once()

    @patch("app.services.advisory_service.gTTS")
    def test_generate_advisory_tts_fallback_on_error(self, mock_gtts_cls):
        mock_gtts_cls.side_effect = Exception("gTTS network failure")

        # Must not raise exception, returns None
        url = generate_advisory_tts("Some text", "te", "inc-adv-2")
        self.assertIsNone(url)

    @patch("app.services.advisory_service.get_supabase_client")
    @patch("app.services.advisory_service.get_incident_by_id")
    @patch("app.services.advisory_service.localize_advisory_text")
    @patch("app.services.advisory_service.generate_advisory_tts")
    def test_create_officer_advisory_preserves_original_and_saves(
        self, mock_tts, mock_localize, mock_get_incident, mock_get_client
    ):
        mock_get_incident.return_value = {"id": "inc-adv-100", "crop": "Chilli"}
        mock_localize.return_value = "లీటరు నీటికి 5 మి.లీ వేప నూనెను పిచికారీ చేయండి."
        mock_tts.return_value = "/uploads/advisory_audio/advisory_inc-adv-100_te.mp3"

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_ai_query = MagicMock()
        mock_ai_query.execute.return_value = MagicMock(data=[])
        mock_client.table.return_value.select.return_value.eq.return_value = mock_ai_query

        original = "Spray neem oil at 5ml per liter of water."
        res = create_or_update_officer_advisory(
            incident_id="inc-adv-100",
            advisory_text=original,
            target_language="Telugu",
            officer_id="AEO001"
        )

        self.assertTrue(res["success"])
        adv = res["advisory"]
        self.assertEqual(adv["original_advisory"], original)
        self.assertEqual(adv["localized_advisory"], "లీటరు నీటికి 5 మి.లీ వేప నూనెను పిచికారీ చేయండి.")
        self.assertEqual(adv["target_language"], "Telugu")
        self.assertEqual(adv["audio_url"], "/uploads/advisory_audio/advisory_inc-adv-100_te.mp3")

    @patch("app.api.v1.incidents.create_or_update_officer_advisory")
    def test_api_submit_advisory_endpoint(self, mock_create):
        mock_create.return_value = {
            "success": True,
            "incident_id": "inc-adv-200",
            "advisory": {
                "original_advisory": "Advise bio-pesticide",
                "target_language": "Telugu",
                "language_code": "te",
                "localized_advisory": "బయో పురుగుమందును సిఫార్సు చేయండి",
                "audio_url": "/uploads/advisory_audio/advisory_inc-adv-200_te.mp3",
                "officer_id": "AEO001",
                "created_at": "2026-09-02T12:00:00Z",
                "updated_at": "2026-09-02T12:00:00Z",
            },
            "message": "Advisory saved successfully."
        }

        response = self.client.post(
            "/api/v1/incidents/inc-adv-200/advisory",
            json={
                "advisory_text": "Advise bio-pesticide",
                "target_language": "Telugu",
                "officer_id": "AEO001"
            }
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["advisory"]["target_language"], "Telugu")


if __name__ == "__main__":
    unittest.main()
