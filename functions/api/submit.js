const INTEREST_CONFIG = {
  incubare:   { label: 'Incubare — spațiu de lucru',   color: '#00E676', emoji: '🟢', prefix: '[INCUBARE]' },
  partener:   { label: 'Parteneriat B2B',                        color: '#7B61FF', emoji: '🟣', prefix: '[PARTENER]' },
  evenimente: { label: 'Evenimente',                             color: '#F59E0B', emoji: '🟡', prefix: '[EVENIMENT]' },
  lab:        { label: 'Digital Lab — servicii tehnice',    color: '#06B6D4', emoji: '🔵', prefix: '[LAB]' },
  curios:     { label: 'Informații generale',               color: '#888888', emoji: '⚪',       prefix: '[INFO]' },
};

export async function onRequestPost({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': 'https://ai17hub.ro',
    'Content-Type': 'application/json',
  };

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  if (!payload.name || !payload.email || !payload.interest || !payload.gdpr_consent) {
    return new Response(JSON.stringify({ error: 'Campuri obligatorii lipsa' }), { status: 400, headers });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return new Response(JSON.stringify({ error: 'Email invalid' }), { status: 400, headers });
  }

  // 1. Salvare Supabase
  const sbRes = await fetch(`${env.PUBLIC_SUPABASE_URL}/rest/v1/prelaunch_leads`, {
    method: 'POST',
    headers: {
      apikey: env.PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.PUBLIC_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!sbRes.ok) {
    const err = await sbRes.text();
    console.error('Supabase error:', err);
    return new Response(JSON.stringify({ error: 'Eroare salvare date.' }), { status: 500, headers });
  }

  // 2. Email notificare -> office@masstudio.ro
  const cfg = INTEREST_CONFIG[payload.interest] || INTEREST_CONFIG.curios;
  const dateStr = new Date().toLocaleDateString('ro-RO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const utmLine = payload.utm_campaign
    ? `<p style="color:#555;font-size:11px;margin-top:12px;">Sursa: ${payload.utm_source || '-'} / ${payload.utm_medium || '-'} / ${payload.utm_campaign}</p>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#0f0f0f;color:#E8DDD0;padding:0;margin:0;">
<div style="background:${cfg.color};padding:20px 32px;">
  <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;color:rgba(0,0,0,0.6);text-transform:uppercase;">${cfg.prefix} &middot; Canal AI17</div>
  <div style="font-size:20px;font-weight:700;color:#0f0f0f;">${cfg.label}</div>
</div>
<div style="padding:32px;max-width:600px;">
<table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
  <tr><td style="padding:12px 0;border-bottom:1px solid #222;color:#666;width:32%;font-size:13px;">Nume</td><td style="padding:12px 0;border-bottom:1px solid #222;font-weight:bold;">${payload.name}</td></tr>
  <tr><td style="padding:12px 0;border-bottom:1px solid #222;color:#666;font-size:13px;">Email</td><td style="padding:12px 0;border-bottom:1px solid #222;"><a href="mailto:${payload.email}" style="color:${cfg.color};">${payload.email}</a></td></tr>
  ${payload.company ? `<tr><td style="padding:12px 0;border-bottom:1px solid #222;color:#666;font-size:13px;">Companie</td><td style="padding:12px 0;border-bottom:1px solid #222;">${payload.company}</td></tr>` : ''}
  <tr><td style="padding:12px 0;border-bottom:1px solid #222;color:#666;font-size:13px;">Interes</td><td style="padding:12px 0;border-bottom:1px solid #222;"><span style="background:${cfg.color}22;color:${cfg.color};font-weight:700;font-size:13px;padding:3px 10px;">${cfg.label}</span></td></tr>
  <tr><td style="padding:12px 0;color:#666;font-size:13px;">GDPR</td><td style="padding:12px 0;color:#00E676;font-size:13px;">&#10003; ${new Date(payload.gdpr_timestamp).toLocaleString('ro-RO')}</td></tr>
</table>
<a href="mailto:${payload.email}?subject=Re: AI17 HUB &mdash; ${cfg.label}" style="display:inline-block;background:${cfg.color};color:#0f0f0f;font-weight:700;font-size:14px;padding:12px 24px;text-decoration:none;margin-bottom:24px;">Raspunde direct &rarr;</a>
<p style="color:#444;font-size:11px;border-top:1px solid #1a1a1a;padding-top:16px;margin:0;">${dateStr} &middot; Lead primit prin ai17hub.ro</p>
${utmLine}
</div></body></html>`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AI17 HUB <noreply@ai17hub.ro>',
        to: ['office@masstudio.ro'],
        reply_to: payload.email,
        subject: `${cfg.emoji} ${cfg.prefix} Lead nou AI17 — ${payload.name}`,
        html,
      }),
    });
    if (!resendRes.ok) {
      console.error('Resend error:', await resendRes.text());
    }
  } catch (e) {
    console.error('Email failed (non-fatal):', e);
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://ai17hub.ro',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
