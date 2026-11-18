/* Public, read-only connection details for the site's small database.
   The publishable key can only read public settings and call the password-checked functions. */
window.JN = {
  api: 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1',
  key: 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v',
  soundcloud: 'https://soundcloud.com/jamesnormal',
  linkedin: 'https://www.linkedin.com/in/james-norman-beng-ceng-miet-rses-4b065b1/',
  async get(path) {
    const r = await fetch(`${this.api}/${path}`, { headers: { apikey: this.key }, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  },
  // Ask the AI crew to start a shift. The server only runs one per hour; resolves true if one ran.
  async kickShift() {
    try { const r = await fetch('/api/night-shift', { cache: 'no-store' }); return (await r.json()).ran === true; }
    catch (e) { return false; }
  },
  // Ask the research desk to file today's report (runs at most once a day; takes a few minutes when it does).
  async kickDesk() {
    try { const r = await fetch('/api/research', { cache: 'no-store' }); return (await r.json()).ran === true; }
    catch (e) { return false; }
  },
  // Privacy-friendly visit counting for Agent Pigeon: the page path, the referring site's domain and phone or
  // desktop. No cookies, no IP addresses, nothing that identifies a person.
  view(path) {
    try {
      let ref = '';
      try { const h = new URL(document.referrer).hostname; if (h && h !== location.hostname) ref = h.replace(/^www\./, ''); } catch (e) { /* no referrer */ }
      fetch(`${this.api}/rpc/jn_view`, { method: 'POST', keepalive: true, headers: { apikey: this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_path: (path || location.pathname).slice(0, 100), p_ref: ref.slice(0, 80), p_mobile: matchMedia('(pointer: coarse)').matches }) }).catch(() => {});
    } catch (e) { /* counting is optional */ }
  },
  event(name) { this.view('event:' + String(name).slice(0, 60)); },
  // Wake the day crew; the server runs at most a couple of due agents per visit.
  kickCrew() { try { fetch('/api/crew', { cache: 'no-store', keepalive: true }).catch(() => {}); } catch (e) { /* optional */ } },
  async rpc(fn, body) {
    const r = await fetch(`${this.api}/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
};

if (!/^\/admin/.test(location.pathname)) { JN.view(); setTimeout(() => JN.kickCrew(), 5000); }
