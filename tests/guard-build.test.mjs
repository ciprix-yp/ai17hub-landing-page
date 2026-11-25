import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/guard-build.mjs', import.meta.url));
const TEST_KEY = '1x00000000000000000000AA';
const REAL_KEY = '0x4AAAAAAAfake-site-key-for-tests';

const run = (env) => {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const prod = { CF_PAGES: '1', CF_PAGES_BRANCH: 'main' };

test('productie Cloudflare fara cheie => esec', () => {
  assert.equal(run(prod).code, 1);
  assert.equal(run({ ...prod, PUBLIC_TURNSTILE_SITE_KEY: '  ' }).code, 1);
});

test('productie Cloudflare cu cheia de test => esec', () => {
  assert.equal(run({ ...prod, PUBLIC_TURNSTILE_SITE_KEY: TEST_KEY }).code, 1);
});

test('productie Cloudflare cu cheie reala => ok', () => {
  assert.equal(run({ ...prod, PUBLIC_TURNSTILE_SITE_KEY: REAL_KEY }).code, 0);
});

test('local, CI GitHub, preview si alte branch-uri: nu face nimic', () => {
  assert.equal(run({}).code, 0, 'local fara cheie');
  assert.equal(run({ PUBLIC_TURNSTILE_SITE_KEY: TEST_KEY }).code, 0, 'local cu cheia de test');
  assert.equal(run({ CI: 'true', GITHUB_ACTIONS: 'true' }).code, 0, 'CI GitHub');
  assert.equal(run({ CF_PAGES: '1', CF_PAGES_BRANCH: 'fix/site-formular-gdpr' }).code, 0, 'preview, alt branch');
  assert.equal(run({ CF_PAGES: '0', CF_PAGES_BRANCH: 'main' }).code, 0, 'CF_PAGES != 1');
});

test('nu afiseaza valori de chei', () => {
  const r = run({ ...prod, PUBLIC_TURNSTILE_SITE_KEY: TEST_KEY });
  assert.ok(!r.out.includes(TEST_KEY));
});
