import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLead, MAX_BODY_BYTES, MAX_LEADS_PER_IP_PER_HOUR, notifyEmail, confirmEmail } from '../server/lead.js';

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

/** D1 fals, in memorie: doar interogarile folosite de server. */
function fakeDb() {
  const rows = [];
  const db = {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              assert.match(sql, /SELECT COUNT/);
              const [ip, since] = args;
              return { n: rows.filter((r) => r.ip === ip && r.created_at > since).length };
            },
            async run() {
              if (sql.startsWith('INSERT')) {
                rows.push({ id: args[0], created_at: args[1], name: args[3], email: args[4], company: args[5], interest: args[6], ip: args[12], consent_version: args[11], consent_at: args[10] });
              } else if (sql.includes('SET ip = NULL')) {
                for (const r of rows) if (r.ip && r.created_at < args[0]) r.ip = null;
              } else if (sql.includes('notify_sent_at')) {
                rows.find((r) => r.id === args[0]).notify_sent_at = args[1];
              } else if (sql.includes('confirm_sent_at')) {
                rows.find((r) => r.id === args[0]).confirm_sent_at = args[1];
              } else if (sql.includes('email_error')) {
                rows.find((r) => r.id === args[0]).email_error = args[1];
              }
            },
          };
        },
      };
    },
  };
  return db;
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
  const deps = { fetchFn, now: () => NOW, randomId: () => 'id-1', waitUntil: (p) => pendingWork.push(p) };
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
  assert.equal(resendCalls(fetchFn).length, 2);
});

test('IP-urile mai vechi de 24h devin NULL la fiecare insert', async () => {
  const { db, run } = setup();
  db.rows.push({ id: 'old', created_at: '2026-11-24T08:00:00.000Z', ip: '198.51.100.1' });
  db.rows.push({ id: 'recent', created_at: '2026-11-25T08:00:00.000Z', ip: '198.51.100.2' });
  await run(makeRequest(validBody()));
  assert.equal(db.rows.find((r) => r.id === 'old').ip, null);
  assert.equal(db.rows.find((r) => r.id === 'recent').ip, '198.51.100.2');
});

test('injectie de header: CR/LF din nume nu ajung in subiect', async () => {
  const { fetchFn, run } = setup();
  const { res } = await run(makeRequest({ ...validBody(), name: 'Ion\r\nBcc: victima@example.com' }));
  assert.equal(res.status, 200);
  const notify = JSON.parse(resendCalls(fetchFn)[0].init.body);
  assert.doesNotMatch(notify.subject, /[\r\n]/);
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
  assert.equal(row.consent_version, 'confidentialitate-2026-11');
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
