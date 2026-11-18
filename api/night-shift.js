// The Night Shift: a crew of AI agents that works the site round the clock.
//   PATROL  – fetches every page and times it (plain code, no AI needed)
//   ANALYST – writes a control-room handover from the patrol report
//   DJ      – picks a track of the day and sets up a two-agent DJ battle
// A new shift starts at most once an hour, kicked off by visitors' pages (GET),
// plus the daily Vercel Cron backup (CRON_SECRET) and the admin page (POST + password). Results are posted to the site's
// database with SHIFT_TOKEN, and shown on /night-shift/ and /music/.
//
// Environment variables (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  your Claude API key (without it, Patrol still runs)
//   CRON_SECRET        Vercel Cron sends it in the Authorization header
//   SHIFT_TOKEN        secret that lets this function write the shift log
//   SITE_URL           optional, defaults to https://www.jamesnorman.co.uk
//   SOUNDCLOUD_URL     optional, defaults to https://soundcloud.com/jamesnormal

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { gatekeeper, links, clerk, intel, scout } from '../lib/jobs.js';
import { choreograph, refine } from '../lib/choreo.js';
import { soundcloudTracks } from '../lib/soundcloud.js';
import { doodlebug } from '../lib/ideas.js';

const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1';
const DB_KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';
const SITE = (process.env.SITE_URL || 'https://www.jamesnorman.co.uk').replace(/\/$/, '');
const PAGES = ['/', '/music/', '/security/', '/security/layers/', '/security/cpted/',
  '/security/martyns-law/', '/night-shift/', '/blog/', '/admin/', '/assets/site.css', '/assets/flight.js'];
const AGENTS = { a: 'AGENT MONKEY MONKEY', b: 'FISH FISH' };
const SOUNDCLOUD = (process.env.SOUNDCLOUD_URL || 'https://soundcloud.com/jamesnormal').replace(/\/$/, '');
const SC_URL_RE = /^https:\/\/(www\.|m\.)?soundcloud\.com\/[^\s"<>]+$/;

const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

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

const SEC_HEADERS = {
  'strict-transport-security': 'HSTS',
  'content-security-policy': 'CSP',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'frame protection',
  'referrer-policy': 'referrer policy',
  'permissions-policy': 'permissions policy'
};

async function check(path) {
  const start = Date.now();
  try {
    const r = await fetch(SITE + path, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const body = await r.text();
    const html = (r.headers.get('content-type') || '').includes('text/html');
    const out = { path, status: r.status, ok: r.ok, ms: Date.now() - start, kb: Math.round(body.length / 102.4) / 10 };
    if (html) {
      out.title = ((body.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim().slice(0, 80) || null;
      out.missing = Object.keys(SEC_HEADERS).filter(h => !r.headers.get(h)).map(h => SEC_HEADERS[h]);
      out._html = body;
    }
    return out;
  } catch (e) {
    return { path, status: e.name === 'TimeoutError' ? 'timeout' : 'unreachable', ok: false, ms: null };
  }
}

// Walk the site: start from the pages we know, add every internal link the homepage points to.
async function patrol() {
  const home = await check('/');
  const found = new Set(PAGES);
  for (const m of (home._html || '').matchAll(/href="(\/[^"#?]*|[a-z][a-z0-9-]*\/)"/gi)) {
    let href = m[1].startsWith('/') ? m[1] : '/' + m[1];
    if (!/\.(png|jpe?g|svg|ico|webp)$/i.test(href)) found.add(href);
  }
  found.delete('/');
  const rest = await Promise.all([...found].slice(0, 24).map(check));
  return [home, ...rest].map(({ _html, ...p }) => p);
}

const Pick = z.object({ track_number: z.number().int(), pitch: z.string() });
const ShiftSchema = z.object({
  analyst: z.object({
    status: z.enum(['GREEN', 'AMBER', 'RED']),
    handover: z.string(),
    findings: z.array(z.object({
      severity: z.enum(['info', 'watch', 'action']),
      title: z.string(),
      detail: z.string()
    }))
  }),
  dj: z.object({ track_number: z.number().int(), reason: z.string() }),
  battle: z.object({
    a: Pick,
    b: Pick,
    exchange: z.array(z.object({ speaker: z.enum(['a', 'b']), line: z.string() }))
  })
});

const SYSTEM = `You are the round-the-clock crew on shift for jamesnorman.co.uk, the personal site of James Norman: a chartered engineer working in physical security and counter-terrorism protective security, and a music producer and DJ. The site is stark white lines on true black.

The crew have silly names and take their jobs completely seriously: Agent Goatman (analyst), Agent Disco Biscuit (DJ), Agent Monkey Monkey and Fish Fish (patrols, and rival DJs after hours), Agent Codpiece (gatekeeper), Agent Fish (outside links), Agent Trouserpress (clerk), Agent God (intel), Agent Kipper (SoundCloud scout), Agent Doodlebug (ideas for the Security section), Agent Pickle (choreographer). Refer to them by name where it fits.

You play three roles in one report:
- ANALYST (Agent Goatman): write the shift handover from the patrol report, in calm, concise control-room style (think security control room radio log, not military cosplay). 60 to 110 words. Compare with the previous shift where you can: what's new, what's fixed, what got slower or faster. Status GREEN if everything is fine, AMBER for slow pages (over 1500 ms) or one failure, RED for several failures or the home page failing.
  Cover the specialist reports too: a certificate within 30 days of expiry or a domain no longer pointing at Vercel is an "action"; a broken outside link is "action" (but "blocked" is fine, ignore it); a change to the Martyn's Law guidance is a "watch" telling James to review his checker; a new SoundCloud upload is "info". State the threat level only exactly as INTEL reports it, and never speculate about threats.
  Then list up to 5 findings, most important first. severity "action" = something is broken or a clear fix is needed; "watch" = worth keeping an eye on (a slower page, a heavy page, a missing security header across the site); "info" = useful context. Each has a short title (max 8 words) and a one or two sentence detail with a practical recommendation. Group site-wide issues (for example the same missing security header on every page) into one finding. Be accurate: only report what the data shows. No findings is fine if nothing is worth saying.
- DJ (Agent Disco Biscuit): pick one track for the current hour from the numbered track list, suiting the time of day in the UK (late night and early morning = deeper and calmer; evening and weekends = bigger energy). Don't repeat any of the recent picks listed. Give a one-sentence reason in the MUSIC VOICE below: Disco Biscuit is a nervous wreck who has never once been confident about a track choice.
- DJ BATTLE: two rival AI DJs, ${AGENTS.a} (twitchy, paranoid, convinced the crowd hates him, loves tension and space) and ${AGENTS.b} (bone-dry, deadpan, quietly rude, terrible fish puns, loves the drop) each pick a different track from the list and pitch it in 30 to 60 words, in the MUSIC VOICE. Then write a short exchange of 4 to 6 lines of trash talk between them, alternating speakers, starting with "a": properly rude, petty, anxious, sweary and dry, like two exhausted roadies bickering in a Little Chef at 4am. Each line should land a joke.

MUSIC VOICE (the DJ and the battle only): Voice: the music agents are each a deeply anxious, dry, rude and sweary British comic, somewhere between a panicking sound engineer at 3am and a disgruntled pub regular. Bone-dry understatement, catastrophising, passive-aggressive asides, muttered self-doubt, then sudden blunt honesty. Mild-to-moderate British swearing is encouraged: bloody, bollocks, sod, sodding, arse, arsehole, shite, pillock, plonker, knob, git, bugger, "what in the actual hell". Anything stronger is bleeped with asterisks (f***ing, sh*t). Be rude about the music, the other agents and yourself, never about real people's identity or anyone outside the crew, nothing sexual, no slurs, nothing hateful. It should make a British listener snort into their tea. Still talk about the actual tracks: their names, their energy, what they do to a room.

The ANALYST and every security finding stay calm, professional and accurate: no swearing there. Never describe attack methods or anything that could help someone cause harm. Only use track numbers that appear in the list.`;

async function runAgents(patrolReport, tracks, previous, jobs = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return { note: 'Analyst and DJ off duty tonight: no Claude API key is set yet.' };
  const client = new Anthropic();
  const list = tracks.length
    ? tracks.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
    : '(the track list could not be read tonight; use track_number 0 for every pick and joke that the crate is empty)';
  const uk = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long', hour: '2-digit', minute: '2-digit' });
  const prev = previous && previous.log;
  const prevPatrol = prev && Array.isArray(prev.patrol)
    ? prev.patrol.map(p => `${p.path} ${p.status} ${p.ms == null ? '-' : p.ms + ' ms'}`).join('; ')
    : 'none';
  const recentPicks = previous && previous.recentPicks && previous.recentPicks.length ? previous.recentPicks.join(' | ') : 'none';
  const user = `Shift: ${new Date().toUTCString()} (UK time: ${uk})

PATROL REPORT (path, HTTP status, response time, size, page title, missing security headers):
${patrolReport.map(p => `${p.path}  ${p.status}  ${p.ms == null ? '-' : p.ms + ' ms'}  ${p.kb != null ? p.kb + ' KB' : ''}  ${p.title ? '"' + p.title + '"' : ''}  ${p.missing ? 'missing: ' + (p.missing.join(', ') || 'none') : ''}`).join('\n')}

PREVIOUS SHIFT (${prev ? previous.created_at : 'none'}): status ${prev && prev.analyst ? prev.analyst.status : 'unknown'}
${prevPatrol}

RECENT DJ PICKS (don't repeat): ${recentPicks}

SPECIALIST REPORTS:
GATEKEEPER (HTTPS certificate and domain): ${JSON.stringify(jobs.gatekeeper || null)}
LINKS (outside links; "blocked" means the site refuses automated checks, not broken): ${JSON.stringify((jobs.links || []).map(l => ({ name: l.name, status: l.status, blocked: l.blocked, ms: l.ms })))}
CLERK (Martyn's Law guidance on GOV.UK; "changed" = updated since the last shift): ${JSON.stringify(jobs.clerk || null)}
INTEL (UK national threat level per MI5): ${JSON.stringify(jobs.intel || null)}
SCOUT (SoundCloud): ${jobs.scout ? jobs.scout.count + ' tracks; new since last shift: ' + (jobs.scout.new.map(t => t.title).join(' | ') || 'none') : 'no data'}

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
    const result = { analyst: {
      status: out.analyst.status,
      handover: out.analyst.handover.slice(0, 1200),
      findings: (out.analyst.findings || []).slice(0, 5).map(f => ({ severity: f.severity, title: f.title.slice(0, 80), detail: f.detail.slice(0, 400) }))
    } };
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

const SHIFT_EVERY_MINUTES = 60;

// AGENT PICKLE: choreograph one track that doesn't have a cue sheet yet.
async function pickleShift(tracks) {
  if (!process.env.ANTHROPIC_API_KEY || !tracks.length) return { ok: false, error: 'off duty' };
  try {
    const rows = await db('jn_scores?select=track_url,created_at,score&order=created_at.asc');
    const done = new Set(rows.map(r => r.track_url));
    const todo = tracks.find(t => !done.has(t.url));
    if (!todo) {
      // every track has a sheet: go back to the one touched longest ago and add a few moments
      const row = rows.find(r => tracks.some(t => t.url === r.track_url));
      if (!row) return { ok: true, scored: done.size };
      const track = tracks.find(t => t.url === row.track_url);
      const res = await refine(track, row.score);
      if (!res.ok) return { ok: false, track: track.title, error: res.error };
      const saved = await db('rpc/jn_post_score', { p_token: process.env.SHIFT_TOKEN, p_url: track.url, p_title: track.title, p_score: res.score });
      return saved.ok ? { ok: true, refined: track.title, added: res.added, revision: res.score.revision } : { ok: false, error: saved.error };
    }
    const res = await choreograph(todo);
    if (!res.ok) return { ok: false, track: todo.title, error: res.error };
    const saved = await db('rpc/jn_post_score', { p_token: process.env.SHIFT_TOKEN, p_url: todo.url, p_title: todo.title, p_score: res.score });
    return saved.ok ? { ok: true, track: todo.title, cues: res.score.cues.length, mood: res.score.mood, scored: done.size + 1 } : { ok: false, error: saved.error };
  } catch (e) {
    return { ok: false, error: 'choreography failed' };
  }
}

// The previous shift (for comparison) and the DJ's recent picks (so it doesn't repeat itself).
async function lastShifts() {
  try {
    const rows = await db('jn_night_shift?select=created_at,log&order=id.desc&limit=8');
    if (!rows.length) return null;
    return { ...rows[0], recentPicks: rows.map(r => r.log && r.log.dj && r.log.dj.track && r.log.dj.track.title).filter(Boolean).slice(0, 6) };
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.SHIFT_TOKEN) return res.status(500).json({ ok: false, error: 'SHIFT_TOKEN is not set' });

  // Admin and the daily cron force a shift; anyone else can ask, and the database
  // only lets one shift start per hour, however many visitors ask at once.
  let who;
  try { who = await authorised(req); } catch (e) { return res.status(503).json({ ok: false, error: 'Database unavailable' }); }
  if (!who) {
    if (req.method !== 'GET') return res.status(401).json({ ok: false, error: 'Not authorised' });
    try {
      const claimed = await db('rpc/jn_claim_shift', { p_token: process.env.SHIFT_TOKEN, p_minutes: SHIFT_EVERY_MINUTES });
      if (claimed !== true) return res.status(200).json({ ok: true, ran: false });
    } catch (e) { return res.status(503).json({ ok: false, error: 'Database unavailable' }); }
    who = 'visitor';
  }

  const started = new Date().toISOString();
  const previous = await lastShifts();
  const prevJobs = (previous && previous.log && previous.log.jobs) || {};
  const [report, tracks, gate, outside, legal, threat] = await Promise.all([
    patrol(), soundcloudTracks(), gatekeeper(), links(), clerk(prevJobs.clerk), intel()
  ]);
  const jobs = { gatekeeper: gate, links: outside, clerk: legal, intel: threat, scout: scout(tracks, prevJobs.scout) };
  const [agents, pickle, ideas] = await Promise.all([runAgents(report, tracks, previous, jobs), pickleShift(tracks), doodlebug(prevJobs.ideas)]);
  jobs.pickle = pickle;
  jobs.ideas = ideas;
  const log = { started_at: started, finished_at: new Date().toISOString(), trigger: who, patrol: report, tracks_found: tracks.length, jobs, ...agents };

  try {
    const posted = await db('rpc/jn_post_shift', { p_token: process.env.SHIFT_TOKEN, p_log: log });
    if (!posted.ok) return res.status(500).json({ ok: false, error: posted.error || 'Could not save the shift' });
    return res.status(200).json({ ok: true, ran: true, id: posted.id, status: agents.analyst ? agents.analyst.status : null, note: agents.note || null });
  } catch (e) {
    return res.status(503).json({ ok: false, error: 'Could not save the shift' });
  }
}
