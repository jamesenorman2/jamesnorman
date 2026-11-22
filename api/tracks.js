// The full SoundCloud track list for the homepage, so each visit can pick at random from everything.
// Cached at the edge for an hour. `sources` says how many tracks each way of reading the profile found (handy if the list ever looks short).
import { soundcloudCatalogue } from '../lib/soundcloud.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false }); }
  const { tracks, sources } = await soundcloudCatalogue();
  res.setHeader('Cache-Control', tracks.length ? 'public, s-maxage=3600, stale-while-revalidate=86400' : 'no-store');
  return res.status(200).json({ ok: tracks.length > 0, count: tracks.length, sources, tracks: tracks.map(t => ({ title: t.title, url: t.url })) });
}
