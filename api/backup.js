// Dated snapshots of the whole site, from the admin page (POST + password).
//
// A snapshot is a git branch called snapshot/YYYY-MM-DD-HHMM, made from whatever is on main right now (every page,
// script and file as it is that minute), plus one extra commit on that branch holding a copy of the site's database
// content (backups/<date>/data.json). Vercel deploys every branch, so each snapshot also gets its own preview
// website: the site exactly as it was, to look round at any time. Branches are never touched again.
//
//   { action: 'create', note? }  makes a snapshot
//   { action: 'list' }           lists them, newest first, with their preview links
//
// Needs GITHUB_TOKEN in the Vercel project's environment variables: a fine-grained personal access token for this
// repository with "Contents: read and write" and "Deployments: read". GITHUB_REPO (default jamesenorman2/jamesnorman)
// and GITHUB_BASE (default main) can override where it looks.

const DB = 'https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1';
const DB_KEY = 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v';
const REPO = process.env.GITHUB_REPO || 'jamesenorman2/jamesnorman';
const BASE = process.env.GITHUB_BASE || 'main';
const PREFIX = 'snapshot/';
// the database tables anyone can read with the site's public key; copied as they stand (newest rows first, capped)
const TABLES = [
  { t: 'jn_site_settings' }, { t: 'jn_blog', order: 'id.desc', limit: 500 }, { t: 'jn_desk', order: 'id.desc', limit: 200 },
  { t: 'jn_night_shift', order: 'id.desc', limit: 100 }, { t: 'jn_crew', order: 'id.desc', limit: 400 },
  { t: 'jn_idea_reviews' }, { t: 'jn_scores', limit: 3000 }
];

async function db(path, body) {
  const r = await fetch(`${DB}/${path}`, { method: body ? 'POST' : 'GET', headers: { apikey: DB_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`Database ${r.status}`);
  return r.json();
}

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'site-backup' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
  if (!r.ok && !opts.soft) { const err = new Error(`GitHub ${r.status}${json && json.message ? ': ' + json.message : ''}`); err.status = r.status; throw err; }
  return { ok: r.ok, status: r.status, json };
}

// "2026-11-22-1530", in UK time
function stamp(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}

async function dumpDatabase() {
  const out = {};
  await Promise.all(TABLES.map(async ({ t, order, limit }) => {
    const q = `select=*${order ? '&order=' + order : ''}${limit ? '&limit=' + limit : ''}`;
    try {
      let r = await fetch(`${DB}/${t}?${q}`, { headers: { apikey: DB_KEY } });
      if (!r.ok && order) r = await fetch(`${DB}/${t}?select=*${limit ? '&limit=' + limit : ''}`, { headers: { apikey: DB_KEY } });   // no such column: take it unordered
      out[t] = r.ok ? await r.json() : { error: `HTTP ${r.status}` };
    } catch (e) { out[t] = { error: 'unreachable' }; }
  }));
  return out;
}

async function authorised(req) {
  if (req.method !== 'POST') return false;
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) return false;
  const res = await db('rpc/jn_admin_login', { p_password: password });
  return !!(res && res.ok);
}

async function create(note) {
  const when = new Date(), base = stamp(when);
  const head = (await gh(`git/ref/heads/${BASE}`)).json.object.sha;
  const tree = (await gh(`git/commits/${head}`)).json.tree.sha;
  const data = await dumpDatabase();
  const bad = Object.entries(data).filter(([, v]) => v && v.error).map(([k]) => k);
  const readme = `# Site snapshot ${base}\n\nTaken ${when.toISOString()} from \`${BASE}\` at ${head}.\n${note ? `\nNote: ${note}\n` : ''}\n` +
    `This branch is the whole site as it was at that moment: every page, script and file. Vercel deploys it as its own preview website.\n\n` +
    `\`data.json\` here is a copy of the site's database content at the same moment${bad.length ? ` (could not read: ${bad.join(', ')})` : ''}.\n\n` +
    `To go back to this version: ask Claude to "restore snapshot ${base}", or on GitHub open a pull request from this branch into ${BASE}.\n`;
  const newTree = (await gh('git/trees', { method: 'POST', body: { base_tree: tree, tree: [
    { path: `backups/${base}/data.json`, mode: '100644', type: 'blob', content: JSON.stringify({ taken_at: when.toISOString(), from_commit: head, tables: data }) },
    { path: `backups/${base}/README.md`, mode: '100644', type: 'blob', content: readme }
  ] } })).json.sha;
  const commit = (await gh('git/commits', { method: 'POST', body: { message: `Snapshot ${base}${note ? ': ' + note : ''}\n\nWhole-site backup taken from ${BASE} (${head}) from the admin page.`, tree: newTree, parents: [head] } })).json.sha;
  let name = base;                                           // two in the same minute: add -2, -3…
  for (let n = 2; n < 20; n++) {
    const r = await gh('git/refs', { method: 'POST', soft: true, body: { ref: `refs/heads/${PREFIX}${name}`, sha: commit } });
    if (r.ok) return { stamp: name, sha: commit, from: head, skipped: bad };
    if (r.status !== 422) throw new Error(`GitHub ${r.status}${r.json && r.json.message ? ': ' + r.json.message : ''}`);
    name = `${base}-${n}`;
  }
  throw new Error('Too many snapshots in the same minute');
}

// the preview website Vercel built for a commit, as reported back to GitHub
async function previewFor(sha) {
  try {
    const ds = await gh(`deployments?sha=${sha}&per_page=5`, { soft: true });
    for (const d of (ds.json || [])) {
      const st = await gh(`deployments/${d.id}/statuses?per_page=5`, { soft: true });
      const s = (st.json || [])[0];
      if (!s) continue;
      if (s.state === 'success') return { state: 'ready', url: s.environment_url || s.target_url || null };
      if (s.state === 'failure' || s.state === 'error') return { state: 'failed', url: null };
      return { state: 'building', url: null };
    }
  } catch (e) { /* no deployment info */ }
  return { state: 'unknown', url: null };
}

async function list() {
  const refs = (await gh(`git/matching-refs/heads/${PREFIX}`)).json || [];
  const rows = await Promise.all(refs.map(async r => {
    const name = r.ref.replace('refs/heads/', ''), sha = r.object.sha;
    const [c, pv] = await Promise.all([gh(`git/commits/${sha}`, { soft: true }), previewFor(sha)]);
    const msg = (c.json && c.json.message || '').split('\n')[0].replace(/^Snapshot \S+:?\s*/, '');
    return { stamp: name.slice(PREFIX.length), branch: name, at: c.json && c.json.committer && c.json.committer.date || null, note: msg, preview: pv.url, state: pv.state,
      github: `https://github.com/${REPO}/tree/${name}`, changes: `https://github.com/${REPO}/compare/${name}...${BASE}` };
  }));
  return rows.sort((a, b) => (b.at || b.stamp).localeCompare(a.at || a.stamp)).slice(0, 60);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  res.setHeader('Cache-Control', 'no-store');
  let ok;
  try { ok = await authorised(req); } catch (e) { return res.status(503).json({ ok: false, error: 'Database unavailable' }); }
  if (!ok) return res.status(401).json({ ok: false, error: 'Not authorised' });
  if (!process.env.GITHUB_TOKEN) return res.status(200).json({ ok: false, setup: true, error: 'Backups need a GitHub token adding first.' });

  const action = req.body && req.body.action;
  try {
    if (action === 'create') {
      const note = String((req.body && req.body.note) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return res.status(200).json({ ok: true, snapshot: await create(note) });
    }
    if (action === 'list') return res.status(200).json({ ok: true, snapshots: await list() });
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    const msg = e && e.message ? e.message : 'error';
    if (e && (e.status === 401 || e.status === 403 || e.status === 404)) return res.status(200).json({ ok: false, setup: true, error: `GitHub said no (${msg}). Check the token has access to ${REPO} with Contents: read and write, and Deployments: read.` });
    return res.status(502).json({ ok: false, error: msg });
  }
}
