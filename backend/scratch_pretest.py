import numpy as np
from PIL import Image, ImageDraw
import io
import time
from app.services.vision_service import evaluate_agricultural_relevance_sync, analyze_crop_image, VisionModelEngine
from app.services.image_gate_service import evaluate_image_usability

print('===========================================================')
print('PRETEST: AGRICULTURAL RELEVANCE ON EXISTING PIPELINE')
print('Model: f4m1/plant-disease-detector-12 (YOLO11 ONNX CPU)')
print('===========================================================')

engine = VisionModelEngine.get_instance()
print(f"Engine loaded: {engine.is_loaded}, Classes count: {len(engine.classes)}")

test_cases = {}

# 1. Crop/Plant (Green foliage)
img = Image.new('RGB', (640, 480), (34, 139, 34))
d = ImageDraw.Draw(img)
d.ellipse([100, 80, 540, 400], fill=(50, 205, 50))
test_cases['crop_plant'] = ('AGRICULTURE', img)

# 2. Affected leaves (Yellowing / Chlorosis with brown spots)
img = Image.new('RGB', (640, 480), (34, 139, 34))
d = ImageDraw.Draw(img)
d.ellipse([100, 80, 540, 400], fill=(210, 180, 50)) # yellow chlorosis
d.ellipse([200, 150, 280, 230], fill=(100, 50, 20)) # brown spots
test_cases['affected_leaves'] = ('AGRICULTURE', img)

# 3. Whole crop (Crop canopy + soil)
img = Image.new('RGB', (640, 480), (120, 80, 40)) # soil
d = ImageDraw.Draw(img)
for x in range(50, 600, 80):
    d.ellipse([x, 150, x+60, 350], fill=(40, 160, 40))
test_cases['whole_crop'] = ('AGRICULTURE', img)

# 4. Farmer holding crop (Human skin + green plant in hand)
img = Image.new('RGB', (640, 480), (200, 160, 130)) # skin tone background
d = ImageDraw.Draw(img)
d.ellipse([200, 100, 440, 380], fill=(30, 150, 30)) # green leaf in center
test_cases['farmer_holding_crop'] = ('AGRICULTURE', img)

# 5. Crop field (Expansive green/yellow field)
img = Image.new('RGB', (640, 480), (60, 170, 60))
d = ImageDraw.Draw(img)
d.rectangle([0, 0, 640, 180], fill=(135, 206, 235)) # sky
d.rectangle([0, 180, 640, 480], fill=(50, 160, 40)) # field
test_cases['crop_field'] = ('AGRICULTURE', img)

# 6. Human face only (Skin tones, hair, no plant color)
img = Image.new('RGB', (640, 480), (220, 175, 140))
d = ImageDraw.Draw(img)
d.ellipse([180, 100, 460, 380], fill=(210, 160, 125)) # face
d.rectangle([180, 50, 460, 120], fill=(30, 20, 15)) # dark hair
test_cases['human_face_only'] = ('NON_AGRICULTURAL', img)

# 7. Car (Metallic blue/red vehicle on asphalt)
img = Image.new('RGB', (640, 480), (80, 80, 80)) # asphalt road
d = ImageDraw.Draw(img)
d.rectangle([120, 180, 520, 380], fill=(30, 80, 180)) # blue car body
d.ellipse([180, 340, 260, 420], fill=(20, 20, 20)) # wheels
d.ellipse([380, 340, 460, 420], fill=(20, 20, 20))
test_cases['car'] = ('NON_AGRICULTURAL', img)

# 8. Building / Concrete (Grey/brick wall)
img = Image.new('RGB', (640, 480), (160, 150, 145))
d = ImageDraw.Draw(img)
d.rectangle([80, 60, 560, 440], fill=(180, 90, 70)) # brick wall
d.rectangle([200, 150, 300, 280], fill=(100, 150, 200)) # window
test_cases['building'] = ('NON_AGRICULTURAL', img)

# 9. Road / Asphalt (Grey pavement with yellow lines)
img = Image.new('RGB', (640, 480), (70, 70, 70))
d = ImageDraw.Draw(img)
d.rectangle([300, 0, 340, 480], fill=(240, 200, 20)) # center yellow stripe
test_cases['road'] = ('NON_AGRICULTURAL', img)

# 10. Random object / Electronics (Black laptop/phone on desk)
img = Image.new('RGB', (640, 480), (190, 150, 110)) # wooden table
d = ImageDraw.Draw(img)
d.rectangle([150, 100, 490, 380], fill=(25, 25, 28)) # black laptop
test_cases['random_object_electronics'] = ('NON_AGRICULTURAL', img)

# 11. Animal / Pet (Brown dog on indoor floor)
img = Image.new('RGB', (640, 480), (210, 190, 170)) # tile floor
d = ImageDraw.Draw(img)
d.ellipse([150, 120, 490, 360], fill=(140, 80, 35)) # brown fur
test_cases['animal_pet'] = ('NON_AGRICULTURAL', img)

# 12. Indoor room (White walls, dark sofa, lamp)
img = Image.new('RGB', (640, 480), (230, 230, 230)) # wall
d = ImageDraw.Draw(img)
d.rectangle([100, 240, 540, 440], fill=(60, 60, 80)) # sofa
test_cases['indoor_room'] = ('NON_AGRICULTURAL', img)

# 13. Mixed: Human + Crop (Person standing in field)
img = Image.new('RGB', (640, 480), (45, 145, 45)) # field
d = ImageDraw.Draw(img)
d.ellipse([260, 60, 380, 200], fill=(210, 160, 130)) # person
d.rectangle([230, 190, 410, 380], fill=(40, 60, 160)) # clothes
test_cases['human_plus_crop'] = ('AGRICULTURE', img)

# 14. Mixed: Farmer holding affected leaf
img = Image.new('RGB', (640, 480), (180, 140, 110)) # hands
d = ImageDraw.Draw(img)
d.ellipse([160, 120, 480, 360], fill=(190, 170, 40)) # chlorotic leaf
d.ellipse([250, 180, 320, 250], fill=(90, 45, 15)) # necrotic lesion
test_cases['farmer_holding_affected_leaf'] = ('AGRICULTURE', img)

# 15. Mixed: Crop + background person
img = Image.new('RGB', (640, 480), (150, 150, 150))
d = ImageDraw.Draw(img)
d.ellipse([450, 80, 550, 200], fill=(200, 150, 120)) # person in background
d.rectangle([0, 150, 400, 480], fill=(35, 155, 35)) # close crop plant foreground
test_cases['crop_plus_background_person'] = ('AGRICULTURE', img)

print('\n================ DETAILED PRETEST EVALUATION ================')
correct = 0
total = len(test_cases)
for name, (expected, im) in test_cases.items():
    buf = io.BytesIO()
    im.save(buf, format='JPEG')
    b = buf.getvalue()
    
    # 1. Relevance check
    rel = evaluate_agricultural_relevance_sync(im)
    is_agri = rel['accepted']
    pred = 'AGRICULTURE' if is_agri else 'NON_AGRICULTURAL'
    
    match = (pred == expected)
    if match:
        correct += 1
    status_icon = 'PASS [OK]' if match else 'FAIL [X]'
    subj = str(rel.get('subject', ''))
    conf_val = float(rel.get('confidence', 0.0))
    print(f"{status_icon} {name:30s} | Exp: {expected:16s} | Got: {pred:16s} | Conf: {conf_val:.2f} | Subj: {subj}")

print('=============================================================')
print(f"PRETEST SUMMARY: {correct}/{total} passed ({correct/total*100:.1f}%)")
print('=============================================================')
