// The Night Shift's specialist jobs. Each one checks something real and returns a small,
// plain result. None of them need AI; the Analyst reads their results afterwards.
// Every job has a timeout and never throws: a failed check is reported, not fatal.

import tls from 'node:tls';
import { promises as dns } from 'node:dns';

const UA = 'jamesnorman.co.uk night shift (site health check)';
const timeout = ms => AbortSignal.timeout(ms);

// GATEKEEPER: the HTTPS certificate, and whether the domain still points at Vercel.
export async function gatekeeper(host = 'www.jamesnorman.co.uk', apex = 'jamesnorman.co.uk') {
  const out = { cert: null, dns: null };
  out.cert = await new Promise(resolve => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const c = sock.getPeerCertificate();
      sock.end();
      if (!c || !c.valid_to) return resolve({ ok: false, error: 'no certificate' });
      const days = Math.floor((new Date(c.valid_to) - Date.now()) / 86400000);
      resolve({ ok: days > 14, days, validTo: new Date(c.valid_to).toISOString().slice(0, 10), issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || null });
    });
    sock.on('error', e => resolve({ ok: false, error: e.code || 'connection failed' }));
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
  try {
    const [a, cname] = await Promise.all([
      dns.resolve4(apex).catch(() => []),
      dns.resolveCname(host).catch(() => [])
    ]);
    // Vercel's addresses and CNAME targets
    const apexOk = a.some(ip => /^(76\.76\.21\.|216\.198\.79\.|64\.29\.17\.)/.test(ip));
    const wwwOk = cname.some(c => /vercel-dns(-\d+)?\.com\.?$/i.test(c));
    out.dns = { ok: apexOk && wwwOk, apex: a, www: cname };
  } catch (e) {
    out.dns = { ok: false, error: 'lookup failed' };
  }
  return out;
}

// LINKS: the outside links the site depends on.
const OUTSIDE = [
  ['SoundCloud', 'https://soundcloud.com/jamesnormal'],
  ['LinkedIn', 'https://www.linkedin.com/in/james-norman-beng-ceng-miet-rses-4b065b1/'],
  ['Martyn’s Law guidance', 'https://www.gov.uk/government/publications/the-terrorism-protection-of-premises-act-2025'],
  ['The Act, Schedule 1', 'https://www.legislation.gov.uk/ukpga/2025/10/schedule/1'],
  ['ProtectUK', 'https://www.protectuk.police.uk/'],
  ['MI5 threat levels', 'https://www.mi5.gov.uk/threat-levels']
];
export async function links() {
  return Promise.all(OUTSIDE.map(async ([name, url]) => {
    const start = Date.now();
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: timeout(10000) });
      await r.arrayBuffer();
      // LinkedIn answers automated requests with 999; that means "blocked bots", not "broken"
      const blocked = r.status === 999 || r.status === 403 || r.status === 429;
      return { name, url, status: r.status, ok: r.ok, blocked, ms: Date.now() - start };
    } catch (e) {
      return { name, url, status: e.name === 'TimeoutError' ? 'timeout' : 'unreachable', ok: false, blocked: false, ms: null };
    }
  }));
}

// CLERK: watches the official Martyn's Law guidance through GOV.UK's public content API.
export async function clerk(previous) {
  try {
    const r = await fetch('https://www.gov.uk/api/content/government/publications/the-terrorism-protection-of-premises-act-2025',
      { headers: { 'user-agent': UA, accept: 'application/json' }, signal: timeout(10000) });
    if (!r.ok) return { ok: false, error: 'GOV.UK returned ' + r.status };
    const j = await r.json();
    const history = (j.details && j.details.change_history) || [];
    const latest = history.length ? history[0] : null;
    const updated = j.public_updated_at || null;
    const before = previous && previous.updated;
    return {
      ok: true,
      title: j.title || null,
      updated,
      note: latest ? String(latest.note || '').slice(0, 300) : null,
      changed: Boolean(before && updated && before !== updated)
    };
  } catch (e) {
    return { ok: false, error: 'GOV.UK unreachable' };
  }
}

// INTEL: the current UK national threat level, as published on GOV.UK (or MI5). Only reported when it reads clearly.
const LEVELS = ['LOW', 'MODERATE', 'SUBSTANTIAL', 'SEVERE', 'CRITICAL'];
export async function intel() {
  const readLevel = html => {
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const patterns = [
      /threat to the UK[^.]{0,140}?\bis\b\s*(LOW|MODERATE|SUBSTANTIAL|SEVERE|CRITICAL)\b/i,
      /current national threat level[^.]{0,60}?\bis\b\s*(LOW|MODERATE|SUBSTANTIAL|SEVERE|CRITICAL)\b/i,
      /national threat level[^.]{0,40}?\b(LOW|MODERATE|SUBSTANTIAL|SEVERE|CRITICAL)\b/i
    ];
    for (const re of patterns) { const m = text.match(re); if (m && LEVELS.includes(m[1].toUpperCase())) return m[1].toUpperCase(); }
    return null;
  };
  // 1. GOV.UK's public content API (the same feed the Clerk reads)
  try {
    const r = await fetch('https://www.gov.uk/api/content/terrorism-national-emergency', { headers: { 'user-agent': UA, accept: 'application/json' }, signal: timeout(10000) });
    if (r.ok) {
      const j = await r.json();
      const d = j.details || {};
      const parts = [d.body, d.introductory_paragraph, d.introduction, ...((d.parts || []).map(p => p.body))].filter(Boolean).join(' ');
      const level = readLevel(typeof parts === 'string' ? parts : JSON.stringify(d));
      if (level) return { ok: true, level, source: 'https://www.gov.uk/terrorism-national-emergency' };
    }
  } catch (e) { /* try MI5 */ }
  // 2. MI5's own page (often refuses automated requests)
  try {
    const r = await fetch('https://www.mi5.gov.uk/threat-levels', { headers: { 'user-agent': UA }, signal: timeout(10000) });
    if (r.ok) { const level = readLevel(await r.text()); if (level) return { ok: true, level, source: 'https://www.mi5.gov.uk/threat-levels' }; }
    return { ok: false, error: 'not available from GOV.UK or MI5 this shift' };
  } catch (e) {
    return { ok: false, error: 'GOV.UK and MI5 unreachable' };
  }
}

// SCOUT: new uploads on SoundCloud since the last shift.
export function scout(tracks, previous) {
  const before = new Set((previous && previous.titles) || []);
  const titles = tracks.map(t => t.title);
  const fresh = previous && previous.titles ? tracks.filter(t => !before.has(t.title)).slice(0, 5) : [];
  return { count: tracks.length, titles: titles.slice(0, 100), new: fresh };
}
