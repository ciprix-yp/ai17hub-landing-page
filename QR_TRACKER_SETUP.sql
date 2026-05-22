-- ============================================================
-- AI17 HUB — QR Tracker pentru evenimentul FOMO 24 Mai 2026
-- Rulează în Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS qr_scans (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scanned_at   TIMESTAMPTZ DEFAULT NOW(),
  campaign     TEXT,           -- qr-fomo-24mai
  source       TEXT,           -- fomo
  medium       TEXT,           -- qr
  user_agent   TEXT,           -- tipul de device
  referrer     TEXT
);

-- Permite inserare anonimă (scriptul din browser)
GRANT USAGE ON SCHEMA public TO anon;
GRANT INSERT ON public.qr_scans TO anon;
-- Permite citire anonimă pentru pagina de stats live
GRANT SELECT ON public.qr_scans TO anon;

ALTER TABLE qr_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert scans"
  ON qr_scans FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon read scans"
  ON qr_scans FOR SELECT TO anon USING (true);

-- Verificare
SELECT COUNT(*) as total_scans FROM qr_scans;
