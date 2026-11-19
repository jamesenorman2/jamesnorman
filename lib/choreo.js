// AGENT MASTERPIECE, the choreographer: writes a cue sheet for one SoundCloud track, a bit like a
// MIDI file for the visuals. It reads the track's published loudness outline, finds the
// sections (builds, breaks, drops), and asks Claude to choreograph the visualiser against them.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { COLOURS, MOMENTS } from './rig.js';
import { light } from './lloyd.js';
export { COLOURS, MOMENTS };

const UA = 'jamesnorman.co.uk night shift';
export const LOOKS = ['plain', 'colour-line', 'colour-wash', 'sparse', 'mirror', 'freeze', 'spikes', 'scanner'];
export const SHOTS = ['far', 'orbit', 'ride', 'under', 'close'];

// The track's loudness outline (about 1,800 points over the whole track) and its length.
export async function trackOutline(url, knownMs) {
  const html = await (await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) })).text();
  const wave = (html.match(/"waveform_url":"(https:\\?\/\\?\/wave\.sndcdn\.com\\?\/[A-Za-z0-9_-]+_m\.(?:png|json))"/) || [])[1];
  const dur = knownMs || Number((html.match(/"full_duration":(\d+)/) || [])[1]);
  if (!wave || !dur) return null;
  const j = await (await fetch(wave.replace(/\\\//g, '/').replace(/\.png$/, '.json'), { signal: AbortSignal.timeout(8000) })).json();
  return { samples: j.samples, height: j.height || 140, durationMs: dur };
}

// Boil the outline down: a loudness value every few seconds, plus the quiet sections (breaks).
export function features({ samples, height, durationMs }) {
  const secs = durationMs / 1000, n = samples.length;
  const step = Math.max(2, Math.round(secs / 240));                 // at most ~240 points
  const sorted = [...samples].sort((a, b) => a - b), lo = sorted[Math.floor(n * 0.05)], hi = sorted[Math.floor(n * 0.98)] || height;
  const at = t => { const i = Math.min(n - 1, Math.floor((t / secs) * n)); return Math.max(0, Math.min(1, (samples[i] - lo) / (hi - lo || 1))); };
  const level = [];
  for (let t = 0; t < secs; t += step) {
    let s = 0, c = 0; for (let k = 0; k < step; k++) { if (t + k < secs) { s += at(t + k); c++; } }
    level.push(Math.round((s / c) * 100) / 100);
  }
  // breaks: stretches clearly quieter than the surrounding minute, 6 s or longer
  const breaks = []; let start = null;
  for (let i = 0; i < level.length; i++) {
    const t = i * step, around = level.slice(Math.max(0, i - Math.round(45 / step)), i + Math.round(45 / step) + 1);
    const ref = Math.max(...around), quiet = level[i] < ref * 0.72;
    if (quiet && start === null) start = t;
    if ((!quiet || i === level.length - 1) && start !== null) { if (t - start >= 6) breaks.push([start, t]); start = null; }
  }
  return { seconds: Math.round(secs), step, level, breaks };
}

const Cue = z.object({
  at: z.number(), until: z.number(),
  look: z.enum(LOOKS), colour: z.enum(COLOURS), shot: z.enum(SHOTS),
  curl: z.number(), twist: z.number(),
  note: z.string()
});
const Moment = z.object({ at: z.number(), type: z.enum(MOMENTS), colour: z.enum(COLOURS), note: z.string() });
const Score = z.object({ mood: z.string(), cues: z.array(Cue) });
const Refinement = z.object({ cue_notes: z.array(z.string()) });

const SYSTEM = `You are Agent Masterpiece, choreographer for a music visualiser on jamesnorman.co.uk: a floating rectangle of white ridge lines (like the Unknown Pleasures cover) that the music scrolls across, in 3D, with a camera that can fly far out, orbit, ride along the surface, go underneath, or come in close. The rectangle can curl up like a wave (curl 0 to 1; 1 = half a tube) and twist (-1 to 1).

Write a cue sheet for one track from its loudness outline. Rules:
- Cues run in order, cover the whole track from 0 to its end, and don't overlap. Typically 12 to 40 cues; long DJ mixes can have up to 60.
- Follow the structure: breaks (quiet stretches) are space and stillness: far or orbit shots, "sparse", "freeze" or "plain", little curl. Drops (the moment after a break ends) are the payoff: a short punchy cue with "spikes", "scanner" or a colour, ride or close shots, more curl and twist. Builds (rising loudness) can ride and climb (curl rising).
- Colour is rare and precious: about one cue in five at most, never two coloured cues in a row, white the rest of the time. Pick colours that suit the moment.
- Looks: plain = white lines; colour-line = one line in colour sweeping through; colour-wash = every few lines tinted; sparse = only some lines; mirror = left and right mirror each other; freeze = the lines stop moving while the camera moves; spikes = jagged, spiky peaks; scanner = a bright band sweeping along the rectangle.
- "note" is what you mutter at that moment, in your voice, under 80 characters, and it must still point at what is happening in the music (e.g. "Drop. Oh god. Oh GOD. Hold onto something, you pillocks", "Long break. Is it broken? Did I break it? Bloody hell", "Kick's back. Thank sod for that"). Shown on screen as the track plays.

Voice: Agent Masterpiece is a deeply anxious, dry, rude and sweary British comic, somewhere between a panicking sound engineer at 3am and a disgruntled pub regular. Bone-dry understatement, catastrophising, passive-aggressive asides, muttered self-doubt, then sudden blunt honesty. Mild-to-moderate British swearing is encouraged: bloody, bollocks, sod, sodding, arse, arsehole, shite, pillock, plonker, knob, git, bugger, "what in the actual hell". Anything stronger is bleeped with asterisks (f***ing, sh*t). Be rude about the music, the other agents and yourself, never about real people's identity or anyone outside the crew, nothing sexual, no slurs, nothing hateful. It should make a British listener snort into their tea.
- mood: a few words summing up the track.

Lighting (lasers, smoke, UV and the rest) is Agent Lloyd's department, not yours: you do the camera, the shape and the looks.`;

export async function choreograph(track) {
  const outline = await trackOutline(track.url, track.durationMs);
  if (!outline) return { ok: false, error: 'no waveform' };
  const f = features(outline);
  const client = new Anthropic();
  const lighting = light(track, outline).catch(() => null);          // Agent Lloyd lights it while Masterpiece blocks the camera
  const response = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(Score) },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Track: "${track.title}"
Length: ${f.seconds} s
Loudness every ${f.step} s (0 = quietest, 1 = loudest): ${f.level.join(',')}
Breaks found (start-end seconds): ${f.breaks.map(b => b.join('-')).join(', ') || 'none'}` }]
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return { ok: false, error: 'no score' };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  const cues = response.parsed_output.cues
    .map(c => ({ at: clamp(c.at, 0, f.seconds), until: clamp(c.until, 0, f.seconds), look: c.look, colour: c.colour, shot: c.shot,
      curl: clamp(c.curl, -0.6, 1), twist: clamp(c.twist, -1, 1), note: String(c.note).slice(0, 90) }))
    .filter(c => c.until > c.at)
    .sort((a, b) => a.at - b.at)
    .slice(0, 80);
  if (!cues.length) return { ok: false, error: 'empty score' };
  const plan = await lighting;
  return { ok: true, score: withLighting({ by: 'Agent Masterpiece', mood: String(response.parsed_output.mood).slice(0, 80), seconds: f.seconds, cues, moments: [], revision: 1 }, plan) };
}

function withLighting(score, plan) {
  if (!plan) return score;
  return { ...score, lights: 'Agent Lloyd', reading: plan.reading, phrase: plan.phrase, states: plan.states, moments: plan.moments };
}

function cleanMoments(list, seconds) {
  return (list || []).map(m => ({ at: Math.max(0, Math.min(seconds, Number(m.at) || 0)), type: m.type, colour: m.colour, note: String(m.note).slice(0, 90) }))
    .filter(m => MOMENTS.includes(m.type)).sort((a, b) => a.at - b.at).slice(0, 120);
}

// Going back over a track: add a few new moments where the choreography is thin.
export async function refine(track, score) {
  const outline = await trackOutline(track.url, track.durationMs);
  if (!outline) return { ok: false, error: 'no waveform' };
  const f = features(outline);
  const client = new Anthropic();
  const lighting = light(track, outline, score).catch(() => null);
  const response = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 8000,
    output_config: { effort: 'low', format: zodOutputFormat(Refinement) },
    system: SYSTEM,
    messages: [{ role: 'user', content: `You choreographed this track before; go back over it. Return cue_notes: a fresh note in your voice for EVERY existing cue, same order, exactly one per cue (${score.cues.length} notes).
Track: "${track.title}" (${f.seconds} s)
Loudness every ${f.step} s: ${f.level.join(',')}
Breaks: ${f.breaks.map(b => b.join('-')).join(', ') || 'none'}
Existing cues: ${score.cues.map(c => `${Math.round(c.at)}-${Math.round(c.until)} ${c.look}${c.colour !== 'none' ? '/' + c.colour : ''} ${c.note}`).join('; ')}
Existing moments: ${(score.moments || []).map(m => `${Math.round(m.at)} ${m.type}`).join(', ') || 'none'}` }]
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return { ok: false, error: 'no refinement' };
  const notes = response.parsed_output.cue_notes;
  const cues = Array.isArray(notes) && notes.length === score.cues.length ? score.cues.map((c, i) => ({ ...c, note: String(notes[i]).slice(0, 90) })) : score.cues;
  const plan = await lighting;
  const next = withLighting({ ...score, cues, revision: (score.revision || 1) + 1 }, plan);
  return { ok: true, added: plan ? plan.moments.length : 0, relit: !!plan, score: next };
}
