// The full SoundCloud track list for the homepage, so each visit can pick at random from everything.
// Cached at the edge for an hour.
import { soundcloudTracks } from '../lib/soundcloud.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false }); }
  const tracks = await soundcloudTracks();
  res.setHeader('Cache-Control', tracks.length ? 'public, s-maxage=3600, stale-while-revalidate=86400' : 'no-store');
  return res.status(200).json({ ok: tracks.length > 0, tracks: tracks.map(t => ({ title: t.title, url: t.url })) });
}
