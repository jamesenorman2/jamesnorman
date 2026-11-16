// The Night Shift: a crew of AI agents that works the site every night.
//   PATROL  – fetches every page and times it (plain code, no AI needed)
//   ANALYST – writes a control-room handover from the patrol report
//   DJ      – picks a track of the day and sets up a two-agent DJ battle
// Runs from Vercel Cron (GET with the CRON_SECRET bearer token) or from the
// admin page (POST with the admin password). Results are posted to the site's
// database with SHIFT_TOKEN, and shown on /night-shift/ and /music/.
//
// Environment variables (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  your Claude API key (without it, Patrol still runs)
//   CRON_SECRET        Vercel Cron sends it in the Authorization header
//   SHIFT_TOKEN        secret that lets this function write the shift log
//   SITE_URL           optional, defaults to https://www.jamesnorman.co.uk

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1';
const DB_KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';
const SITE = (process.env.SITE_URL || 'https://www.jamesnorman.co.uk').replace(/\/$/, '');
const PAGES = ['/', '/visualiser/', '/music/', '/security/', '/security/layers/', '/security/cpted/',
  '/security/martyns-law/', '/night-shift/', '/admin/', '/assets/site.css', '/assets/flight.js'];
const AGENTS = { a: 'VANTAGE', b: 'LOWLIGHT' };

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

async function patrol() {
  return Promise.all(PAGES.map(async path => {
    const start = Date.now();
    try {
      const r = await fetch(SITE + path, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
      await r.arrayBuffer();
      return { path, status: r.status, ok: r.ok, ms: Date.now() - start };
    } catch (e) {
      return { path, status: e.name === 'TimeoutError' ? 'timeout' : 'unreachable', ok: false, ms: null };
    }
  }));
}

const Pick = z.object({ track_number: z.number().int(), pitch: z.string() });
const ShiftSchema = z.object({
  analyst: z.object({
    status: z.enum(['GREEN', 'AMBER', 'RED']),
    handover: z.string()
  }),
  dj: z.object({ track_number: z.number().int(), reason: z.string() }),
  battle: z.object({
    a: Pick,
    b: Pick,
    exchange: z.array(z.object({ speaker: z.enum(['a', 'b']), line: z.string() }))
  })
});

const SYSTEM = `You are the overnight crew for jamesnorman.co.uk, the personal site of James Norman: a chartered engineer working in physical security and counter-terrorism protective security, and a music producer and DJ. The site is stark white lines on true black.

You play three roles in one report:
- ANALYST: write the shift handover from the patrol report, in calm, concise control-room style (think security control room radio log, not military cosplay). 60 to 110 words. Mention anything that failed or was slow (over 1500 ms), otherwise confirm all clear. Status GREEN if everything is fine, AMBER for slow pages or one failure, RED for several failures or the home page failing.
- DJ: pick one track of the day from the numbered track list and give a one-sentence reason.
- DJ BATTLE: two rival AI DJs, ${AGENTS.a} (precise, cool, loves tension and space) and ${AGENTS.b} (warm, playful, loves the drop) each pick a different track from the list and pitch it in 30 to 60 words. Then write a short exchange of 4 to 6 lines of friendly trash talk between them, alternating speakers, starting with "a".

Keep everything light, witty and kind. Never describe attack methods or anything that could help someone cause harm. Only use track numbers that appear in the list.`;

async function runAgents(patrolReport, tracks) {
  if (!process.env.ANTHROPIC_API_KEY) return { note: 'Analyst and DJ off duty tonight: no Claude API key is set yet.' };
  const client = new Anthropic();
  const list = tracks.length
    ? tracks.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
    : '(no tracks synced yet; use track_number 0 for every pick and say the crate is empty)';
  const user = `Shift date: ${new Date().toUTCString()}

PATROL REPORT (path, HTTP status, response time):
${patrolReport.map(p => `${p.path}  ${p.status}  ${p.ms == null ? '-' : p.ms + ' ms'}`).join('\n')}

TRACK LIST:
${list}`;

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(ShiftSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: user }]
    });
    if (response.stop_reason === 'refusal') return { note: 'The analyst declined to write tonight’s report.' };
    const out = response.parsed_output;
    if (!out) return { note: 'The analyst’s report came back unreadable tonight.' };

    const track = n => (Number.isInteger(n) && n >= 1 && n <= tracks.length) ? { title: tracks[n - 1].title, url: tracks[n - 1].url } : null;
    const result = { analyst: { status: out.analyst.status, handover: out.analyst.handover.slice(0, 1200) } };
    const dj = track(out.dj.track_number);
    if (dj) result.dj = { track: dj, reason: out.dj.reason.slice(0, 300) };
    const ta = track(out.battle.a.track_number), tb = track(out.battle.b.track_number);
    if (ta && tb) {
      result.battle = {
        a: { agent: AGENTS.a, track: ta, pitch: out.battle.a.pitch.slice(0, 500) },
        b: { agent: AGENTS.b, track: tb, pitch: out.battle.b.pitch.slice(0, 500) },
        exchange: out.battle.exchange.slice(0, 8).map(l => ({ speaker: l.speaker, line: l.line.slice(0, 280) }))
      };
    }
    return result;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { note: 'Analyst off duty: the Claude API key was rejected.' };
    if (e instanceof Anthropic.RateLimitError) return { note: 'Analyst off duty: Claude was busy, try again later.' };
    if (e instanceof Anthropic.APIError) return { note: `Analyst off duty: Claude API error ${e.status}.` };
    return { note: 'Analyst off duty: something went wrong.' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false }); }
  let who;
  try { who = await authorised(req); } catch (e) { return res.status(503).json({ ok: false, error: 'Database unavailable' }); }
  if (!who) return res.status(401).json({ ok: false, error: 'Not authorised' });
  if (!process.env.SHIFT_TOKEN) return res.status(500).json({ ok: false, error: 'SHIFT_TOKEN is not set' });

  const started = new Date().toISOString();
  const report = await patrol();
  let tracks = [];
  try {
    const [row] = await db('jn_site_settings?key=eq.catalogue&select=value');
    if (row && Array.isArray(row.value)) tracks = row.value.slice(0, 200);
  } catch (e) { /* no catalogue yet */ }

  const agents = await runAgents(report, tracks);
  const log = { started_at: started, finished_at: new Date().toISOString(), trigger: who, patrol: report, ...agents };

  try {
    const posted = await db('rpc/jn_post_shift', { p_token: process.env.SHIFT_TOKEN, p_log: log });
    if (!posted.ok) return res.status(500).json({ ok: false, error: posted.error || 'Could not save the shift' });
    return res.status(200).json({ ok: true, id: posted.id, status: agents.analyst ? agents.analyst.status : null, note: agents.note || null });
  } catch (e) {
    return res.status(503).json({ ok: false, error: 'Could not save the shift' });
  }
}
