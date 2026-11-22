// Reads James's SoundCloud track list (shared by the Night Shift and /api/tracks).
//
// Two sources, merged:
//  1. SoundCloud's official API, if a SOUNDCLOUD_CLIENT_ID is set (a key from a SoundCloud app you have registered). It lists every
//     public track.
//  2. The profile's public RSS feed. It only carries tracks that are flagged to appear in the feed (SoundCloud: track > Permissions >
//     "Include in RSS feed") and never private ones, so a track that is missing from the feed will not be offered by the homepage.
// If either source is unavailable the other still works, and /api/tracks says how many tracks each one found.
const SOUNDCLOUD = (process.env.SOUNDCLOUD_URL || 'https://soundcloud.com/jamesnormal').replace(/\/$/, '');
const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID || '';
const SC_URL_RE = /^https:\/\/(www\.|m\.)?soundcloud\.com\/[^\s"<>]+$/;
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

const get = async (url, ms = 9000) => { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };

// the profile's user id: from the profile page, or failing that from SoundCloud's public oEmbed answer
async function findUser() {
  try {
    const page = await (await get(SOUNDCLOUD)).text();
    const id = (page.match(/soundcloud:\/\/users:(\d+)/) || page.match(/"urn":"soundcloud:users:(\d+)"/) || page.match(/api\.soundcloud\.com\/users\/(\d+)/) || [])[1];
    if (id) return id;
  } catch (e) { /* try the other way */ }
  try {
    const j = await (await get(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(SOUNDCLOUD)}`)).json();
    const id = ((j.html || '').match(/users(?:%2F|\/)(\d+)/) || [])[1];
    if (id) return id;
  } catch (e) { /* nothing */ }
  return null;
}

// official API: every public track, newest first, following the "next" links
async function fromApi(id) {
  if (!CLIENT_ID) return [];
  const tracks = []; let url = `https://api.soundcloud.com/users/${id}/tracks?limit=200&linked_partitioning=true&access=playable&client_id=${encodeURIComponent(CLIENT_ID)}`;
  try {
    for (let i = 0; i < 25 && url; i++) {
      const j = await (await get(url, 10000)).json();
      for (const t of Array.isArray(j) ? j : j.collection || []) {
        const u = String(t.permalink_url || '').split('?')[0];
        if (t.title && SC_URL_RE.test(u) && t.sharing !== 'private') tracks.push({ title: String(t.title).slice(0, 200), url: u, durationMs: t.duration || null });
      }
      url = j.next_href ? (j.next_href.includes('client_id=') ? j.next_href : `${j.next_href}&client_id=${encodeURIComponent(CLIENT_ID)}`) : null;
    }
  } catch (e) { /* keep what we have */ }
  return tracks;
}

async function fromRss(id) {
  const tracks = [];
  try {
    const rss = await (await get(`https://feeds.soundcloud.com/users/soundcloud:users:${id}/sounds.rss`)).text();
    for (const item of rss.split('<item>').slice(1)) {
      const title = decode((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
      const url = decode((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').split('?')[0];
      const d = ((item.match(/<itunes:duration>([\d:]+)<\/itunes:duration>/) || [])[1] || '').split(':').map(Number);
      const durationMs = d.length ? d.reduce((a, b) => a * 60 + b, 0) * 1000 : null;
      if (title && SC_URL_RE.test(url)) tracks.push({ title: title.slice(0, 200), url, durationMs });
      if (tracks.length >= 500) break;
    }
  } catch (e) { /* no feed */ }
  return tracks;
}

// the full answer, with where it came from
export async function soundcloudCatalogue() {
  const id = await findUser();
  if (!id) return { tracks: [], sources: { user: false, api: 0, rss: 0, apiKey: !!CLIENT_ID } };
  const [api, rss] = await Promise.all([fromApi(id), fromRss(id)]);
  const all = new Map();
  for (const t of [...api, ...rss]) if (!all.has(t.url)) all.set(t.url, t);          // the API list first (newest first); the feed fills any gaps
  return { tracks: [...all.values()], sources: { user: true, api: api.length, rss: rss.length, apiKey: !!CLIENT_ID } };
}

export async function soundcloudTracks() { return (await soundcloudCatalogue()).tracks; }
