// One-off converter: turns the Cooklang drink files from the Norman Cooks recipes repo into bar/cocktails.json,
// which the Bar page (bar/index.html) reads. Run it again whenever the drinks change:
//   node lib/build-bar.mjs /path/to/recipes-/Recipes-Cooklang/Drinks
// The pantry side of Norman Cooks is deliberately left out: this is just the drinks, their stories and the method.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) { console.error('Usage: node lib/build-bar.mjs <Drinks folder>'); process.exit(1); }
const SKIP = new Set(['gazpacho']);                                        // a soup, not a drink

// how much drink it is, from the glass it is served in (the same idea as Norman Cooks' cocktail-length.ts)
const GLASS_WORDS = [
  [/\bshot\b|\bshooter\b/, 'shot'],
  [/\b(martini|coupe|coupette|rocks|margarita|old[- ]fashioned|lowball|tumbler|nick (and|&) nora|snifter|cocktail)\b/, 'short'],
  [/\b(highball|collins|hurricane|mug|wine|flute|champagne|julep|pint|goblet|tiki|sling|balloon|copa|pilsner|zombie)\b/, 'long']
];
const lengthOf = glass => {
  const t = String(glass || '').toLowerCase(); let best = null;
  for (const [re, len] of GLASS_WORDS) { const m = t.match(re); if (m && (!best || m.index < best.at)) best = { at: m.index, len }; }
  return best ? best.len : null;
};
const METHODS = ['shaken', 'stirred', 'built', 'blended', 'layered', 'muddled'];

function parseBody(body) {
  const ingredients = []; const seen = new Set();
  const add = (name, qty, unit, note) => {
    const key = name.toLowerCase(); if (seen.has(key)) return; seen.add(key);
    ingredients.push({ name, ...(qty ? { qty } : {}), ...(unit ? { unit } : {}), ...(note ? { note } : {}) });
  };
  const text = s => s
    .replace(/@([^@#~{}\n]+?)\{([^}]*)\}/g, (m, name, inner) => {
      const [a, b] = inner.split('%');
      const qty = b !== undefined ? a.trim() : /^[\d./-]+$/.test((a || '').trim()) ? a.trim() : '';
      const unit = b !== undefined ? b.trim() : '';
      const note = b === undefined && a && !qty ? a.trim() : '';
      add(name.trim(), qty, unit, note);
      return name.trim();
    })
    .replace(/@(\w[\w'-]*)/g, (m, name) => { add(name, '', '', ''); return name; })
    .replace(/#([^@#~{}\n]+?)\{[^}]*\}/g, (m, name) => name.trim())
    .replace(/#(\w[\w'-]*)/g, (m, name) => name)
    .replace(/~\{([^}%]*)%?([^}]*)\}/g, (m, a, b) => (a + ' ' + b).trim())
    .replace(/\s+/g, ' ').trim();
  const [main, ...notes] = body.split(/^##\s*Notes\s*$/m);
  const paras = s => s.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  const steps = paras(main).map(text);
  const noteText = notes.length ? paras(notes.join('\n')).map(x => x.replace(/\s+/g, ' ')) : [];
  return { ingredients, steps, notes: noteText };
}

const drinks = [];
for (const file of readdirSync(dir).filter(f => f.endsWith('.cook')).sort()) {
  const id = file.replace(/\.cook$/, ''); if (SKIP.has(id)) continue;
  const raw = readFileSync(join(dir, file), 'utf8');
  const meta = {}; const rest = [];
  for (const line of raw.split('\n')) { const m = line.match(/^>>\s*([^:]+):\s*(.*)$/); if (m) meta[m[1].trim().toLowerCase()] = m[2].trim(); else rest.push(line); }
  const { ingredients, steps, notes } = parseBody(rest.join('\n').trim());
  const tags = (meta.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const all = steps.join(' ').toLowerCase();
  const method = tags.find(t => METHODS.includes(t)) ||                       // what the file says, else read it off the first instruction
    (/\bblend\b/.test(all) ? 'blended' : /\bmuddle\b/.test(all) ? 'muddled' : /\bshake\b|shaker/.test(all) ? 'shaken' : /\bstir\b/.test(all) && /mixing glass/.test(all) ? 'stirred' : /\bstir|top|fill|pour/.test(all) ? 'built' : null);
  const hot = /mulled|hot |warm/i.test(meta.title + ' ' + all) && !meta.glass;
  drinks.push({
    id, title: meta.title || id, glass: meta.glass || null, length: hot ? 'hot' : lengthOf(meta.glass), method,
    alcoholFree: /mocktail|alcohol-free|non-alcoholic/i.test(meta.history || '') || /^virgin /i.test(meta.title || ''),
    place: meta['origin place'] || null, year: meta['origin year'] || null, history: meta.history || null,
    servings: Number(meta.servings) || 1, ingredients, steps, notes
  });
}
drinks.sort((a, b) => a.title.localeCompare(b.title));
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'bar', 'cocktails.json');
writeFileSync(out, JSON.stringify({ drinks }, null, 1) + '\n');
console.log(`${drinks.length} drinks written to bar/cocktails.json`);
