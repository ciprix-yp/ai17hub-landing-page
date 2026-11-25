import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/check-deploy.mjs', import.meta.url));
const TEST_KEY = '1x00000000000000000000AA';
const REAL_KEY = '0x4AAAAAAAfake-site-key-for-tests';

function run(files, env) {
  const dir = mkdtempSync(join(tmpdir(), 'check-deploy-'));
  try {
    if (files) {
      mkdirSync(join(dir, '_astro'));
      for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, '_astro', name), content);
    }
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, DIST_DIR: dir, ...env },
      encoding: 'utf8',
    });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('dist cu cheia reala din env: ok', () => {
  const r = run({ 'a.js': `const k="${REAL_KEY}";` }, { PUBLIC_TURNSTILE_SITE_KEY: REAL_KEY });
  assert.equal(r.code, 0);
  assert.match(r.out, /ok/);
});

test('lipsa cheii in env => esec', () => {
  assert.equal(run({ 'a.js': 'x' }, {}).code, 1);
});

test('cheia de test in env => esec', () => {
  assert.equal(run({ 'a.js': TEST_KEY }, { PUBLIC_TURNSTILE_SITE_KEY: TEST_KEY }).code, 1);
});

test('env corect dar dist construit cu cheia de test => esec', () => {
  const r = run({ 'a.js': `x="${TEST_KEY}"`, 'b.js': `y="${REAL_KEY}"` }, { PUBLIC_TURNSTILE_SITE_KEY: REAL_KEY });
  assert.equal(r.code, 1);
  assert.match(r.out, /cheia de test/);
});

test('env corect dar cheia nu apare in dist => esec', () => {
  const r = run({ 'a.js': 'nimic' }, { PUBLIC_TURNSTILE_SITE_KEY: REAL_KEY });
  assert.equal(r.code, 1);
});

test('fara dist/_astro => esec', () => {
  assert.equal(run(null, { PUBLIC_TURNSTILE_SITE_KEY: REAL_KEY }).code, 1);
});

test('nu afiseaza valori de chei', () => {
  for (const [files, env] of [
    [{ 'a.js': TEST_KEY }, { PUBLIC_TURNSTILE_SITE_KEY: REAL_KEY }],
    [{ 'a.js': 'x' }, { PUBLIC_TURNSTILE_SITE_KEY: REAL_KEY }],
    [{ 'a.js': 'x' }, { PUBLIC_TURNSTILE_SITE_KEY: TEST_KEY }],
  ]) {
    const r = run(files, env);
    assert.ok(!r.out.includes(REAL_KEY) && !r.out.includes(TEST_KEY));
  }
});
