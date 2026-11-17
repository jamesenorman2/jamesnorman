// AGENT PICKLE, the choreographer: writes a cue sheet for one SoundCloud track, a bit like a
// MIDI file for the visuals. It reads the track's published loudness outline, finds the
// sections (builds, breaks, drops), and asks Claude to choreograph the visualiser against them.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const UA = 'jamesnorman.co.uk night shift';
export const LOOKS = ['plain', 'colour-line', 'colour-wash', 'sparse', 'mirror', 'freeze', 'spikes', 'scanner'];
export const COLOURS = ['none', 'red', 'amber', 'cyan', 'violet', 'green'];
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
const Score = z.object({ mood: z.string(), cues: z.array(Cue) });

const SYSTEM = `You are Agent Pickle, choreographer for a music visualiser on jamesnorman.co.uk: a floating rectangle of white ridge lines (like the Unknown Pleasures cover) that the music scrolls across, in 3D, with a camera that can fly far out, orbit, ride along the surface, go underneath, or come in close. The rectangle can curl up like a wave (curl 0 to 1; 1 = half a tube) and twist (-1 to 1).

Write a cue sheet for one track from its loudness outline. Rules:
- Cues run in order, cover the whole track from 0 to its end, and don't overlap. Typically 12 to 40 cues; long DJ mixes can have up to 60.
- Follow the structure: breaks (quiet stretches) are space and stillness: far or orbit shots, "sparse", "freeze" or "plain", little curl. Drops (the moment after a break ends) are the payoff: a short punchy cue with "spikes", "scanner" or a colour, ride or close shots, more curl and twist. Builds (rising loudness) can ride and climb (curl rising).
- Colour is rare and precious: about one cue in five at most, never two coloured cues in a row, white the rest of the time. Pick colours that suit the moment.
- Looks: plain = white lines; colour-line = one line in colour sweeping through; colour-wash = every few lines tinted; sparse = only some lines; mirror = left and right mirror each other; freeze = the lines stop moving while the camera moves; spikes = jagged, spiky peaks; scanner = a bright band sweeping along the rectangle.
- Keep "note" to a few words describing the moment (e.g. "first drop", "long break, floating").
- mood: a few words summing up the track.`;

export async function choreograph(track) {
  const outline = await trackOutline(track.url, track.durationMs);
  if (!outline) return { ok: false, error: 'no waveform' };
  const f = features(outline);
  const client = new Anthropic();
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
      curl: clamp(c.curl, -0.6, 1), twist: clamp(c.twist, -1, 1), note: String(c.note).slice(0, 60) }))
    .filter(c => c.until > c.at)
    .sort((a, b) => a.at - b.at)
    .slice(0, 80);
  if (!cues.length) return { ok: false, error: 'empty score' };
  return { ok: true, score: { by: 'Agent Pickle', mood: String(response.parsed_output.mood).slice(0, 80), seconds: f.seconds, cues } };
}
