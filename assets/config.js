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
