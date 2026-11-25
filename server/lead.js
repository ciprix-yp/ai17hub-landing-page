// Logica formularului de pre-lansare (POST /api/lead), folosita de functions/api/lead.js.
// Fara dependente: ruleaza in Cloudflare Pages Functions si in `node --test`.
// Tot ce tine de runtime (fetch, D1, ceas, waitUntil) intra prin parametri, ca sa poata fi inlocuit in teste.

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_LEADS_PER_IP_PER_HOUR = 5;
export const IP_RETENTION_MS = 24 * 3_600_000;
export const CONSENT_VERSION = 'confidentialitate-2026-11';
export const SOURCE = 'landing-prelaunch';
export const INTERESTS = ['incubare', 'partener', 'evenimente', 'lab', 'curios'];

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND_URL = 'https://api.resend.com/emails';
const PRODUCTION_HOST = 'ai17hub.ro';
const DEFAULT_TO = 'office@ai17hub.ro';
const DEFAULT_FROM = 'AI17 HUB <noreply@ai17hub.ro>';
// Aceeasi regula ca in formular (src/components/CaptureForm.astro).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UTM_REGEX = /^[\w.-]{1,100}$/;
const TOKEN_MAX_LENGTH = 2048;

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

const fail = (error, status) => jsonResponse({ ok: false, error }, status);

/** Un singur rand, fara CR/LF si fara caractere de control (subiecte de email). */
export const oneLine = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();

/** Productia e doar ai17hub.ro; orice alt host (pages.dev, localhost) e "preview". */
export function environmentOf(hostname) {
  return hostname === PRODUCTION_HOST ? 'production' : 'preview';
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
  if (name.length < 1 || name.length > 120) return { ok: false, error: 'name' };
  const email = trimmed(payload.email);
  if (email.length > 254 || !EMAIL_REGEX.test(email)) return { ok: false, error: 'email' };
  if (typeof payload.interest !== 'string' || !INTERESTS.includes(payload.interest)) return { ok: false, error: 'interest' };
  if (payload.gdpr !== true) return { ok: false, error: 'gdpr' };

  let company = null;
  if (payload.company !== undefined && payload.company !== null) {
    if (typeof payload.company !== 'string') return { ok: false, error: 'invalid' };
    company = payload.company.trim() || null;
    if (company !== null && company.length > 200) return { ok: false, error: 'invalid' };
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
    `Nume: ${lead.name}`,
    `Email: ${lead.email}`,
    `Companie: ${lead.company ?? '-'}`,
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

/** Trimite un email prin Resend. Fara cheie, in afara productiei, doar loghează (fara date personale). */
async function sendEmail(env, fetchFn, { id, kind, to, replyTo, subject, text }, environment) {
  if (!env.RESEND_API_KEY) {
    if (environment !== 'production') {
      console.log(`lead: email ${kind} nu a fost trimis (fara RESEND_API_KEY), id=${id}, subiect=${subject.length} car., text=${text.length} car.`);
      return;
    }
    throw new Error('RESEND_API_KEY lipseste');
  }
  const response = await fetchFn(RESEND_URL, {
    method: 'POST',
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
}

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
      await db.prepare('UPDATE lead SET email_error = ?2 WHERE id = ?1').bind(id, String(error).slice(0, 200)).run();
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
    await sendNotify(env, fetchFn, lead);
    await mark(env.LEADS_DB, lead.id, 'notify_sent_at', null, now);
  } catch (error) {
    console.error('lead: notificarea a esuat', error);
    await mark(env.LEADS_DB, lead.id, 'notify_sent_at', error, now);
  }
  try {
    await sendConfirm(env, fetchFn, lead);
    await mark(env.LEADS_DB, lead.id, 'confirm_sent_at', null, now);
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
    const response = await fetchFn(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    if (!response.ok) return 'error';
    result = await response.json();
  } catch (error) {
    console.error('lead: siteverify a esuat', error);
    return 'error';
  }
  if (result?.success !== true) return 'invalid';
  const allowed = new Set([PRODUCTION_HOST, requestHostname]);
  // Cheile de test Cloudflare raspund cu hostname "example.com"; se accepta doar in afara productiei.
  if (environmentOf(requestHostname) !== 'production') allowed.add('example.com');
  return typeof result.hostname === 'string' && allowed.has(result.hostname) ? 'ok' : 'invalid';
}

async function recentLeadsFromIp(db, ip, now) {
  const since = new Date(now().getTime() - 3_600_000).toISOString();
  const row = await db.prepare('SELECT COUNT(*) AS n FROM lead WHERE ip = ?1 AND created_at > ?2').bind(ip, since).first();
  return Number(row?.n ?? 0);
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
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail('invalid', 413);
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
  const token = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';
  if (token === '' || token.length > TOKEN_MAX_LENGTH) return fail('captcha', 403);
  const captcha = await verifyTurnstile(env, fetchFn, token, ip, url.hostname);
  if (captcha === 'invalid') return fail('captcha', 403);
  if (captcha === 'error') return fail('server', 500);

  const db = env.LEADS_DB ?? null;
  if (!db) console.warn('lead: binding-ul LEADS_DB lipseste: fara jurnal si fara rate limit');

  // 6. Rate limit (daca D1 lipseste sau nu raspunde, cererea trece)
  if (db && ip) {
    try {
      if ((await recentLeadsFromIp(db, ip, now)) >= MAX_LEADS_PER_IP_PER_HOUR) return fail('rate', 429);
    } catch (error) {
      console.error('lead: verificarea rate limit a esuat', error);
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
    ip,
  };

  let stored = false;
  if (db) {
    try {
      await storeLead(db, lead);
      stored = true;
    } catch (error) {
      console.error('lead: inserarea in D1 a esuat', error);
    }
    if (stored) {
      try {
        await purgeOldIps(db, now);
      } catch (error) {
        console.error('lead: curatarea IP-urilor vechi a esuat', error);
      }
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
  waitUntil(sendConfirm(env, fetchFn, lead).catch((error) => console.error('lead: confirmarea a esuat', error)));
  return jsonResponse({ ok: true });
}
