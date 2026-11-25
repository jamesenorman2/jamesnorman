// The on/off switches for the agent processes, set on the admin page and kept with the other Stick men settings
// (jn_site_settings, key "stickmen", field "switches"). A switch is only ever off when it has been set to false.
const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1';
const DB_KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';

export async function switchedOff(key) {
  try {
    const r = await fetch(`${DB}/jn_site_settings?key=eq.stickmen&select=value`, { headers: { apikey: DB_KEY }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const [row] = await r.json();
    return !!(row && row.value && row.value.switches && row.value.switches[key] === false);
  } catch (e) { return false; }                     // if the switches can't be read, carry on as normal
}
