// Fetches a SoundCloud track's waveform (its loudness over time) for the visualiser.
// Browsers can't read it straight from SoundCloud, so the site fetches it here.
//   /api/waveform?wave=https://wave.sndcdn.com/<id>_m.png   (from the player's waveform_url)
//   /api/waveform?track=https://soundcloud.com/<user>/<track>
// Only SoundCloud addresses are accepted. Results are cached for a day.

const WAVE_RE = /^https:\/\/wave\.sndcdn\.com\/[A-Za-z0-9_-]+_m\.(png|json)$/;
const TRACK_RE = /^https:\/\/(www\.|m\.)?soundcloud\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/;

async function waveFromTrackPage(track) {
  const html = await (await fetch(track, { signal: AbortSignal.timeout(8000) })).text();
  const m = html.match(/"waveform_url":"(https:\\?\/\\?\/wave\.sndcdn\.com\\?\/[A-Za-z0-9_-]+_m\.(?:png|json))"/);
  return m ? m[1].replace(/\\\//g, '/') : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false }); }
  const q = new URL(req.url, 'http://x').searchParams;
  try {
    let wave = q.get('wave');
    const track = q.get('track');
    if (wave && !WAVE_RE.test(wave)) return res.status(400).json({ ok: false, error: 'Not a SoundCloud waveform' });
    if (!wave && track) {
      if (!TRACK_RE.test(track.split('?')[0])) return res.status(400).json({ ok: false, error: 'Not a SoundCloud track' });
      wave = await waveFromTrackPage(track.split('?')[0]);
    }
    if (!wave) return res.status(404).json({ ok: false, error: 'No waveform found' });

    const r = await fetch(wave.replace(/\.png$/, '.json'), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ ok: false, error: 'SoundCloud returned ' + r.status });
    const j = await r.json();
    if (!Array.isArray(j.samples) || !j.samples.length) return res.status(502).json({ ok: false, error: 'Empty waveform' });
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).json({ ok: true, height: j.height || 140, samples: j.samples.slice(0, 4000).map(v => Math.max(0, Math.round(v))) });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'Could not reach SoundCloud' });
  }
}
