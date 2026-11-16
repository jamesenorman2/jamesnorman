// The Night Shift: a crew of AI agents that works the site once a day.
//   PATROL  – fetches every page and times it (plain code, no AI needed)
//   ANALYST – writes a control-room handover from the patrol report
//   DJ      – picks a track of the day and sets up a two-agent DJ battle
//
// No database: the shift runs when the first visitor of the day asks for it,
// and Vercel's CDN keeps the result until 05:00 UTC, when the next shift starts.
// The track list is read live from the public SoundCloud feed.
//
// Environment variables (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  your Claude API key (without it, Patrol still runs)
//   SITE_URL           optional, defaults to https://www.jamesnorman.co.uk
//   SOUNDCLOUD_URL     optional, defaults to https://soundcloud.com/jamesnormal

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const SITE = (process.env.SITE_URL || 'https://www.jamesnorman.co.uk').replace(/\/$/, '');
const SOUNDCLOUD = (process.env.SOUNDCLOUD_URL || 'https://soundcloud.com/jamesnormal').replace(/\/$/, '');
const PAGES = ['/', '/visualiser/', '/music/', '/security/', '/security/layers/', '/security/cpted/',
  '/security/martyns-law/', '/night-shift/', '/site.json', '/assets/site.css', '/assets/flight.js'];
const AGENTS = { a: 'VANTAGE', b: 'LOWLIGHT' };
const SC_URL_RE = /^https:\/\/(www\.|m\.)?soundcloud\.com\/[^\s"<>]+$/;

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

const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

// Public SoundCloud podcast-style feed: find the user id on the profile page, then read the RSS.
async function soundcloudTracks() {
  try {
    const page = await (await fetch(SOUNDCLOUD, { signal: AbortSignal.timeout(8000) })).text();
    const id = (page.match(/soundcloud:\/\/users:(\d+)/) || page.match(/"urn":"soundcloud:users:(\d+)"/) || [])[1];
    if (!id) return [];
    const rss = await (await fetch(`https://feeds.soundcloud.com/users/soundcloud:users:${id}/sounds.rss`, { signal: AbortSignal.timeout(8000) })).text();
    const tracks = [];
    for (const item of rss.split('<item>').slice(1)) {
      const title = decode((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
      const url = decode((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').split('?')[0];
      if (title && SC_URL_RE.test(url)) tracks.push({ title: title.slice(0, 200), url });
      if (tracks.length >= 100) break;
    }
    return tracks;
  } catch (e) {
    return [];
  }
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
  if (!process.env.ANTHROPIC_API_KEY) return { note: 'Analyst and DJ off duty: no Claude API key is set yet.' };
  const client = new Anthropic();
  const list = tracks.length
    ? tracks.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
    : '(the track list could not be read tonight; use track_number 0 for every pick and joke that the crate is empty)';
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
    if (response.stop_reason === 'refusal') return { note: 'The analyst declined to write this report.' };
    const out = response.parsed_output;
    if (!out) return { note: 'The analyst’s report came back unreadable.' };

    const track = n => (Number.isInteger(n) && n >= 1 && n <= tracks.length) ? tracks[n - 1] : null;
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
    if (e instanceof Anthropic.RateLimitError) return { note: 'Analyst off duty: Claude was busy.' };
    if (e instanceof Anthropic.APIError) return { note: `Analyst off duty: Claude API error ${e.status}.` };
    return { note: 'Analyst off duty: something went wrong.' };
  }
}

// seconds until the next 05:00 UTC, when the next shift starts
function untilNextShift(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(60, Math.round((next - now) / 1000));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false }); }
  // only the plain URL is cached, so refuse variants that would dodge the cache and re-run the crew
  if (new URL(req.url, 'http://x').search) return res.status(400).json({ ok: false, error: 'No parameters' });

  const started = new Date();
  const [report, tracks] = await Promise.all([patrol(), soundcloudTracks()]);
  const agents = await runAgents(report, tracks);
  const shift = {
    ok: true,
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    patrol: report,
    tracks_found: tracks.length,
    ...agents
  };
  const ttl = untilNextShift(started);
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=600`);
  return res.status(200).json(shift);
}
