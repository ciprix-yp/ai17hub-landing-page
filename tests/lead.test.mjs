import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleLead, MAX_BODY_BYTES, MAX_LEADS_PER_IP_PER_HOUR, CONSENT_VERSION, notifyEmail, confirmEmail, environmentOf, rateLimitKey } from '../server/lead.js';

const ORIGIN = 'https://ai17hub.ro';
const URL_ = `${ORIGIN}/api/lead`;
const NOW = new Date('2026-11-25T10:00:00.000Z');

const validBody = () => ({
  name: 'Ion Popescu',
  email: 'ion@firmata.ro',
  interest: 'incubare',
  company: 'MASSTUDIO SRL',
  gdpr: true,
  utm_source: 'qr',
  turnstileToken: 'tok',
  website: '',
});

function makeRequest(body, { origin = ORIGIN, headers = {}, raw } = {}) {
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7', ...headers };
  if (origin !== null) h.Origin = origin;
  return new Request(URL_, { method: 'POST', headers: h, body: raw ?? JSON.stringify(body) });
}

/** D1 pe node:sqlite, cu migratia reala: interogarile serverului ruleaza pe SQL adevarat (numerotate ?1, ?2). */
function fakeDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../migrations/0001_lead.sql', import.meta.url), 'utf8'));
  return {
    raw,
    get rows() {
      return raw.prepare('SELECT * FROM lead ORDER BY created_at, rowid').all().map((r) => ({ ...r }));
    },
    prepare(sql) {
      const st = raw.prepare(sql);
      return {
        bind: (...args) => ({
          async first() {
            return st.get(...args) ?? null;
          },
          async run() {
            st.run(...args);
            return {};
          },
        }),
      };
    },
  };
}

/** Rand pre-existent in jurnal (campurile NOT NULL au valori implicite). */
function seed(db, row) {
  const r = { environment: 'production', name: 'X', email: 'x@y.ro', interest: 'lab', consent_at: row.created_at, consent_version: 'v', ip: null, ...row };
  db.raw
    .prepare('INSERT INTO lead (id, created_at, environment, name, email, interest, consent_at, consent_version, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.created_at, r.environment, r.name, r.email, r.interest, r.consent_at, r.consent_version, r.ip);
}

/** fetch fals: siteverify si Resend. */
function fakeFetch({ captcha = { success: true, hostname: 'ai17hub.ro' }, resendOk = true } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('siteverify')) return new Response(JSON.stringify(captcha), { status: 200 });
    if (String(url).includes('api.resend.com')) return new Response('{}', { status: resendOk ? 200 : 500 });
    throw new Error(`fetch neasteptat: ${url}`);
  };
  fn.calls = calls;
  return fn;
}

function setup(envOverrides = {}, fetchOpts = {}) {
  const db = fakeDb();
  const fetchFn = fakeFetch(fetchOpts);
  const pendingWork = [];
  const env = { TURNSTILE_SECRET_KEY: 's', RESEND_API_KEY: 'k', LEAD_NOTIFY_TO: 'office@ai17hub.ro', LEADS_DB: db, ...envOverrides };
  let counter = 0;
  const deps = { fetchFn, now: () => NOW, randomId: () => `id-${(counter += 1)}`, waitUntil: (p) => pendingWork.push(p) };
  const run = async (request) => {
    const res = await handleLead(request, env, deps);
    await Promise.all(pendingWork);
    return { res, json: await res.json() };
  };
  return { db, fetchFn, env, run };
}

const resendCalls = (fetchFn) => fetchFn.calls.filter((c) => c.url.includes('api.resend.com'));

test('cerere valida: 200, rand in D1, notificare + confirmare', async () => {
  const { db, fetchFn, run } = setup();
  const { res, json } = await run(makeRequest(validBody()));
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].email, 'ion@firmata.ro');
  assert.equal(db.rows[0].ip, '203.0.113.7');
  assert.ok(db.rows[0].notify_sent_at && db.rows[0].confirm_sent_at);
  const mails = resendCalls(fetchFn).map((c) => JSON.parse(c.init.body));
  assert.equal(mails.length, 2);
  assert.deepEqual(mails[0].to, ['office@ai17hub.ro']);
  assert.equal(mails[0].reply_to, 'ion@firmata.ro');
  assert.deepEqual(mails[1].to, ['ion@firmata.ro']);
  assert.ok(!mails[1].text.includes('Ion Popescu'), 'confirmarea nu contine campurile vizitatorului');
  assert.match(mails[1].text, /Am primit datele tale\. Te contactăm în maxim 48 de ore/);
});

test('validare: coduri pe camp', async () => {
  const cases = [
    [{ name: '' }, 'name'],
    [{ name: 'x'.repeat(121) }, 'name'],
    [{ name: 5 }, 'name'],
    [{ email: 'fara-arond' }, 'email'],
    [{ email: `${'a'.repeat(250)}@b.ro` }, 'email'],
    [{ interest: 'altceva' }, 'interest'],
    [{ interest: undefined }, 'interest'],
    [{ gdpr: false }, 'gdpr'],
    [{ gdpr: 'true' }, 'gdpr'],
    [{ company: 'c'.repeat(201) }, 'invalid'],
  ];
  for (const [patch, code] of cases) {
    const { fetchFn, db, run } = setup();
    const { res, json } = await run(makeRequest({ ...validBody(), ...patch }));
    assert.equal(res.status, 400, JSON.stringify(patch));
    assert.deepEqual(json, { ok: false, error: code }, JSON.stringify(patch));
    assert.equal(fetchFn.calls.length, 0, 'validarea e inaintea Turnstile');
    assert.equal(db.rows.length, 0);
  }
});

test('validare: corpul nu e obiect => invalid', async () => {
  for (const raw of ['[]', 'null', '"x"', '12']) {
    const { run } = setup();
    const { res, json } = await run(makeRequest(null, { raw }));
    assert.equal(res.status, 400);
    assert.equal(json.error, 'invalid');
  }
});

test('JSON invalid => 400 invalid', async () => {
  const { run } = setup();
  const { res, json } = await run(makeRequest(null, { raw: '{nu e json' }));
  assert.equal(res.status, 400);
  assert.deepEqual(json, { ok: false, error: 'invalid' });
});

test('raspunsurile au HSTS si nosniff (_headers nu se aplica Functions)', async () => {
  const { res } = await setup().run(makeRequest(null, { raw: '{nu e json' }));
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('Content-Type gresit => 400', async () => {
  const { run } = setup();
  const { res } = await run(makeRequest(validBody(), { headers: { 'Content-Type': 'text/plain' } }));
  assert.equal(res.status, 400);
});

test('payload prea mare => 413', async () => {
  const { run } = setup();
  const big = { ...validBody(), company: 'c'.repeat(MAX_BODY_BYTES) };
  const { res } = await run(makeRequest(big));
  assert.equal(res.status, 413);
  // si prin antetul Content-Length
  const { res: res2 } = await run(makeRequest(validBody(), { headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } }));
  assert.equal(res2.status, 413);
});

test('Origin gresit sau lipsa => 403 origin, fara efecte', async () => {
  for (const origin of ['https://evil.example', 'http://ai17hub.ro', null]) {
    const { res, json } = await setup().run(makeRequest(validBody(), { origin }));
    assert.equal(res.status, 403);
    assert.deepEqual(json, { ok: false, error: 'origin' });
  }
});

test('honeypot completat: 200 fals, fara salvare, fara email, fara Turnstile', async () => {
  const { db, fetchFn, run } = setup();
  const { res, json } = await run(makeRequest({ ...validBody(), website: 'http://spam.example' }));
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true });
  assert.equal(db.rows.length, 0);
  assert.equal(fetchFn.calls.length, 0);
});

test('Turnstile invalid => 403 captcha, fara salvare', async () => {
  const { db, run } = setup({}, { captcha: { success: false, 'error-codes': ['invalid-input-response'] } });
  const { res, json } = await run(makeRequest(validBody()));
  assert.equal(res.status, 403);
  assert.deepEqual(json, { ok: false, error: 'captcha' });
  assert.equal(db.rows.length, 0);
});

test('Turnstile: hostname strain => 403 captcha; lipsa tokenului => 403 captcha', async () => {
  const a = setup({}, { captcha: { success: true, hostname: 'evil.example' } });
  assert.equal((await a.run(makeRequest(validBody()))).res.status, 403);
  const b = setup();
  const { res } = await b.run(makeRequest({ ...validBody(), turnstileToken: '' }));
  assert.equal(res.status, 403);
  assert.equal(b.fetchFn.calls.length, 0);
});

test('Turnstile: siteverify trimite secretul si remoteip', async () => {
  const { fetchFn, run } = setup();
  await run(makeRequest(validBody()));
  const verify = fetchFn.calls.find((c) => c.url.includes('siteverify'));
  const body = verify.init.body;
  assert.equal(body.get('secret'), 's');
  assert.equal(body.get('response'), 'tok');
  assert.equal(body.get('remoteip'), '203.0.113.7');
});

test('Turnstile: fara secret configurat => 500 server', async () => {
  const { res, json } = await setup({ TURNSTILE_SECRET_KEY: undefined }).run(makeRequest(validBody()));
  assert.equal(res.status, 500);
  assert.deepEqual(json, { ok: false, error: 'server' });
});

test('rate limit: a 6-a cerere de la acelasi IP => 429', async () => {
  const { db, run } = setup();
  for (let i = 1; i <= MAX_LEADS_PER_IP_PER_HOUR; i += 1) {
    const { res } = await run(makeRequest(validBody()));
    assert.equal(res.status, 200, `cererea ${i}`);
  }
  const { res, json } = await run(makeRequest(validBody()));
  assert.equal(res.status, 429);
  assert.deepEqual(json, { ok: false, error: 'rate' });
  assert.equal(db.rows.length, MAX_LEADS_PER_IP_PER_HOUR);
  // alt IP trece
  const other = await run(makeRequest(validBody(), { headers: { 'CF-Connecting-IP': '203.0.113.99' } }));
  assert.equal(other.res.status, 200);
});

test('fara D1: cererea trece, notificarea se trimite sincron', async () => {
  const { fetchFn, run } = setup({ LEADS_DB: undefined });
  const { res, json } = await run(makeRequest(validBody()));
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true });
  assert.equal(resendCalls(fetchFn).length, 2);
});

test('fara D1 si emailul cade => 500 server', async () => {
  const { res, json } = await setup({ LEADS_DB: undefined }, { resendOk: false }).run(makeRequest(validBody()));
  assert.equal(res.status, 500);
  assert.deepEqual(json, { ok: false, error: 'server' });
});

test('cu D1 si emailul cade: 200, eroarea se noteaza in D1', async () => {
  const { db, res, json } = await (async () => {
    const s = setup({}, { resendOk: false });
    const r = await s.run(makeRequest(validBody()));
    return { db: s.db, ...r };
  })();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.match(db.rows[0].email_error, /Resend HTTP 500/);
});

test('D1 care arunca: rate limit omis, cererea trece prin email', async () => {
  const brokenDb = { prepare: () => { throw new Error('D1 jos'); } };
  const { res, fetchFn } = await (async () => {
    const s = setup({ LEADS_DB: brokenDb });
    const r = await s.run(makeRequest(validBody()));
    return { ...r, fetchFn: s.fetchFn };
  })();
  assert.equal(res.status, 200);
  // fara jurnal nu se poate deduplica pe email: doar notificarea pleaca
  assert.equal(resendCalls(fetchFn).length, 1);
});

test('IP-urile mai vechi de 24h devin NULL la fiecare insert', async () => {
  const { db, run } = setup();
  seed(db, { id: 'old', created_at: '2026-11-24T08:00:00.000Z', ip: '198.51.100.1' });
  seed(db, { id: 'recent', created_at: '2026-11-25T08:00:00.000Z', ip: '198.51.100.2' });
  await run(makeRequest(validBody()));
  assert.equal(db.rows.find((r) => r.id === 'old').ip, null);
  assert.equal(db.rows.find((r) => r.id === 'recent').ip, '198.51.100.2');
});

test('injectie de header: CR/LF din nume nu ajung in subiect', async () => {
  const { fetchFn, run } = setup();
  // numele cu caractere de control e respins de parseLead; subiectul si corpul raman pe un rand si pentru ce ajunge totusi la notifyEmail
  const { res, json } = await run(makeRequest({ ...validBody(), name: 'Ion\r\nBcc: victima@example.com' }));
  assert.equal(res.status, 400);
  assert.equal(json.error, 'name');
  assert.equal(fetchFn.calls.length, 0);
  const direct = notifyEmail({ name: 'a\r\nb', interest: 'lab', environment: 'production', email: 'a@b.ro', company: 'c\r\nd\u2028e', consentAt: 'x', id: 'i' });
  assert.doesNotMatch(direct.text.split('\n').filter((l) => /^(Nume|Email|Companie):/.test(l)).join(''), /[\r\u2028]/);
  assert.match(direct.text, /Nume: a b\n/);
  assert.match(direct.text, /Companie: c d e\n/);
  const { subject } = notifyEmail({ name: 'a\r\nBcc: x', interest: 'lab', environment: 'production', email: 'a@b.ro', company: null, consentAt: 'x', id: 'i' });
  assert.doesNotMatch(subject, /[\r\n]/);
  // un email cu CR/LF nu trece validarea
  const bad = await setup().run(makeRequest({ ...validBody(), email: 'a@b.ro\r\nBcc: x@y.ro' }));
  assert.equal(bad.json.error, 'email');
});

test('campuri extra ignorate: gdpr_timestamp/source/consent_version le pune serverul', async () => {
  const { db, run } = setup();
  const { res } = await run(
    makeRequest({ ...validBody(), gdpr_timestamp: '1999-01-01T00:00:00Z', source: 'hack', consent_version: 'x', consent_at: '1999', id: 'ales-de-client', ip: '1.1.1.1', environment: 'x' }),
  );
  assert.equal(res.status, 200);
  const row = db.rows[0];
  assert.equal(row.id, 'id-1');
  assert.equal(row.consent_at, NOW.toISOString());
  assert.equal(row.consent_version, 'confidentialitate-2026-05-23');
  assert.equal(row.ip, '203.0.113.7');
});

test('UTM cu format invalid se arunca, restul cererii trece', async () => {
  const { fetchFn, run } = setup();
  const { res } = await run(makeRequest({ ...validBody(), utm_source: 'a b<script>', utm_medium: 'm'.repeat(101), utm_campaign: 'camp-1.x' }));
  assert.equal(res.status, 200);
  const text = JSON.parse(resendCalls(fetchFn)[0].init.body).text;
  assert.match(text, /UTM: - \/ - \/ camp-1\.x/);
});

test('in afara productiei si fara RESEND_API_KEY: cererea trece, nimic nu pleaca', async () => {
  const s = setup({ RESEND_API_KEY: undefined }, { captcha: { success: true, hostname: 'localhost' } });
  const req = new Request('http://localhost:8788/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8788', 'CF-Connecting-IP': '127.0.0.1' },
    body: JSON.stringify(validBody()),
  });
  const { res } = await s.run(req);
  assert.equal(res.status, 200);
  assert.equal(resendCalls(s.fetchFn).length, 0);
});

test('in productie fara RESEND_API_KEY si fara D1 => 500', async () => {
  const { res } = await setup({ RESEND_API_KEY: undefined, LEADS_DB: undefined }).run(makeRequest(validBody()));
  assert.equal(res.status, 500);
});

test('confirmarea nu depinde de input', () => {
  assert.deepEqual(confirmEmail(), confirmEmail());
});

const previewRequest = (body = validBody(), headers = {}) =>
  new Request('https://preview.ai17hub-landing-page.pages.dev/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://preview.ai17hub-landing-page.pages.dev', 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  });

test('productia respinge hostname-ul example.com al cheii de test; previewul il accepta', async () => {
  const prod = await setup({}, { captcha: { success: true, hostname: 'example.com' } }).run(makeRequest(validBody()));
  assert.equal(prod.res.status, 403);
  assert.equal(prod.json.error, 'captcha');
  const preview = await setup({}, { captcha: { success: true, hostname: 'example.com' } }).run(previewRequest());
  assert.equal(preview.res.status, 200);
});

test('siteverify non-200 sau exceptie => 500 server, fara salvare', async () => {
  const a = setup();
  a.fetchFn.calls.length = 0;
  const non200 = async () => new Response('{}', { status: 503 });
  const r1 = await handleLead(makeRequest(validBody()), a.env, { fetchFn: non200, now: () => NOW });
  assert.equal(r1.status, 500);
  const boom = async () => {
    throw new Error('retea');
  };
  const r2 = await handleLead(makeRequest(validBody()), a.env, { fetchFn: boom, now: () => NOW });
  assert.equal(r2.status, 500);
  assert.equal(a.db.rows.length, 0);
});

test('fetch-urile externe au timeout (AbortSignal)', async () => {
  const { fetchFn, run } = setup();
  await run(makeRequest(validBody()));
  assert.ok(fetchFn.calls.length >= 3);
  for (const c of fetchFn.calls) assert.ok(c.init.signal instanceof AbortSignal, c.url);
});

test('functions/api/lead.js: alta metoda => 405 Allow POST; POST paseaza waitUntil', async () => {
  const { onRequest, onRequestPost } = await import('../functions/api/lead.js');
  const res405 = onRequest({});
  assert.equal(res405.status, 405);
  assert.equal(res405.headers.get('Allow'), 'POST');
  assert.match(res405.headers.get('Content-Security-Policy'), /default-src 'none'/);

  const realFetch = globalThis.fetch;
  const fake = fakeFetch();
  globalThis.fetch = fake;
  try {
    const waited = [];
    const res = await onRequestPost({
      request: makeRequest(validBody()),
      env: { TURNSTILE_SECRET_KEY: 's', RESEND_API_KEY: 'k', LEADS_DB: fakeDb() },
      waitUntil: (p) => waited.push(p),
    });
    assert.equal(res.status, 200);
    assert.equal(waited.length, 1, 'emailurile merg prin waitUntil');
    await Promise.all(waited);
    assert.equal(resendCalls(fake).length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('www.ai17hub.ro e productie; alte hosturi sunt preview', async () => {
  assert.equal(environmentOf('ai17hub.ro'), 'production');
  assert.equal(environmentOf('www.ai17hub.ro'), 'production');
  assert.equal(environmentOf('ai17hub-landing-page.pages.dev'), 'preview');
  assert.equal(environmentOf('evil-ai17hub.ro'), 'preview');
  const s = setup();
  const req = new Request('https://www.ai17hub.ro/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://www.ai17hub.ro', 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify(validBody()),
  });
  const { res } = await s.run(req);
  assert.equal(res.status, 200);
  assert.equal(s.db.rows[0].environment, 'production');
  assert.equal(resendCalls(s.fetchFn).length, 2);
});

test('preview: doar notificarea interna, nicio confirmare catre vizitator', async () => {
  for (const withDb of [true, false]) {
    const s = setup(withDb ? {} : { LEADS_DB: undefined }, { captcha: { success: true, hostname: 'preview.ai17hub-landing-page.pages.dev' } });
    const { res } = await s.run(previewRequest());
    assert.equal(res.status, 200);
    const mails = resendCalls(s.fetchFn).map((c) => JSON.parse(c.init.body));
    assert.equal(mails.length, 1, `cu D1: ${withDb}`);
    assert.deepEqual(mails[0].to, ['office@ai17hub.ro']);
    if (withDb) assert.equal(s.db.rows[0].confirm_sent_at, null);
  }
});

test('o singura confirmare pe email la 24h (fara diferenta de litere); notificarea merge mereu', async () => {
  const s = setup();
  await s.run(makeRequest(validBody()));
  const second = await s.run(makeRequest({ ...validBody(), email: 'ION@firmata.ro' }, { headers: { 'CF-Connecting-IP': '203.0.113.50' } }));
  assert.equal(second.res.status, 200);
  assert.equal(s.db.rows.length, 2, 'lead-ul se salveaza');
  const mails = resendCalls(s.fetchFn).map((c) => JSON.parse(c.init.body));
  assert.equal(mails.length, 3, 'notify, confirm, apoi doar notify');
  assert.deepEqual(mails.filter((m) => m.to[0] !== 'office@ai17hub.ro').length, 1);
  assert.equal(s.db.rows[1].confirm_sent_at, null);
  assert.ok(s.db.rows[1].notify_sent_at);
  // alt email primeste confirmare
  await s.run(makeRequest({ ...validBody(), email: 'alta@firmata.ro' }, { headers: { 'CF-Connecting-IP': '203.0.113.51' } }));
  assert.equal(resendCalls(s.fetchFn).length, 5);
});

test('dupa 24h acelasi email primeste din nou confirmare', async () => {
  const s = setup();
  seed(s.db, { id: 'vechi', created_at: '2026-11-24T09:00:00.000Z', email: 'ion@firmata.ro' });
  await s.run(makeRequest(validBody()));
  const mails = resendCalls(s.fetchFn).map((c) => JSON.parse(c.init.body));
  assert.equal(mails.length, 2);
});

test('rateLimitKey: IPv4, IPv6 comprimat/expandat, /64, IPv4 mapat, invalide', () => {
  assert.equal(rateLimitKey('203.0.113.7'), '203.0.113.7');
  assert.equal(rateLimitKey('2001:db8::1'), '2001:0db8:0000:0000::/64');
  assert.equal(rateLimitKey('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:0db8:0000:0000::/64');
  assert.equal(rateLimitKey('2001:db8:0:0:ffff:ffff:ffff:ffff'), '2001:0db8:0000:0000::/64');
  assert.equal(rateLimitKey('2001:db8:1:2:3::9'), '2001:0db8:0001:0002::/64');
  assert.equal(rateLimitKey('::1'), '0000:0000:0000:0000::/64');
  assert.equal(rateLimitKey('::'), '0000:0000:0000:0000::/64');
  assert.equal(rateLimitKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(rateLimitKey('2001:db8:1:2:3:4:5:6'), rateLimitKey('2001:db8:1:2::'));
  assert.notEqual(rateLimitKey('2001:db8:1:2::1'), rateLimitKey('2001:db8:1:3::1'));
  for (const bad of ['', 'abc', '1.2.3', '999.1.1.1', '1::2::3', '1:2:3:4:5:6:7:8:9', ':::', 'g::1', '1:2:3:4:5:6:7::8']) {
    assert.equal(rateLimitKey(bad), null, bad);
  }
});

test('rate limit pe IPv6: doua adrese din acelasi /64 se numara impreuna; D1 pastreaza cheia, nu IP-ul', async () => {
  const s = setup();
  for (let i = 1; i <= MAX_LEADS_PER_IP_PER_HOUR; i += 1) {
    const ip = i % 2 ? `2001:db8:aaaa:bbbb::${i}` : `2001:0db8:aaaa:bbbb:${i}:0:0:1`;
    const { res } = await s.run(makeRequest({ ...validBody(), email: `u${i}@firma.ro` }, { headers: { 'CF-Connecting-IP': ip } }));
    assert.equal(res.status, 200, `cererea ${i}`);
  }
  assert.ok(s.db.rows.every((r) => r.ip === '2001:0db8:aaaa:bbbb::/64'));
  const blocked = await s.run(makeRequest(validBody(), { headers: { 'CF-Connecting-IP': '2001:db8:aaaa:bbbb:9:9:9:9' } }));
  assert.equal(blocked.res.status, 429);
  const otherNet = await s.run(makeRequest(validBody(), { headers: { 'CF-Connecting-IP': '2001:db8:aaaa:cccc::1' } }));
  assert.equal(otherNet.res.status, 200);
});

test('rate limit IPv4 stocheaza adresa ca atare', async () => {
  const s = setup();
  await s.run(makeRequest(validBody()));
  assert.equal(s.db.rows[0].ip, '203.0.113.7');
});

test('caractere de control sau bidi in nume/companie => respins', async () => {
  const bad = ['a\u0000b', 'a\tb', 'a\nb', 'a\u007fb', 'a\u0085b', 'a\u202eb', 'a\u2066b', 'a\u2028b', 'a\u200fb'];
  for (const value of bad) {
    const n = await setup().run(makeRequest({ ...validBody(), name: value }));
    assert.equal(n.res.status, 400, JSON.stringify(value));
    assert.equal(n.json.error, 'name');
    const c = await setup().run(makeRequest({ ...validBody(), company: value }));
    assert.equal(c.res.status, 400, JSON.stringify(value));
    assert.equal(c.json.error, 'invalid');
  }
  const ok = await setup().run(makeRequest({ ...validBody(), name: 'Ștefan Țăranu-Îngâmfat', company: 'Ș&Ț SRL' }));
  assert.equal(ok.res.status, 200);
});

test('corp mare trimis in bucati, fara Content-Length: 413 si fluxul e abandonat', async () => {
  let cancelled = false;
  let sent = 0;
  const chunk = new TextEncoder().encode('x'.repeat(1024));
  const stream = new ReadableStream({
    pull(controller) {
      sent += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: stream,
    duplex: 'half',
  });
  const s = setup();
  const res = await handleLead(request, s.env, { fetchFn: s.fetchFn, now: () => NOW });
  assert.equal(res.status, 413);
  assert.ok(cancelled, 'fluxul a fost anulat');
  assert.ok(sent < 64, `nu s-a citit tot (${sent} bucati)`);
});

test('corp valid trimis in bucati este acceptat', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(validBody()));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 20));
      controller.enqueue(bytes.slice(20));
      controller.close();
    },
  });
  const request = new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' },
    body: stream,
    duplex: 'half',
  });
  const s = setup();
  const res = await handleLead(request, s.env, { fetchFn: s.fetchFn, now: () => NOW, waitUntil: () => {} });
  assert.equal(res.status, 200);
});

test('email_error: notificarea si confirmarea pe care le-au esuat se concateneaza cu prefix', async () => {
  const s = setup({}, { resendOk: false });
  await s.run(makeRequest(validBody()));
  assert.match(s.db.rows[0].email_error, /^notify: Resend HTTP 500 \| confirm: Resend HTTP 500$/);
  assert.equal(s.db.rows[0].notify_sent_at, null);
  assert.equal(s.db.rows[0].confirm_sent_at, null);
});

test('email doar logat (fara RESEND_API_KEY, preview): nu se seteaza notify_sent_at/confirm_sent_at', async () => {
  const s = setup({ RESEND_API_KEY: undefined }, { captcha: { success: true, hostname: 'preview.ai17hub-landing-page.pages.dev' } });
  const { res } = await s.run(previewRequest());
  assert.equal(res.status, 200);
  assert.equal(s.db.rows[0].notify_sent_at, null);
  assert.equal(s.db.rows[0].confirm_sent_at, null);
  assert.equal(s.db.rows[0].email_error, null);
});

test('raspunsurile functiei au CSP restrictiv, HSTS si nosniff', async () => {
  const { res } = await setup().run(makeRequest(null, { raw: 'x' }));
  assert.equal(res.headers.get('Content-Security-Policy'), "default-src 'none'; frame-ancestors 'none'");
});

test('consent_version: politica publicata la 23 Mai 2026', () => {
  assert.equal(CONSENT_VERSION, 'confidentialitate-2026-05-23');
});

test('migratia reala: tabela si indexurile; indexul de email serveste interogarea', () => {
  const db = fakeDb();
  const idx = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'lead'").all().map((r) => r.name);
  assert.ok(idx.includes('lead_ip_created_idx'));
  assert.ok(idx.includes('lead_email_created_idx'));
  const plan = (sql, ...args) => db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');
  assert.match(plan('SELECT COUNT(*) FROM lead WHERE email = ?1 COLLATE NOCASE AND created_at > ?2', 'a', 'b'), /lead_email_created_idx/);
  assert.match(plan('SELECT COUNT(*) FROM lead WHERE ip = ?1 AND created_at > ?2', 'a', 'b'), /lead_ip_created_idx/);
  assert.throws(() => seed(db, { id: 'x', created_at: 'now', environment: 'staging' }), /CHECK/);
});
