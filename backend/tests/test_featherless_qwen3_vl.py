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
            "success": True,
            "incident_id": inc_id,
            "farmer_id": "farmer-12345",
            "reference_id": "REF-9999",
            "message": "Incident submitted successfully",
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
        self.assertEqual(resp1.status_code, 400)
        d1 = resp1.json()
        detail1 = d1.get("detail", d1)
        self.assertTrue(detail1.get("photo_retry_required"))
        self.assertIn("image_evaluations", detail1)

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

    # =========================================================================
    # TEST 9: All Healthy Crop Photos -> Rejected with specific retry message
    # =========================================================================
    @patch("app.api.v1.incidents.get_supabase_client")
    @patch("app.api.v1.incidents.evaluate_multimodal_evidence")
    @patch("app.api.v1.incidents.process_multiple_vision_for_incident")
    @patch("app.api.v1.incidents.create_farmer_incident")
    def test_9_healthy_crop_photo_rejection(
        self, mock_create_incident, mock_vision, mock_eval_mm, mock_get_supabase
    ):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        inc_id = str(uuid.uuid4())
        mock_create_incident.return_value = {
            "success": True,
            "incident_id": inc_id,
            "farmer_id": "farmer-12345",
            "reference_id": "REF-8888",
            "message": "Incident submitted",
            "photos": ["/uploads/photos/healthy_leaf.jpg"]
        }
        mock_vision.return_value = {"images": []}

        # Multimodal AI determines plant is completely healthy, no symptoms visible
        mock_eval_mm.return_value = {
            "overall_relevance": "HEALTHY_CROP",
            "images": [
                {
                    "image_index": 1,
                    "status": "HEALTHY_CROP",
                    "relationship_to_complaint": "The photo shows lush green healthy chilli foliage with zero visible symptoms of curling, yellowing, or pests.",
                    "visual_evidence": [],
                    "limitations": []
                }
            ],
            "assessment": {
                "relationship": "INCONSISTENT",
                "summary": "Photo shows a completely healthy plant, inconsistent with reported disease.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Farmer should upload a photo of affected or damaged parts."
        }

        resp = self.client.post(
            "/api/v1/incidents/upload",
            data={
                "farmer_name": "Ramesh",
                "farmer_phone": "9876543210",
                "crop": "Chilli",
                "description": "Leaves are curling",
                "language": "English"
            },
            files=[("photos", ("healthy_chilli.jpg", b"fake-healthy-bytes" * 10, "image/jpeg"))]
        )

        self.assertEqual(resp.status_code, 400)
        detail = resp.json().get("detail", {})
        self.assertTrue(detail.get("photo_retry_required"))
        self.assertIn("healthy", detail.get("message", "").lower())
        self.assertIn("affected or damaged", detail.get("message", "").lower())

    # =========================================================================
    # TEST 10: Wrong / Mismatched Crop Photos -> Rejected with specific retry message
    # =========================================================================
    @patch("app.api.v1.incidents.get_supabase_client")
    @patch("app.api.v1.incidents.evaluate_multimodal_evidence")
    @patch("app.api.v1.incidents.process_multiple_vision_for_incident")
    @patch("app.api.v1.incidents.create_farmer_incident")
    def test_10_wrong_crop_photo_rejection(
        self, mock_create_incident, mock_vision, mock_eval_mm, mock_get_supabase
    ):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        inc_id = str(uuid.uuid4())
        mock_create_incident.return_value = {
            "success": True,
            "incident_id": inc_id,
            "farmer_id": "farmer-12345",
            "reference_id": "REF-7777",
            "message": "Incident submitted",
            "photos": ["/uploads/photos/banana_leaf.jpg"]
        }
        mock_vision.return_value = {"images": []}

        # Multimodal AI detects wrong crop (e.g. Banana tree when complaint is for Chilli)
        mock_eval_mm.return_value = {
            "overall_relevance": "WRONG_CROP",
            "images": [
                {
                    "image_index": 1,
                    "status": "WRONG_CROP",
                    "relationship_to_complaint": "The photo shows a banana tree, but the farmer reported chilli leaf curl.",
                    "visual_evidence": [],
                    "limitations": ["Wrong crop"]
                }
            ],
            "assessment": {
                "relationship": "INCONSISTENT",
                "summary": "Photo shows a completely different crop than reported in complaint.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Farmer should upload photos of the actual reported crop."
        }

        # Test English response
        resp_en = self.client.post(
            "/api/v1/incidents/upload",
            data={
                "farmer_name": "Ramesh",
                "farmer_phone": "9876543210",
                "crop": "Chilli",
                "description": "Leaves are curling",
                "language": "English"
            },
            files=[("photos", ("banana_tree.jpg", b"fake-banana-bytes" * 10, "image/jpeg"))]
        )

        self.assertEqual(resp_en.status_code, 400)
        detail_en = resp_en.json().get("detail", {})
        self.assertTrue(detail_en.get("photo_retry_required"))
        self.assertIn("different plant or object", detail_en.get("message", "").lower())
        self.assertIn("chilli", detail_en.get("message", "").lower())

        # Test Telugu localized response
        resp_te = self.client.post(
            "/api/v1/incidents/upload",
            data={
                "farmer_name": "Ramesh",
                "farmer_phone": "9876543210",
                "crop": "Chilli",
                "description": "ఆకులు ముడుచుకుపోతున్నాయి",
                "language": "Telugu"
            },
            files=[("photos", ("banana_tree.jpg", b"fake-banana-bytes" * 10, "image/jpeg"))]
        )

        self.assertEqual(resp_te.status_code, 400)
        detail_te = resp_te.json().get("detail", {})
        self.assertTrue(detail_te.get("photo_retry_required"))
        self.assertIn("మిరప", detail_te.get("message", ""))
        self.assertIn("మరొక ఫోటో", detail_te.get("message", ""))



class TestMultimodalQwen3VLPipeline(unittest.TestCase):
    """
    Tests for Featherless Qwen3-VL multimodal pipeline:
    - Bounding box sanitation
    - Dual-layer coordinates (YOLO absolute vs Qwen normalized)
    - Structured multimodal assessment and cross-validation
    """

    def test_sanitize_bbox_valid_dict(self):
        from app.services.llm_service import _sanitize_bbox
        raw = {"x1": 0.15, "y1": 0.20, "x2": 0.45, "y2": 0.55}
        cleaned = _sanitize_bbox(raw)
        self.assertIsNotNone(cleaned)
        self.assertEqual(cleaned["x1"], 0.15)
        self.assertEqual(cleaned["y1"], 0.20)
        self.assertEqual(cleaned["x2"], 0.45)
        self.assertEqual(cleaned["y2"], 0.55)

    def test_sanitize_bbox_clamp_out_of_bounds(self):
        from app.services.llm_service import _sanitize_bbox
        raw = {"x1": -0.1, "y1": -0.05, "x2": 1.2, "y2": 1.05}
        cleaned = _sanitize_bbox(raw)
        self.assertIsNotNone(cleaned)
        self.assertEqual(cleaned["x1"], 0.0)
        self.assertEqual(cleaned["y1"], 0.0)
        self.assertEqual(cleaned["x2"], 1.0)
        self.assertEqual(cleaned["y2"], 1.0)

    def test_sanitize_bbox_rejects_inverted(self):
        from app.services.llm_service import _sanitize_bbox
        # x2 < x1
        self.assertIsNone(_sanitize_bbox({"x1": 0.5, "y1": 0.2, "x2": 0.3, "y2": 0.6}))
        # y2 < y1
        self.assertIsNone(_sanitize_bbox({"x1": 0.2, "y1": 0.7, "x2": 0.5, "y2": 0.4}))
        # zero area (degenerate line)
        self.assertIsNone(_sanitize_bbox({"x1": 0.3, "y1": 0.3, "x2": 0.3, "y2": 0.5}))

    def test_sanitize_bbox_valid_list(self):
        from app.services.llm_service import _sanitize_bbox
        raw = [0.1, 0.2, 0.4, 0.6]
        cleaned = _sanitize_bbox(raw)
        self.assertIsNotNone(cleaned)
        self.assertEqual(cleaned["x1"], 0.1)
        self.assertEqual(cleaned["y1"], 0.2)
        self.assertEqual(cleaned["x2"], 0.4)
        self.assertEqual(cleaned["y2"], 0.6)

    @patch("app.services.llm_service.httpx.AsyncClient")
    def test_multimodal_evidence_structure_and_dual_layer(self, mock_client_cls):
        import asyncio

        qwen_stage2_response = {
            "overall_relevance": "RELEVANT",
            "images": [
                {
                    "image_index": 1,
                    "status": "RELEVANT",
                    "visible_crop": "Tomato",
                    "relationship_to_complaint": "Tomato foliage shows spots matching complaint.",
                    "visual_evidence": ["Necrotic circular spots with chlorotic halo"],
                    "spatial_mappings": [
                        {
                            "label": "Brown circular spot on lower leaf",
                            "description": "Necrotic foliar lesion with concentric rings",
                            "confidence": 0.88,
                            "bbox_normalized": {"x1": 0.15, "y1": 0.20, "x2": 0.48, "y2": 0.55}
                        }
                    ]
                }
            ],
            "assessment": {
                "relationship": "CONSISTENT",
                "summary": "Visual evidence is consistent with tomato leaf spots reported.",
                "requires_aeo_verification": True
            },
            "safe_aeo_approach": "Conduct on-site leaf examination before issuing advisory.",
            "multimodal_assessment": {
                "voice_image_relationship": "CONSISTENT",
                "confidence": 0.88,
                "reasoning": "Reported spots align with observed foliar lesions.",
                "supporting_evidence": ["Brown foliar spots observed"],
                "contradictions": [],
                "missing_evidence": [],
                "possible_conditions": ["Possible fungal leaf spot or early blight"],
                "evidence_strength": "STRONG",
                "why_ai_reached_assessment": "Target lesions visible on tomato leaves.",
                "recommended_aeo_checks": ["Inspect underside for sporulation"]
            }
        }

        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {"choices": [{"message": {"content": json.dumps(qwen_stage2_response)}}]}
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        async def run_test():
            complaint = {"crop": "Tomato", "description": "Brown spots on tomato leaves"}
            photos_data = [{"bytes": b"fake-tomato-bytes", "url": "https://fake.url/img.jpg", "index": 0}]
            yolo_findings = [
                {
                    "status": "detected",
                    "detections": [
                        {"bbox": {"x1": 27, "x2": 300, "y1": 26, "y2": 310}, "label": "early_blight", "confidence": 0.817}
                    ],
                    "image_width": 553,
                    "image_height": 414
                }
            ]

            with patch("app.core.config.settings.FEATHERLESS_API_KEY", "test-key"):
                res = await evaluate_multimodal_evidence(complaint, photos_data, yolo_findings)

            # 1. Structure verification
            self.assertIn("multimodal_assessment", res)
            self.assertIn("visual_mappings", res)
            self.assertIn("voice_image_assessment", res)
            self.assertIn("vision", res)

            # 2. Dual layer check: YOLO detections preserved untouched
            self.assertEqual(len(res["vision"]["yolo_detections"]), 1)
            self.assertEqual(res["vision"]["yolo_detections"][0]["detections"][0]["label"], "early_blight")
            self.assertEqual(res["vision"]["yolo_detections"][0]["detections"][0]["bbox"]["x1"], 27)

            # 3. Qwen visual mappings: normalized coordinates between 0 and 1
            mappings = res["visual_mappings"]
            self.assertGreaterEqual(len(mappings), 1)
            box = mappings[0]["bbox_normalized"]
            self.assertTrue(0.0 <= box["x1"] < box["x2"] <= 1.0)
            self.assertTrue(0.0 <= box["y1"] < box["y2"] <= 1.0)
            self.assertEqual(mappings[0]["source"], "QWEN3_VL")
            self.assertEqual(mappings[0]["evidence_type"], "QWEN_VISUAL_MAPPING")

            # 4. Cross validation relationship
            self.assertEqual(res["multimodal_assessment"]["voice_image_relationship"], "CONSISTENT")
            self.assertIn("recommended_aeo_checks", res["multimodal_assessment"])

            # 5. Tentative non-confirmed language
            for cond in res["multimodal_assessment"].get("possible_conditions", []):
                self.assertNotIn("diagnosed with certainty", cond.lower())

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()

