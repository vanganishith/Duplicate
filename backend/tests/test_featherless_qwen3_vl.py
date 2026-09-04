import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
import json
import uuid

from app.main import app
from app.services.llm_service import (
    validate_and_understand_agricultural_complaint,
    evaluate_multimodal_evidence,
    extract_agricultural_meaning,
    _parse_llm_json
)
from app.core.config import settings


class TestFeatherlessQwen3VL(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    # =========================================================================
    # TEST 1: Agricultural voice + relevant crop photos -> Accepted & sent to AEO
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_1_agri_voice_and_relevant_photos(self, mock_client_cls):
        # Stage 1 Mock
        stage1_output = {
            "agriculture_related": True,
            "reason": "Clear agricultural complaint regarding chilli leaf curl",
            "complaint": {
                "crop": "Chilli",
                "plant_part": "leaves",
                "symptoms": ["leaf curl", "whiteflies"],
                "duration": "3 days",
                "severity": "moderate",
                "suspected_problem": "Chilli leaf curl virus",
                "farmer_concern": "Leaves are curling upwards with whiteflies."
            },
            "photo_guidance": [
                "Close-up photo of curling chilli leaves",
                "Photo of underside showing whiteflies"
            ]
        }
        # Stage 2 Mock
        stage2_output = {
            "overall_relevance": "RELEVANT",
            "images": [
                {
                    "image_index": 1,
                    "status": "RELEVANT",
                    "relationship_to_complaint": "Clear chilli leaf curling observed.",
                    "visual_evidence": ["curled leaf edges", "pale discoloration"],
                    "limitations": []
                }
            ],
            "assessment": {
                "relationship": "CONSISTENT",
                "summary": "Visual evidence is consistent with chilli leaf curl reported by farmer.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Inspect healthy vs affected leaves, verify whitefly population in the field, and follow official agricultural advisories before recommending treatment."
        }

        mock_resp = MagicMock(status_code=200)
        mock_resp.json.side_effect = [
            {"choices": [{"message": {"content": json.dumps(stage1_output)}}]},
            {"choices": [{"message": {"content": json.dumps(stage2_output)}}]}
        ]
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.FEATHERLESS_API_KEY", "test-featherless-key"):
            # Stage 1: Validate voice
            v_res = await validate_and_understand_agricultural_complaint(
                "మిర్చి తోటలో ఆకులు ముడుచుకుపోతున్నాయి, తెల్లదోమలు ఉన్నాయి.", "Telugu"
            )
            self.assertTrue(v_res["agriculture_related"])
            self.assertEqual(v_res["complaint"]["crop"], "Chilli")
            self.assertEqual(len(v_res["photo_guidance"]), 2)

            # Stage 2: Evaluate photos
            photos = [{"index": 0, "path": "/fake/photo1.jpg", "usable": True}]
            yolo_dets = [{"photo_index": 0, "detections": [{"class_name": "leaf_curl", "confidence": 0.88}], "usable": True}]
            m_res = await evaluate_multimodal_evidence(v_res["complaint"], photos, yolo_dets)

            self.assertEqual(m_res["overall_relevance"], "RELEVANT")
            self.assertEqual(m_res["images"][0]["status"], "RELEVANT")
            self.assertEqual(m_res["assessment"]["relationship"], "CONSISTENT")
            self.assertTrue(m_res["assessment"]["requires_aeo_verification"])
            self.assertIn("safe_aeo_approach", m_res)
            self.assertNotIn("apply 5ml", m_res["safe_aeo_approach"].lower())

    def test_1_agricultural_voice_relevant_photos(self):
        import asyncio
        asyncio.run(self._async_test_1_agri_voice_and_relevant_photos())

    # =========================================================================
    # TEST 2: Agricultural voice + imperfect but related photos -> Accepted
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_2_imperfect_but_related_photos(self, mock_client_cls):
        stage2_output = {
            "overall_relevance": "LIMITED_EVIDENCE",
            "images": [
                {
                    "image_index": 1,
                    "status": "LIMITED_EVIDENCE",
                    "relationship_to_complaint": "Crop foliage is visible but slightly blurred; general leaf discoloration visible.",
                    "visual_evidence": ["paddy foliage visible"],
                    "limitations": ["slight motion blur", "distant camera angle"]
                }
            ],
            "assessment": {
                "relationship": "PARTIALLY_CONSISTENT",
                "summary": "Visual evidence provides partial context. Foliage is visible but field inspection is needed.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Conduct on-site inspection of paddy tillers and leaves to assess discoloration severity."
        }

        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {"choices": [{"message": {"content": json.dumps(stage2_output)}}]}
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.FEATHERLESS_API_KEY", "test-key"):
            complaint = {"crop": "Paddy", "symptoms": ["yellow leaves"]}
            photos = [{"index": 0, "path": "/fake/paddy_blur.jpg", "usable": True}]
            res = await evaluate_multimodal_evidence(complaint, photos, [])

            # Flexible visual match: imperfect photos are still accepted
            self.assertIn(res["overall_relevance"], ["LIMITED_EVIDENCE", "RELEVANT"])
            self.assertEqual(res["images"][0]["status"], "LIMITED_EVIDENCE")
            self.assertTrue(res["assessment"]["requires_aeo_verification"])

    def test_2_agricultural_voice_imperfect_photos(self):
        import asyncio
        asyncio.run(self._async_test_2_imperfect_but_related_photos())

    # =========================================================================
    # TEST 3: Agricultural voice + all irrelevant photos -> Photo retry requested
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_3_all_irrelevant_photos(self, mock_client_cls):
        stage2_output = {
            "overall_relevance": "NON_RELEVANT",
            "images": [
                {
                    "image_index": 1,
                    "status": "NON_AGRICULTURAL",
                    "relationship_to_complaint": "Image shows an indoor room wall and furniture.",
                    "visual_evidence": [],
                    "limitations": ["Not a crop photo"]
                },
                {
                    "image_index": 2,
                    "status": "NON_RELEVANT",
                    "relationship_to_complaint": "Image shows a motorcycle parked on pavement.",
                    "visual_evidence": [],
                    "limitations": ["Vehicle shown instead of crop"]
                }
            ],
            "assessment": {
                "relationship": "INCONSISTENT",
                "summary": "None of the uploaded images contain agricultural evidence or the reported crop.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Request farmer to upload clear photos of the affected crop foliage."
        }

        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {"choices": [{"message": {"content": json.dumps(stage2_output)}}]}
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.FEATHERLESS_API_KEY", "test-key"):
            complaint = {"crop": "Cotton", "symptoms": ["bollworm"]}
            photos = [{"index": 0, "path": "/fake/wall.jpg"}, {"index": 1, "path": "/fake/bike.jpg"}]
            res = await evaluate_multimodal_evidence(complaint, photos, [])

            # All photos irrelevant -> overall_relevance is NON_RELEVANT
            self.assertEqual(res["overall_relevance"], "NON_RELEVANT")
            self.assertEqual(res["images"][0]["status"], "NON_AGRICULTURAL")
            self.assertEqual(res["images"][1]["status"], "NON_RELEVANT")

    def test_3_agricultural_voice_all_irrelevant_photos(self):
        import asyncio
        asyncio.run(self._async_test_3_all_irrelevant_photos())

    # =========================================================================
    # TEST 4: Non-agricultural voice -> agriculture_related = false, no photo upload
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_4_non_agricultural_voice(self, mock_client_cls):
        stage1_output = {
            "agriculture_related": False,
            "reason": "The speaker is discussing a cricket match between India and Australia.",
            "complaint": None,
            "photo_guidance": []
        }

        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {"choices": [{"message": {"content": json.dumps(stage1_output)}}]}
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.FEATHERLESS_API_KEY", "test-key"):
            res = await validate_and_understand_agricultural_complaint(
                "నిన్న మ్యాచ్ లో కోహ్లీ సెంచరీ కొట్టాడు, సూపర్ గా ఆడాడు.", "Telugu"
            )
            self.assertFalse(res["agriculture_related"])
            self.assertIn("cricket", res["reason"].lower())
            self.assertIsNone(res["complaint"])
            self.assertEqual(res["photo_guidance"], [])

    def test_4_non_agricultural_voice(self):
        import asyncio
        asyncio.run(self._async_test_4_non_agricultural_voice())

    # =========================================================================
    # TEST 5: 1 useful + 3 bad photos -> Accepted, bad photos individually tagged
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_5_one_useful_three_bad_photos(self, mock_client_cls):
        stage2_output = {
            "overall_relevance": "RELEVANT",
            "images": [
                {
                    "image_index": 1,
                    "status": "NON_AGRICULTURAL",
                    "relationship_to_complaint": "Farmer selfie or human face.",
                    "visual_evidence": [],
                    "limitations": ["Selfie"]
                },
                {
                    "image_index": 2,
                    "status": "RELEVANT",
                    "relationship_to_complaint": "Clear image of tomato foliage with brown spot lesions.",
                    "visual_evidence": ["brown leaf spots", "yellow halo"],
                    "limitations": []
                },
                {
                    "image_index": 3,
                    "status": "NON_RELEVANT",
                    "relationship_to_complaint": "Image of a tractor wheel.",
                    "visual_evidence": [],
                    "limitations": ["Machinery"]
                },
                {
                    "image_index": 4,
                    "status": "ANALYSIS_FAILED",
                    "relationship_to_complaint": "Completely black / underexposed image.",
                    "visual_evidence": [],
                    "limitations": ["Pitch black"]
                }
            ],
            "assessment": {
                "relationship": "PARTIALLY_CONSISTENT",
                "summary": "Photo #2 shows clear brown spots on foliage consistent with complaint, while others do not show crop leaves.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Verify tomato plant symptoms in field using Photo #2 as reference."
        }

        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {"choices": [{"message": {"content": json.dumps(stage2_output)}}]}
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.FEATHERLESS_API_KEY", "test-key"):
            complaint = {"crop": "Tomato", "symptoms": ["brown spots"]}
            photos = [{"index": 0}, {"index": 1}, {"index": 2}, {"index": 3}]
            res = await evaluate_multimodal_evidence(complaint, photos, [])

            # Incident accepted because at least 1 image is RELEVANT
            self.assertEqual(res["overall_relevance"], "RELEVANT")
            self.assertEqual(len(res["images"]), 4)
            self.assertEqual(res["images"][0]["status"], "NON_AGRICULTURAL")
            self.assertEqual(res["images"][1]["status"], "RELEVANT")
            self.assertEqual(res["images"][2]["status"], "NON_RELEVANT")
            self.assertEqual(res["images"][3]["status"], "ANALYSIS_FAILED")

    def test_5_one_useful_three_bad_photos(self):
        import asyncio
        asyncio.run(self._async_test_5_one_useful_three_bad_photos())

    # =========================================================================
    # TEST 6: Farmer re-records after non-agricultural voice -> Evaluated fresh
    # =========================================================================
    @patch("app.api.v1.incidents.validate_and_understand_agricultural_complaint")
    def test_6_farmer_rerecords_fresh_evaluation(self, mock_validate):
        # Call 1: Non-agricultural voice transcript
        mock_validate.return_value = {
            "agriculture_related": False,
            "reason": "General conversational topic about going to a movie.",
            "complaint": None,
            "photo_guidance": []
        }

        resp1 = self.client.post(
            "/api/v1/incidents/voice/analyze",
            json={"transcript": "రేపు సినిమాకి వెళ్దామా?", "language": "Telugu"}
        )
        self.assertEqual(resp1.status_code, 200)
        d1 = resp1.json()
        self.assertFalse(d1["agriculture_related"])
        self.assertIn("movie", d1["reason"].lower())

        # Call 2: Farmer re-records with agricultural issue
        mock_validate.return_value = {
            "agriculture_related": True,
            "reason": "Cotton leaf reddening reported",
            "complaint": {
                "crop": "Cotton",
                "plant_part": "leaves",
                "symptoms": ["reddening leaves"],
                "duration": "1 week",
                "severity": "high",
                "suspected_problem": "Magnesium deficiency or leafhopper damage",
                "farmer_concern": "Cotton leaves turning red"
            },
            "photo_guidance": ["Photo of reddish cotton leaves", "Photo of healthy vs affected plants"]
        }

        resp2 = self.client.post(
            "/api/v1/incidents/voice/analyze",
            json={"transcript": "పత్తి చేనులో ఆకులు ఎర్రబడుతున్నాయి", "language": "Telugu"}
        )
        self.assertEqual(resp2.status_code, 200)
        d2 = resp2.json()
        self.assertTrue(d2["agriculture_related"])
        self.assertEqual(d2["complaint"]["crop"], "Cotton")
        self.assertEqual(len(d2["photo_guidance"]), 2)

    # =========================================================================
    # TEST 7: Farmer retries photos without re-recording voice -> Preserves complaint
    # =========================================================================
    @patch("app.api.v1.incidents.get_supabase_client")
    @patch("app.api.v1.incidents.evaluate_multimodal_evidence")
    @patch("app.api.v1.incidents.process_multiple_vision_for_incident")
    @patch("app.api.v1.incidents.create_farmer_incident")
    def test_7_photo_retry_without_rerecording_voice(
        self, mock_create_incident, mock_vision, mock_eval_mm, mock_get_supabase
    ):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        inc_id = str(uuid.uuid4())
        mock_create_incident.return_value = {
            "incident_id": inc_id,
            "photos": ["/uploads/photos/test_1.jpg"]
        }
        mock_vision.return_value = {"images": []}

        # Scenario A: All irrelevant photos -> Returns 422 with photo_retry_required
        mock_eval_mm.return_value = {
            "overall_relevance": "NON_RELEVANT",
            "images": [{"image_index": 1, "status": "NON_AGRICULTURAL", "relationship_to_complaint": "Room photo"}],
            "assessment": {"relationship": "INCONSISTENT", "summary": "No agricultural evidence", "requires_aeo_verification": True},
            "safe_aeo_approach": "Retake photo of the crop"
        }

        resp1 = self.client.post(
            "/api/v1/incidents/upload",
            data={
                "farmer_name": "Ramesh",
                "farmer_phone": "9876543210",
                "description": "Leaves curling upwards"
            },
            files=[("photos", ("room.jpg", b"fake-bytes-1" * 10, "image/jpeg"))]
        )
        self.assertEqual(resp1.status_code, 422)
        d1 = resp1.json()
        detail1 = d1.get("detail", d1)
        self.assertTrue(detail1.get("photo_retry_required"))
        self.assertIn("evaluation", detail1)

        # Scenario B: Farmer retries photos with valid crop photo -> 201 Created
        mock_eval_mm.return_value = {
            "overall_relevance": "RELEVANT",
            "images": [{"image_index": 1, "status": "RELEVANT", "relationship_to_complaint": "Chilli leaf curling visible"}],
            "assessment": {"relationship": "CONSISTENT", "summary": "Evidence matches", "requires_aeo_verification": True},
            "safe_aeo_approach": "Field inspection of chilli leaves"
        }

        resp2 = self.client.post(
            "/api/v1/incidents/upload",
            data={
                "farmer_name": "Ramesh",
                "farmer_phone": "9876543210",
                "description": "Leaves curling upwards"
            },
            files=[("photos", ("chilli_leaf.jpg", b"fake-bytes-2" * 10, "image/jpeg"))]
        )
        self.assertEqual(resp2.status_code, 201)
        d2 = resp2.json()
        self.assertTrue(d2["success"])
        self.assertEqual(d2["incident_id"], inc_id)

    # =========================================================================
    # TEST 8: Featherless API unavailable -> Graceful error handling, no crash
    # =========================================================================
    @patch("app.services.llm_service.httpx.AsyncClient")
    async def _async_test_8_featherless_api_unavailable(self, mock_client_cls):
        # Network failure / timeout
        mock_client = AsyncMock()
        mock_client.post.side_effect = Exception("Featherless API gateway 504 timeout")
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        with patch("app.core.config.settings.FEATHERLESS_API_KEY", "test-key"):
            # Stage 1: Fallback activates gracefully
            v_res = await validate_and_understand_agricultural_complaint(
                "టమోటా ఆకులు ఎండిపోతున్నాయి", "Telugu"
            )
            self.assertTrue(v_res["agriculture_related"])
            self.assertEqual(v_res["complaint"]["crop"], "Tomato")
            self.assertTrue(len(v_res["photo_guidance"]) >= 1)

            # Stage 2: Multimodal fallback activates gracefully from YOLO11 findings
            photos = [{"index": 0, "path": "/fake/tomato.jpg"}]
            yolo_dets = [{"photo_index": 0, "detections": [{"class_name": "leaf_spot"}], "usable": True}]
            m_res = await evaluate_multimodal_evidence(v_res["complaint"], photos, yolo_dets)

            self.assertIn(m_res["overall_relevance"], ["RELEVANT", "LIMITED_EVIDENCE"])
            self.assertTrue(m_res["assessment"]["requires_aeo_verification"])
            self.assertIn("safe_aeo_approach", m_res)

    def test_8_featherless_api_unavailable_graceful(self):
        import asyncio
        asyncio.run(self._async_test_8_featherless_api_unavailable())


if __name__ == "__main__":
    unittest.main()
