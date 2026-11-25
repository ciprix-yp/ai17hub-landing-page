// Garda de build: integrarea Git a Cloudflare Pages construieste fara PUBLIC_TURNSTILE_SITE_KEY daca variabila de
// build nu e setata in dashboard ([vars] din wrangler.toml sunt runtime, nu variabile de build). Un build de
// productie fara cheie ar livra un formular care esueaza mereu; aici pica intentionat, iar site-ul vechi ramane live.
//
// Se aplica DOAR pe Cloudflare Pages, productie (CF_PAGES=1 si CF_PAGES_BRANCH=main). Local, in CI GitHub, pe
// preview si pe alte branch-uri nu face nimic. Nu afiseaza valori de chei.
const TEST_SITE_KEY = '1x00000000000000000000AA';

const onProduction = process.env.CF_PAGES === '1' && process.env.CF_PAGES_BRANCH === 'main';
if (onProduction) {
  const key = (process.env.PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();
  if (key === '') {
    console.error('guard-build: PUBLIC_TURNSTILE_SITE_KEY lipseste din variabilele de build (Pages -> Settings -> Variables, Production). Build de productie oprit.');
    process.exit(1);
  }
  if (key === TEST_SITE_KEY) {
    console.error('guard-build: PUBLIC_TURNSTILE_SITE_KEY este cheia de test Cloudflare; pune cheia reala in Production. Build de productie oprit.');
    process.exit(1);
  }
}
