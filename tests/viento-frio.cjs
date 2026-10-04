// "Viento frío" en Info del día: solo cuando la sensación térmica es fría de verdad.
// Usa el código real de index.html (iwBeaufort / iwWindHtml).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const desde = src.indexOf('const IW_BEAUFORT=['), hasta = src.indexOf('function iwHumidityHtml(');
assert(desde > 0 && hasta > desde, 'no encontré el código del viento');
const {iwWindHtml} = new Function('mcUrl', src.slice(desde, hasta) + 'return {iwWindHtml};')(s => `/${s}.svg`);
const etiqueta = (...a) => (iwWindHtml(...a).match(/<span>([^<]+)<\/span>/) || [])[1];

test('a pleasant day with a breeze is not "cold wind" (real case 4/10: 20°, feels 17°, 15 km/h)', () => {
  assert.equal(etiqueta(15, 20, null, 20, 17), 'Brisa');
  assert.equal(etiqueta(25, 20, null, 27, 24), 'Brisa moderada');
});

test('cold wind when the feels-like temperature is really cold', () => {
  assert.equal(etiqueta(20, 180, null, 13, 9), 'Viento frío');
  assert.equal(etiqueta(15, 180, null, 16, 14), 'Viento frío');
  assert(iwWindHtml(20, 180, null, 13, 9).includes('is-cold'));
});

test('no cold label without enough wind, without the wind cooling, or with strong wind', () => {
  assert.equal(etiqueta(8, 180, null, 10, 6), 'Brisa leve');   // casi sin viento
  assert.equal(etiqueta(15, 180, null, 12, 11), 'Brisa');       // el viento no enfría
  assert.equal(etiqueta(45, 180, null, 10, 4), 'Viento fuerte'); // manda la fuerza
});
