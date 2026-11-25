// Garda de deploy: verifica ARTEFACTUL din dist/, nu doar variabila de mediu.
// Build-ul incorporeaza PUBLIC_TURNSTILE_SITE_KEY in JS-ul din dist/_astro; un dist construit cu cheia de test
// (sau fara cheie) ar face formularul sa esueze in productie, chiar daca env-ul curent arata bine.
//
// Ordinea: build cu cheia reala -> pnpm check:deploy (cu aceeasi cheie in env) -> deploy.
//   secret run ai17hub-site -- pnpm build
//   secret run ai17hub-site -- pnpm check:deploy
// Nu afiseaza valori de chei. DIST_DIR (optional) schimba folderul verificat (folosit de teste).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_SITE_KEY = '1x00000000000000000000AA';
const key = (process.env.PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();
const distDir = process.env.DIST_DIR || 'dist';
const assetsDir = join(distDir, '_astro');

const fail = (message) => {
  console.error(`check:deploy: ${message}`);
  process.exit(1);
};

if (key === '') fail('PUBLIC_TURNSTILE_SITE_KEY lipseste din mediu.');
if (key === TEST_SITE_KEY) fail('PUBLIC_TURNSTILE_SITE_KEY este cheia de test Cloudflare; foloseste cheia reala.');
if (!existsSync(assetsDir)) fail(`nu exista ${assetsDir}; ruleaza intai pnpm build.`);

const files = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
if (files.length === 0) fail(`nu exista fisiere .js in ${assetsDir}.`);

let hasTestKey = false;
let hasRealKey = false;
for (const name of files) {
  const text = readFileSync(join(assetsDir, name), 'utf8');
  if (text.includes(TEST_SITE_KEY)) hasTestKey = true;
  if (text.includes(key)) hasRealKey = true;
}

if (hasTestKey) fail('dist/ contine cheia de test Cloudflare: reconstruieste cu cheia reala (pnpm build).');
if (!hasRealKey) fail('dist/ nu contine cheia din PUBLIC_TURNSTILE_SITE_KEY: dist-ul e vechi sau construit cu alta cheie; reconstruieste (pnpm build).');
console.log('check:deploy: ok');
