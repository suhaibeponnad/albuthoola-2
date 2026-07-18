-- ========================================================
-- AL BUTHOOLA ARTFEST - SUPABASE DATABASE SCHEMA
-- Execute this SQL in your Supabase SQL Editor to create tables.
-- ========================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. HOUSES / TEAMS TABLE
CREATE TABLE IF NOT EXISTS houses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    secondary_color TEXT NOT NULL,
    emblem TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. EVENTS / PROGRAMMES TABLE
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('solo', 'group')),
    category TEXT NOT NULL CHECK (category IN ('stage', 'non-stage')),
    completed BOOLEAN DEFAULT FALSE,
    points_config JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RESULTS / AWARDEES TABLE
CREATE TABLE IF NOT EXISTS results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
    participant TEXT NOT NULL,
    position INTEGER CHECK (position IS NULL OR (position >= 1 AND position <= 3)),
    grade TEXT CHECK (grade IS NULL OR grade IN ('A', 'B')),
    points INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SETTINGS TABLE
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY DEFAULT 'global',
    admin_pin TEXT DEFAULT '1234',
    rules JSONB DEFAULT '{"solo": {"1st": 10, "2nd": 6, "3rd": 4, "gradeA": 5, "gradeB": 3}, "group": {"1st": 20, "2nd": 12, "3rd": 8, "gradeA": 10, "gradeB": 6}}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Allow public read access (for parents/leaderboard)
-- Allow public write access (for admin score logging)
-- ========================================================

ALTER TABLE houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Allow public read access on houses" ON houses;
DROP POLICY IF EXISTS "Allow public write access on houses" ON houses;
DROP POLICY IF EXISTS "Allow public read access on events" ON events;
DROP POLICY IF EXISTS "Allow public write access on events" ON events;
DROP POLICY IF EXISTS "Allow public read access on results" ON results;
DROP POLICY IF EXISTS "Allow public write access on results" ON results;
DROP POLICY IF EXISTS "Allow public read access on settings" ON settings;
DROP POLICY IF EXISTS "Allow public write access on settings" ON settings;

-- Create Permissive RLS Policies for Anon / Authenticated Users
CREATE POLICY "Allow public read access on houses" ON houses FOR SELECT USING (true);
CREATE POLICY "Allow public write access on houses" ON houses FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read access on events" ON events FOR SELECT USING (true);
CREATE POLICY "Allow public write access on events" ON events FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read access on results" ON results FOR SELECT USING (true);
CREATE POLICY "Allow public write access on results" ON results FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read access on settings" ON settings FOR SELECT USING (true);
CREATE POLICY "Allow public write access on settings" ON settings FOR ALL USING (true) WITH CHECK (true);

-- ========================================================
-- DEFAULT DATA SEEDING
-- Populate default competing teams/houses and global settings
-- ========================================================

INSERT INTO houses (id, name, color, secondary_color, emblem) VALUES
    ('house-1', 'Phoenix Fire', '#ef4444', '#991b1b', '🔥'),
    ('house-2', 'Pegasus Frost', '#3b82f6', '#1e3a8a', '❄️'),
    ('house-3', 'Emerald Titans', '#10b981', '#064e3b', '🍃'),
    ('house-4', 'Golden Dragons', '#eab308', '#713f12', '⚡')
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (id, admin_pin, rules) VALUES
    ('global', '1234', '{"solo": {"1st": 10, "2nd": 6, "3rd": 4, "gradeA": 5, "gradeB": 3}, "group": {"1st": 20, "2nd": 12, "3rd": 8, "gradeA": 10, "gradeB": 6}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ========================================================
-- REALTIME SUBSCRIPTIONS
-- Enable Supabase Realtime so scores broadcast live to all clients
-- ========================================================

ALTER PUBLICATION supabase_realtime ADD TABLE houses;
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE results;
ALTER PUBLICATION supabase_realtime ADD TABLE settings;
