# AI17 HUB — Landing Page Pre-Lansare

**Stack**: Astro 5 · Tailwind 4 · GSAP · Lenis · Supabase · Cloudflare Pages  
**Domeniu**: ai17hub.ro  
**Dev server**: http://localhost:4321

---

## Setup local

```bash
# 1. Instalare dependențe
pnpm install

# 2. Configurare variabile de mediu
cp .env.example .env
# Completează PUBLIC_SUPABASE_URL și PUBLIC_SUPABASE_ANON_KEY

# 3. Dev server
pnpm dev

# 4. TypeScript check
pnpm astro check

# 5. Build producție
pnpm build
```

---

## Configurare Supabase

1. Crează un cont la [supabase.com](https://supabase.com) (free tier)
2. Crează un proiect nou (region: EU Central)
3. În **SQL Editor**, rulează tot conținutul din `SUPABASE_SETUP.sql`
4. Din **Settings → API**, copiază:
   - `Project URL` → `PUBLIC_SUPABASE_URL` în `.env`
   - `anon public` key → `PUBLIC_SUPABASE_ANON_KEY` în `.env`

---

## Deploy pe Cloudflare Pages

1. Push repo pe GitHub
2. În Cloudflare Pages: **Create Project → Connect to Git**
3. Build settings:
   - **Framework**: Astro
   - **Build command**: `pnpm build`
   - **Output directory**: `dist`
4. Environment variables (Settings → Environment Variables):
   ```
   PUBLIC_SUPABASE_URL = https://your-project.supabase.co
   PUBLIC_SUPABASE_ANON_KEY = your-anon-key
   ```
5. Configurează domeniu `ai17hub.ro` în **Custom domains**

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
│   ├── CaptureForm.astro      # Formular captare → Supabase
│   ├── MassStudio.astro       # Social proof + galerie proiecte
│   ├── FOMOEvent.astro        # Banner eveniment 24 Mai 2026
│   ├── Footer.astro           # 4 coloane + bara finală
│   ├── WhatsAppButton.astro   # Floating button → Anca Stebingăr
│   ├── CookieBanner.astro     # GDPR consent banner
│   └── InfiniteLine.astro     # SVG linia verde animată
└── pages/
    └── index.astro            # Pagina principală
```

---

## WhatsApp

Butonul floating conectează direct la **Anca Patricița Stebingăr (+40 746 123 553)**  
cu mesaj predefinit:  
*"Bună! Sunt interesat/ă de AI17 HUB Constanța și aș vrea să aflu mai multe detalii despre proiect și posibilitățile de colaborare."*

Utilizatorul poate modifica mesajul înainte de trimitere.

---

## UTM tracking (pentru QR de la FOMO)

Link cu UTM pentru slide-ul lui Mihai:
```
https://ai17hub.ro?utm_source=fomo&utm_medium=qr&utm_campaign=qr-fomo-24mai
```

---

## Faza 2 (după lansare)

- [ ] Conectare n8n webhook pentru email automat la fiecare lead
- [ ] Adăugare pagini complete (Incubare, Parteneri, Lab, Evenimente)
- [ ] Chatbot AI (după EU AI Act — Septembrie 2026)
- [ ] Fonturi Barlow self-hosted (înlocuiește Google Fonts)
- [ ] Configurare Cloudflare Turnstile pe formular
