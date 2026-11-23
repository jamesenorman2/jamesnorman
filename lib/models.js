// Which Claude model each job uses, and the switches that keep the API bill small. All of it can be changed in the Vercel
// environment variables without touching the code:
//   CLAUDE_MODEL_FAST    the everyday jobs (shift analyst, light and camera cue sheets, ideas, day crew). Default: Haiku 5.5, the cheapest.
//   CLAUDE_MODEL_WRITER  the research desk's blog post (needs the best writing). Default: Sonnet 5.5.
//   AI_OFF=1             emergency stop: nothing calls Claude at all (the site carries on, the agents just say they are off duty)
//   SHIFT_EVERY_MINUTES  how often the night shift can run (default 360 = every 6 hours)
//   DESK_EVERY_HOURS     how often the research desk writes a post (default 24)
//   IDEAS_EVERY_HOURS    how often Oatie Man pitches ideas (default 72)
//   REFINE_TRACKS=1      let the choreographers keep re-working tracks that already have a cue sheet (off by default: it never ends)
export const FAST = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-5-5';
export const WRITER = process.env.CLAUDE_MODEL_WRITER || 'claude-sonnet-5-5';
export const hasAI = () => !!process.env.ANTHROPIC_API_KEY && process.env.AI_OFF !== '1';
export const num = (name, fallback) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };
