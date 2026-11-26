// Logs every Claude call (tokens in and out) and enforces the daily token budget set on the admin page (Settings tab).
// Use tracked('agent-name') in place of new Anthropic(). If the usage log can't be reached, calls carry on (and aren't counted).
import Anthropic from '@anthropic-ai/sdk';

const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1/rpc';
const DB_KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';
const call = (fn, body) => fetch(`${DB}/${fn}`, { method: 'POST', headers: { apikey: DB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null);

let cache = { at: 0, over: false, day: new Date().getUTCDate() };
export async function overBudget() {
  const token = process.env.SHIFT_TOKEN; if (!token) return false;
  if (cache.day !== new Date().getUTCDate()) cache = { at: 0, over: false, day: new Date().getUTCDate() };   // a new UTC day: ask again
  if (cache.over) return true;                                   // once over for the day, stay over without asking again
  if (Date.now() - cache.at < 20000) return false;
  try {
    const r = await call('jn_usage_today', { p_token: token });
    cache = { at: Date.now(), over: !!(r && r.ok && r.budget > 0 && r.used >= r.budget), day: new Date().getUTCDate() };
  } catch (e) { cache.at = Date.now(); }
  return cache.over;
}

async function log(label, response) {
  try {
    const u = response && response.usage, token = process.env.SHIFT_TOKEN; if (!u || !token) return;
    const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    await call('jn_log_usage', { p_token: token, p_label: label, p_model: response.model || 'unknown', p_in: inTok, p_out: u.output_tokens || 0 });
    cache.at = 0;                                                // re-check the total on the next call
  } catch (e) { /* never break an agent over logging */ }
}

export async function tracked(label) {
  const client = new Anthropic(), m = client.messages, parse = m.parse.bind(m), stream = m.stream.bind(m);
  const guard = async () => { if (await overBudget()) throw new Error('Daily AI budget reached: the agents are paused until tomorrow (change it in Admin, Settings).'); };
  m.parse = async (...a) => { await guard(); const r = await parse(...a); await log(label, r); return r; };
  m.stream = (...a) => {
    const s = stream(...a), fm = s.finalMessage.bind(s);
    s.finalMessage = async () => { await guard(); const r = await fm(); await log(label, r); return r; };
    return s;
  };
  await guard();                                                 // stop before a call that would start (streams start straight away)
  return client;
}
