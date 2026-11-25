// Sign in to the admin page with your own email address instead of typing the password.
//
//   POST { action: 'send', email }    -> if the address is the admin email, Supabase emails it a one-time sign-in link (the answer is the same either way)
//   POST { action: 'session', token } -> checks the Supabase sign-in token (from the email link, or from Google) and, only for the admin email, returns the admin password
//                                        for the page to use in memory, exactly as if it had been typed
//
// Needs two environment variables on Vercel: ADMIN_EMAIL (the address allowed in) and ADMIN_PASSWORD (the admin password the page already uses).
// In Supabase (Authentication, URL configuration) the page https://www.jamesnorman.co.uk/admin/ must be on the redirect list. "Sign in with Google" also needs the Google provider switched on there.
import { timingSafeEqual } from 'node:crypto';

const SUPA = 'https://ynhyylnsbvmdasyyalcg.supabase.co';
const KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  const admin = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), pw = process.env.ADMIN_PASSWORD || '';
  if (!admin || !pw) return res.status(503).json({ ok: false, setup: true, error: 'Email sign-in is not set up yet (ADMIN_EMAIL and ADMIN_PASSWORD on Vercel).' });
  const body = req.body || {};
  try {
    if (body.action === 'send') {
      const email = String(body.email || '').trim().toLowerCase();
      if (same(email, admin)) {
        const redirect = `https://${req.headers.host}/admin/`;
        await fetch(`${SUPA}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, create_user: true }) });
      }
      return res.status(200).json({ ok: true });                     // the same answer whoever asks
    }
    if (body.action === 'session') {
      const token = String(body.token || '');
      if (!token) return res.status(400).json({ ok: false });
      const r = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
      if (!r.ok) return res.status(401).json({ ok: false, error: 'That sign-in link has expired. Ask for a new one.' });
      const u = await r.json();
      if (u && u.email && u.email_confirmed_at !== null && u.email_confirmed_at !== undefined && same(String(u.email).toLowerCase(), admin)) return res.status(200).json({ ok: true, password: pw });
      return res.status(403).json({ ok: false, error: 'That account is not allowed in.' });
    }
    return res.status(400).json({ ok: false });
  } catch (e) { return res.status(503).json({ ok: false, error: 'Couldn’t reach the sign-in service.' }); }
}
