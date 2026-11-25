# AI17 HUB — Landing Page Pre-Lansare

**Stack**: Astro 7 · Tailwind 4 · GSAP · Lenis · Cloudflare Pages (Functions + D1 opțional) · Resend  
**Domeniu**: ai17hub.ro  
**Dev server**: http://localhost:4321

---

## Setup local

```bash
# 1. Instalare dependențe
pnpm install

# 2. Variabile de mediu: .env.example listează doar numele; valorile se pun în Keychain
#    secret set ai17hub-site <VAR>
#    secret run ai17hub-site -- pnpm dev

# 3. Dev server
pnpm dev

# 4. TypeScript check
pnpm astro check

# 5. Build producție (necesită PUBLIC_TURNSTILE_SITE_KEY; local de test: 1x00000000000000000000AA)
pnpm build

# 6. Teste (formular + gardă deploy; folosesc node:sqlite, fără flag-uri pe Node 22.23.4)
node --test tests/lead.test.mjs tests/check-deploy.test.mjs

# 7. Înainte de deploy, în ordinea asta (aceeași cheie reală în env la ambele):
#    build cu cheia reală -> pnpm check:deploy -> deploy
secret run ai17hub-site -- pnpm build
secret run ai17hub-site -- pnpm check:deploy
```

`pnpm check:deploy` verifică artefactul, nu doar variabila: cade dacă `dist/_astro/*.js` conține
cheia de test Cloudflare sau nu conține valoarea din `PUBLIC_TURNSTILE_SITE_KEY` (nu afișează chei).

---

## Formularul de contact

Formularul (`src/components/CaptureForm.astro`) trimite JSON la `POST /api/lead`
(Cloudflare Pages Function: `functions/api/lead.js`, logica în `server/lead.js`).
Serverul verifică Origin, honeypot, validează câmpurile, verifică Cloudflare Turnstile,
aplică rate limit (dacă există D1; cheia e IPv4 sau prefixul IPv6 /64), salvează în D1 (opțional)
și trimite prin Resend o notificare către echipă. Confirmarea către vizitator pleacă doar din
producție (`ai17hub.ro` / `www.ai17hub.ro`) și, cu D1, o singură dată la 24h pe același email.

Variabile (nume în `.env.example`):

- build: `PUBLIC_TURNSTILE_SITE_KEY`
- runtime, secrete (dashboard sau `wrangler pages secret put`): `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`
- runtime, publice (în `wrangler.toml`, secțiunea `[vars]`): `LEAD_NOTIFY_TO`, `LEAD_FROM`

Numele proiectului Pages este `ai17hub-landing-page` (`wrangler.toml`). Cu un `wrangler.toml` care are
`pages_build_output_dir`, dashboard-ul Pages îl tratează ca sursă de adevăr pentru binding-uri:
jurnalul D1 (`LEADS_DB`, `migrations/0001_lead.sql`) trebuie declarat în `wrangler.toml` după
`wrangler d1 create`, nu doar în dashboard. Până atunci e dezactivat; pașii sunt în `wrangler.toml`.
Local: `.dev.vars` (nu se comite) sau `wrangler pages dev dist --binding TURNSTILE_SECRET_KEY=<cheie de test>`.

---

## Deploy

Deploy-ul se face manual, cu `wrangler pages deploy dist`, doar cu acordul lui Ciprian
(după `pnpm build` și `pnpm check:deploy`).

---

## Structura proiectului

```
src/
├── layouts/
│   └── BaseLayout.astro      # HTML shell, SEO, Lenis smooth scroll
├── components/
│   ├── NavBar.astro           # Header sticky cu blur la scroll
│   ├── HeroSlideshow.astro    # GSAP Ken Burns pe 15 randări
│   ├── StatsBar.astro         # 1906 / 1M€ / 100+ / 4 — counter animat
│   ├── WhatIsAI17.astro       # Narativ + pull quote + linia infinită SVG
│   ├── FourVerticals.astro    # Grid 2×2 — cele 4 trasee
│   ├── Spaces.astro           # Tab-uri Parter/Supantă/Mansardă
│   ├── Timeline1906.astro     # GSAP ScrollTrigger timeline orizontal
│   ├── CaptureForm.astro      # Formular captare → /api/lead
│   ├── MassStudio.astro       # Social proof + galerie proiecte
│   ├── Footer.astro           # 4 coloane + bara finală
│   ├── WhatsAppButton.astro   # Floating button → Anca Stebingăr
│   ├── CookieBanner.astro     # GDPR consent banner
│   └── InfiniteLine.astro     # SVG linia verde animată
└── pages/
    ├── index.astro            # Pagina principală
    └── 404.astro              # Pagina 404
functions/api/lead.js          # POST /api/lead (JS pur ESM)
server/lead.js                 # Logica formularului (testabilă)
migrations/                    # Schema D1
public/fonts/                  # Barlow self-hosted (SIL OFL, vezi OFL.txt)
```

---

## WhatsApp

Butonul floating conectează direct la **Anca Patricița Stebingăr (+40 746 123 553)**  
cu mesaj predefinit:  
*"Bună! Sunt interesat/ă de AI17 HUB Constanța și aș vrea să aflu mai multe detalii despre proiect și posibilitățile de colaborare."*

Utilizatorul poate modifica mesajul înainte de trimitere.

---

## Faza 2 (după lansare)

- [ ] Conectare n8n webhook pentru email automat la fiecare lead
- [ ] Adăugare pagini complete (Incubare, Parteneri, Lab, Evenimente)
- [ ] Chatbot AI (după EU AI Act — Septembrie 2026)
