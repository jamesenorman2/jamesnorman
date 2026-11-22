// The Bar's live feed: reads your Cooklang cocktail files straight from Google Drive, the same folders Norman Cooks reads,
// so the Bar shows (and keeps up with) whatever is in them. Read-only: it only lists and downloads.
//
//   GET /api/bar   ->   { ok: true, drinks: [...], updated, count }
//
// Needs three environment variables, the same ones Norman Cooks uses to read Drive:
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
// Optional: GOOGLE_BAR_FOLDERS, a comma-separated list of Drive folder IDs (defaults to your Cocktails and Drinks folders).
// Without them it answers { ok: false, setup: true } and the page carries on with the built-in selection.
// The answer is cached at the edge for 15 minutes (and served stale while it refreshes), so Drive is not hit on every visit.

import { parseDrink, dedupe } from '../lib/cooklang-drinks.js';

// Recipes/Cooklang/Cocktails (everything in it is a cocktail) and Recipes/Cooklang/Drinks (only recipes that name a glass count)
const DEFAULT_FOLDERS = ['1MRMZUOWW5hPyxK9tt4myFVrppyLaW7uv', '1g6s6431AKpkrUgGpPMhLcCY1QHSlxy29'];
const STRICT = new Set(['1g6s6431AKpkrUgGpPMhLcCY1QHSlxy29']);
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';

async function accessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  if (!r.ok) throw new Error(`Google sign-in ${r.status}`);
  return (await r.json()).access_token;
}

async function listFolder(token, folderId, depth = 0) {
  const out = []; let pageToken = '';
  do {
    const q = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false`, fields: 'nextPageToken, files(id, name, mimeType)', pageSize: '200' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await fetch(`${API}/files?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Drive list ${r.status}`);
    const j = await r.json();
    for (const f of j.files || []) {
      if (f.mimeType === FOLDER_MIME) { if (depth < 2) out.push(...await listFolder(token, f.id, depth + 1)); }
      else if (/\.cook$/i.test(f.name)) out.push(f);
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function download(token, id) {
  const r = await fetch(`${API}/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Drive read ${r.status}`);
  return r.text();
}

// a few at a time, so 250 files do not become 250 simultaneous requests
async function pool(items, size, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; try { out[i] = await fn(items[i]); } catch (e) { out[i] = null; } }
  }));
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false }); }
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET || !process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).json({ ok: false, setup: true });
  }
  try {
    const token = await accessToken();
    const folders = (process.env.GOOGLE_BAR_FOLDERS ? process.env.GOOGLE_BAR_FOLDERS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_FOLDERS);
    const lists = await Promise.all(folders.map(async f => (await listFolder(token, f)).map(file => ({ ...file, strict: STRICT.has(f) }))));
    const files = lists.flat();
    const parsed = await pool(files, 16, async f => parseDrink(f.name.replace(/\.cook$/i, ''), await download(token, f.id), { strict: f.strict }));
    const drinks = dedupe(parsed.filter(Boolean));
    if (!drinks.length) throw new Error('No drinks found');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    return res.status(200).json({ ok: true, count: drinks.length, files: files.length, updated: new Date().toISOString(), drinks });
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(200).json({ ok: false, error: e && e.message ? e.message : 'error' });
  }
}
