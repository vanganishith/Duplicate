import unittest
from unittest.mock import patch, MagicMock
import uuid
import io
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app
from app.services.incident_service import create_farmer_incident
from app.services.vision_service import process_multiple_vision_for_incident, process_vision_for_incident


class TestMultiImageIncidents(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def _create_image(self, color=(34, 139, 34)) -> bytes:
        img = Image.new("RGB", (640, 480), color)
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue()

    def _create_non_agri_image(self) -> bytes:
        img = Image.new("RGB", (640, 480), (100, 100, 100)) # Grey image without vegetation
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue()

    # 1. Zero photos -> Incident created successfully
    @patch("app.services.incident_service.get_supabase_client")
    def test_01_create_incident_zero_photos(self, mock_get_supabase):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        inc_id = str(uuid.uuid4())
        farmer_id = str(uuid.uuid4())

        mock_farmers = MagicMock()
        mock_farmers.select.return_value.eq.return_value.execute.return_value.data = [{"id": farmer_id, "name": "Ravi", "phone": "+919876543210"}]

        mock_incidents = MagicMock()
        mock_incidents.insert.return_value.execute.return_value.data = [{
            "id": inc_id,
            "farmer_id": farmer_id,
            "crop": "Paddy",
            "description": "Yellow leaves",
            "photo_url": None,
            "photos": [],
            "status": "NEW",
            "priority": "LOW"
        }]

        mock_db.table.side_effect = lambda t: mock_farmers if t == "farmers" else mock_incidents

        res = create_farmer_incident(
            farmer_name="Ravi",
            farmer_phone="9876543210",
            description="Yellow leaves observed on paddy crop",
            crop="Paddy"
        )

        self.assertTrue(res["success"])
        self.assertEqual(res["incident_id"], inc_id)
        self.assertIsNone(res["photo_url"])
        self.assertEqual(res["photos"], [])

    # 2. One photo -> Incident created & analyzed
    @patch("app.services.incident_service.upload_incident_photo", return_value="http://localhost:8000/uploads/photos/test.jpg")
    @patch("app.services.vision_service.analyze_crop_image")
    @patch("app.database.session.get_supabase_client")
    @patch("app.services.incident_service.get_supabase_client")
    def test_02_create_incident_single_photo(self, mock_get_supabase_inc, mock_get_supabase_db, mock_analyze, mock_upload):
        mock_db = MagicMock()
        mock_get_supabase_inc.return_value = mock_db
        mock_get_supabase_db.return_value = mock_db

        inc_id = str(uuid.uuid4())
        farmer_id = str(uuid.uuid4())

        mock_farmers = MagicMock()
        mock_farmers.select.return_value.eq.return_value.execute.return_value.data = [{"id": farmer_id, "name": "Ravi", "phone": "+919876543210"}]

        mock_incidents = MagicMock()
        mock_incidents.insert.return_value.execute.return_value.data = [{
            "id": inc_id,
            "farmer_id": farmer_id,
            "crop": "Tomato",
            "description": "Leaf spots",
            "photo_url": "http://localhost:8000/uploads/photos/test.jpg",
            "photos": ["http://localhost:8000/uploads/photos/test.jpg"],
            "status": "NEW"
        }]
        mock_incidents.update.return_value.eq.return_value.execute.return_value.data = [{
            "id": inc_id, "status": "AI_ANALYZED"
        }]

        mock_ai = MagicMock()
        mock_ai.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4()), "incident_id": inc_id}]

        mock_db.table.side_effect = lambda t: mock_farmers if t == "farmers" else (mock_ai if t == "ai_analysis" else mock_incidents)

        mock_analyze.return_value = {
            "success": True,
            "detections": [{"label": "early_blight", "confidence": 0.82, "bbox": {"x1": 10, "y1": 10, "x2": 100, "y2": 100}}],
            "quality": {"level": "good", "usable": True},
            "agriculture_relevance": {"accepted": True, "subject": "vegetation_canopy"},
            "image": {"width": 640, "height": 480}
        }

        photo_bytes = self._create_image()
        res = create_farmer_incident(
            farmer_name="Ravi",
            farmer_phone="9876543210",
            description="Tomato leaf spots",
            photos_bytes=[photo_bytes]
        )

        self.assertTrue(res["success"])
        self.assertEqual(len(res["photos"]), 1)

        v_res = process_multiple_vision_for_incident(
            incident_id=inc_id,
            photos_data=[{"bytes": photo_bytes, "url": res["photos"][0], "index": 0}]
        )

        self.assertTrue(v_res["success"])
        self.assertEqual(v_res["vision_prediction"], "early_blight")
        self.assertEqual(v_res["total_images"], 1)

    # 3. Two photos -> Both processed independently without crossing detections
    @patch("app.services.vision_service.analyze_crop_image")
    @patch("app.database.session.get_supabase_client")
    def test_03_two_photos_independent_processing(self, mock_get_supabase, mock_analyze):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        inc_id = str(uuid.uuid4())

        mock_ai = MagicMock()
        mock_ai.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4()), "incident_id": inc_id}]
        mock_incidents = MagicMock()
        mock_incidents.update.return_value.eq.return_value.execute.return_value.data = [{"id": inc_id, "status": "AI_ANALYZED"}]
        mock_db.table.side_effect = lambda t: mock_ai if t == "ai_analysis" else mock_incidents

        # Photo 1 has early_blight; Photo 2 has leaf_spot
        mock_analyze.side_effect = [
            {
                "success": True,
                "detections": [{"label": "early_blight", "confidence": 0.85, "bbox": {"x1": 10, "y1": 10, "x2": 50, "y2": 50}}],
                "quality": {"level": "good", "usable": True},
                "agriculture_relevance": {"accepted": True},
                "image": {"width": 640, "height": 480}
            },
            {
                "success": True,
                "detections": [{"label": "leaf_spot", "confidence": 0.72, "bbox": {"x1": 100, "y1": 100, "x2": 200, "y2": 200}}],
                "quality": {"level": "good", "usable": True},
                "agriculture_relevance": {"accepted": True},
                "image": {"width": 640, "height": 480}
            }
        ]

        photos_data = [
            {"bytes": self._create_image(), "url": "http://test/p1.jpg", "index": 0},
            {"bytes": self._create_image(), "url": "http://test/p2.jpg", "index": 1}
        ]

        v_res = process_multiple_vision_for_incident(inc_id, photos_data)
        self.assertTrue(v_res["success"])
        self.assertEqual(v_res["total_images"], 2)
        self.assertEqual(v_res["images"][0]["detections"][0]["label"], "early_blight")
        self.assertEqual(v_res["images"][1]["detections"][0]["label"], "leaf_spot")

    # 4. Four photos -> All four accepted
    @patch("app.services.vision_service.analyze_crop_image")
    @patch("app.database.session.get_supabase_client")
    def test_04_four_photos_accepted(self, mock_get_supabase, mock_analyze):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        inc_id = str(uuid.uuid4())

        mock_ai = MagicMock()
        mock_ai.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4()), "incident_id": inc_id}]
        mock_incidents = MagicMock()
        mock_incidents.update.return_value.eq.return_value.execute.return_value.data = [{"id": inc_id}]
        mock_db.table.side_effect = lambda t: mock_ai if t == "ai_analysis" else mock_incidents

        mock_analyze.return_value = {
            "success": True,
            "detections": [],
            "quality": {"level": "good", "usable": True},
            "agriculture_relevance": {"accepted": True},
            "image": {"width": 640, "height": 480}
        }

        photos_data = [{"bytes": self._create_image(), "url": f"http://test/p{i}.jpg", "index": i} for i in range(4)]
        v_res = process_multiple_vision_for_incident(inc_id, photos_data)
        self.assertTrue(v_res["success"])
        self.assertEqual(v_res["total_images"], 4)

    # 5. Five photos -> Rejected by max 4 limit
    @patch("app.database.session.get_supabase_client")
    def test_05_five_photos_rejected_by_limit(self, mock_get_supabase):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        mock_farmers = MagicMock()
        mock_farmers.select.return_value.eq.return_value.execute.return_value.data = [{"id": str(uuid.uuid4()), "phone": "+919876543210"}]
        mock_db.table.return_value = mock_farmers

        with self.assertRaises(ValueError) as ctx:
            create_farmer_incident(
                farmer_name="Ravi",
                farmer_phone="9876543210",
                description="Test issue",
                photos_bytes=[self._create_image() for _ in range(5)]
            )
        self.assertIn("Maximum 4 photos allowed", str(ctx.exception))

    # 6. One useful + three irrelevant -> Incident created & useful image analyzed
    @patch("app.services.vision_service.analyze_crop_image")
    @patch("app.database.session.get_supabase_client")
    def test_06_one_useful_three_irrelevant_photos(self, mock_get_supabase, mock_analyze):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        inc_id = str(uuid.uuid4())

        mock_ai = MagicMock()
        mock_ai.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4()), "incident_id": inc_id}]
        mock_incidents = MagicMock()
        mock_incidents.update.return_value.eq.return_value.execute.return_value.data = [{"id": inc_id}]
        mock_db.table.side_effect = lambda t: mock_ai if t == "ai_analysis" else mock_incidents

        # Photo 0: non_agricultural; Photo 1: useful with early_blight; Photo 2 & 3: non_agricultural
        mock_analyze.side_effect = [
            {"success": True, "detections": [], "agriculture_relevance": {"accepted": False}, "quality": {"level": "good"}},
            {"success": True, "detections": [{"label": "early_blight", "confidence": 0.89}], "agriculture_relevance": {"accepted": True}, "quality": {"level": "good"}},
            {"success": True, "detections": [], "agriculture_relevance": {"accepted": False}, "quality": {"level": "good"}},
            {"success": True, "detections": [], "agriculture_relevance": {"accepted": False}, "quality": {"level": "good"}},
        ]

        photos_data = [{"bytes": self._create_image(), "url": f"http://test/p{i}.jpg", "index": i} for i in range(4)]
        v_res = process_multiple_vision_for_incident(inc_id, photos_data)

        self.assertTrue(v_res["success"])
        self.assertEqual(v_res["vision_prediction"], "early_blight")
        self.assertEqual(v_res["images"][0]["status"], "non_agricultural")
        self.assertEqual(v_res["images"][1]["status"], "detected")
        self.assertEqual(v_res["images"][2]["status"], "non_agricultural")
        self.assertEqual(v_res["images"][3]["status"], "non_agricultural")

    # 7. Four irrelevant images -> Incident still created and reaches AEO
    @patch("app.services.vision_service.analyze_crop_image")
    @patch("app.database.session.get_supabase_client")
    def test_07_four_irrelevant_photos_incident_preserved(self, mock_get_supabase, mock_analyze):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        inc_id = str(uuid.uuid4())

        mock_ai = MagicMock()
        mock_ai.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4()), "incident_id": inc_id}]
        mock_incidents = MagicMock()
        mock_incidents.update.return_value.eq.return_value.execute.return_value.data = [{"id": inc_id}]
        mock_db.table.side_effect = lambda t: mock_ai if t == "ai_analysis" else mock_incidents

        mock_analyze.return_value = {
            "success": True,
            "detections": [],
            "agriculture_relevance": {"accepted": False, "reason": "No vegetation"},
            "quality": {"level": "good"}
        }

        photos_data = [{"bytes": self._create_non_agri_image(), "url": f"http://test/p{i}.jpg", "index": i} for i in range(4)]
        v_res = process_multiple_vision_for_incident(inc_id, photos_data)

        self.assertTrue(v_res["success"])
        self.assertEqual(v_res["vision_status"], "non_agricultural")
        for img in v_res["images"]:
            self.assertEqual(img["status"], "non_agricultural")

    # 8. Corrupt image error -> Incident not destroyed, individual error recorded
    @patch("app.services.vision_service.analyze_crop_image")
    @patch("app.database.session.get_supabase_client")
    def test_08_image_failure_does_not_block_incident(self, mock_get_supabase, mock_analyze):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        inc_id = str(uuid.uuid4())

        mock_ai = MagicMock()
        mock_ai.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4()), "incident_id": inc_id}]
        mock_incidents = MagicMock()
        mock_incidents.update.return_value.eq.return_value.execute.return_value.data = [{"id": inc_id}]
        mock_db.table.side_effect = lambda t: mock_ai if t == "ai_analysis" else mock_incidents

        mock_analyze.side_effect = Exception("Simulated decode failure")

        photos_data = [{"bytes": b"invalid_bytes", "url": "http://test/bad.jpg", "index": 0}]
        v_res = process_multiple_vision_for_incident(inc_id, photos_data)

        self.assertTrue(v_res["success"])
        self.assertEqual(v_res["images"][0]["status"], "analysis_failed")
        self.assertIn("Simulated decode failure", v_res["images"][0]["error"])

    # 9. Legacy process_vision_for_incident backward compatibility
    @patch("app.services.vision_service.analyze_crop_image")
    @patch("app.database.session.get_supabase_client")
    def test_09_legacy_process_vision_for_incident(self, mock_get_supabase, mock_analyze):
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        inc_id = str(uuid.uuid4())

        mock_ai = MagicMock()
        mock_ai.select.return_value.eq.return_value.execute.return_value.data = []
        mock_ai.insert.return_value.execute.return_value.data = [{"id": str(uuid.uuid4()), "incident_id": inc_id}]
        mock_incidents = MagicMock()
        mock_incidents.update.return_value.eq.return_value.execute.return_value.data = [{"id": inc_id}]
        mock_db.table.side_effect = lambda t: mock_ai if t == "ai_analysis" else mock_incidents

        mock_analyze.return_value = {
            "success": True,
            "detections": [{"label": "leaf_curl", "confidence": 0.91}],
            "quality": {"level": "good", "usable": True},
            "agriculture_relevance": {"accepted": True},
            "image": {"width": 640, "height": 480}
        }

        res = process_vision_for_incident(inc_id, self._create_image())
        self.assertTrue(res["success"])
        self.assertEqual(res["vision_prediction"], "leaf_curl")
        self.assertEqual(res["total_images"], 1)


if __name__ == "__main__":
    unittest.main()
