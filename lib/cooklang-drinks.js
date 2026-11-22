// Reads a drink from a Cooklang (.cook) file, the way Norman Cooks writes them. Used by the Bar's live feed (api/bar.js,
// which reads your Google Drive) and by the offline snapshot builder (lib/build-bar.mjs).
//
// A file has a header and a method. The header is either YAML-style (the Drive files):
//     ---
//     title: Michelada
//     tags: [shaken, beer]
//     glass: Beer mug
//     ---
// or `>> key: value` lines (the older copies in the recipes repo). The method is plain text with Cooklang marks:
// @ingredient{amount%unit}, #cookware{}, ~{time%unit}, and an optional "## Notes" section at the end.

const GLASS_WORDS = [
  [/\bshot\b|\bshooter\b/, 'shot'],
  [/\b(martini|coupe|coupette|rocks|margarita|old[- ]fashioned|lowball|tumbler|nick (and|&) nora|snifter|cocktail)\b/, 'short'],
  [/\b(highball|collins|hurricane|mug|wine|flute|champagne|julep|pint|goblet|tiki|sling|balloon|copa|pilsner|zombie)\b/, 'long']
];
// how much drink it is, from the glass it is served in (the same idea as Norman Cooks' cocktail-length.ts)
export function lengthOf(glass) {
  const t = String(glass || '').toLowerCase(); let best = null;
  for (const [re, len] of GLASS_WORDS) { const m = t.match(re); if (m && (!best || m.index < best.at)) best = { at: m.index, len }; }
  return best ? best.len : null;
}
const METHODS = ['shaken', 'stirred', 'built', 'blended', 'layered', 'muddled'];

const unslug = s => (/\s/.test(s) || !/-/.test(s) ? s : s.replace(/-+/g, ' ')).trim();          // "fresh-lime-juice" -> "fresh lime juice"

function readHeader(raw) {
  const meta = {}; let body = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fm = body.match(/^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(\n|$)/);
  const put = (k, v) => { k = k.trim().toLowerCase().replace(/_/g, ' '); if (k && !(k in meta)) meta[k] = String(v).trim().replace(/^["']|["']$/g, ''); };
  if (fm) { fm[1].split('\n').forEach(l => { const m = l.match(/^([A-Za-z][\w ]*):\s*(.*)$/); if (m) put(m[1], m[2]); }); body = body.slice(fm[0].length); }
  body = body.split('\n').filter(l => { const m = l.match(/^>>\s*([^:]+):\s*(.*)$/); if (m) { put(m[1], m[2]); return false; } return true; }).join('\n');
  return { meta, body: body.trim() };
}

function parseBody(body) {
  const ingredients = []; const seen = new Set();
  const add = (name, qty, unit, note) => {
    name = unslug(name); const key = name.toLowerCase(); if (!name || seen.has(key)) return; seen.add(key);
    ingredients.push({ name, ...(qty ? { qty } : {}), ...(unit ? { unit } : {}), ...(note ? { note } : {}) });
  };
  const text = s => s
    .replace(/\s--\s/g, ' — ')                                              // a Cooklang comment mark used as a dash in prose
    .replace(/@([^@#~{}\n]+?)\{([^}]*)\}/g, (m, name, inner) => {
      const [a, b] = inner.split('%');
      const qty = b !== undefined ? a.trim() : /^[\d./-]+$/.test((a || '').trim()) ? a.trim() : '';
      const unit = b !== undefined ? b.trim().replace(/^ml$/i, 'ml') : '';
      const note = b === undefined && a && !qty ? a.trim() : '';
      add(name.trim(), qty, unit, note);
      return unslug(name.trim());
    })
    .replace(/@(\w[\w'-]*)/g, (m, name) => { add(name, '', '', ''); return unslug(name); })
    .replace(/#([^@#~{}\n]+?)\{[^}]*\}/g, (m, name) => unslug(name.trim()))
    .replace(/#(\w[\w'-]*)/g, (m, name) => unslug(name))
    .replace(/~\{([^}%]*)%?([^}]*)\}/g, (m, a, b) => (a + ' ' + b).trim())
    .replace(/\s+/g, ' ').trim();
  const [main, ...notes] = body.split(/^##\s*Notes\s*$/m);
  const paras = s => s.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  return { ingredients, steps: paras(main).map(text), notes: notes.length ? paras(notes.join('\n')).map(x => x.replace(/\s+/g, ' ')) : [] };
}

// raw file text -> a drink, or null if it is not a drink. `strict` (for a general Drinks folder that also holds soups and the like)
// keeps only recipes that name a glass, as Norman Cooks does.
export function parseDrink(id, raw, { strict = false } = {}) {
  const { meta, body } = readHeader(raw);
  if (!meta.title || !body) return null;
  if (strict && !meta.glass) return null;
  const { ingredients, steps, notes } = parseBody(body);
  if (!ingredients.length || !steps.length) return null;
  const tags = (meta.tags || '').replace(/^\[|\]$/g, '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const all = steps.join(' ').toLowerCase();
  const method = tags.find(t => METHODS.includes(t)) ||                       // what the file says, else read it off the first instruction
    (/\bblend\b/.test(all) ? 'blended' : /\bmuddle\b/.test(all) ? 'muddled' : /\bshake\b|shaker/.test(all) ? 'shaken' : /\bstir\b/.test(all) && /mixing glass/.test(all) ? 'stirred' : /\bstir|top|fill|pour/.test(all) ? 'built' : null);
  const source = meta['source url'] || meta['source detail'] || (/^https?:\/\//.test(meta.source || '') ? meta.source : '');
  const hot = /mulled|hot toddy|warm/i.test(meta.title + ' ' + all) && !meta.glass;
  const url = /^https:\/\/[^\s"<>]+$/.test(source) ? source : null;
  return {
    id, title: meta.title, glass: meta.glass || null, length: hot ? 'hot' : lengthOf(meta.glass), method,
    alcoholFree: /mocktail|alcohol-free|non-alcoholic/i.test(meta.history || '') || /^virgin |mocktail/i.test(meta.title) || tags.includes('mocktail') || tags.includes('non-alcoholic'),
    place: meta['origin place'] || null, year: meta['origin year'] || null, history: meta.history || null,
    author: meta.author || null, sourceUrl: url,
    servings: Number(meta['base servings'] || meta.servings) || 1, ingredients, steps, notes
  };
}

// two files can describe the same drink (a Cocktails folder and a Drinks folder): keep the fuller one
export function dedupe(drinks) {
  const richness = d => (d.history ? 3 : 0) + (d.place ? 1 : 0) + (d.notes ? d.notes.length : 0) + d.steps.length + d.ingredients.length * 0.1;
  const by = new Map();
  for (const d of drinks) {
    const key = d.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const have = by.get(key);
    if (!have || richness(d) > richness(have)) by.set(key, d);
  }
  return [...by.values()].sort((a, b) => a.title.localeCompare(b.title));
}
