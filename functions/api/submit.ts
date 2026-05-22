interface Env {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  RESEND_API_KEY: string;
}

interface LeadPayload {
  name: string;
  email: string;
  interest: string;
  company?: string;
  gdpr_consent: boolean;
  gdpr_timestamp: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

const INTEREST_CONFIG: Record<string, { label: string; color: string; emoji: string; subject_prefix: string }> = {
  incubare:  { label: 'Incubare — spațiu de lucru',   color: '#00E676', emoji: '🟢', subject_prefix: '[INCUBARE]' },
  partener:  { label: 'Parteneriat B2B',              color: '#7B61FF', emoji: '🟣', subject_prefix: '[PARTENER]' },
  evenimente:{ label: 'Evenimente',                   color: '#F59E0B', emoji: '🟡', subject_prefix: '[EVENIMENT]' },
  lab:       { label: 'Digital Lab — servicii tehnice',color: '#06B6D4', emoji: '🔵', subject_prefix: '[LAB]' },
  curios:    { label: 'Informații generale',           color: '#888888', emoji: '⚪', subject_prefix: '[INFO]' },
};

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const headers = {
    'Access-Control-Allow-Origin': 'https://ai17hub.ro',
    'Content-Type': 'application/json',
  };

  let payload: LeadPayload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  // Validare minimă server-side
  if (!payload.name || !payload.email || !payload.interest || !payload.gdpr_consent) {
    return new Response(
      JSON.stringify({ error: 'Câmpuri obligatorii lipsă' }),
      { status: 400, headers }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(payload.email)) {
    return new Response(
      JSON.stringify({ error: 'Email invalid' }),
      { status: 400, headers }
    );
  }

  // 1. Salvare în Supabase
  const supabaseRes = await fetch(
    `${env.PUBLIC_SUPABASE_URL}/rest/v1/prelaunch_leads`,
    {
      method: 'POST',
      headers: {
        apikey: env.PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.PUBLIC_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!supabaseRes.ok) {
    const errText = await supabaseRes.text();
    console.error('Supabase error:', errText);
    return new Response(
      JSON.stringify({ error: 'Eroare salvare date. Încearcă din nou.' }),
      { status: 500, headers }
    );
  }

  // 2. Email notificare → office@masstudio.ro cu canal per traseu
  const cfg = INTEREST_CONFIG[payload.interest] ?? INTEREST_CONFIG['curios'];
  const dateStr = new Date().toLocaleDateString('ro-RO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const utmInfo = payload.utm_campaign
    ? `<p style="color:#555;font-size:11px;margin-top:16px;">Sursă: ${payload.utm_source ?? '-'} · ${payload.utm_medium ?? '-'} · ${payload.utm_campaign}</p>`
    : '';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#0f0f0f;color:#E8DDD0;padding:0;margin:0;">

  <!-- Header canal colorat per traseu -->
  <div style="background:${cfg.color};padding:20px 32px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:1.4rem;">${cfg.emoji}</span>
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;color:rgba(0,0,0,0.6);text-transform:uppercase;">${cfg.subject_prefix} · Canal AI17</div>
      <div style="font-size:20px;font-weight:700;color:#0f0f0f;">${cfg.label}</div>
    </div>
  </div>

  <div style="padding:32px;max-width:600px;">

    <!-- Lead info -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #222;color:#666;width:32%;font-size:13px;">Nume</td>
        <td style="padding:12px 0;border-bottom:1px solid #222;font-weight:bold;font-size:15px;">${payload.name}</td>
      </tr>
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #222;color:#666;font-size:13px;">Email</td>
        <td style="padding:12px 0;border-bottom:1px solid #222;">
          <a href="mailto:${payload.email}" style="color:${cfg.color};font-size:15px;">${payload.email}</a>
        </td>
      </tr>
      ${payload.company ? `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #222;color:#666;font-size:13px;">Companie</td>
        <td style="padding:12px 0;border-bottom:1px solid #222;font-size:15px;">${payload.company}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #222;color:#666;font-size:13px;">Interes</td>
        <td style="padding:12px 0;border-bottom:1px solid #222;">
          <span style="background:${cfg.color}22;color:${cfg.color};font-weight:700;font-size:13px;padding:3px 10px;border-radius:3px;">${cfg.label}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#666;font-size:13px;">GDPR</td>
        <td style="padding:12px 0;color:#00E676;font-size:13px;">✓ ${new Date(payload.gdpr_timestamp).toLocaleString('ro-RO')}</td>
      </tr>
    </table>

    <!-- CTA reply -->
    <a href="mailto:${payload.email}?subject=Re: AI17 HUB — ${cfg.label}" style="display:inline-block;background:${cfg.color};color:#0f0f0f;font-weight:700;font-size:14px;padding:12px 24px;text-decoration:none;margin-bottom:24px;">
      Răspunde direct →
    </a>

    <p style="color:#444;font-size:11px;border-top:1px solid #1a1a1a;padding-top:16px;margin:0;">
      ${dateStr} · Lead primit prin ai17hub.ro
    </p>
    ${utmInfo}
  </div>
</body>
</html>`;

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
        subject: `${cfg.emoji} ${cfg.subject_prefix} Lead nou AI17 — ${payload.name}`,
        html: emailHtml,
      }),
    });

    if (!resendRes.ok) {
      // Email eșuat dar lead salvat — logăm și continuăm
      const errBody = await resendRes.text();
      console.error('Resend error (non-fatal):', errBody);
    }
  } catch (emailErr) {
    // Nu blocăm utilizatorul dacă emailul eșuează
    console.error('Email send failed (non-fatal):', emailErr);
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://ai17hub.ro',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
