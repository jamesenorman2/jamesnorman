// The research desk (see lib/research.js). Runs at most once a day: kicked off by blog visitors (GET),
// by the daily Vercel Cron (CRON_SECRET), or forced from the admin page (POST + password).
// Needs ANTHROPIC_API_KEY and SHIFT_TOKEN, like the Night Shift.

import { runDesk } from '../lib/research.js';

const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1';
const DB_KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';
const EVERY_HOURS = 20;

async function db(path, body) {
  const r = await fetch(`${DB}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: DB_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`Database ${r.status}`);
  return r.json();
}

async function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === `Bearer ${secret}`) return 'cron';
  if (req.method === 'POST') {
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (password) {
      const res = await db('rpc/jn_admin_login', { p_password: password });
      if (res && res.ok) return 'admin';
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.SHIFT_TOKEN) return res.status(500).json({ ok: false, error: 'SHIFT_TOKEN is not set' });

  let who;
  try { who = await authorised(req); } catch (e) { return res.status(503).json({ ok: false, error: 'Database unavailable' }); }
  if (!who) {
    if (req.method !== 'GET') return res.status(401).json({ ok: false, error: 'Not authorised' });
    try {
      if (await db('rpc/jn_claim_desk', { p_token: process.env.SHIFT_TOKEN, p_hours: EVERY_HOURS }) !== true)
        return res.status(200).json({ ok: true, ran: false });
    } catch (e) { return res.status(503).json({ ok: false, error: 'Database unavailable' }); }
    who = 'visitor';
  }

  let recent = '';
  try { recent = (await db('jn_blog?select=title&order=id.desc&limit=8')).map(p => p.title).join(' | '); } catch (e) { /* first run */ }
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

  let desk;
  try { desk = await runDesk({ today, recent }); }
  catch (e) { return res.status(502).json({ ok: false, error: 'The research desk failed: ' + (e && e.status ? `API ${e.status}` : 'error') }); }
  if (!desk.ok) return res.status(200).json({ ok: false, ran: true, error: desk.error });

  try {
    const saved = await db('rpc/jn_post_desk', { p_token: process.env.SHIFT_TOKEN, p_post: desk.post, p_incidents: desk.incidents, p_briefs: desk.briefs });
    if (!saved.ok) return res.status(500).json({ ok: false, error: saved.error });
    return res.status(200).json({ ok: true, ran: true, trigger: who, post: saved.id, title: desk.post.title, incidents: desk.incidents.length, briefs: desk.briefs.length, sources_searched: desk.searched });
  } catch (e) { return res.status(503).json({ ok: false, error: 'Could not save' }); }
}
