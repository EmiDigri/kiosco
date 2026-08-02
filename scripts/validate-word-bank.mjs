import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const mainScriptMatch = html.match(/<script src="\.\/assets\/desafios-es\.js"><\/script>\s*<script>([\s\S]*?)<\/script>\s*<script src="\.\/catalogo-ui\.js"/);
if (!mainScriptMatch) throw new Error('No se encontro el script principal');
Function(mainScriptMatch[1]);

const curatedMatch = html.match(/const rawChallenges=(\[[\s\S]*?\]);\s*const scores=/);
if (!curatedMatch) throw new Error('No se encontro el banco artesanal');
const curated = Function(`"use strict"; return (${curatedMatch[1]});`)();

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('assets/desafios-es.js', 'utf8'), context);
const generated = context.window.KIOSCO_WORD_BANK;
if (!Array.isArray(generated)) throw new Error('El banco generado no es un arreglo');

const normalize = (value) => String(value ?? '')
  .toLocaleUpperCase('es-AR')
  .replace(/Ñ/g, '\uE000')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\uE000/g, 'Ñ')
  .replace(/[^A-ZÑ]/g, '');

const all = [...curated, ...generated];
const keys = all.map(([word]) => normalize(word));
const invalid = all.filter(([word, category, clue]) => {
  const key = normalize(word);
  return key.length < 5 || key.length > 8 || !category || !clue || normalize(clue).includes(key);
});
const byLength = Object.fromEntries([5, 6, 7, 8].map((length) => [length, keys.filter((key) => key.length === length).length]));
const byCategory = all.reduce((counts, [, category]) => {
  counts[category] = (counts[category] || 0) + 1;
  return counts;
}, {});
const duplicateClues = all.length - new Set(all.map(([, , clue]) => clue)).size;

const report = {
  mainScript: 'OK',
  curated: curated.length,
  generated: generated.length,
  total: all.length,
  uniqueWords: new Set(keys).size,
  invalidEntries: invalid.length,
  duplicateClues,
  byLength,
  byCategory,
};
console.log(JSON.stringify(report, null, 2));

if (all.length !== 10000 || new Set(keys).size !== 10000 || invalid.length) process.exit(1);
