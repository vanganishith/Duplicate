# RythuBandhu - Database & Supabase Setup (Phase 2)

RythuBandhu uses **Supabase PostgreSQL** with the **PostGIS** geospatial extension to provide a low-friction incident reporting system.

---

## Core Philosophy

1. **Zero Farmer Authentication**: No passwords, OTPs, or accounts. Farmers are identified strictly by their unique `phone` number.
2. **Separation of Concerns**:
   - `incidents`: What the farmer actually reported.
   - `ai_analysis`: What the multi-modal AI / LLM detected and extracted.
3. **Independent Incident Lifecycle**: An incident can exist and be assigned to an AEO without belonging to a cluster (`cluster_id` is nullable).

---

## Database Schema (5 Tables)

```text
  +------------------+         +-------------------------+
  |     farmers      |         |        officers         |
  |------------------|         |-------------------------|
  | id (PK)          |         | id (PK)                 |
  | name             |         | name                    |
  | phone (UNIQUE)   |         | phone, email            |
  | preferred_lang   |         | role (AEO/AO/ADMIN)     |
  | village,district |         | assigned_area           |
  | location (Point) |         | location (Point)        |
  +--------+---------+         +------------+------------+
           | 1                              | 1
           |                                |
           | n                              | n (assigned_aeo_id)
  +--------v--------------------------------v------------+
  |                       incidents                      |
  |------------------------------------------------------|
  | id (PK)                                              |
  | farmer_id (FK -> farmers.id)                         |
  | assigned_aeo_id (FK -> officers.id, NULLABLE)        |
  | cluster_id (FK -> clusters.id, NULLABLE)             |
  | crop, description, language                          |
  | location (Point), location_source                    |
  | photo_url, audio_url                                 |
  | status (NEW, AI_ANALYZED, AEO_NOTIFIED, ...)         |
  | priority (LOW, MEDIUM, HIGH, CRITICAL)               |
  | risk_score, reported_at, created_at, updated_at      |
  +--------+--------------------------------+------------+
           | 1                              | n
           |                                |
           | n                              | 1
  +--------v---------+         +------------v------------+
  |   ai_analysis    |         |        clusters         |
  |------------------|         |-------------------------|
  | id (PK)          |         | id (PK)                 |
  | incident_id (FK) |         | crop, possible_cond     |
  | transcript       |         | center_location (Point) |
  | crop_detected    |         | incident_count          |
  | symptoms (JSONB) |         | risk_score, status      |
  | vision_pred      |         +-------------------------+
  | llm_summary      |
  | structured_data  |
  +------------------+
```

---

## Setup Instructions (Supabase)

### Step 1: Open Supabase SQL Editor
1. Log in to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project and navigate to the **SQL Editor** tab.

### Step 2: Apply the Schema (`schema.sql`)
1. Open [`database/schema.sql`](file:///c:/Users/nalla/OneDrive/Documents/webdev/kisaansathi/database/schema.sql).
2. Copy and paste the entire script into the Supabase SQL Editor.
3. Click **Run**.
4. This will:
   - Enable `postgis` and `uuid-ossp` extensions.
   - Create all 5 tables with CHECK constraints and foreign keys.
   - Create spatial GiST indexes on all `geography(Point, 4326)` columns.
   - Create automated `updated_at` trigger functions.
   - Enable Row Level Security (RLS) policies.

### Step 3: (Optional) Apply Demo Seed Data (`seed.sql`)
1. Open [`database/seed.sql`](file:///c:/Users/nalla/OneDrive/Documents/webdev/kisaansathi/database/seed.sql).
2. Copy and paste into the Supabase SQL Editor.
3. Click **Run**.
4. This populates sample farmers, officers, clusters, incidents, and an AI analysis record with Telangana coordinates.

---

## Phone-Based Farmer Lookup Query Pattern

When a farmer submits a problem:
```sql
-- 1. Check if farmer exists by phone
SELECT id, name, preferred_language, village FROM farmers WHERE phone = '+919876543210';

-- 2a. If NOT found: Create new farmer
INSERT INTO farmers (name, phone, preferred_language, village, district, state, location)
VALUES ('Ramesh Kumar', '+919876543210', 'Telugu', 'Geesugonda', 'Warangal', 'Telangana', ST_SetSRID(ST_MakePoint(79.6750, 17.9689), 4326)::geography)
RETURNING id;

-- 2b. If found: Use existing farmer id to insert new incident
INSERT INTO incidents (farmer_id, crop, description, language, location, location_source)
VALUES ('11111111-1111-1111-1111-111111111111', 'Chilli', 'Leaves curling upwards', 'Telugu', ST_SetSRID(ST_MakePoint(79.6755, 17.9692), 4326)::geography, 'GPS');
```
