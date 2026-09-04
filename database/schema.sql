-- ==============================================================================
-- RythuBandhu - Phase 2 Database Schema (Supabase PostgreSQL + PostGIS)
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 2. Trigger Function to Automatically Update `updated_at` Timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ==============================================================================
-- TABLE 1: farmers
-- Stores basic farmer identity and contact info. Phone is the unique lookup key.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS farmers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    preferred_language TEXT,
    village TEXT,
    district TEXT,
    state TEXT,
    location GEOGRAPHY(Point, 4326),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- TABLE 2: officers
-- Stores Agricultural Extension Officers (AEOs), AOs, and Admin users.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS officers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('AEO', 'AO', 'ADMIN')),
    assigned_area TEXT NOT NULL,
    location GEOGRAPHY(Point, 4326),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- TABLE 3: clusters
-- Stores geographic/temporal groups of similar agricultural incidents.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crop TEXT,
    possible_condition TEXT,
    center_location GEOGRAPHY(Point, 4326),
    incident_count INTEGER NOT NULL DEFAULT 0,
    confirmation_count INTEGER NOT NULL DEFAULT 0,
    risk_score NUMERIC,
    confidence NUMERIC,
    status TEXT NOT NULL DEFAULT 'EMERGING' CHECK (status IN ('EMERGING', 'ACTIVE', 'CONFIRMED', 'RESOLVED', 'DISMISSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- TABLE 4: incidents
-- Core table storing original farmer agricultural complaints/reports.
-- cluster_id and assigned_aeo_id are NULLABLE by design.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
    assigned_aeo_id UUID REFERENCES officers(id) ON DELETE SET NULL,
    cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL,
    crop TEXT,
    description TEXT NOT NULL,
    language TEXT,
    location GEOGRAPHY(Point, 4326),
    location_source TEXT CHECK (location_source IN ('GPS', 'REGISTERED_AREA', 'MANUAL', 'UNKNOWN')),
    photo_url TEXT,
    photos JSONB DEFAULT '[]'::jsonb,
    audio_url TEXT,
    status TEXT NOT NULL DEFAULT 'NEW' CHECK (
        status IN (
            'NEW',
            'AI_ANALYZED',
            'AEO_NOTIFIED',
            'ACKNOWLEDGED',
            'INVESTIGATING',
            'ACTION_TAKEN',
            'RESOLVED',
            'ESCALATED'
        )
    ),
    priority TEXT NOT NULL DEFAULT 'LOW' CHECK (
        priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    ),
    risk_score NUMERIC,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- TABLE 5: ai_analysis
-- Stores AI findings separately without overwriting original farmer complaint.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS ai_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    transcript TEXT,
    detected_language TEXT,
    crop_detected TEXT,
    symptoms JSONB,
    possible_conditions JSONB,
    vision_prediction TEXT,
    vision_confidence NUMERIC,
    llm_summary TEXT,
    structured_data JSONB,
    model_name TEXT,
    model_version TEXT,
    requires_aeo_review BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- TABLE 6: community_confirmations (Phase 10)
-- Stores corroboration responses from nearby farmers (YES, NO, NOT_SURE).
-- Unique constraint on (incident_id, farmer_phone) prevents duplicate voting.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS community_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    farmer_id UUID REFERENCES farmers(id) ON DELETE SET NULL,
    farmer_phone TEXT NOT NULL,
    farmer_name TEXT DEFAULT 'Nearby Farmer',
    response TEXT NOT NULL CHECK (response IN ('YES', 'NO', 'NOT_SURE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_incident_farmer_confirmation UNIQUE (incident_id, farmer_phone)
);

ALTER TABLE community_confirmations
    ADD COLUMN IF NOT EXISTS location GEOGRAPHY(Point, 4326) NULL;

-- ==============================================================================
-- TABLE 7: community_posts
-- Farmer-authored discussion, optionally connected to an existing incident.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS community_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE community_posts
    ADD COLUMN IF NOT EXISTS crop TEXT;

-- ==============================================================================
-- TABLE 8: community_comments
-- Farmer comments, or official AEO responses when officer_id is populated.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS community_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    officer_id UUID REFERENCES officers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE community_comments
    ADD COLUMN IF NOT EXISTS officer_id UUID REFERENCES officers(id) ON DELETE SET NULL;

-- ==============================================================================
-- TABLE 9: community_comment_reactions
-- Minimal helpful reaction; one farmer can add it once per comment.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS community_comment_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES community_comments(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    reaction TEXT NOT NULL CHECK (reaction = 'HELPFUL'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_comment_farmer_reaction UNIQUE (comment_id, farmer_id, reaction)
);

-- ==============================================================================
-- INDEXES FOR PERFORMANCE & GEOSPATIAL SEARCH
-- ==============================================================================

-- Spatial GiST Indexes
CREATE INDEX IF NOT EXISTS idx_farmers_location ON farmers USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_officers_location ON officers USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_clusters_center_location ON clusters USING GIST(center_location);
CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents USING GIST(location);

-- B-Tree Indexes for Foreign Keys & Queries
CREATE INDEX IF NOT EXISTS idx_farmers_phone ON farmers(phone);
CREATE INDEX IF NOT EXISTS idx_incidents_farmer_id ON incidents(farmer_id);
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_aeo ON incidents(assigned_aeo_id);
CREATE INDEX IF NOT EXISTS idx_incidents_cluster_id ON incidents(cluster_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_priority ON incidents(priority);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_incident_id ON ai_analysis(incident_id);
CREATE INDEX IF NOT EXISTS idx_community_confirmations_incident_id ON community_confirmations(incident_id);
CREATE INDEX IF NOT EXISTS idx_community_confirmations_location ON community_confirmations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_community_posts_farmer_id ON community_posts(farmer_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_incident_id ON community_posts(incident_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_post_id ON community_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_farmer_id ON community_comments(farmer_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_officer_id ON community_comments(officer_id);
CREATE INDEX IF NOT EXISTS idx_community_comment_reactions_comment_id ON community_comment_reactions(comment_id);

-- ==============================================================================
-- AUTOMATED `updated_at` TRIGGERS
-- ==============================================================================
DROP TRIGGER IF EXISTS trigger_farmers_updated_at ON farmers;
CREATE TRIGGER trigger_farmers_updated_at
    BEFORE UPDATE ON farmers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_officers_updated_at ON officers;
CREATE TRIGGER trigger_officers_updated_at
    BEFORE UPDATE ON officers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_clusters_updated_at ON clusters;
CREATE TRIGGER trigger_clusters_updated_at
    BEFORE UPDATE ON clusters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_incidents_updated_at ON incidents;
CREATE TRIGGER trigger_incidents_updated_at
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_community_posts_updated_at ON community_posts;
CREATE TRIGGER trigger_community_posts_updated_at
    BEFORE UPDATE ON community_posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_community_comments_updated_at ON community_comments;
CREATE TRIGGER trigger_community_comments_updated_at
    BEFORE UPDATE ON community_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE farmers ENABLE ROW LEVEL SECURITY;
ALTER TABLE officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comment_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_confirmations ENABLE ROW LEVEL SECURITY;

-- Allow public read/write access via Backend Service Role & Public Anon Client for MVP
DROP POLICY IF EXISTS "Allow public read on farmers" ON farmers;
CREATE POLICY "Allow public read on farmers" ON farmers FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on farmers" ON farmers;
CREATE POLICY "Allow public insert on farmers" ON farmers FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update on farmers" ON farmers;
CREATE POLICY "Allow public update on farmers" ON farmers FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public read on officers" ON officers;
CREATE POLICY "Allow public read on officers" ON officers FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public read on clusters" ON clusters;
CREATE POLICY "Allow public read on clusters" ON clusters FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read on incidents" ON incidents;
CREATE POLICY "Allow public read on incidents" ON incidents FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on incidents" ON incidents;
CREATE POLICY "Allow public insert on incidents" ON incidents FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update on incidents" ON incidents;
CREATE POLICY "Allow public update on incidents" ON incidents FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public read on ai_analysis" ON ai_analysis;
CREATE POLICY "Allow public read on ai_analysis" ON ai_analysis FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on ai_analysis" ON ai_analysis;
CREATE POLICY "Allow public insert on ai_analysis" ON ai_analysis FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read on community posts" ON community_posts;
CREATE POLICY "Allow public read on community posts" ON community_posts FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on community posts" ON community_posts;
CREATE POLICY "Allow public insert on community posts" ON community_posts FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update on community posts" ON community_posts;
CREATE POLICY "Allow public update on community posts" ON community_posts FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public read on community comments" ON community_comments;
CREATE POLICY "Allow public read on community comments" ON community_comments FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on community comments" ON community_comments;
CREATE POLICY "Allow public insert on community comments" ON community_comments FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update on community comments" ON community_comments;
CREATE POLICY "Allow public update on community comments" ON community_comments FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public read on community reactions" ON community_comment_reactions;
CREATE POLICY "Allow public read on community reactions" ON community_comment_reactions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on community reactions" ON community_comment_reactions;
CREATE POLICY "Allow public insert on community reactions" ON community_comment_reactions FOR INSERT WITH CHECK (true);

-- No public policies are created for community_confirmations. The backend
-- service role can aggregate them while exact coordinates remain private.
