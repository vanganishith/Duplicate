import unittest
import io
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import asyncio

from app.services.image_gate_service import (
    safe_decode_image,
    evaluate_image_usability,
    evaluate_agricultural_relevance,
    run_image_safety_gates,
    preprocess_for_inference
)


class TestPhase5ImageGates(unittest.TestCase):
    
    def _create_image_bytes(self, img: Image.Image, format="JPEG") -> bytes:
        buf = io.BytesIO()
        img.save(buf, format=format)
        return buf.getvalue()

    # 1. Good plant image -> ACCEPT
    def test_01_good_plant_image_accepted(self):
        img = Image.new("RGB", (640, 480), (34, 139, 34))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        d.line([(320, 80), (320, 400)], fill=(0, 100, 0), width=4)
        
        quality = evaluate_image_usability(img)
        self.assertTrue(quality["usable"])
        self.assertEqual(quality["level"], "good")
        self.assertGreaterEqual(quality["confidence"], 0.80)

    # 2. Medium-quality plant image -> ACCEPT
    def test_02_medium_quality_plant_image_accepted(self):
        img = Image.new("RGB", (640, 480), (45, 120, 45))
        d = ImageDraw.Draw(img)
        d.ellipse([120, 100, 500, 380], fill=(60, 180, 60))
        # Slightly soften/noise
        img = img.filter(ImageFilter.BoxBlur(1.5))
        
        quality = evaluate_image_usability(img)
        self.assertTrue(quality["usable"])
        self.assertIn(quality["level"], ["good", "medium"])
        self.assertFalse(quality["needs_better_photo"])

    # 3. Low-resolution but recognizable plant (320x240 low-end smartphone) -> ACCEPT
    def test_03_low_resolution_plant_accepted(self):
        img = Image.new("RGB", (320, 240), (40, 140, 40))
        d = ImageDraw.Draw(img)
        d.ellipse([50, 40, 270, 200], fill=(80, 200, 80))
        
        quality = evaluate_image_usability(img)
        self.assertTrue(quality["usable"])
        self.assertFalse(quality["needs_better_photo"])

    # 4. Moderately blurry plant -> ACCEPT (Medium Quality Pathway)
    def test_04_moderately_blurry_plant_accepted_medium(self):
        img = Image.new("RGB", (640, 480), (30, 130, 30))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        # Moderate camera motion blur
        img = img.filter(ImageFilter.GaussianBlur(radius=2.0))
        
        quality = evaluate_image_usability(img)
        self.assertTrue(quality["usable"])
        self.assertEqual(quality["level"], "medium")
        self.assertFalse(quality["needs_better_photo"])

    # 5. Extremely blurry image -> REJECT
    def test_05_extremely_blurry_image_rejected(self):
        img = Image.new("RGB", (640, 480), (30, 130, 30))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
        # Unrecoverable severe blur
        img = img.filter(ImageFilter.GaussianBlur(radius=15.0))
        
        quality = evaluate_image_usability(img)
        self.assertFalse(quality["usable"])
        self.assertEqual(quality["level"], "poor")
        self.assertTrue(quality["needs_better_photo"])
        self.assertIn("blurry", quality["reason"].lower())

    # 6. Very dark but still recognizable plant -> ACCEPT / MEDIUM
    def test_06_very_dark_but_visible_plant_accepted(self):
        # Dim lighting (Mean RGB ~ 25)
        img = Image.new("RGB", (640, 480), (15, 25, 15))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 80, 540, 400], fill=(20, 45, 20))
        d.ellipse([200, 150, 300, 250], fill=(35, 60, 25))
        
        quality = evaluate_image_usability(img)
        self.assertTrue(quality["usable"])
        self.assertEqual(quality["level"], "medium")
        self.assertFalse(quality["needs_better_photo"])

    # 7. Completely dark image (Pitch black / lens cap) -> REJECT
    def test_07_completely_dark_image_rejected(self):
        img = Image.new("RGB", (640, 480), (2, 2, 3))
        
        quality = evaluate_image_usability(img)
        self.assertFalse(quality["usable"])
        self.assertEqual(quality["level"], "poor")
        self.assertTrue(quality["needs_better_photo"])
        self.assertIn("dark", quality["reason"].lower())

    # 8. Corrupted image bytes -> REJECT
    def test_08_corrupted_image_rejected(self):
        corrupt_bytes = b"NOT_A_VALID_IMAGE_FILE_DATA_CORRUPT"
        
        result = asyncio.run(run_image_safety_gates(corrupt_bytes))
        self.assertFalse(result["accepted"])
        self.assertFalse(result["quality"]["usable"])
        self.assertIn("unable to open", result["farmer_message"].lower())

    # 9. Dog / Animal -> REJECT (Non-Agricultural)
    def test_09_dog_animal_rejected(self):
        # Neutral brown/black animal colors without vegetation index
        img = Image.new("RGB", (400, 400), (70, 50, 40))
        d = ImageDraw.Draw(img)
        d.ellipse([100, 100, 300, 300], fill=(139, 69, 19)) # Brown fur
        d.ellipse([130, 130, 160, 160], fill=(20, 20, 20))  # Black nose
        
        relevance = asyncio.run(evaluate_agricultural_relevance(img))
        self.assertFalse(relevance["accepted"])
        self.assertIn("crop or plant", relevance["reason"])

    # 10. Human / Portrait -> REJECT (Non-Agricultural)
    def test_10_human_portrait_rejected(self):
        # Skin tones + blue shirt
        img = Image.new("RGB", (400, 400), (200, 200, 200))
        d = ImageDraw.Draw(img)
        d.rectangle([50, 200, 350, 400], fill=(30, 60, 150)) # Blue shirt
        d.ellipse([120, 50, 280, 210], fill=(240, 190, 160)) # Face skin tone
        
        relevance = asyncio.run(evaluate_agricultural_relevance(img))
        self.assertFalse(relevance["accepted"])
        self.assertIn("crop or plant", relevance["reason"])

    # 11. Car / Vehicle -> REJECT (Non-Agricultural)
    def test_11_car_vehicle_rejected(self):
        # Metallic gray and blue vehicle
        img = Image.new("RGB", (400, 400), (100, 100, 100))
        d = ImageDraw.Draw(img)
        d.rectangle([50, 150, 350, 300], fill=(180, 20, 20)) # Red car body
        d.rectangle([100, 80, 300, 150], fill=(50, 150, 220)) # Glass window
        
        relevance = asyncio.run(evaluate_agricultural_relevance(img))
        self.assertFalse(relevance["accepted"])
        self.assertIn("crop or plant", relevance["reason"])

    # 12. Random Household Object (Metallic Blue Box) -> REJECT
    def test_12_random_object_rejected(self):
        img = Image.new("RGB", (400, 400), (30, 30, 50))
        d = ImageDraw.Draw(img)
        d.rectangle([70, 70, 330, 330], fill=(0, 191, 255), outline=(255, 255, 0), width=4)
        
        relevance = asyncio.run(evaluate_agricultural_relevance(img))
        self.assertFalse(relevance["accepted"])

    # 13. Healthy Plant -> ACCEPT
    def test_13_healthy_plant_accepted(self):
        img = Image.new("RGB", (500, 500), (220, 220, 220))
        d = ImageDraw.Draw(img)
        d.polygon([(250, 40), (420, 250), (250, 460), (80, 250)], fill=(34, 139, 34))
        
        raw_bytes = self._create_image_bytes(img)
        result = asyncio.run(run_image_safety_gates(raw_bytes))
        self.assertTrue(result["accepted"])
        self.assertTrue(result["quality"]["usable"])
        self.assertTrue(result["agriculture_relevance"]["accepted"])
        self.assertIsNone(result["farmer_message"])

    # 14. Diseased Plant (Chlorosis + Necrotic spots) -> ACCEPT
    def test_14_diseased_plant_accepted(self):
        img = Image.new("RGB", (500, 500), (230, 230, 230))
        d = ImageDraw.Draw(img)
        d.ellipse([60, 60, 440, 440], fill=(218, 165, 32)) # Yellowing blade
        d.ellipse([120, 120, 180, 180], fill=(139, 69, 19)) # Necrotic brown spot
        d.ellipse([260, 220, 320, 280], fill=(101, 67, 33)) # Leaf blight patch
        
        raw_bytes = self._create_image_bytes(img)
        result = asyncio.run(run_image_safety_gates(raw_bytes))
        self.assertTrue(result["accepted"])
        self.assertTrue(result["quality"]["usable"])
        self.assertTrue(result["agriculture_relevance"]["accepted"])
        self.assertIsNone(result["farmer_message"])

    # 15. Letterbox Preprocessing Test (CPU Inference Format)
    def test_15_letterbox_preprocessing(self):
        img = Image.new("RGB", (640, 480), (50, 150, 50))
        tensor = preprocess_for_inference(img, target_size=(640, 640), letterbox=True)
        self.assertEqual(tensor.shape, (1, 3, 640, 640))
        self.assertEqual(tensor.dtype, np.float32)
        self.assertTrue(0.0 <= float(np.min(tensor)) <= float(np.max(tensor)) <= 1.0)


if __name__ == "__main__":
    unittest.main()
