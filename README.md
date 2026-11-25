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

# 6. Teste (formular)
node --test tests/lead.test.mjs

# 7. Gardă înainte de deploy: refuză lipsa cheii Turnstile sau cheia de test
pnpm check:deploy
```

---

## Formularul de contact

Formularul (`src/components/CaptureForm.astro`) trimite JSON la `POST /api/lead`
(Cloudflare Pages Function: `functions/api/lead.js`, logica în `server/lead.js`).
Serverul verifică Origin, honeypot, validează câmpurile, verifică Cloudflare Turnstile,
aplică rate limit (dacă există D1), salvează în D1 (opțional) și trimite prin Resend
o notificare către echipă și o confirmare către vizitator.

Variabile (nume în `.env.example`):

- build: `PUBLIC_TURNSTILE_SITE_KEY`
- runtime: `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `LEAD_NOTIFY_TO`, `LEAD_FROM`

Jurnalul D1 (`LEADS_DB`, `migrations/0001_lead.sql`) este dezactivat până se creează baza;
instrucțiunile sunt în `wrangler.toml`. Local: `.dev.vars` (nu se comite) și
`wrangler pages dev dist --d1 LEADS_DB`.

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
