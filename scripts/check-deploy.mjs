// Garda de deploy: refuza build-ul de productie fara cheia Turnstile reala (formularul ar da mereu eroare).
// Rulare: pnpm check:deploy (cu PUBLIC_TURNSTILE_SITE_KEY in env, de ex. prin `secret run ai17hub-site -- ...`).
const TEST_SITE_KEY = '1x00000000000000000000AA';
const key = (process.env.PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();

if (key === '') {
  console.error('check:deploy: PUBLIC_TURNSTILE_SITE_KEY lipseste.');
  process.exit(1);
}
if (key === TEST_SITE_KEY) {
  console.error('check:deploy: PUBLIC_TURNSTILE_SITE_KEY este cheia de test Cloudflare; foloseste cheia reala.');
  process.exit(1);
}
console.log('check:deploy: ok');
