// The research desk: agents read the news on James's interests and write the blog.
//   1. AGENT GCHQ (incident desk) goes first: terrorism incidents worldwide in the last week, with the
//      modus operandi and the facts as reported by authorities and reputable outlets.
//   2. The desk covers security, AI, AI agents and music production.
//   3. One agent writes a long-form blog post on the most interesting thing found, with sources.
// Step 1 uses Claude with web search (free text, cited). Step 2 turns that dossier into structured
// briefs and the post (structured output can't be combined with web-search citations, hence two calls).

import { tracked } from './usage.js';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { WRITER, hasAI } from './models.js';
import { z } from 'zod';
import { WHO } from './profile.js';

const MODEL = WRITER;
export const TOPICS = ['terrorism', 'security', 'ai', 'ai-agents', 'music-production'];
export const WRITERS = {
  terrorism: 'Agent GCHQ', security: 'Agent Codpiece', ai: 'Agent Frankie',
  'ai-agents': 'Agent Monkey Monkey', 'music-production': 'Agent Normal'
};

const RESEARCH_BRIEF = (today, recent, weekly = true) => `Today is ${today}. You are the research desk for the AI agents behind jamesnorman.co.uk.
${WHO}

Search the web and build a research dossier, in this order of priority:

${weekly ? '1. TERRORISM INCIDENTS (do this first and most thoroughly). Find terrorist attacks, foiled plots and significant terrorism prosecutions reported in the last 7 days, worldwide, with any UK incidents first. For each one give: date; place; what happened, as reported; the modus operandi in counter-terrorism terms (attack method such as vehicle as a weapon, bladed weapon, firearms, IED, arson, hostage-taking; target type such as crowded place, transport, place of worship; how the attack was carried out at the level reported in the news; how it was stopped); casualties as officially reported; status (investigation, charges, which agency leads); and the attribution only as stated by the authorities. Report facts only, from official statements and reputable outlets; mark anything unconfirmed as unconfirmed. Do not name victims. Do not speculate. Do not include anything that would help someone carry out an attack (no construction or tactical detail beyond what is needed to name the method). If nothing qualifies, say so plainly.' : '1. (Terrorism incidents are covered once a week by Agent GCHQ: do not search for them today.)'}
2. SECURITY: notable developments in protective security, counter-terrorism policy, Martyn's Law / the Terrorism (Protection of Premises) Act implementation, crowded places, physical security technology.
3. AI: the most significant developments of the week.
4. AI AGENTS: agentic AI developments, research and real deployments.
5. MUSIC PRODUCTION: production techniques, tools, gear, plugins, and AI in music.

For every item, record the source URL and publication date. Prefer primary and reputable sources. Skip anything older than 14 days unless it is essential context.
Finally, note the one finding you think is the most genuinely interesting story of the week for James, and why.
${recent ? `\nRecent blog posts (pick a different angle): ${recent}` : ''}`;

const Source = z.object({ title: z.string(), url: z.string() });
const Incident = z.object({
  date: z.string(), location: z.string(), country: z.string(),
  mo: z.string(),               // short label, e.g. "Vehicle as a weapon"
  target: z.string(),
  summary: z.string(), modus_operandi: z.string(), casualties: z.string(), status: z.string(),
  confirmed: z.boolean(), sources: z.array(Source)
});
const Brief = z.object({ topic: z.enum(TOPICS), headline: z.string(), summary: z.string(), why_it_matters: z.string(), sources: z.array(Source) });
const Post = z.object({
  topic: z.enum(TOPICS), title: z.string(), dek: z.string(),
  body: z.string(),              // markdown: ## headings, paragraphs, **bold**, *italic*, [links](https://...), - lists, > quotes
  sources: z.array(Source)
});
const Desk = z.object({ incidents: z.array(Incident), briefs: z.array(Brief), post: Post });

const WRITE_BRIEF = `You are the editor of "Night Shift Notes", the blog written by the AI agents on jamesnorman.co.uk.
From the research dossier, produce:
- incidents: every terrorism incident in the dossier, most recent first, facts only, with sources. "mo" is a short label (e.g. "Vehicle as a weapon", "Bladed weapon", "IED", "Firearms", "Arson", "Foiled plot"). Set confirmed=false where the dossier marks something unconfirmed. Do not name victims. No tactical or construction detail.
- briefs: 1 to 3 short briefs per other topic (security, ai, ai-agents, music-production), each with sources from the dossier.
- post: ONE long-form blog post (700 to 1100 words) on the most interesting story in the dossier.

How to write the post so it is genuinely good:
- Lead with the story, not with throat-clearing. The first paragraph should make a security professional or a producer want to keep reading.
- Have an argument. Explain what happened, why it matters, and what most coverage missed. Make connections across James's worlds where they are real (for example: how an attack's MO maps onto detect-delay-respond and Martyn's Law duties; how agentic AI changes threat or defence; what a new production technique teaches about signal and noise). Don't force a connection that isn't there.
- Be concrete: names of organisations, numbers, dates, mechanisms. Every factual claim must come from the dossier, and link the source inline as [text](url).
- If the post is about a terrorism incident: be sober and respectful, facts as reported, analyse the MO and the protective-security lessons at the level a practitioner would discuss publicly, never anything operationally useful to an attacker, and never sensational.
- UK English. No hype words ("game-changer", "revolutionary"), no listicle filler, no "in conclusion". Short paragraphs, 2 to 4 "## " subheadings, end on a sharp point or open question.
- The dek is one sentence that sells the post.
- Only use URLs that appear in the dossier.`;

// Web research with Claude's web search: returns the dossier text plus every source the searches found.
export async function webDossier(client, prompt, maxUses = 8) {
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }];
  const messages = [{ role: 'user', content: prompt }];
  let response;
  for (let i = 0; i < 4; i++) {
    response = await client.messages.stream({
      model: MODEL, max_tokens: 12000, output_config: { effort: 'low' }, tools, messages
    }).finalMessage();
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });   // the server resumes where it left off
  }
  if (response.stop_reason === 'refusal') return null;
  // the dossier text, plus every source the searches found (so the writer can only cite real URLs)
  const all = messages.slice(1).flatMap(m => m.content).concat(response.content);
  const text = all.filter(b => b.type === 'text').map(b => b.text).join('');
  const found = new Map();
  for (const b of all) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
      for (const r of b.content) if (r.url) found.set(r.url, r.title || r.url);
    if (b.type === 'text' && Array.isArray(b.citations))
      for (const c of b.citations) if (c.url) found.set(c.url, c.title || c.url);
  }
  return { text, sources: [...found].map(([url, title]) => ({ url, title })) };
}

const cleanUrl = (u, ok) => /^https:\/\/[^\s"<>]+$/.test(u) && ok.has(u);

export async function runDesk({ today, recent, weekly = true, previousIncidents = [] }) {
  if (!hasAI()) return { ok: false, error: 'no API key, or AI is switched off' };
  const client = await tracked('research desk');
  const dossier = await webDossier(client, RESEARCH_BRIEF(today, recent, weekly));
  if (!dossier || !dossier.text.trim()) return { ok: false, error: 'research came back empty' };

  const response = await client.messages.parse({
    model: MODEL, max_tokens: 14000,
    output_config: { effort: 'medium', format: zodOutputFormat(Desk) },
    system: WRITE_BRIEF,
    messages: [{ role: 'user', content: `Today is ${today}.${weekly ? '' : ' Terrorism incidents are not part of today\'s desk (they are refreshed weekly): return an empty incidents list, and do not write the post about a terrorism incident.'}\n\nRESEARCH DOSSIER:\n${dossier.text}\n\nSOURCES FOUND:\n${dossier.sources.map(s => `- ${s.title}: ${s.url}`).join('\n')}` }]
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return { ok: false, error: 'the writer declined' };
  const out = response.parsed_output;

  // Keep only sources the searches really returned; strip inline links that point anywhere else.
  const ok = new Set(dossier.sources.map(s => s.url));
  const srcs = list => (list || []).filter(s => cleanUrl(s.url, ok)).slice(0, 8);
  const body = String(out.post.body).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => cleanUrl(u, ok) ? m : t).slice(0, 20000);
  const post = {
    topic: out.post.topic, title: String(out.post.title).slice(0, 160), dek: String(out.post.dek).slice(0, 300),
    author: WRITERS[out.post.topic] || 'Agent Fish', body, sources: srcs(out.post.sources)
  };
  // GCHQ's incident round-up is weekly: on other days the last round-up is carried forward unchanged
  const incidents = weekly ? out.incidents.slice(0, 20).map(i => ({ ...i, sources: srcs(i.sources) })) : (previousIncidents || []).slice(0, 20);
  const briefs = out.briefs.slice(0, 14).map(b => ({ ...b, author: WRITERS[b.topic], sources: srcs(b.sources) }));

  // Agent Blog-head, the editor, reads everything before it goes out.
  const grumble = await editorCheck(client, dossier, post, weekly ? incidents : []);
  if (grumble.ok) {
    if (grumble.post_body) post.body = grumble.post_body.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => cleanUrl(u, ok) ? m : t);
    if (grumble.post_title) post.title = grumble.post_title;
    if (weekly) for (const fix of grumble.incident_fixes) if (incidents[fix.index]) {
      if (fix.drop) incidents[fix.index] = null;
      else { if (fix.summary) incidents[fix.index].summary = fix.summary; if (fix.modus_operandi) incidents[fix.index].modus_operandi = fix.modus_operandi; }
    }
  }
  const publish = !grumble.ok || grumble.verdict !== 'hold';
  return { ok: true, post: publish ? post : null, held: publish ? null : post, incidents: incidents.filter(Boolean), briefs, searched: dossier.sources.length,
    grumble: { ok: grumble.ok, verdict: grumble.verdict || 'unchecked', changes: grumble.changes || [], note: grumble.note || grumble.error || '' } };
}

// ─── Agent Blog-head: grumpy, pedantic, essential ───────────────────────────
const Review = z.object({
  verdict: z.enum(['publish', 'hold']),
  post_title: z.string(),            // corrected title, or the same title
  post_body: z.string(),             // corrected body (markdown), or the same body
  incident_fixes: z.array(z.object({ index: z.number().int(), drop: z.boolean(), summary: z.string(), modus_operandi: z.string() })),
  changes: z.array(z.string()),      // one line per change made, plain English
  note: z.string()                   // one grumpy line for the Agents page
});
const EDITOR = `You are Agent Blog-head, the editor on jamesnorman.co.uk: grumpy, pedantic and essential. Before anything the research desk wrote is published, you check it against the research dossier it came from.
- Every factual claim (names of organisations, numbers, dates, casualty figures, attributions) must be supported by the dossier. Fix or remove anything that is not.
- Remove the names of private individuals, victims and anyone not officially named; remove details that identify a sensitive site's security arrangements.
- Terrorism coverage must be sober: no sensational or loaded wording, no speculation, attributions only as stated by authorities, nothing operationally useful to an attacker.
- Keep links only where the dossier supports them. Keep the writer's voice and argument; edit, don't rewrite for the sake of it.
- verdict "hold" only if the post cannot be fixed (its central claim is unsupported, or it is about something that should not be published). Otherwise "publish" with your corrected text.
- incident_fixes: one entry per incident you change (by index); drop=true to remove an unsupported or unconfirmable incident; otherwise give corrected summary and modus_operandi (repeat the original if unchanged).
- changes: list what you changed, briefly. note: one dry, grumpy line about today's copy.`;

async function editorCheck(client, dossier, post, incidents) {
  try {
    const response = await client.messages.parse({
      model: MODEL, max_tokens: 6000,
      output_config: { effort: 'low', format: zodOutputFormat(Review) },
      system: EDITOR,
      messages: [{ role: 'user', content: `DOSSIER:\n${dossier.text}\n\nPOST TITLE: ${post.title}\nPOST BODY:\n${post.body}\n\nINCIDENTS:\n${incidents.map((i, k) => `[${k}] ${i.date} ${i.location}: ${i.summary} | MO: ${i.modus_operandi} | ${i.casualties} | ${i.status}`).join('\n') || 'none'}` }]
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) return { ok: false, error: 'Blog-head declined to review' };
    const r = response.parsed_output;
    return { ok: true, verdict: r.verdict, post_title: String(r.post_title).slice(0, 160), post_body: String(r.post_body).slice(0, 20000),
      incident_fixes: r.incident_fixes || [], changes: (r.changes || []).slice(0, 12).map(c => String(c).slice(0, 200)), note: String(r.note).slice(0, 200) };
  } catch (e) { return { ok: false, error: 'Blog-head unavailable: ' + (e && e.status ? 'API ' + e.status : 'error') }; }
}
