-- Jurnalul lead-urilor din formularul de pre-lansare (Cloudflare D1, binding LEADS_DB).
-- Aplicare locala:  pnpm dlx wrangler@4 d1 execute LEADS_DB --local --file=migrations/0001_lead.sql
-- Aplicare remote (dupa ce baza exista si binding-ul e activ in wrangler.toml): wrangler d1 migrations apply <nume-baza> --remote
CREATE TABLE lead (
  id TEXT PRIMARY KEY,                       -- UUID
  created_at TEXT NOT NULL,                  -- ISO 8601, UTC
  environment TEXT NOT NULL CHECK (environment IN ('production', 'preview')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL,                   -- email normalizat pentru dedupe: litere mici, fara +tag, gmail fara puncte
  company TEXT,
  interest TEXT NOT NULL CHECK (interest IN ('incubare', 'partener', 'evenimente', 'lab', 'curios')),
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  consent_at TEXT NOT NULL,                  -- momentul acordului GDPR, pus de server
  consent_version TEXT NOT NULL,             -- versiunea politicii de confidentialitate acceptate
  ip TEXT,                                   -- cheia de rate limit (IPv4 sau prefix IPv6 /64), nu adresa completa; serverul o pune pe NULL cand are peste 24h, la fiecare cerere care ajunge la rate limit
  notify_sent_at TEXT,
  confirm_sent_at TEXT,
  email_error TEXT                           -- erori concatenate, cu prefix: "notify: ... | confirm: ..."
);

CREATE INDEX lead_ip_created_idx ON lead (ip, created_at);
-- O singura confirmare pe email_key la 24h (primul lead inserat in fereastra).
CREATE INDEX lead_email_key_created_idx ON lead (email_key, created_at);
-- Plafonul global de confirmari pe ora (COUNT pe confirm_sent_at).
CREATE INDEX lead_confirm_sent_idx ON lead (confirm_sent_at);
