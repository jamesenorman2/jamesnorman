// Agent Oatie Man: the ideas agent. Once a day it pitches new interactive pieces for the Security section:
// small games, or moving diagrams that explain a security theory. The pitches are kept (newest first) and
// shown in the Idea Lab on /security/. It never builds or publishes code itself; James picks what gets made.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { FAST, hasAI, num } from './models.js';
import { z } from 'zod';
import { WHO } from './profile.js';

const EVERY_HOURS = num('IDEAS_EVERY_HOURS', 72), KEEP = 40;
const Idea = z.object({
  title: z.string(),
  kind: z.enum(['game', 'moving diagram', 'simulator', 'quiz']),
  theory: z.string(),          // the security idea it teaches, e.g. "Deter, detect, delay, respond"
  pitch: z.string(),           // one or two sentences: why someone would want to play with it
  how_it_works: z.string(),    // what the visitor sees and does, step by step
  takeaway: z.string(),        // what they understand afterwards
  build: z.string(),           // how it could be built on this site (canvas, SVG, plain JavaScript), and roughly how big a job
  effort: z.enum(['small', 'medium', 'large'])
});
const Pitch = z.object({ ideas: z.array(Idea), note: z.string() });

const SYSTEM = `You are Agent Oatie Man on the Night Shift crew of jamesnorman.co.uk. ${WHO} The site is stark white lines on true black, with occasional colour.

Your job: invent new interactive pieces for the Security section that make security theory click for clients, students and the curious. Each is either a small game or a moving diagram that explains one idea, built in the browser with canvas or SVG and plain JavaScript, no accounts, no data collected.

Good material: deter, detect, delay, respond and the critical detection point; defence in depth and layering; the security onion; CPTED (natural surveillance, territoriality, access control, maintenance); crime displacement and diffusion of benefits; routine activity theory and the crime triangle; rational choice and situational crime prevention's 25 techniques; hostile reconnaissance and deterrence messaging; vehicle dynamics and HVM stand-off; blast stand-off and the inverse-cube fall-off of pressure; crowd density and flow in evacuations; the insider threat; access control and tailgating; CCTV pixel density and what a camera can actually see; alarm false-alarm rates and operator fatigue; Martyn's Law duties; risk = likelihood × impact; the security-convenience trade-off; social engineering.

Rules:
- Pitch 2 or 3 ideas, each on a different theory, and never repeat or closely rework an idea already on the list you are given or a tool already on the site.
- Be specific and playful: what is on screen, what the visitor does, what moves, how it ends, why it is fun. Think in the site's style: white line drawings on black, a single accent colour at the key moment.
- Accurate theory, explained in plain UK English. Nothing that would help someone plan an attack: defensive and educational only, no operational detail about real sites, weapons or explosives.
- "build" says how it fits this site (a single page under /security/, canvas or SVG, plain JavaScript) and the main pieces of work.
- "note" is one dry line to James about today's batch.`;

// reviews: James's verdicts from the admin page, [{ idea_id, verdict: 'agree'|'disagree', note }]
export async function doodlebug(previous, reviews = []) {
  const prev = previous && Array.isArray(previous.archive) ? previous : { archive: [] };
  const due = !prev.at || Date.now() - Date.parse(prev.at) > EVERY_HOURS * 3600e3;
  if (!due) return prev;                                   // carry the list forward until the next batch is due
  if (!hasAI()) return { ...prev, ok: false, error: 'no API key, or AI is switched off' };
  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: FAST,
      max_tokens: 4000,
      output_config: { effort: 'medium', format: zodOutputFormat(Pitch) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Tools already on the site: Layers of Protection (design a site's layers and see if the response arrives before the intruder: detect, delay, respond, probability of interruption); Crime Prevention Through Environmental Design (CPTED: an editable isometric night-time street with a CPTED audit); Martyn's Law readiness checker.

Ideas already pitched (do not repeat): ${prev.archive.map(i => i.title).join(' | ') || 'none yet'}

James's verdicts so far (learn what he likes; build on agreed themes, avoid what he turned down):
${verdictLines(prev.archive, reviews) || 'none yet'}

Pitch today's ideas.` }]
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) return { ...prev, ok: false, error: 'no pitch today' };
    const at = new Date().toISOString();
    const fresh = response.parsed_output.ideas.slice(0, 3).map(i => ({
      id: at.slice(0, 10) + '-' + String(i.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40),
      title: String(i.title).slice(0, 90), kind: i.kind, theory: String(i.theory).slice(0, 120), pitch: String(i.pitch).slice(0, 400),
      how_it_works: String(i.how_it_works).slice(0, 1200), takeaway: String(i.takeaway).slice(0, 400), build: String(i.build).slice(0, 600),
      effort: i.effort, at
    }));
    return { ok: true, at, note: String(response.parsed_output.note).slice(0, 200), latest: fresh.length, archive: fresh.concat(prev.archive).slice(0, KEEP) };
  } catch (e) {
    return { ...prev, ok: false, error: e && e.status ? `API ${e.status}` : 'error' };
  }
}

function verdictLines(archive, reviews) {
  const byId = new Map((reviews || []).map(r => [r.idea_id, r]));
  return archive.filter(i => byId.has(i.id)).slice(0, 20)
    .map(i => { const r = byId.get(i.id); return `- ${r.verdict === 'agree' ? 'AGREED' : 'TURNED DOWN'}: ${i.title}${r.note ? ' (James: ' + String(r.note).slice(0, 160) + ')' : ''}`; }).join('\n');
}

// Ideas still waiting for James's verdict.
export function pendingIdeas(ideas, reviews = []) {
  const done = new Set((reviews || []).map(r => r.idea_id));
  return ((ideas && ideas.archive) || []).filter(i => i.id && !done.has(i.id));
}
