// Rebuilds bar/cocktails.json: the Bar's built-in selection, shown instantly and used if Google Drive can't be reached.
// (The live list comes from Drive through api/bar.js.) Point it at a folder of Cooklang drink files:
//   node lib/build-bar.mjs /path/to/recipes-/Recipes-Cooklang/Drinks
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrink, dedupe } from './cooklang-drinks.js';

const dir = process.argv[2];
if (!dir) { console.error('Usage: node lib/build-bar.mjs <folder of .cook files>'); process.exit(1); }
const drinks = dedupe(readdirSync(dir).filter(f => f.endsWith('.cook')).sort()
  .map(f => parseDrink(f.replace(/\.cook$/, ''), readFileSync(join(dir, f), 'utf8'), { strict: true })).filter(Boolean));
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'bar', 'cocktails.json');
writeFileSync(out, JSON.stringify({ drinks }, null, 1) + '\n');
console.log(`${drinks.length} drinks written to bar/cocktails.json`);
