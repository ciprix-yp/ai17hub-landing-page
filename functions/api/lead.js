// POST /api/lead: formularul de pre-lansare (src/components/CaptureForm.astro).
// JS pur ESM: in functions/ nu stau fisiere .ts sau de alt fel (Cloudflare crapa la compilare, vezi 55d3a5d).
import { handleLead, jsonResponse } from '../../server/lead.js';

export const onRequestPost = (context) =>
  handleLead(context.request, context.env, { waitUntil: (promise) => context.waitUntil(promise) });

// Orice alta metoda
export const onRequest = () => jsonResponse({ ok: false, error: 'method' }, 405, { Allow: 'POST' });
