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

const INTEREST_LABELS: Record<string, string> = {
  incubare: 'Incubare — spațiu de lucru',
  partener: 'Parteneriat B2B',
  evenimente: 'Evenimente',
  lab: 'Digital Lab — servicii tehnice',
  curios: 'Sunt curios',
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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

  // 2. Email notificare → office@masstudio.ro
  const interestLabel = INTEREST_LABELS[payload.interest] ?? payload.interest;
  const utmInfo = payload.utm_campaign
    ? `<p style="color:#888;font-size:12px;">Sursa: ${payload.utm_source ?? '-'} / ${payload.utm_medium ?? '-'} / ${payload.utm_campaign}</p>`
    : '';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#1C1C1C;color:#E8DDD0;padding:32px;max-width:600px;margin:0 auto;">
  <div style="border-left:4px solid #00E676;padding-left:20px;margin-bottom:28px;">
    <h1 style="color:#00E676;font-size:24px;margin:0 0 4px;">Lead nou — AI17 HUB</h1>
    <p style="color:#888;margin:0;font-size:14px;">${new Date().toLocaleDateString('ro-RO', { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' })}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;color:#888;width:35%;">Nume</td>
      <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;font-weight:bold;">${payload.name}</td>
    </tr>
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;color:#888;">Email</td>
      <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;">
        <a href="mailto:${payload.email}" style="color:#00E676;">${payload.email}</a>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;color:#888;">Interes</td>
      <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;color:#00E676;font-weight:bold;">${interestLabel}</td>
    </tr>
    ${payload.company ? `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;color:#888;">Companie</td>
      <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;">${payload.company}</td>
    </tr>` : ''}
    <tr>
      <td style="padding:10px 0;color:#888;">GDPR</td>
      <td style="padding:10px 0;color:#00E676;">✓ Acord dat la ${new Date(payload.gdpr_timestamp).toLocaleString('ro-RO')}</td>
    </tr>
  </table>

  ${utmInfo}

  <div style="margin-top:28px;padding:16px;background:#2A2A2A;border-radius:4px;">
    <p style="margin:0;font-size:13px;color:#888;">
      Răspunde direct la acest email sau contactează pe
      <a href="mailto:${payload.email}" style="color:#00E676;">${payload.email}</a>
    </p>
  </div>

  <p style="color:#444;font-size:11px;margin-top:24px;">
    Lead primit prin landing page ai17hub.ro — AI17 HUB Pre-lansare
  </p>
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
        subject: `🟢 Lead nou AI17 — ${interestLabel} — ${payload.name}`,
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
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://ai17hub.ro',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
