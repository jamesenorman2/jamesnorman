// The day crew runner. Each call runs agents that are due (each at most once per its interval),
// claimed through the database so two visitors can't start the same agent. Triggered by pages (GET),
// the daily cron (CRON_SECRET), or the admin page (POST + password, optionally { agent } to force one).
import { switchedOff } from '../lib/switches.js';
import { CREW } from '../lib/crew.js';
import { hasAI } from '../lib/models.js';

const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1';
const DB_KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';

async function db(path, body) {
  const r = await fetch(`${DB}/${path}`, { method: body ? 'POST' : 'GET', headers: { apikey: DB_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`Database ${r.status}`);
  return r.json();
}

async function authorised(req) {
  if (process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`) return 'cron';
  if (req.method === 'POST' && req.body && typeof req.body.password === 'string' && req.body.password) {
    const res = await db('rpc/jn_admin_login', { p_password: req.body.password });
    if (res && res.ok) return 'admin';
  }
  return null;
}

async function runOne(name, force) {
  const agent = CREW[name], token = process.env.SHIFT_TOKEN;
  if (agent.ai && !hasAI()) return { agent: name, ran: false, error: 'no API key' };
  const claimed = await db('rpc/jn_claim_crew', { p_token: token, p_agent: name, p_hours: force ? 0 : agent.every });
  if (claimed !== true) return { agent: name, ran: false };
  const [last] = await db(`jn_crew?select=report&agent=eq.${name}&order=id.desc&limit=1`).catch(() => []);
  let report;
  try { report = await agent.run(last && last.report, token); }
  catch (e) { report = { summary: 'Off duty today: ' + (e && e.message ? e.message : 'error'), error: true }; }
  const out = { ...report, at: new Date().toISOString() };
  if (name === 'bunsen' && out.secret) {             // the answer is kept private until someone answers
    await db('rpc/jn_post_quiz', { p_token: token, p_id: out.id, p_answer: out.secret.answer_index, p_explanation: out.secret.explanation, p_options: out.options.length });
    delete out.secret;
  }
  const saved = await db('rpc/jn_post_crew', { p_token: token, p_agent: name, p_report: out });
  return { agent: name, ran: true, ok: !!(saved && saved.ok), summary: out.summary };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.SHIFT_TOKEN) return res.status(500).json({ ok: false, error: 'SHIFT_TOKEN is not set' });
  let who;
  try { who = await authorised(req); } catch (e) { return res.status(503).json({ ok: false, error: 'Database unavailable' }); }
  if (who !== 'admin' && await switchedOff('crew')) return res.status(200).json({ ok: true, ran: false, off: true });      // switched off on the admin page
  if (req.method === 'POST' && !who) return res.status(401).json({ ok: false, error: 'Not authorised' });
  const only = who === 'admin' && req.body && CREW[req.body.agent] ? [req.body.agent] : null;
  // a visitor's kick runs at most two due agents (keeps each request short); cron and admin run them all
  const names = only || Object.keys(CREW).sort(() => Math.random() - 0.5);
  const limit = who ? names.length : 2, results = [];
  for (const name of names) {
    if (results.filter(r => r.ran).length >= limit) break;
    try { results.push(await runOne(name, !!only)); } catch (e) { results.push({ agent: name, ran: false, error: e.message }); }
  }
  return res.status(200).json({ ok: true, trigger: who || 'visitor', ran: results.filter(r => r.ran) });
}
