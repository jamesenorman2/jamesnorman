// Add tracks to your catalogue from the admin page: paste SoundCloud track links, and the site looks up each title through SoundCloud's public
// oEmbed answer, then saves them in the jn_catalogue table (the homepage and the Night Shift pick from it, alongside the feed and any API key).
//   POST { password, urls: [...] }   ->  { ok, added, titled }
const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1';
const KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';
const URL_RE = /^https:\/\/(www\.|m\.)?soundcloud\.com\/[^\s"<>]+$/;

async function rpc(fn, body) {
  const r = await fetch(`${DB}/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Database ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  const body = req.body || {};
  try {
    const login = await rpc('jn_admin_login', { p_password: typeof body.password === 'string' ? body.password : '' });
    if (!login || !login.ok) return res.status(401).json({ ok: false, error: 'Not authorised' });
    const urls = [...new Set((Array.isArray(body.urls) ? body.urls : []).map(u => String(u).trim().split('?')[0]).filter(u => URL_RE.test(u)))].slice(0, 200);
    if (!urls.length) return res.status(400).json({ ok: false, error: 'No SoundCloud track links found.' });
    let titled = 0;
    const tracks = await Promise.all(urls.map(async url => {
      let title = '';
      try { const r = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) }); if (r.ok) { title = String((await r.json()).title || '').slice(0, 200); if (title) titled++; } } catch (e) { /* the link is still saved, without a title */ }
      return { url, title };
    }));
    const saved = await rpc('jn_catalogue_add', { p_password: body.password, p_tracks: tracks });
    if (!saved || !saved.ok) return res.status(400).json({ ok: false, error: (saved && saved.error) || 'Couldn’t save' });
    return res.status(200).json({ ok: true, added: saved.added, titled });
  } catch (e) { return res.status(503).json({ ok: false, error: 'Couldn’t reach the database.' }); }
}
