// The day crew: agents that each do one job once a day (or once a week) and file a report.
// Each returns { summary, ...details } or throws. api/crew.js decides who is due and saves the report.
import { tracked } from './usage.js';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { FAST, hasAI } from './models.js';
import { z } from 'zod';
import { soundcloudTracks } from './soundcloud.js';
import { webDossier } from './research.js';
import { WHO } from './profile.js';

const MODEL = FAST;
const SITE = (process.env.SITE_URL || 'https://www.jamesnorman.co.uk').replace(/\/$/, '');
const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1';
const DB_KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';
const get = (url, ms = 8000, init = {}) => fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'manual', ...init });
async function parse(system, user, schema, effort = 'low', max = 3000) {
  const who = (/You are Agent ([A-Za-z ]+?)[,.]/.exec(system) || /Agent ([A-Za-z ]+?)(?:’s|'s)/.exec(system) || [])[1] || 'crew';
  const r = await (await tracked('crew: ' + who.trim().toLowerCase())).messages.parse({ model: MODEL, max_tokens: max, output_config: { effort, format: zodOutputFormat(schema) }, system, messages: [{ role: 'user', content: user }] });
  if (r.stop_reason === 'refusal' || !r.parsed_output) throw new Error('no answer');
  return r.parsed_output;
}

// ─── Agent Harry: regulation watcher ─────────────────────────────────────
const WATCH = [
  ['Martyn’s Law', 'Terrorism (Protection of Premises) Act'],
  ['SIA', 'Security Industry Authority premises guidance'],
  ['Protective security', 'protective security counter terrorism guidance'],
  ['Building Regulations', 'Approved Document building regulations'],
  ['Crowded places', 'crowded places security guidance']
];
export async function binlid(prev) {
  const since = prev && prev.checked ? Date.parse(prev.checked) : Date.now() - 30 * 864e5;
  const found = new Map();
  for (const [area, q] of WATCH) {
    try {
      const r = await get(`https://www.gov.uk/api/search.json?q=${encodeURIComponent(q)}&order=-public_timestamp&count=8&fields=title,link,public_timestamp,description,format`);
      const d = await r.json();
      for (const x of d.results || []) {
        const t = Date.parse(x.public_timestamp);
        if (t > since && x.link && !found.has(x.link)) found.set(x.link, { area, title: x.title, url: 'https://www.gov.uk' + x.link, date: x.public_timestamp, description: x.description || '' });
      }
    } catch (e) { /* GOV.UK search unreachable for this query */ }
  }
  let items = [...found.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 12);
  if (items.length && hasAI()) {
    try {
      const out = await parse(`You are Agent Harry, the regulation watcher for James Norman. ${WHO} For each new GOV.UK item, say in one plain sentence whether it matters to his work and what it might change: his Martyn's Law readiness checker, his Security Handbook, or his clients' designs. Mark relevance high, medium or low. Be accurate: only what the title and description support.`,
        items.map((x, i) => `[${i}] ${x.area} | ${x.title} | ${x.date.slice(0, 10)} | ${x.description}`).join('\n'),
        z.object({ notes: z.array(z.object({ index: z.number().int(), relevance: z.enum(['high', 'medium', 'low']), impact: z.string() })) }));
      for (const n of out.notes) if (items[n.index]) Object.assign(items[n.index], { relevance: n.relevance, impact: String(n.impact).slice(0, 300) });
    } catch (e) { /* notes are optional */ }
  }
  items = items.filter(x => x.relevance !== 'low');
  const high = items.filter(x => x.relevance === 'high').length;
  return { checked: new Date().toISOString(), items, summary: items.length ? `${items.length} new on GOV.UK${high ? `, ${high} that matter` : ''}` : 'Nothing new on GOV.UK' };
}

// ─── Agent Abnormal: SoundCloud stats ───────────────────────────────────
function counts(html, url) {
  const slug = url.replace(/^https:\/\/(www\.|m\.)?soundcloud\.com/, '');
  let i = html.indexOf(`"permalink_url":"https://soundcloud.com${slug}"`);
  if (i < 0) i = 0;
  const win = html.slice(Math.max(0, i - 4000), i + 4000);
  const n = k => { const m = win.match(new RegExp(`"${k}":(\\d+)`)); return m ? Number(m[1]) : null; };
  return { plays: n('playback_count'), likes: n('likes_count'), reposts: n('reposts_count'), comments: n('comment_count') };
}
export async function biscuittin(prev) {
  const tracks = await soundcloudTracks();
  const snap = [];
  for (const t of tracks.slice(0, 30)) {
    try { snap.push({ title: t.title, url: t.url, ...counts(await (await get(t.url)).text(), t.url) }); }
    catch (e) { snap.push({ title: t.title, url: t.url }); }
  }
  const before = new Map(((prev && prev.tracks) || []).map(t => [t.url, t]));
  for (const t of snap) { const b = before.get(t.url); t.new_plays = b && t.plays != null && b.plays != null ? t.plays - b.plays : null; }
  const total = snap.reduce((a, t) => a + (t.plays || 0), 0), gained = snap.reduce((a, t) => a + (t.new_plays || 0), 0);
  const climbing = snap.filter(t => t.new_plays > 0).sort((a, b) => b.new_plays - a.new_plays).slice(0, 3);
  return { tracks: snap, total_plays: total, gained, climbing: climbing.map(t => t.title),
    summary: `${total.toLocaleString('en-GB')} plays across ${snap.length} tracks` + (prev && prev.tracks ? ` · +${gained} since yesterday` : '') + (climbing[0] ? ` · climbing: ${climbing[0].title}` : '') };
}

// ─── Agent Old School: crate digger (weekly) ───────────────────────────────────
const Digs = z.object({ sound: z.string(), picks: z.array(z.object({ artist: z.string(), title: z.string(), label: z.string(), released: z.string(), url: z.string(), why: z.string(), mix_with: z.string() })) });
export async function wurzel(prev) {
  const tracks = await soundcloudTracks();
  const client = await tracked('crew: old school');
  const dossier = await webDossier(client, `You are Agent Old School, crate digger for James Norman, a UK producer and DJ (SoundCloud: https://soundcloud.com/jamesnormal). His uploads: ${tracks.map(t => t.title).join(' | ')}.
1. Work out his sound: look at his SoundCloud profile, the events and stages he plays (the titles name them) and what those events book.
2. Find 6 to 8 genuinely new releases (out in the last 3 weeks, or due within a week) that would fit his sets. Prefer smaller labels and underplayed artists over obvious chart picks. For each: artist, title, label, release date, a link (label, Bandcamp, Beatport, Juno or similar), why it fits, and which of his own sets it would sit in.
Previous digs (do not repeat): ${((prev && prev.picks) || []).map(p => p.artist + ' – ' + p.title).join(' | ') || 'none'}`, 10);
  const ok = new Set(dossier.sources.map(s => s.url));
  const out = await parse(`Turn Agent Old School's research into a crate. Only use links that appear in the sources list. "sound" is one sentence describing James's sound. "why" is one or two sentences, in Old School's voice: a dry, slightly anxious, mildly sweary British record-shop lifer. "mix_with" names one of his uploads.`,
    `${dossier.text}\n\nSOURCES:\n${dossier.sources.map(s => s.url).join('\n')}`, Digs, 'medium', 8000);
  const picks = out.picks.filter(p => ok.has(p.url)).slice(0, 8);
  return { sound: String(out.sound).slice(0, 300), picks, summary: `${picks.length} new records dug up this week` };
}

// ─── Agent Mr. Particular: own-site attack-surface check ──────────────────────────
export async function teacake() {
  const f = [];
  const add = (severity, title, detail) => f.push({ severity, title, detail });
  // 1. files that should never be public
  for (const path of ['/.env', '/.env.local', '/.git/config', '/.git/HEAD', '/.vercel/project.json']) {
    try { const r = await get(SITE + path); if (r.status === 200) add('action', `${path} is publicly readable`, 'Block it in vercel.json or remove it from the deployment.'); } catch (e) { /* unreachable is fine */ }
  }
  for (const path of ['/package.json', '/lib/research.js', '/api/night-shift.js']) {
    try { const r = await get(SITE + path); if (r.status === 200) add('watch', `Source file ${path} is served`, 'No secrets are in it, but serving server code helps reconnaissance. Consider blocking /lib/ and dotfiles with a redirect or a .vercelignore.'); } catch (e) { /* fine */ }
  }
  // 2. the public database key must not be able to write
  try {
    const r = await get(`${DB}/jn_site_settings`, 8000, { method: 'POST', headers: { apikey: DB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'teacake_probe', value: {} }) });
    if (r.ok) add('action', 'Public key can write site settings', 'Row-level security is not blocking inserts on jn_site_settings. Fix the policy now.');
  } catch (e) { /* fine */ }
  try {
    const r = await get(`${DB}/rpc/jn_post_shift`, 8000, { method: 'POST', headers: { apikey: DB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: 'teacake-probe', p_log: {} }) });
    const d = await r.json().catch(() => ({}));
    if (d && d.ok) add('action', 'Shift log accepts a fake token', 'jn_post_shift accepted an invalid token.');
  } catch (e) { /* fine */ }
  // 3. the waveform proxy must refuse other hosts (no open proxy / SSRF)
  try { const r = await get(`${SITE}/api/waveform?wave=${encodeURIComponent('https://example.com/x_m.json')}`); if (r.status === 200) add('action', 'Waveform proxy fetches other hosts', 'It should only accept wave.sndcdn.com addresses.'); } catch (e) { /* fine */ }
  // 4. security headers on the homepage
  let html = '';
  try {
    const r = await get(SITE + '/'); html = await r.text();
    const h = k => r.headers.get(k);
    if (!h('strict-transport-security')) add('watch', 'No HSTS header', 'Add Strict-Transport-Security in vercel.json.');
    if (!h('content-security-policy')) add('watch', 'No Content-Security-Policy', 'A CSP limiting scripts to the site, SoundCloud and the CDNs would contain any injected script.');
    if (!h('x-frame-options') && !(h('content-security-policy') || '').includes('frame-ancestors')) add('watch', 'Pages can be framed', 'Add X-Frame-Options or frame-ancestors.');
  } catch (e) { add('watch', 'Homepage unreachable', 'Mr. Particular could not load the homepage.'); }
  // 5. photosensitivity: the strobe must stay at or under 3 flashes a second, and respect reduced motion
  if (html) {
    const m = html.match(/\[(\d+),\s*(\d+),\s*(\d+)\]\.forEach\(t => \{\s*setTimeout\(\(\) => \{ root\.style\.filter = 'invert\(1\)'/);
    if (m) { const gap = Number(m[2]) - Number(m[1]); if (gap < 334) add('action', 'Strobe faster than 3 flashes a second', `Flashes are ${gap} ms apart; keep them at least 334 ms apart.`); }
    else add('info', 'Strobe timing not found', 'Mr. Particular could not read the strobe timing from the homepage; check it by hand.');
    if (!/prefers-reduced-motion/.test(html)) add('action', 'Reduced motion ignored', 'The homepage should switch the strobe off for visitors who ask for reduced motion.');
  }
  const worst = f.some(x => x.severity === 'action') ? 'action' : f.some(x => x.severity === 'watch') ? 'watch' : 'clear';
  return { findings: f, worst, summary: f.length ? `${f.filter(x => x.severity === 'action').length} actions, ${f.filter(x => x.severity === 'watch').length} to watch` : 'All probes held' };
}

// ─── Agent Snoopy: visitor analyst ─────────────────────────────────────────
export async function pigeon(prev, token) {
  const r = await get(`${DB}/rpc/jn_view_stats`, 8000, { method: 'POST', headers: { apikey: DB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: token, p_days: 7 }) });
  if (!r.ok) throw new Error('stats unavailable');
  const stats = await r.json();
  if (!stats || !stats.ok) throw new Error('stats refused');
  let suggestions = [];
  if (hasAI() && stats.total) {
    const out = await parse(`You are Agent Snoopy, who reads the visitor numbers for jamesnorman.co.uk (a security consultant, producer and DJ's site: a music visualiser homepage, security tools, a blog, an agents page). From last week's counts, give 3 concrete, specific suggestions to improve the site, each tied to a number in the data. No invented numbers. Dry and brief.`,
      JSON.stringify(stats), z.object({ suggestions: z.array(z.object({ title: z.string(), detail: z.string() })) }));
    suggestions = out.suggestions.slice(0, 3);
  }
  return { stats, suggestions, summary: `${(stats.total || 0).toLocaleString('en-GB')} page views this week` + (stats.mobile_share != null ? ` · ${Math.round(stats.mobile_share * 100)}% on phones` : '') };
}

// ─── Agent Quizzy Rascal: question of the day ─────────────────────────────────────
const Question = z.object({ topic: z.string(), question: z.string(), options: z.array(z.string()), answer_index: z.number().int(), explanation: z.string(), linkedin_post: z.string() });
export async function bunsen(prev) {
  const used = ((prev && prev.past) || []).slice(0, 30);
  const q = await parse(`You are Agent Quizzy Rascal. Write one multiple-choice question a day on physical and protective security for jamesnorman.co.uk: practical, the kind a security consultant, architect or venue manager should be able to answer. Topics: detect-delay-respond, CPTED, hostile vehicle mitigation and stand-off, blast, access control, CCTV image quality, intruder detection, control rooms, Martyn's Law duties, crowded places, risk assessment, insider threat. Exactly 4 options, one clearly right, the others plausible. Accurate UK practice; no operational detail that would help an attacker. "explanation": 2 or 3 sentences on why the answer is right. "linkedin_post": a short ready-to-paste LinkedIn post (under 120 words) posing the question, inviting answers, in James's voice (${WHO.split('.')[0]}), without the answer.`,
    `Questions already asked (do not repeat): ${used.map(u => u.question).join(' | ') || 'none'}`, Question, 'medium');
  if (q.options.length !== 4 || q.answer_index < 0 || q.answer_index > 3) throw new Error('malformed question');
  const id = new Date().toISOString().slice(0, 10);
  return { id, topic: String(q.topic).slice(0, 60), question: String(q.question).slice(0, 400), options: q.options.map(o => String(o).slice(0, 200)),
    secret: { answer_index: q.answer_index, explanation: String(q.explanation).slice(0, 800) }, linkedin_post: String(q.linkedin_post).slice(0, 1200),
    past: [{ id, question: q.question }].concat(used), summary: `Today: ${String(q.question).slice(0, 90)}` };
}

// Who works when (hours between runs), and what each needs.
export const CREW = {
  binlid: { every: 20, run: binlid },
  biscuittin: { every: 20, run: biscuittin },
  teacake: { every: 20, run: teacake },
  pigeon: { every: 20, run: pigeon, needsToken: true },
  bunsen: { every: 20, run: bunsen, ai: true },
  wurzel: { every: 160, run: wurzel, ai: true }
};
