import unittest
from unittest.mock import patch, MagicMock
import io
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from fastapi.testclient import TestClient

from app.main import app
from app.services.vision_service import (
    VisionModelEngine,
    analyze_crop_image,
    transform_boxes_to_original,
    non_maximum_suppression,
    compute_iou
)


class TestPhase5Vision(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        # Warm up/verify model is loaded
        cls.engine = VisionModelEngine.get_instance()
        cls.client = TestClient(app)
        
    def _create_image_bytes(self, img: Image.Image, format="JPEG") -> bytes:
        buf = io.BytesIO()
        img.save(buf, format=format)
        return buf.getvalue()

    # 1. Real Model Verification: Engine Loaded & Actual Classes
    def test_01_real_model_loaded(self):
        """Verify that the real f4m1 ONNX model is loaded with genuine weights and 12 classes."""
        self.assertTrue(self.engine.is_loaded)
        self.assertIsNotNone(self.engine.session)
        self.assertEqual(len(self.engine.classes), 12)
        self.assertIn("leaf_spot", self.engine.classes)
        self.assertIn("powdery_mildew", self.engine.classes)
        self.assertIn("early_blight", self.engine.classes)

    # 2. Real Agricultural Image -> Runs Full Inference
    def test_02_real_agricultural_image_inference(self):
        """Passes a clear agricultural leaf image through the real YOLO11 model."""
        img = Image.new("RGB", (640, 480), (34, 139, 34))
        d = ImageDraw.Draw(img)
        d.ellipse([80, 60, 560, 420], fill=(50, 205, 50))
        d.line([(320, 60), (320, 420)], fill=(0, 100, 0), width=4)
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertTrue(res["success"])
        self.assertEqual(res["image"]["width"], 640)
        self.assertEqual(res["image"]["height"], 480)
        self.assertTrue(res["quality"]["usable"])
        self.assertTrue(res["agriculture_relevance"]["accepted"])
        self.assertTrue(res["requires_aeo_review"])
        self.assertIn("timings_ms", res)
        self.assertGreater(res["timings_ms"]["inference"], 0)

    # 3. Healthy Plant Image -> Accepted without forced diagnosis
    def test_03_healthy_plant_accepted(self):
        """Healthy green plant is accepted by gates; if no disease exceeds threshold, detections is empty."""
        img = Image.new("RGB", (500, 500), (220, 220, 220))
        d = ImageDraw.Draw(img)
        d.polygon([(250, 40), (420, 250), (250, 460), (80, 250)], fill=(34, 139, 34))
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertTrue(res["success"])
        self.assertTrue(res["quality"]["usable"])
        self.assertTrue(res["agriculture_relevance"]["accepted"])
        self.assertIsInstance(res["detections"], list)
        self.assertTrue(res["requires_aeo_review"])

    # 4. Diseased Plant Image (Chlorosis + Necrotic Lesions) -> Full Inference
    def test_04_diseased_plant_inference(self):
        """Diseased plant with chlorosis patches passes gates and runs real YOLO11 inference."""
        img = Image.new("RGB", (800, 600), (230, 230, 230))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 700, 520], fill=(218, 165, 32)) # Yellow blade
        d.ellipse([200, 180, 300, 280], fill=(139, 69, 19)) # Necrotic spot
        d.ellipse([450, 320, 550, 420], fill=(101, 67, 33)) # Blight patch
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes, confidence_threshold=0.01) # Test raw detection extraction
        
        self.assertTrue(res["success"])
        self.assertEqual(res["image"]["width"], 800)
        self.assertEqual(res["image"]["height"], 600)
        self.assertTrue(res["quality"]["usable"])
        self.assertIsInstance(res["detections"], list)

    # 5. Medium-Quality Plant Image -> ACCEPT
    def test_05_medium_quality_plant_accepted(self):
        img = Image.new("RGB", (640, 480), (45, 120, 45))
        d = ImageDraw.Draw(img)
        d.ellipse([120, 100, 500, 380], fill=(60, 180, 60))
        img = img.filter(ImageFilter.BoxBlur(1.0))
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertTrue(res["success"])
        self.assertTrue(res["quality"]["usable"])
        self.assertFalse(res["quality"]["needs_better_photo"])

    # 6. Low-Resolution but Usable Plant (320x240) -> ACCEPT
    def test_06_low_resolution_plant_accepted(self):
        img = Image.new("RGB", (320, 240), (40, 140, 40))
        d = ImageDraw.Draw(img)
        d.ellipse([50, 40, 270, 200], fill=(80, 200, 80))
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertTrue(res["success"])
        self.assertEqual(res["image"]["width"], 320)
        self.assertEqual(res["image"]["height"], 240)

    # 7. Moderately Blurry Plant -> ACCEPT in medium pathway
    def test_07_moderately_blurry_plant_accepted(self):
        img = Image.new("RGB", (640, 480), (30, 130, 30))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        img = img.filter(ImageFilter.GaussianBlur(radius=2.0))
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertTrue(res["success"])
        self.assertTrue(res["quality"]["usable"])
        self.assertEqual(res["quality"]["level"], "medium")

    # 8. Extremely Blurry Image -> REJECT before YOLO inference
    def test_08_extremely_blurry_image_rejected(self):
        img = Image.new("RGB", (640, 480), (30, 130, 30))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        img = img.filter(ImageFilter.GaussianBlur(radius=25.0))
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertFalse(res["success"])
        self.assertFalse(res["quality"]["usable"])
        self.assertEqual(res["detections"], [])
        self.assertIn("blurry", res["farmer_message"].lower())

    # 9. Completely Dark Image (Pitch Black) -> REJECT
    def test_09_completely_dark_image_rejected(self):
        img = Image.new("RGB", (640, 480), (2, 2, 3))
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertFalse(res["success"])
        self.assertFalse(res["quality"]["usable"])
        self.assertEqual(res["detections"], [])
        self.assertIn("dark", res["farmer_message"].lower())

    # 10. Dog / Animal -> REJECT (Non-Agricultural)
    def test_10_dog_animal_rejected(self):
        img = Image.new("RGB", (400, 400), (70, 50, 40))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 100, 300, 300], fill=(139, 69, 19))
        d.ellipse([130, 130, 160, 160], fill=(20, 20, 20))
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertFalse(res["success"])
        self.assertFalse(res["agriculture_relevance"]["accepted"])
        self.assertEqual(res["detections"], [])

    # 11. Human Portrait -> REJECT (Non-Agricultural)
    def test_11_human_portrait_rejected(self):
        img = Image.new("RGB", (400, 400), (200, 200, 200))
        d = ImageDraw.Draw(img)
        d.rectangle([50, 200, 350, 400], fill=(30, 60, 150))
        d.ellipse([120, 50, 280, 210], fill=(240, 190, 160))
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertFalse(res["success"])
        self.assertFalse(res["agriculture_relevance"]["accepted"])
        self.assertEqual(res["detections"], [])

    # 12. Car / Vehicle -> REJECT (Non-Agricultural)
    def test_12_car_vehicle_rejected(self):
        img = Image.new("RGB", (400, 400), (100, 100, 100))
        d = ImageDraw.Draw(img)
        d.rectangle([50, 150, 350, 300], fill=(180, 20, 20))
        d.rectangle([100, 80, 300, 150], fill=(50, 150, 220))
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertFalse(res["success"])
        self.assertFalse(res["agriculture_relevance"]["accepted"])

    # 13. Random Object (Metallic Blue Box) -> REJECT
    def test_13_random_object_rejected(self):
        img = Image.new("RGB", (400, 400), (30, 30, 50))
        d = ImageDraw.Draw(img)
        d.rectangle([70, 70, 330, 330], fill=(0, 191, 255), outline=(255, 255, 0), width=4)
        
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertFalse(res["success"])

    # 14. Coordinate Inverse Transformation Unit Test
    def test_14_coordinate_scaling_after_letterbox(self):
        """
        Tests that boxes detected on a 640x640 letterbox canvas are accurately
        un-padded and scaled back to original image dimensions (e.g. 1000x500).
        """
        orig_W, orig_H = 1000, 500
        # scale = min(640/1000, 640/500) = 0.64
        # new_W = 640, new_H = 320, pad_x = 0, pad_y = 160
        scale = 0.64
        pad_x = 0
        pad_y = 160
        
        # Center box on canvas: cx=320, cy=320 (which is canvas center), w=200, h=100
        # in original image: cx should be 320 / 0.64 = 500, cy should be (320 - 160) / 0.64 = 250 (original center!)
        boxes_canvas = np.array([[320.0, 320.0, 200.0, 100.0]])
        
        orig_boxes = transform_boxes_to_original(
            boxes_canvas=boxes_canvas,
            scale=scale,
            pad_x=pad_x,
            pad_y=pad_y,
            orig_W=orig_W,
            orig_H=orig_H
        )
        
        self.assertEqual(len(orig_boxes), 1)
        b = orig_boxes[0]
        # x1 = (320 - 100) / 0.64 = 343.75 -> 344
        # x2 = (320 + 100) / 0.64 = 656.25 -> 656
        # y1 = (320 - 50 - 160) / 0.64 = 171.875 -> 172
        # y2 = (320 + 50 - 160) / 0.64 = 328.125 -> 328
        self.assertAlmostEqual(b["x1"], 344, delta=2)
        self.assertAlmostEqual(b["x2"], 656, delta=2)
        self.assertAlmostEqual(b["y1"], 172, delta=2)
        self.assertAlmostEqual(b["y2"], 328, delta=2)
        self.assertTrue(0 <= b["x1"] < b["x2"] <= orig_W)
        self.assertTrue(0 <= b["y1"] < b["y2"] <= orig_H)

    # 15. NMS Deduplication Unit Test
    def test_15_non_maximum_suppression(self):
        """Tests that duplicate overlapping boxes for the same class are suppressed."""
        boxes = np.array([
            [100, 100, 200, 200], # Primary box (conf 0.90)
            [105, 102, 198, 205], # Overlapping duplicate (conf 0.85) - IoU > 0.80
            [300, 300, 400, 400], # Separate distinct lesion (conf 0.75)
        ], dtype=np.float32)
        scores = np.array([0.90, 0.85, 0.75], dtype=np.float32)
        classes = np.array([3, 3, 3], dtype=np.int64) # Same class: leaf_spot
        
        keep = non_maximum_suppression(boxes, scores, classes, iou_threshold=0.45)
        self.assertEqual(len(keep), 2)
        self.assertIn(0, keep)
        self.assertIn(2, keep)
        self.assertNotIn(1, keep)

    # 16. Model Failure Handling Unit Test
    @patch.object(VisionModelEngine, "infer", side_effect=RuntimeError("Simulated hardware error"))
    def test_16_model_failure_handled_gracefully(self, mock_infer):
        """Tests that unexpected ONNX inference failure returns a controlled response without crashing."""
        img = Image.new("RGB", (640, 480), (34, 139, 34))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        raw_bytes = self._create_image_bytes(img)
        res = analyze_crop_image(raw_bytes)
        
        self.assertFalse(res["success"])
        self.assertIn("error", res)
        self.assertIn("Inference error", res["error"])
        self.assertEqual(res["detections"], [])
        self.assertTrue(res["requires_aeo_review"])

    # 17. FastAPI API Endpoint Integration Test (POST /api/v1/vision/analyze)
    def test_17_api_endpoint_vision_analyze(self):
        """Tests the FastAPI endpoint POST /api/v1/vision/analyze with multipart image upload."""
        img = Image.new("RGB", (640, 480), (34, 139, 34))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        raw_bytes = self._create_image_bytes(img)
        
        response = self.client.post(
            "/api/v1/vision/analyze",
            files={"photo": ("leaf_sample.jpg", raw_bytes, "image/jpeg")},
            data={"confidence_threshold": "0.15"}
        )
        
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["image"]["width"], 640)
        self.assertEqual(data["image"]["height"], 480)
        self.assertTrue(data["requires_aeo_review"])
        self.assertEqual(data["model"]["name"], "f4m1/plant-disease-detector-12")
        self.assertEqual(data["model"]["type"], "YOLO11")


if __name__ == "__main__":
    unittest.main()
