(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Caligrafia = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';
  const writerKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  function text(value, kind) {
    if (typeof value !== 'string' || !value.trim()) return null;
    let t = value.trim().normalize('NFC');
    if (kind === 'nombre') return t.toLowerCase().replace(/\s+/g, ' ');
    if (/^[-\u2010-\u2015\u2212\u2500\s]+$/.test(t)) return '0';
    t = t.replace(/^\$\s*/, '').replace(/[.,\-\u2010-\u2015\s]+$/, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '');
    else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(t) || !Number.isSafeInteger(Math.round(Number(t) * 100))) return null;
    return String(Math.round(Number(t) * 100));
  }
  function score(actual, expected, kind) {
    const a = text(actual, kind), b = text(expected, kind);
    return {text: actual ?? null, correct: a !== null && b !== null && a === b};
  }
  function selectExamples(examples, target) {
    return examples.filter(e => writerKey(e.writer) === writerKey(target.writer) && e.kind === target.kind &&
      e.date !== target.date && e.sourceHash !== target.sourceHash && e.cropHash !== target.cropHash)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 2);
  }
  function stats(runs, writer) {
    const seen = new Set(), trials = [];
    for (const r of runs.slice().sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))) {
      if (r.state !== 'complete' || writerKey(r.writer) !== writerKey(writer)) continue;
      const key = r.sourceHash + ':' + r.cropHash;
      if (!seen.has(key)) { seen.add(key); trials.push(r); }
    }
    return {total: trials.length, baseline: trials.filter(r => r.baseline.correct).length,
      memory: trials.filter(r => r.memory.correct).length, days: new Set(trials.map(r => r.date)).size};
  }
  return {writerKey, text, score, selectExamples, stats};
});
