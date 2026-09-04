import unittest
from unittest.mock import patch, MagicMock
import uuid
import io
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app
from app.services.vision_service import process_vision_for_incident
from app.services.voice_service import process_voice_for_incident


class TestPhase5Persistence(unittest.TestCase):
    
    def setUp(self):
        self.client = TestClient(app)
        
    def _create_sample_photo(self) -> bytes:
        img = Image.new("RGB", (640, 480), (34, 139, 34))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue()

    # 1. Successful Vision Persistence (Photo-Only)
    @patch("app.database.session.get_supabase_client")
    def test_01_successful_vision_persistence_photo_only(self, mock_get_supabase):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        
        incident_id = str(uuid.uuid4())
        mock_ai_table = MagicMock()
        mock_ai_table.select.return_value.eq.return_value.execute.return_value.data = []
        
        inserted_id = str(uuid.uuid4())
        mock_ai_table.insert.return_value.execute.return_value.data = [{
            "id": inserted_id,
            "incident_id": incident_id,
            "vision_prediction": "leaf_spot",
            "vision_confidence": 0.82,
            "requires_aeo_review": True
        }]
        
        mock_incidents_table = MagicMock()
        mock_db.table.side_effect = lambda t: mock_ai_table if t == "ai_analysis" else mock_incidents_table
        
        photo_bytes = self._create_sample_photo()
        res = process_vision_for_incident(incident_id, photo_bytes)
        
        self.assertTrue(res["success"])
        self.assertEqual(res["incident_id"], incident_id)
        self.assertTrue(res["requires_aeo_review"])
        mock_ai_table.insert.assert_called_once()
        
        insert_payload = mock_ai_table.insert.call_args[0][0]
        self.assertIn("structured_data", insert_payload)
        self.assertIn("vision", insert_payload["structured_data"])
        self.assertTrue(insert_payload["requires_aeo_review"])

    # 2. Bounding-Box & Detections Persistence inside structured_data
    @patch("app.database.session.get_supabase_client")
    def test_02_bounding_box_persisted_in_structured_data(self, mock_get_supabase):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        
        incident_id = str(uuid.uuid4())
        mock_ai_table = MagicMock()
        mock_ai_table.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai_table.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4())}]
        mock_db.table.side_effect = lambda t: mock_ai_table if t == "ai_analysis" else MagicMock()
        
        photo_bytes = self._create_sample_photo()
        res = process_vision_for_incident(incident_id, photo_bytes)
        
        insert_payload = mock_ai_table.insert.call_args[0][0]
        vision_sd = insert_payload["structured_data"]["vision"]
        self.assertIn("detections", vision_sd)
        self.assertIn("image_width", vision_sd)
        self.assertIn("image_height", vision_sd)
        self.assertIn("model", vision_sd)
        self.assertEqual(vision_sd["model"]["name"], "f4m1/plant-disease-detector-12")

    # 3. No Detection Case -> Saves null prediction without writing 'healthy'
    @patch("app.services.vision_service.analyze_crop_image")
    @patch("app.database.session.get_supabase_client")
    def test_03_no_detection_persisted_correctly(self, mock_get_supabase, mock_analyze):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        
        mock_analyze.return_value = {
            "success": True,
            "image": {"width": 640, "height": 480},
            "quality": {"usable": True, "level": "good"},
            "agriculture_relevance": {"accepted": True},
            "detections": [], # Zero detections
            "requires_aeo_review": True
        }
        
        mock_ai_table = MagicMock()
        mock_ai_table.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai_table.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4())}]
        mock_db.table.side_effect = lambda t: mock_ai_table if t == "ai_analysis" else MagicMock()
        
        incident_id = str(uuid.uuid4())
        res = process_vision_for_incident(incident_id, b"sample-bytes")
        
        insert_payload = mock_ai_table.insert.call_args[0][0]
        self.assertIsNone(insert_payload["vision_prediction"])
        self.assertIsNone(insert_payload["vision_confidence"])
        self.assertEqual(insert_payload["structured_data"]["vision"]["detections"], [])
        self.assertEqual(insert_payload["structured_data"]["vision"]["status"], "no_reliable_detection")
        self.assertTrue(insert_payload["requires_aeo_review"])

    # 4. Multimodal Fusion: Voice + Photo Coexist in Same ai_analysis Record
    @patch("app.database.session.get_supabase_client")
    def test_04_voice_and_photo_coexist_in_same_record(self, mock_get_supabase):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        
        incident_id = str(uuid.uuid4())
        existing_ai_id = str(uuid.uuid4())
        
        # Existing row created by Voice AI in Phase 4
        existing_row = {
            "id": existing_ai_id,
            "incident_id": incident_id,
            "transcript": "వరి చేనులో ఆకులు పసుపు రంగులోకి మారుతున్నాయి",
            "detected_language": "Telugu",
            "crop_detected": "వరి",
            "symptoms": ["ఆకులు పసుపు రంగులోకి మారడం"],
            "possible_conditions": ["Nutrient deficiency"],
            "vision_prediction": None,
            "vision_confidence": None,
            "llm_summary": "Paddy leaves turning yellow.",
            "structured_data": {"voice": {"symptoms": ["yellow leaves"]}},
            "requires_aeo_review": True
        }
        
        mock_ai_table = MagicMock()
        mock_ai_table.select.return_value.eq.return_value.execute.return_value.data = [existing_row]
        mock_ai_table.update.return_value.eq.return_value.execute.return_value.data = [existing_row]
        mock_db.table.side_effect = lambda t: mock_ai_table if t == "ai_analysis" else MagicMock()
        
        photo_bytes = self._create_sample_photo()
        res = process_vision_for_incident(incident_id, photo_bytes)
        
        self.assertTrue(res["success"])
        # Must UPDATE, not create duplicate insert
        mock_ai_table.update.assert_called_once()
        mock_ai_table.insert.assert_not_called()
        
        update_payload = mock_ai_table.update.call_args[0][0]
        self.assertIn("structured_data", update_payload)
        # Voice data must remain intact in merged structured data
        self.assertIn("voice", update_payload["structured_data"])
        self.assertIn("vision", update_payload["structured_data"])

    # 5. Voice running after Vision preserves existing vision prediction
    @patch("app.services.voice_service.transcribe_audio")
    @patch("app.services.voice_service.extract_agricultural_meaning")
    @patch("app.services.voice_service.get_supabase_client")
    def test_05_voice_running_after_vision_preserves_vision_data(self, mock_get_supabase, mock_extract, mock_transcribe):
        import asyncio
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        
        mock_transcribe.return_value = ("Leaves are yellow", "English")
        mock_extract.return_value = {
            "crop_detected": "Paddy",
            "symptoms": ["yellowing"],
            "possible_conditions": ["Leaf Blight"],
            "llm_summary": "Paddy yellowing reported.",
            "structured_data": {"crop": "Paddy"}
        }
        
        incident_id = str(uuid.uuid4())
        existing_ai_id = str(uuid.uuid4())
        
        # Existing row created by Vision AI
        existing_row = {
            "id": existing_ai_id,
            "incident_id": incident_id,
            "transcript": None,
            "vision_prediction": "leaf_spot",
            "vision_confidence": 0.85,
            "structured_data": {"vision": {"detections": [{"label": "leaf_spot", "confidence": 0.85}]}},
            "requires_aeo_review": True
        }
        
        mock_inc_table = MagicMock()
        mock_inc_table.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": incident_id, "description": "Leaves are yellow", "status": "NEW", "audio_url": None
        }]
        mock_inc_table.update.return_value.eq.return_value.execute.return_value.data = [{
            "id": incident_id, "status": "AI_ANALYZED"
        }]
        
        mock_ai_table = MagicMock()
        mock_ai_table.select.return_value.eq.return_value.execute.return_value.data = [existing_row]
        mock_ai_table.update.return_value.eq.return_value.execute.return_value.data = [existing_row]
        
        def router(t):
            if t == "incidents":
                return mock_inc_table
            elif t == "ai_analysis":
                return mock_ai_table
            return MagicMock()
            
        mock_db.table.side_effect = router
        
        res = asyncio.run(process_voice_for_incident(incident_id, b"fake-audio-bytes"))
        
        self.assertTrue(res["success"])
        mock_ai_table.update.assert_called_once()
        update_payload = mock_ai_table.update.call_args[0][0]
        
        # Transcript updated
        self.assertEqual(update_payload["transcript"], "Leaves are yellow")
        # Structured data has both voice and vision
        self.assertIn("voice", update_payload["structured_data"])
        self.assertIn("vision", update_payload["structured_data"])

    # 6. Vision Failure Handled Gracefully
    @patch("app.services.vision_service.analyze_crop_image", side_effect=RuntimeError("Corrupt pixel buffer"))
    @patch("app.database.session.get_supabase_client")
    def test_06_vision_failure_handled_gracefully(self, mock_get_supabase, mock_analyze):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        
        mock_ai_table = MagicMock()
        mock_ai_table.select.return_value.eq.return_value.execute.return_value.data = []
        mock_db.table.side_effect = lambda t: mock_ai_table if t == "ai_analysis" else MagicMock()
        
        incident_id = str(uuid.uuid4())
        # Should raise or handle gracefully without crashing
        with self.assertRaises(RuntimeError):
            process_vision_for_incident(incident_id, b"corrupt-data")

    # 7. End-to-End Multipart Upload with Photo Triggers Real Vision Persistence
    @patch("app.services.incident_service.upload_incident_photo")
    @patch("app.database.session.get_supabase_client")
    @patch("app.services.incident_service.get_supabase_client")
    def test_07_multipart_upload_triggers_vision_persistence(self, mock_inc_db, mock_session_db, mock_upload_photo):
        mock_db = MagicMock()
        mock_inc_db.return_value = mock_db
        mock_session_db.return_value = mock_db
        mock_upload_photo.return_value = "https://supabase.co/storage/photos/sample_leaf.jpg"
        
        farmer_id = str(uuid.uuid4())
        incident_id = str(uuid.uuid4())
        
        mock_farmers_table = MagicMock()
        mock_farmers_table.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": farmer_id, "name": "Ravi", "phone": "+919876543210"
        }]
        
        mock_inc_table = MagicMock()
        mock_inc_table.insert.return_value.execute.return_value.data = [{
            "id": incident_id, "farmer_id": farmer_id, "photo_url": "https://supabase.co/storage/photos/sample_leaf.jpg"
        }]
        
        mock_ai_table = MagicMock()
        mock_ai_table.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai_table.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4())}]
        
        def table_router(t):
            if t == "farmers":
                return mock_farmers_table
            elif t == "incidents":
                return mock_inc_table
            elif t == "ai_analysis":
                return mock_ai_table
            return MagicMock()
            
        mock_db.table.side_effect = table_router
        
        photo_bytes = self._create_sample_photo()
        with patch("app.api.v1.incidents.evaluate_multimodal_evidence") as mock_eval_mm:
            mock_eval_mm.return_value = {
                "overall_relevance": "RELEVANT",
                "images": [{"image_index": 1, "status": "RELEVANT"}],
                "assessment": {"relationship": "CONSISTENT", "summary": "Evidence verified"},
                "safe_aeo_approach": "Field verification"
            }
            response = self.client.post(
            "/api/v1/incidents/upload",
            data={
                "farmer_name": "Ravi",
                "farmer_phone": "9876543210",
                "description": "Leaf spots observed",
                "crop": "Cotton"
            },
            files={
                "photo": ("leaf.jpg", photo_bytes, "image/jpeg")
            }
        )
        
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertIn("vision_ai", data)
        self.assertEqual(data["vision_ai"]["incident_id"], incident_id)
        self.assertTrue(data["vision_ai"]["requires_aeo_review"])


if __name__ == "__main__":
    unittest.main()
