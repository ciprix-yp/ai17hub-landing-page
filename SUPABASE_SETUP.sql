-- ============================================================
-- AI17 HUB — Setup Supabase pentru formularul de pre-lansare
-- Rulează în Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Creare tabel prelaunch_leads
CREATE TABLE IF NOT EXISTS prelaunch_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  interest        TEXT NOT NULL CHECK (interest IN ('incubare', 'partener', 'evenimente', 'lab', 'curios')),
  company         TEXT,
  gdpr_consent    BOOLEAN NOT NULL DEFAULT false,
  gdpr_timestamp  TIMESTAMPTZ,
  source          TEXT DEFAULT 'landing-prelaunch',
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT
);

-- 2. Grants — acordă privilegii rolurilor Supabase
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT INSERT ON public.prelaunch_leads TO anon;
GRANT SELECT, UPDATE, DELETE ON public.prelaunch_leads TO authenticated;

-- 3. Row Level Security — strat suplimentar de protecție
ALTER TABLE prelaunch_leads ENABLE ROW LEVEL SECURITY;

-- Permite oricui să insereze (formularul frontend folosește anon key)
CREATE POLICY "Allow anonymous inserts"
  ON prelaunch_leads
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Permite doar authenticated users (voi) să citească datele
CREATE POLICY "Allow authenticated reads"
  ON prelaunch_leads
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Index pentru căutare rapidă după email
CREATE INDEX IF NOT EXISTS idx_prelaunch_leads_email
  ON prelaunch_leads(email);

CREATE INDEX IF NOT EXISTS idx_prelaunch_leads_interest
  ON prelaunch_leads(interest);

-- 4. Verificare setup corect
SELECT COUNT(*) as total_leads FROM prelaunch_leads;
