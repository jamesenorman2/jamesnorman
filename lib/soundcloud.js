// Reads James's SoundCloud track list from the public RSS feed (shared by the Night Shift and /api/tracks).
const SOUNDCLOUD = (process.env.SOUNDCLOUD_URL || 'https://soundcloud.com/jamesnormal').replace(/\/$/, '');
const SC_URL_RE = /^https:\/\/(www\.|m\.)?soundcloud\.com\/[^\s"<>]+$/;
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

// Your track list, read live from SoundCloud's public feed: find the user id on the profile page, then read the RSS.
export async function soundcloudTracks() {
  try {
    const page = await (await fetch(SOUNDCLOUD, { signal: AbortSignal.timeout(8000) })).text();
    const id = (page.match(/soundcloud:\/\/users:(\d+)/) || page.match(/"urn":"soundcloud:users:(\d+)"/) || [])[1];
    if (!id) return [];
    const rss = await (await fetch(`https://feeds.soundcloud.com/users/soundcloud:users:${id}/sounds.rss`, { signal: AbortSignal.timeout(8000) })).text();
    const tracks = [];
    for (const item of rss.split('<item>').slice(1)) {
      const title = decode((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
      const url = decode((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').split('?')[0];
      const d = ((item.match(/<itunes:duration>([\d:]+)<\/itunes:duration>/) || [])[1] || '').split(':').map(Number);
      const durationMs = d.length ? d.reduce((a, b) => a * 60 + b, 0) * 1000 : null;
      if (title && SC_URL_RE.test(url)) tracks.push({ title: title.slice(0, 200), url, durationMs });
      if (tracks.length >= 500) break;
    }
    return tracks;
  } catch (e) {
    return [];
  }
}

