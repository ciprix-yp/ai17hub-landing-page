// Logica formularului de pre-lansare (POST /api/lead), folosita de functions/api/lead.js.
// Fara dependente: ruleaza in Cloudflare Pages Functions si in `node --test`.
// Tot ce tine de runtime (fetch, D1, ceas, waitUntil) intra prin parametri, ca sa poata fi inlocuit in teste.

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_LEADS_PER_IP_PER_HOUR = 5;
export const IP_RETENTION_MS = 24 * 3_600_000;
export const EMAIL_CONFIRM_WINDOW_MS = 24 * 3_600_000;
// Data politicii de confidentialitate publicate (src/pages/legal/confidentialitate.astro: "23 Mai 2026").
// Se actualizeaza cand Ciprian publica politica noua.
export const CONSENT_VERSION = 'confidentialitate-2026-05-23';
export const SOURCE = 'landing-prelaunch';
export const INTERESTS = ['incubare', 'partener', 'evenimente', 'lab', 'curios'];

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND_URL = 'https://api.resend.com/emails';
const PRODUCTION_HOSTS = ['ai17hub.ro', 'www.ai17hub.ro'];
const FETCH_TIMEOUT_MS = 8000;
// Caractere de control si bidi (inclusiv separatoarele de linie Unicode): nu au ce cauta in nume/companie.
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const DEFAULT_TO = 'office@ai17hub.ro';
const DEFAULT_FROM = 'AI17 HUB <noreply@ai17hub.ro>';
// Aceeasi regula ca in formular (src/components/CaptureForm.astro).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UTM_REGEX = /^[\w.-]{1,100}$/;
const TOKEN_MAX_LENGTH = 2048;

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    // _headers din Pages nu se aplica raspunsurilor din Functions: HSTS si nosniff se pun aici (aceeasi valoare ca in public/_headers).
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...extraHeaders,
    },
  });
}

const fail = (error, status) => jsonResponse({ ok: false, error }, status);

/** Un singur rand, fara CR/LF si fara caractere de control (subiecte de email). */
export const oneLine = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();

/** Productia e ai17hub.ro si www.ai17hub.ro; orice alt host (pages.dev, localhost) e "preview". */
export function environmentOf(hostname) {
  return PRODUCTION_HOSTS.includes(hostname) ? 'production' : 'preview';
}

/**
 * Cheia de rate limit: IPv4 ca atare, IPv6 ca prefix /64 normalizat (forme comprimate `::` expandate).
 * IPv4 mapat in IPv6 (::ffff:a.b.c.d) devine IPv4. Intoarce null pentru orice nu e adresa valida.
 */
export function rateLimitKey(raw) {
  const octets = (text) => {
    const parts = text.split('.').map(Number);
    return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
  };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return octets(raw) ? raw : null;
  if (!raw.includes(':')) return null;
  let text = raw.toLowerCase();
  const v4 = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const o = octets(v4[2]);
    if (!o) return null;
    text = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const list = (s) => (s === '' ? [] : s.split(':'));
  let groups;
  if (halves.length === 2) {
    const head = list(halves[0]);
    const tail = list(halves[1]);
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = list(text);
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const values = groups.map((g) => parseInt(g, 16));
  if (values.slice(0, 5).every((n) => n === 0) && values[5] === 0xffff) {
    return `${values[6] >> 8}.${values[6] & 255}.${values[7] >> 8}.${values[7] & 255}`;
  }
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}

/**
 * Citeste corpul cu limita reala: numara octetii pe masura ce vin si renunta la depasire.
 * @returns {Promise<string | null>} textul, sau null daca a depasit limita
 */
async function readBodyLimited(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Browserul trimite Origin la orice POST facut cu fetch; un script fara Origin sau de pe alt site e refuzat. */
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin !== null && origin === new URL(request.url).origin;
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Valideaza corpul cererii si intoarce doar campurile cunoscute; orice altceva trimis de browser se ignora
 * (gdpr_timestamp, source, consent_version le pune serverul).
 * @returns {{ ok: true, lead: object } | { ok: false, error: 'name'|'email'|'interest'|'gdpr'|'invalid' }}
 */
export function parseLead(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return { ok: false, error: 'invalid' };
  const name = trimmed(payload.name);
  if (name.length < 1 || name.length > 120 || CONTROL_OR_BIDI.test(name)) return { ok: false, error: 'name' };
  const email = trimmed(payload.email);
  if (email.length > 254 || !EMAIL_REGEX.test(email)) return { ok: false, error: 'email' };
  if (typeof payload.interest !== 'string' || !INTERESTS.includes(payload.interest)) return { ok: false, error: 'interest' };
  if (payload.gdpr !== true) return { ok: false, error: 'gdpr' };

  let company = null;
  if (payload.company !== undefined && payload.company !== null) {
    if (typeof payload.company !== 'string') return { ok: false, error: 'invalid' };
    company = payload.company.trim() || null;
    if (company !== null && (company.length > 200 || CONTROL_OR_BIDI.test(company))) return { ok: false, error: 'invalid' };
  }
  // Valorile UTM care nu respecta formatul se arunca (nu pierdem un lead din cauza unei campanii cu caractere ciudate).
  const utm = (value) => (typeof value === 'string' && UTM_REGEX.test(value) ? value : null);
  return {
    ok: true,
    lead: {
      name,
      email,
      interest: payload.interest,
      company,
      utm_source: utm(payload.utm_source),
      utm_medium: utm(payload.utm_medium),
      utm_campaign: utm(payload.utm_campaign),
    },
  };
}

/** Emailul pentru echipa: doar text (nu HTML), subiect pe un singur rand. */
export function notifyEmail(lead) {
  const test = lead.environment !== 'production';
  const subject = oneLine(`${test ? '[TEST] ' : ''}[ai17hub] Lead nou (${lead.interest}): ${lead.name}`).slice(0, 180);
  const lines = [
    `Lead nou de pe site${test ? ' - TEST, trimis de pe un preview' : ''}`,
    '',
    `Nume: ${oneLine(lead.name)}`,
    `Email: ${oneLine(lead.email)}`,
    `Companie: ${lead.company ? oneLine(lead.company) : '-'}`,
    `Interes: ${lead.interest}`,
    `UTM: ${[lead.utm_source, lead.utm_medium, lead.utm_campaign].map((v) => v ?? '-').join(' / ')}`,
    `Acord GDPR: ${lead.consentAt} (${CONSENT_VERSION})`,
    `Sursa: ${SOURCE}`,
    `ID: ${lead.id}`,
    '',
    'Raspunde direct la acest email ca sa-i scrii persoanei (Reply-To).',
  ];
  return { subject, text: lines.join('\n') };
}

/** Confirmarea catre vizitator: text fix, fara campurile lui; fraza e cea din starea de succes a formularului. */
export function confirmEmail() {
  return {
    subject: 'Am primit datele tale',
    text: [
      'Mulțumim!',
      '',
      `Am primit datele tale. Te contactăm în maxim 48 de ore de la ${DEFAULT_TO} — verifică și folderul Spam.`,
      '',
      'AI17 HUB',
    ].join('\n'),
  };
}

const addressList = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Trimite un email prin Resend. Fara cheie, in afara productiei, doar loghează (fara date personale).
 * @returns {Promise<boolean>} true daca a plecat efectiv; false daca a fost doar logat
 */
async function sendEmail(env, fetchFn, { id, kind, to, replyTo, subject, text }, environment) {
  if (!env.RESEND_API_KEY) {
    if (environment !== 'production') {
      console.log(`lead: email ${kind} nu a fost trimis (fara RESEND_API_KEY), id=${id}, subiect=${subject.length} car., text=${text.length} car.`);
      return false;
    }
    throw new Error('RESEND_API_KEY lipseste');
  }
  const response = await fetchFn(RESEND_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `lead-${kind}-${id}`,
    },
    body: JSON.stringify({
      from: env.LEAD_FROM || DEFAULT_FROM,
      to,
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text,
    }),
  });
  if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
  return true;
}

/** Confirmarea catre vizitator pleaca doar din productie (pe preview nu exista relay catre adrese straine). */
const confirmAllowed = (lead) => lead.environment === 'production' && !lead.skipConfirm;

const sendNotify = (env, fetchFn, lead) =>
  sendEmail(
    env,
    fetchFn,
    { id: lead.id, kind: 'notify', to: addressList(env.LEAD_NOTIFY_TO || DEFAULT_TO), replyTo: lead.email, ...notifyEmail(lead) },
    lead.environment,
  );

const sendConfirm = (env, fetchFn, lead) =>
  sendEmail(
    env,
    fetchFn,
    { id: lead.id, kind: 'confirm', to: [lead.email], replyTo: addressList(env.LEAD_NOTIFY_TO || DEFAULT_TO)[0], ...confirmEmail() },
    lead.environment,
  );

async function mark(db, id, column, error, now) {
  if (!db) return;
  try {
    if (error) {
      // Erorile se concateneaza (notify: ... | confirm: ...), nu se suprascriu.
      const label = column === 'confirm_sent_at' ? 'confirm' : 'notify';
      const message = `${label}: ${String(error?.message ?? error)}`.slice(0, 200);
      await db
        .prepare("UPDATE lead SET email_error = substr(CASE WHEN email_error IS NULL THEN ?2 ELSE email_error || ' | ' || ?2 END, 1, 400) WHERE id = ?1")
        .bind(id, message)
        .run();
    } else {
      // Numele coloanei vine dintr-o lista fixa, nu din input.
      const col = column === 'confirm_sent_at' ? 'confirm_sent_at' : 'notify_sent_at';
      await db.prepare(`UPDATE lead SET ${col} = ?2 WHERE id = ?1`).bind(id, now().toISOString()).run();
    }
  } catch (err) {
    console.error('lead: nu am putut nota rezultatul emailului', err);
  }
}

/** Notificare + confirmare, cu rezultatul notat in D1 (daca exista). Nu arunca niciodata. */
async function sendBoth(env, fetchFn, lead, now) {
  try {
    if (await sendNotify(env, fetchFn, lead)) await mark(env.LEADS_DB, lead.id, 'notify_sent_at', null, now);
  } catch (error) {
    console.error('lead: notificarea a esuat', error);
    await mark(env.LEADS_DB, lead.id, 'notify_sent_at', error, now);
  }
  if (!confirmAllowed(lead)) return;
  try {
    if (await sendConfirm(env, fetchFn, lead)) await mark(env.LEADS_DB, lead.id, 'confirm_sent_at', null, now);
  } catch (error) {
    console.error('lead: confirmarea a esuat', error);
    await mark(env.LEADS_DB, lead.id, 'confirm_sent_at', error, now);
  }
}

/** Verifica tokenul Turnstile. @returns {'ok'|'invalid'|'error'} */
async function verifyTurnstile(env, fetchFn, token, ip, requestHostname) {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error('lead: TURNSTILE_SECRET_KEY lipseste');
    return 'error';
  }
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set('remoteip', ip);
  let result;
  try {
    const response = await fetchFn(TURNSTILE_VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return 'error';
    result = await response.json();
  } catch (error) {
    console.error('lead: siteverify a esuat', error);
    return 'error';
  }
  if (result?.success !== true) return 'invalid';
  const allowed = new Set([...PRODUCTION_HOSTS, requestHostname]);
  // Cheile de test Cloudflare raspund cu hostname "example.com"; se accepta doar in afara productiei.
  if (environmentOf(requestHostname) !== 'production') allowed.add('example.com');
  return typeof result.hostname === 'string' && allowed.has(result.hostname) ? 'ok' : 'invalid';
}

async function recentLeadsFromIp(db, key, now) {
  const since = new Date(now().getTime() - 3_600_000).toISOString();
  const row = await db.prepare('SELECT COUNT(*) AS n FROM lead WHERE ip = ?1 AND created_at > ?2').bind(key, since).first();
  return Number(row?.n ?? 0);
}

/** Exista alt lead cu acelasi email (fara diferenta de litere) in ultimele 24h? Indexul lead_email_created_idx serveste interogarea. */
async function hasRecentLeadWithEmail(db, email, now) {
  const since = new Date(now().getTime() - EMAIL_CONFIRM_WINDOW_MS).toISOString();
  const row = await db.prepare('SELECT COUNT(*) AS n FROM lead WHERE email = ?1 COLLATE NOCASE AND created_at > ?2').bind(email, since).first();
  return Number(row?.n ?? 0) > 0;
}

async function storeLead(db, lead) {
  await db
    .prepare(
      `INSERT INTO lead (id, created_at, environment, name, email, company, interest, utm_source, utm_medium, utm_campaign,
                         consent_at, consent_version, ip)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      lead.id, lead.createdAt, lead.environment, lead.name, lead.email, lead.company, lead.interest,
      lead.utm_source, lead.utm_medium, lead.utm_campaign, lead.consentAt, CONSENT_VERSION, lead.ip,
    )
    .run();
}

async function purgeOldIps(db, now) {
  const cutoff = new Date(now().getTime() - IP_RETENTION_MS).toISOString();
  await db.prepare('UPDATE lead SET ip = NULL WHERE ip IS NOT NULL AND created_at < ?1').bind(cutoff).run();
}

/**
 * Procesarea unei cereri POST /api/lead.
 * @param {Request} request
 * @param {Record<string, any>} env  TURNSTILE_SECRET_KEY, RESEND_API_KEY, LEAD_NOTIFY_TO, LEAD_FROM, LEADS_DB (optionale in afara de secretul Turnstile)
 * @param {{ waitUntil?: (p: Promise<unknown>) => void, fetchFn?: typeof fetch, now?: () => Date, randomId?: () => string }} [deps]
 * @returns {Promise<Response>}
 */
export async function handleLead(request, env, deps = {}) {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const waitUntil = deps.waitUntil ?? ((promise) => void promise.catch(() => {}));
  const url = new URL(request.url);

  // 1. Origin
  if (!isSameOrigin(request)) return fail('origin', 403);

  // 2. Content-Type, dimensiune, JSON
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) return fail('invalid', 400);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return fail('invalid', 413);
  let payload;
  try {
    const raw = await readBodyLimited(request, MAX_BODY_BYTES);
    if (raw === null) return fail('invalid', 413);
    payload = JSON.parse(raw);
  } catch (_error) {
    return fail('invalid', 400);
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return fail('invalid', 400);

  // 3. Honeypot: raspuns "succes" fals, fara efecte
  if (typeof payload.website === 'string' && payload.website.trim() !== '') {
    console.warn('lead: honeypot completat, cerere ignorata');
    return jsonResponse({ ok: true });
  }

  // 4. Validarea campurilor, inaintea Turnstile (tokenul e de unica folosinta)
  const parsed = parseLead(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  // 5. Turnstile
  const rawIp = (request.headers.get('CF-Connecting-IP') || '').trim();
  const ip = rawIp.length <= 64 && /^[0-9a-f:.]+$/i.test(rawIp) ? rawIp : null;
  const ipKey = ip ? rateLimitKey(ip) : null;
  const token = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';
  if (token === '' || token.length > TOKEN_MAX_LENGTH) return fail('captcha', 403);
  const captcha = await verifyTurnstile(env, fetchFn, token, ip, url.hostname);
  if (captcha === 'invalid') return fail('captcha', 403);
  if (captcha === 'error') return fail('server', 500);

  const db = env.LEADS_DB ?? null;
  if (!db) console.warn('lead: binding-ul LEADS_DB lipseste: fara jurnal si fara rate limit');

  // 6. Curatarea IP-urilor vechi (>24h) + rate limit (daca D1 lipseste sau nu raspunde, cererea trece)
  if (db) {
    try {
      await purgeOldIps(db, now);
    } catch (error) {
      console.error('lead: curatarea IP-urilor vechi a esuat', error);
    }
  }
  if (db && ipKey) {
    try {
      if ((await recentLeadsFromIp(db, ipKey, now)) >= MAX_LEADS_PER_IP_PER_HOUR) return fail('rate', 429);
    } catch (error) {
      console.error('lead: verificarea rate limit a esuat', error);
    }
  }

  // O singura confirmare / 24h / email: daca verificarea esueaza, confirmarea se omite (nu risca relay).
  let skipConfirm = false;
  if (db) {
    try {
      skipConfirm = await hasRecentLeadWithEmail(db, parsed.lead.email, now);
    } catch (error) {
      console.error('lead: verificarea emailului recent a esuat', error);
      skipConfirm = true;
    }
  }

  // 7. Salvare + emailuri
  const createdAt = now().toISOString();
  const lead = {
    ...parsed.lead,
    id: randomId(),
    createdAt,
    consentAt: createdAt,
    environment: environmentOf(url.hostname),
    ip: ipKey, // in D1 se pastreaza cheia (IPv4 / prefix IPv6 /64), nu adresa completa
    skipConfirm,
  };

  let stored = false;
  if (db) {
    try {
      await storeLead(db, lead);
      stored = true;
    } catch (error) {
      console.error('lead: inserarea in D1 a esuat', error);
    }
  }

  if (stored) {
    waitUntil(sendBoth(env, fetchFn, lead, now));
    return jsonResponse({ ok: true });
  }

  // Fara jurnal, notificarea e singura urma: se trimite sincron, iar daca pica, cererea esueaza.
  try {
    await sendNotify(env, fetchFn, lead);
  } catch (error) {
    console.error('lead: notificarea a esuat si D1 nu e disponibil', error);
    return fail('server', 500);
  }
  // Confirmarea pleaca doar din productie (confirmAllowed); fara jurnal nu se poate deduplica pe email.
  if (confirmAllowed(lead)) {
    waitUntil(sendConfirm(env, fetchFn, lead).catch((error) => console.error('lead: confirmarea a esuat', error)));
  }
  return jsonResponse({ ok: true });
}
