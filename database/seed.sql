-- ==============================================================================
-- RythuBandhu - Phase 2 Demo Seed Data (Optional)
-- Clean, realistic demonstration records to verify relations and geospatial queries
-- ==============================================================================

-- 1. Insert Demo Farmers
INSERT INTO farmers (id, name, phone, preferred_language, village, district, state, location)
VALUES
    (
        '11111111-1111-1111-1111-111111111111',
        'Ramesh Kumar',
        '+919876543210',
        'Telugu',
        'Geesugonda',
        'Warangal',
        'Telangana',
        ST_SetSRID(ST_MakePoint(79.6750, 17.9689), 4326)::geography
    ),
    (
        '22222222-2222-2222-2222-222222222222',
        'Anil Reddy',
        '+919876543211',
        'Telugu',
        'Choppadandi',
        'Karimnagar',
        'Telangana',
        ST_SetSRID(ST_MakePoint(79.1667, 18.5833), 4326)::geography
    ),
    (
        '33333333-3333-3333-3333-333333333333',
        'Laxmi Devi',
        '+919876543212',
        'Telugu',
        'Nakrekal',
        'Nalgonda',
        'Telangana',
        ST_SetSRID(ST_MakePoint(79.4333, 17.1667), 4326)::geography
    )
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Demo Agricultural Officers
INSERT INTO officers (id, name, phone, email, role, assigned_area, location, is_active)
VALUES
    (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Srinivas Rao',
        '+919440012345',
        'srinivas.aeo@telangana.gov.in',
        'AEO',
        'Warangal Rural Mandal',
        ST_SetSRID(ST_MakePoint(79.6000, 17.9700), 4326)::geography,
        TRUE
    ),
    (
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'Kavitha Sharma',
        '+919440012346',
        'kavitha.ao@telangana.gov.in',
        'AO',
        'Warangal District Division',
        ST_SetSRID(ST_MakePoint(79.5800, 17.9900), 4326)::geography,
        TRUE
    ),
    (
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'Admin Officer',
        '+919440012347',
        'admin.agri@telangana.gov.in',
        'ADMIN',
        'State Agriculture Command Centre',
        ST_SetSRID(ST_MakePoint(78.4867, 17.3850), 4326)::geography,
        TRUE
    )
ON CONFLICT (id) DO NOTHING;

-- 3. Insert Demo Incident Cluster (Prepared for future geospatial intelligence)
INSERT INTO clusters (id, crop, possible_condition, center_location, incident_count, confirmation_count, risk_score, confidence, status)
VALUES
    (
        '99999999-9999-9999-9999-999999999999',
        'Chilli',
        'Chilli Leaf Curl Viral Disease / Thrips',
        ST_SetSRID(ST_MakePoint(79.6700, 17.9650), 4326)::geography,
        3,
        1,
        0.85,
        0.92,
        'ACTIVE'
    )
ON CONFLICT (id) DO NOTHING;

-- 4. Insert Demo Incidents
-- Demonstrating:
-- Incident 1: Linked to Farmer, Assigned AEO, and Cluster
-- Incident 2: Linked to Farmer & Assigned AEO, but NO Cluster (cluster_id is NULL)
-- Incident 3: Brand new incident without AEO and without Cluster (both NULL)
INSERT INTO incidents (
    id, farmer_id, assigned_aeo_id, cluster_id, crop, description, language,
    location, location_source, photo_url, audio_url, status, priority, risk_score
)
VALUES
    (
        'e1111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '99999999-9999-9999-9999-999999999999',
        'Chilli',
        'Chilli leaves are curling upwards and showing yellow patches. Plants look stunted.',
        'Telugu',
        ST_SetSRID(ST_MakePoint(79.6755, 17.9692), 4326)::geography,
        'GPS',
        'incidents/photos/chilli_leaf_curl_01.jpg',
        'incidents/audio/chilli_complaint_01.mp3',
        'INVESTIGATING',
        'HIGH',
        0.82
    ),
    (
        'e2222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        NULL,
        'Cotton',
        'Spotted bollworm infestation in flower buds and bolls in 2-acre plot.',
        'Telugu',
        ST_SetSRID(ST_MakePoint(79.1670, 18.5840), 4326)::geography,
        'GPS',
        'incidents/photos/cotton_bollworm_02.jpg',
        NULL,
        'ACKNOWLEDGED',
        'MEDIUM',
        0.55
    ),
    (
        'e3333333-3333-3333-3333-333333333333',
        '33333333-3333-3333-3333-333333333333',
        NULL,
        NULL,
        'Paddy',
        'Spindle-shaped brown lesions observed on paddy leaves.',
        'Telugu',
        ST_SetSRID(ST_MakePoint(79.4340, 17.1672), 4326)::geography,
        'MANUAL',
        NULL,
        NULL,
        'NEW',
        'LOW',
        NULL
    )
ON CONFLICT (id) DO NOTHING;

-- 5. Insert Demo AI Analysis Record (Separated from original incident)
INSERT INTO ai_analysis (
    id, incident_id, transcript, detected_language, crop_detected,
    symptoms, possible_conditions, vision_prediction, vision_confidence,
    llm_summary, structured_data, model_name, model_version, requires_aeo_review
)
VALUES
    (
        'f1111111-1111-1111-1111-111111111111',
        'e1111111-1111-1111-1111-111111111111',
        'Mirapa aakulu paiki muduchukuntunnayi mariyu pasupu machalu vachayi.',
        'te',
        'Chilli (Capsicum annuum)',
        '["upward leaf curling", "yellow chlorotic patches", "plant stunting"]'::jsonb,
        '["Chilli Leaf Curl Virus", "Thrips Infestation", "Mite Damage"]'::jsonb,
        'Chilli Leaf Curl Virus (Gemini virus)',
        0.91,
        'Farmer reports upward leaf curl and stunting on chilli crop indicative of Begomovirus transmitted by whiteflies.',
        '{"crop": "Chilli", "affected_stage": "Vegetative", "severity": "High", "pest_vector": "Bemisia tabaci"}'::jsonb,
        'gemini-1.5-flash + custom-vision-v2',
        '2.1.0',
        TRUE
    )
ON CONFLICT (id) DO NOTHING;
