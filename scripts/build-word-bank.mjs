import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import zlib from 'node:zlib';

const root = process.cwd();
const TARGET_NEW_WORDS = 9799;
const INPUTS = {
  frequency: path.join(root, '.tmp-frequency.csv'),
  dictionary: path.join(root, '.tmp-es-ar.dic'),
  definitions: path.join(root, '.tmp-eswiktionary.jsonl.gz'),
  index: path.join(root, 'index.html'),
};
const OUTPUT = path.join(root, 'assets', 'desafios-es.js');

for (const input of Object.values(INPUTS)) {
  if (!fs.existsSync(input)) throw new Error(`Falta la fuente ${path.basename(input)}`);
}

const normalize = (value) => String(value ?? '')
  .toLocaleUpperCase('es-AR')
  .replace(/Ñ/g, '\uE000')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\uE000/g, 'Ñ')
  .replace(/[^A-ZÑ]/g, '');

const cleanWord = (value) => String(value ?? '').normalize('NFC').trim().toLocaleLowerCase('es-AR');
const isSpanishWord = (value) => /^[a-záéíóúüñ]+$/iu.test(value);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleWord = (value) => value.toLocaleUpperCase('es-AR');
const hash = (value) => {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const categories = {
  n: 'sustantivo',
  v: 'verbo',
  adj: 'adjetivo',
  adv: 'adverbio',
  prep: 'preposicion',
  conj: 'conector',
  pron: 'pronombre',
  art: 'articulo',
  num: 'numeral',
  interj: 'interjeccion',
};

const wiktionaryPos = {
  n: new Set(['noun']),
  v: new Set(['verb']),
  adj: new Set(['adj']),
  adv: new Set(['adv']),
  prep: new Set(['prep']),
  conj: new Set(['conj']),
  pron: new Set(['pron']),
  art: new Set(['article', 'det']),
  num: new Set(['num']),
  interj: new Set(['intj']),
};

// Evita nombres propios camuflados, regionalismos muy ajenos y vocabulario
// que no aporta a un juego familiar. La frecuencia sigue siendo el filtro principal.
const blockedWords = new Set(`
  coño joder follar follada follado follando puta putas puto putos zorra zorras
  marica maricas maricon maricón maricones boludo boluda pelotudo pelotuda
  mogolico mogólico mogolica mogólica retrasado retrasada culo culos pija pijas
  concha conchas verga vergas orto ortos mierda mierdas carajo carajos
  vosotros vosotras vuestro vuestra vuestros vuestras gilipollas hostia hostias
`.trim().split(/\s+/).map(normalize));

const blockedDefinitions = [
  /\b(?:ciudad|municipio|provincia|departamento|localidad|aldea)\s+(?:de|en|del)\b/i,
  /\b(?:dinast[ií]a|apellido|nombre propio|grupo [eé]tnico)\b/i,
  /\b(?:españa|murcia|burgos|castilla|asturias|andaluc[ií]a)\b/i,
  /\b(?:palabra|t[eé]rmino)\s+(?:desconocid[oa]|arcaic[oa])\b/i,
  /\bno se (?:conoce|sabe)\b/i,
];

const indexSource = fs.readFileSync(INPUTS.index, 'utf8');
const curatedMatch = indexSource.match(/const rawChallenges=(\[[\s\S]*?\]);\s*const scores=/);
if (!curatedMatch) throw new Error('No pude encontrar rawChallenges en index.html');
const curated = Function(`"use strict"; return (${curatedMatch[1]});`)();
const curatedKeys = new Set(curated.map(([word]) => normalize(word)));

const dictionaryLines = fs.readFileSync(INPUTS.dictionary, 'utf8').split(/\r?\n/).slice(1);
const dictionary = new Set();
for (const line of dictionaryLines) {
  const word = cleanWord(line.split('/')[0]);
  if (word) dictionary.add(normalize(word));
}

const frequencyRows = [];
const frequencyLines = fs.readFileSync(INPUTS.frequency, 'utf8').split(/\r?\n/).slice(1);
for (const line of frequencyLines) {
  const match = line.match(/^(\d+),([^,]+),([^,]*),([^,]*),(.*)$/);
  if (!match || !categories[match[3]]) continue;
  const word = cleanWord(match[2]);
  const key = normalize(word);
  if (!isSpanishWord(word) || key.length < 5 || key.length > 8 || blockedWords.has(key)) continue;
  frequencyRows.push({
    count: Number(match[1]),
    word,
    key,
    pos: match[3],
    usage: match[5],
  });
}

const frequencyByKey = new Map();
for (const row of frequencyRows) {
  const rows = frequencyByKey.get(row.key) || [];
  rows.push(row);
  frequencyByKey.set(row.key, rows);
}

const definitions = new Map();
const obsoletePattern = /(?:arca[ií]sm|obsolet|desusad|anticuad|hist[oó]ric|poco usado|raro)/i;
const definitionStream = fs.createReadStream(INPUTS.definitions).pipe(zlib.createGunzip());
const definitionLines = readline.createInterface({ input: definitionStream, crlfDelay: Infinity });
for await (const line of definitionLines) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  if (row.lang_code !== 'es') continue;
  const key = normalize(row.word);
  const targetRows = frequencyByKey.get(key);
  if (!targetRows) continue;

  for (const target of targetRows) {
    if (!wiktionaryPos[target.pos]?.has(row.pos)) continue;
    const mapKey = `${key}|${target.pos}`;
    if (definitions.has(mapKey)) continue;
    const rowTags = [...(row.categories || []), ...(row.tags || [])].join(' ');
    if (obsoletePattern.test(rowTags)) continue;

    const senseCandidates = [];
    for (const [senseIndex, sense] of (row.senses || []).entries()) {
      const senseTags = [...(sense.categories || []), ...(sense.tags || []), ...(sense.raw_tags || [])].join(' ');
      if (obsoletePattern.test(senseTags)) continue;
      const definition = String(sense.glosses?.[0] || '').replace(/\s+/g, ' ').trim();
      if (definition.length < 14 || definition.length > 280) continue;
      if (blockedDefinitions.some((pattern) => pattern.test(definition))) continue;
      const specialistMarks = (sense.categories || []).length + (sense.topics || []).length + (sense.raw_tags || []).length;
      const lengthPenalty = Math.abs(Math.min(definition.length, 150) - 75) / 20;
      senseCandidates.push({ definition, score: specialistMarks * 100 + senseIndex * 3 + lengthPenalty });
    }
    senseCandidates.sort((a, b) => a.score - b.score);
    if (senseCandidates[0]) definitions.set(mapKey, { lemma: cleanWord(row.word), definition: senseCandidates[0].definition });
  }
}

const replacementFor = (category) => {
  if (category === 'verbo') return 'esa acción';
  if (category === 'adjetivo') return 'esa cualidad';
  if (category === 'adverbio') return 'esa manera';
  return 'esa idea';
};

const sanitizeDefinition = (definition, answer, lemma, category) => {
  let text = String(definition)
    .replace(/\([^)]{0,100}\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,\s]+$/g, '');

  const directWords = [...new Set([answer, lemma].map(cleanWord).filter(Boolean))];
  for (const directWord of directWords) {
    const escaped = escapeRegex(directWord);
    text = text
      .replace(new RegExp(`^(?:un|una|el|la|los|las)\\s+${escaped}\\s+(?:es|son|se refiere a)\\s+`, 'iu'), '')
      .replace(new RegExp(`^${escaped}\\s+(?:es|son|se refiere a)\\s+`, 'iu'), '')
      .replace(new RegExp(`\\b${escaped}\\b`, 'giu'), replacementFor(category));
  }

  if (text.length > 180) {
    const shortened = text.slice(0, 180);
    const boundary = Math.max(shortened.lastIndexOf(','), shortened.lastIndexOf(' '));
    text = shortened.slice(0, boundary > 100 ? boundary : 180).trim();
  }
  return text.replace(/[.;:,\s]+$/g, '');
};

const clueTemplates = {
  sustantivo: [
    (body) => `En el mapa de las cosas, nombra ${body}.`,
    (body) => `Entre lo visible y lo pensado, aparece como ${body}.`,
    (body) => `El mundo le guarda un nombre a ${body}.`,
  ],
  verbo: [
    (body) => `El mundo cambia un poco cuando alguien logra ${body}.`,
    (body) => `Hay movimiento o decisión en esta acción: ${body}.`,
    (body) => `Algo deja de estar quieto cuando sucede esto: ${body}.`,
  ],
  adjetivo: [
    (body) => `Así puede mostrarse algo cuando se reconoce por ${body}.`,
    (body) => `Una cualidad se vuelve visible de esta manera: ${body}.`,
    (body) => `Describe aquello que deja esta impresión: ${body}.`,
  ],
  adverbio: [
    (body) => `Modifica el modo, el lugar o el tiempo con esta idea: ${body}.`,
    (body) => `La acción cambia de matiz cuando expresa ${body}.`,
  ],
  preposicion: [
    (body) => `Una palabra breve orienta la relación entre ideas: ${body}.`,
    (body) => `Funciona como un puente pequeño para indicar ${body}.`,
  ],
  conector: [
    (body) => `Dos partes de una frase encuentran unión para expresar ${body}.`,
    (body) => `La oración dobla una esquina cuando necesita indicar ${body}.`,
  ],
  pronombre: [
    (body) => `Ocupa un lugar sin repetir el nombre y puede señalar ${body}.`,
    (body) => `Se presta para nombrar indirectamente ${body}.`,
  ],
  articulo: [
    (body) => `Acompaña un nombre y ayuda a reconocer ${body}.`,
    (body) => `Antes de ciertas cosas, esta palabra permite indicar ${body}.`,
  ],
  numeral: [
    (body) => `El lenguaje cuenta u ordena cuando necesita expresar ${body}.`,
    (body) => `Entre cantidades y posiciones, representa ${body}.`,
  ],
  interjeccion: [
    (body) => `Una emoción salta de la boca para expresar ${body}.`,
    (body) => `La frase puede ser mínima cuando de pronto comunica ${body}.`,
  ],
};

const buildClue = ({ word, lemma, key, pos, definition, source }) => {
  const category = categories[pos];
  const body = sanitizeDefinition(definition, word, lemma, category);
  if (body.length < 12) return null;
  const templates = clueTemplates[category] || clueTemplates.sustantivo;
  let clue = templates[hash(key) % templates.length](body.charAt(0).toLocaleLowerCase('es-AR') + body.slice(1));
  if (source === 'form' && category === 'verbo') clue += ' La respuesta está conjugada, no en infinitivo.';
  else if (source === 'form' && /s$/i.test(word) && !/s$/i.test(lemma)) clue += ' La respuesta está en plural.';
  if (normalize(clue).includes(key)) return null;
  return clue.replace(/\s+/g, ' ').trim();
};

const candidates = [];
const candidateKeys = new Set(curatedKeys);
const addCandidate = ({ word, key, pos, count, lemma, source, dictionaryMatch }) => {
  if (candidateKeys.has(key) || blockedWords.has(key)) return;
  const definitionRow = definitions.get(`${normalize(lemma)}|${pos}`);
  if (!definitionRow) return;
  const clue = buildClue({ word, lemma, key, pos, definition: definitionRow.definition, source });
  if (!clue || clue.length < 35 || clue.length > 250) return;
  candidates.push({
    display: titleWord(word),
    category: categories[pos],
    clue,
    key,
    count,
    source,
    dictionaryMatch,
  });
  candidateKeys.add(key);
};

// Primero entran lemas frecuentes. Los validados de forma exacta por es-AR
// tienen prioridad, pero una palabra de frecuencia alta no se descarta sólo
// porque Hunspell la genere mediante una regla de flexión.
for (const row of frequencyRows) {
  addCandidate({
    ...row,
    lemma: row.word,
    source: 'lemma',
    dictionaryMatch: dictionary.has(row.key),
  });
}

// Para completar diez mil sin acudir a rarezas, se usan las formas más
// frecuentes de los mismos lemas: plurales y conjugaciones reales del corpus.
const forms = [];
for (const row of frequencyRows) {
  for (const item of row.usage.split('|')) {
    const separator = item.indexOf(':');
    if (separator < 1) continue;
    const count = Number(item.slice(0, separator));
    const word = cleanWord(item.slice(separator + 1));
    const key = normalize(word);
    if (!Number.isFinite(count) || count < 40 || !isSpanishWord(word)) continue;
    if (key.length < 5 || key.length > 8 || blockedWords.has(key) || key === row.key) continue;
    if (row.pos === 'v' && /(?:áis|éis|íais|abais|arais|erais|ierais|aseis|ieseis|ad|ed|id|aos|eos|íos)$/iu.test(word)) continue;
    forms.push({
      word,
      key,
      pos: row.pos,
      count,
      lemma: row.word,
      source: 'form',
      dictionaryMatch: dictionary.has(key),
    });
  }
}
forms.sort((a, b) => b.count - a.count || Number(b.dictionaryMatch) - Number(a.dictionaryMatch) || a.key.localeCompare(b.key, 'es'));
for (const form of forms) addCandidate(form);

const ranked = candidates.sort((a, b) => {
  const sourceDifference = Number(a.source === 'lemma') - Number(b.source === 'lemma');
  if (sourceDifference) return -sourceDifference;
  const dictionaryDifference = Number(a.dictionaryMatch) - Number(b.dictionaryMatch);
  if (dictionaryDifference) return -dictionaryDifference;
  return b.count - a.count || a.key.localeCompare(b.key, 'es');
});

if (ranked.length < TARGET_NEW_WORDS) {
  throw new Error(`Sólo quedaron ${ranked.length} candidatas válidas; hacen falta ${TARGET_NEW_WORDS}`);
}

const selected = ranked.slice(0, TARGET_NEW_WORDS);
const outputEntries = selected.map(({ display, category, clue }) => [display, category, clue]);
const output = `/*\n * Banco complementario de Desafío del día. Archivo generado: no editar a mano.\n * Fuentes y licencias detalladas en THIRD_PARTY_NOTICES.md.\n */\nwindow.KIOSCO_WORD_BANK=${JSON.stringify(outputEntries)};\n`;
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, output, 'utf8');

const allEntries = [...curated, ...outputEntries];
const allKeys = allEntries.map(([word]) => normalize(word));
const uniqueKeys = new Set(allKeys);
const byLength = Object.fromEntries([5, 6, 7, 8].map((length) => [length, allKeys.filter((key) => key.length === length).length]));
const byCategory = allEntries.reduce((accumulator, [, category]) => {
  accumulator[category] = (accumulator[category] || 0) + 1;
  return accumulator;
}, {});
const answerLeaks = allEntries.filter(([word, , clue]) => normalize(clue).includes(normalize(word)));

if (allEntries.length !== 10000) throw new Error(`El total final es ${allEntries.length}, no 10000`);
if (uniqueKeys.size !== allEntries.length) throw new Error(`Hay ${allEntries.length - uniqueKeys.size} respuestas repetidas`);
if (answerLeaks.length) throw new Error(`Hay ${answerLeaks.length} pistas que revelan la respuesta`);

console.log(JSON.stringify({
  curated: curated.length,
  generated: outputEntries.length,
  total: allEntries.length,
  byLength,
  byCategory,
  generatedForms: selected.filter((entry) => entry.source === 'form').length,
  generatedDictionaryMatches: selected.filter((entry) => entry.dictionaryMatch).length,
  bytes: Buffer.byteLength(output),
}, null, 2));
