// AGENT LLOYD, lighting designer: studies one track properly (its sections, breaks, silences,
// builds, drops and phrasing) and writes the lighting plan for it: a lighting state for every
// section, which the homepage's light director plays phrase by phrase, plus exact hits.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { COLOURS, MOMENTS } from './rig.js';

export const SCENES = ['mounted', 'fan', 'web', 'scan', 'rgb', 'shine', 'uv', 'glow', 'contour', 'delaunay', 'fourier', 'lissajous', 'rivers', 'rest'];
export const INTENSITY = ['off', 'low', 'medium', 'high', 'peak'];

// A close reading of the loudness outline at its full resolution: SoundCloud publishes about 1,800
// points per track, so a point every ~0.2 s on a six-minute track (coarser only for long mixes).
// From it: silences, breaks, builds, drops (timed to the sample), sharp hits, section changes and phrasing.
export function analyse({ samples, height, durationMs }) {
  const secs = durationMs / 1000, n = samples.length;
  const step = secs / n;                                            // seconds per point: the outline's own resolution
  const sorted = [...samples].sort((a, b) => a - b), lo = sorted[Math.floor(n * 0.03)], hi = sorted[Math.floor(n * 0.98)] || height;
  const at = t => { const i = Math.min(n - 1, Math.floor((t / secs) * n)); return Math.max(0, Math.min(1, (samples[i] - lo) / (hi - lo || 1))); };
  const level = [];
  for (let i = 0; i < n; i++) level.push(+Math.max(0, Math.min(1, (samples[i] - lo) / (hi - lo || 1))).toFixed(2));
  const N = level.length, T = i => Math.round(i * step * 10) / 10;
  const mean = (a, b) => { a = Math.max(0, a); b = Math.min(N, b); let s = 0; for (let i = a; i < b; i++) s += level[i]; return b > a ? s / (b - a) : 0; };
  const w = Math.max(1, Math.round(6 / step));

  // silences: the outline drops to (nearly) nothing for a second or more
  const silences = []; for (let i = 0, s = -1; i <= N; i++) { const q = i < N && level[i] < 0.05; if (q && s < 0) s = i; if (!q && s >= 0) { if (T(i - s) >= 1) silences.push([T(s), T(i)]); s = -1; } }
  // breaks: clearly quieter than the surrounding minute, 6 s or longer; and the drop that ends each one
  const breaks = [], drops = [];
  for (let i = 0, s = -1; i <= N; i++) {
    const ref = i < N ? Math.max(...level.slice(Math.max(0, i - Math.round(45 / step)), i + Math.round(45 / step) + 1)) : 0;
    const q = i < N && level[i] < ref * 0.72;
    if (q && s < 0) s = i;
    if (!q && s >= 0) { if (T(i - s) >= 6) { breaks.push([T(s), T(i)]); if (i < N) { let j = i, best = -1; for (let k = Math.max(1, i - Math.round(1.5 / step)); k < Math.min(N, i + Math.round(1.5 / step)); k++) if (level[k] - level[k - 1] > best) { best = level[k] - level[k - 1]; j = k; } drops.push({ at: T(j), lift: +(mean(j, j + w) - mean(s, j)).toFixed(2) }); } } s = -1; }
  }
  // builds: the smoothed level climbing steadily for 8 s or more
  const sm = level.map((_, i) => mean(i - w, i + w + 1)), builds = [];
  for (let i = 1, s = -1; i <= N; i++) { const up = i < N && sm[i] > sm[i - 1] + 0.002; if (up && s < 0) s = i - 1; if (!up && s >= 0) { if (T(i - s) >= 8 && sm[i - 1] - sm[s] > 0.2) builds.push([T(s), T(i - 1)]); s = -1; } }
  // hits: sudden jumps in level above the last second, the sharpest ones, timed to the point
  const hits = [], one = Math.max(2, Math.round(1 / step));
  for (let i = one; i < N; i++) { const jump = level[i] - mean(i - one, i); if (jump > 0.22) hits.push({ at: T(i), jump }); }
  hits.sort((x, y) => y.jump - x.jump);
  const sharp = []; for (const h of hits) { if (sharp.every(q => Math.abs(q - h.at) >= 2)) sharp.push(h.at); if (sharp.length >= 60) break; }
  sharp.sort((x, y) => x - y);
  // section changes: the average level either side of a point differs a lot
  const changes = [];
  for (let i = w; i < N - w; i++) { const d = mean(i, i + w * 1.5) - mean(i - w * 1.5, i); if (Math.abs(d) > 0.16 && (!changes.length || T(i) - changes[changes.length - 1].at > 8)) changes.push({ at: T(i), to: d > 0 ? 'louder' : 'quieter' }); }
  // phrasing: the repeat length (8 to 64 s) at which the level's ups and downs line up best
  const diff = level.map((v, i) => (i ? v - level[i - 1] : 0));
  let phrase = 0, best = 0;
  for (let lag = Math.max(1, Math.round(8 / step)); lag <= Math.round(64 / step) && lag < N / 2; lag++) {
    let c = 0; for (let i = lag; i < N; i++) c += diff[i] * diff[i - lag];
    if (c > best * 1.05) { best = c; phrase = lag * step; }
  }
  const dynamics = +(sorted[Math.floor(n * 0.95)] - sorted[Math.floor(n * 0.2)]) / (hi - lo || 1);
  return { seconds: Math.round(secs), step: +step.toFixed(3), level, hits: sharp, silences, breaks, drops, builds, changes, phrase, dynamics: +dynamics.toFixed(2) };
}

const State = z.object({
  at: z.number(), until: z.number(),
  intensity: z.enum(INTENSITY),
  scenes: z.array(z.enum(SCENES)),
  colours: z.array(z.enum(COLOURS)),
  note: z.string()
});
const Moment = z.object({ at: z.number(), type: z.enum(MOMENTS), colour: z.enum(COLOURS), note: z.string() });
const Plan = z.object({ reading: z.string(), phrase: z.number(), states: z.array(State), moments: z.array(Moment) });

const SYSTEM = `You are Agent Lloyd, lighting designer for the music visualiser on jamesnorman.co.uk: a floating 3D landscape of white ridge lines on pure black that the music scrolls across. You have been lighting dance floors for thirty years. You are calm, meticulous and quietly obsessive: you listen to a track all the way through before you touch a fader, you count the bars, and you believe the best lighting is the cue that lands exactly on the change and the darkness you leave around it.

You are given a reading of one track's loudness at its full resolution, several points a second (from its waveform outline, so you see the shape of the music in detail, though not every individual drum): the level over time, the sharpest hits, silences, breaks, the drops that end them (with how much the level lifts), builds, section changes, an estimated phrase length and how dynamic the track is. Study it properly before you plan: where are the intros and outros, the grooves, the breakdowns, the tension and the release? Where does the track breathe? A silence is a held breath: light nothing, let it hang. A break is space: dim and slow. A build is tension: bring things in gradually. A drop is release: hit it exactly. A long groove needs variety without clutter.

Your rig (what the scenes are):
- mounted: laser beams fired straight up out of the tallest peaks of the waveform, scissoring, riding the peaks.
- fan: a sweeping fan of laser beams out of the landscape.
- web: a cage of laser beams strung between the peaks, gliding from peak to peak on every kick.
- scan: one ridge line lit as a laser, sweeping through the landscape once a bar.
- rgb: the laser fan chasing round the whole colour wheel. Special.
- shine: soft coloured light shining up out of the tallest peaks.
- uv: blacklight: the white lines turn UV violet for a few seconds. Hypnotic.
- glow: a red light that blooms out of the landscape.
- contour: the landscape becomes a topographic map: contour lines at four heights, blue low to red high, stepping up the mountains one notch per beat. Hypnotic; breakdowns and deep grooves.
- delaunay: the tallest peaks joined by a Delaunay triangulation, re-triangulating on every beat as peaks rise and fall, the new edges flaring. A cleverer laser web; drops and driving sections.
- fourier: a chain of spinning circles (a Fourier series) tracing one ridge line, one sweep every two bars, sharpening as more harmonics join over the scene. Builds and melodic passages.
- lissajous: a 3D Lissajous knot hanging over a peak with a beam up to it, turning with the tempo and retying into a new shape every four bars. Special; the top of a build or a big melodic moment.
- rivers: dashes of light running downhill along the steepest descent from every peak into the valleys, faster when the music is louder. Rolling grooves.
- rest: nothing. Darkness is a scene too.
Always on underneath: slow red and blue pools of light under the landscape, which follow the loudness by themselves.

Write the plan:
- reading: your reading of the track in two or three sentences (structure, energy, where it peaks, what it needs). Plain and specific.
- phrase: the phrase length in seconds you will light to (usually 16 or 32 beats; use the estimate unless the structure tells you otherwise; 6 to 40).
- states: lighting states that cover the whole track in order, from 0 to the end, without gaps or overlaps, with boundaries on the section changes, break starts and drops. Typically 8 to 30 (more for long mixes). For each: intensity (off: nothing at all; low: an occasional single scene with space around it; medium: a scene most phrases; high: a scene every phrase; peak: every phrase, the busiest the rig gets), the scenes it may use (in the order you want them to rotate; 1 to 5), its colours (1 to 3; avoid "none"; keep a palette per section and change it at the big moments; red, violet and cyan suit the moody stretches, amber and green the lifts), and a note: what you are doing and why, under 80 characters, in your voice (e.g. "Breakdown. Strip it to the red and let it breathe", "Second drop. Everything, on the one").
  Silences and the quietest breaks are off or low. Builds rise through the intensities. Drops are high or peak. Do not light everything at peak: contrast is the point. rgb, uv and lissajous are rare treats; the geometry scenes (contour, delaunay, fourier, lissajous, rivers) are your signature, use them where the music is most intricate, one at a time, and let them breathe.
- moments: exact hits, timed to a tenth of a second (the outline is fine enough for that: use the drop and hit times you are given), chosen from: ${MOMENTS.join(', ')}. Put them on the drops (on the exact second the break ends), the tops of builds, and the biggest changes. Strobe only on the single biggest drop after a long break, if at all. fog (the smoke machine) two or three times at most, ideally rolling in during a build so the drop's lasers cut through it. A few to twenty depending on length; never two within 8 seconds. Colour where it applies, otherwise "none"; and a note in your voice under 80 characters.`;

export async function light(track, outline, previous) {
  const f = analyse(outline);
  const client = new Anthropic();
  const prev = previous && previous.states ? `\nYour previous plan for this track (improve on it; keep what worked): phrase ${previous.phrase} s; ${previous.states.map(s => `${Math.round(s.at)}-${Math.round(s.until)} ${s.intensity} [${s.scenes.join(' ')}] ${s.colours.join('/')}`).join('; ')}` : '';
  const response = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 24000,
    output_config: { effort: 'medium', format: zodOutputFormat(Plan) },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Track: "${track.title}"
Length: ${f.seconds} s; dynamics ${f.dynamics} (0 = flat, 1 = very dynamic)
Loudness every ${f.step} s, 0 to 99: ${f.level.map(v => Math.round(v * 99)).join(',')}
Sharpest hits (seconds): ${f.hits.join(', ') || 'none'}
Silences: ${f.silences.map(s => s.join('-')).join(', ') || 'none'}
Breaks: ${f.breaks.map(s => s.join('-')).join(', ') || 'none'}
Drops (second, lift): ${f.drops.map(d => `${d.at} (+${d.lift})`).join(', ') || 'none'}
Builds: ${f.builds.map(s => s.join('-')).join(', ') || 'none'}
Section changes: ${f.changes.map(c => `${c.at} ${c.to}`).join(', ') || 'none'}
Estimated phrase: ${f.phrase || 'unclear'} s${prev}` }]
  });
  const out = response.parsed_output;
  if (response.stop_reason === 'refusal' || !out) return null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  const states = out.states
    .map(s => ({ at: clamp(s.at, 0, f.seconds), until: clamp(s.until, 0, f.seconds), intensity: s.intensity,
      scenes: s.scenes.filter(x => SCENES.includes(x)).slice(0, 5), colours: s.colours.filter(c => c !== 'none').slice(0, 3), note: String(s.note).slice(0, 90) }))
    .filter(s => s.until > s.at && s.scenes.length)
    .sort((a, b) => a.at - b.at).slice(0, 80);
  const moments = (out.moments || [])
    .map(m => ({ at: Math.round(clamp(m.at, 0, f.seconds) * 10) / 10, type: m.type, colour: m.colour, note: String(m.note).slice(0, 90), by: 'Agent Lloyd' }))
    .filter(m => MOMENTS.includes(m.type)).sort((a, b) => a.at - b.at)
    .filter((m, i, a) => !i || m.at - a[i - 1].at >= 8).slice(0, 60);
  return { reading: String(out.reading).slice(0, 400), phrase: clamp(out.phrase || f.phrase || 16, 6, 40), states, moments };
}
