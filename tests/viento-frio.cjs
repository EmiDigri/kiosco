// Renglón del viento en Info del día: nombre según la fuerza, de dónde viene, sudestada,
// "Viento frío" solo con sensación fría de verdad y ráfagas cuando pegan fuerte.
// Usa el código real de index.html (iwBeaufort / iwWindHtml).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const desde = src.indexOf('const IW_BEAUFORT=['), hasta = src.indexOf('function iwHumidityHtml(');
assert(desde > 0 && hasta > desde, 'no encontré el código del viento');
const {iwWindHtml} = new Function('mcUrl', src.slice(desde, hasta) + 'return {iwWindHtml};')(s => `/${s}.svg`);
// Texto visible del renglón, como lo lee una persona.
const texto = (...a) => iwWindHtml(...a).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const etiqueta = (...a) => (iwWindHtml(...a).match(/<span>([^<]+)<\/span>/) || [])[1];

test('a pleasant day with a breeze is not "cold wind" (real case 4/10: 20°, feels 17°, north 15 km/h)', () => {
  assert.equal(texto(15, 20, null, 20, 17), 'Brisa del norte · 15 km/h');
  assert.equal(etiqueta(25, 290, null, 27, 24), 'Brisa moderada del oeste');
});

test('says where the wind comes from, in words', () => {
  const rumbos = [[0, 'norte'], [44, 'noreste'], [90, 'este'], [200, 'sur'], [225, 'sudoeste'], [270, 'oeste'], [315, 'noroeste'], [359, 'norte']];
  for (const [grados, nombre] of rumbos) assert.equal(etiqueta(15, grados, null, 20, 19), `Brisa del ${nombre}`, `${grados}°`);
  // Sin dirección (variable) o con calma, no se inventa.
  assert.equal(etiqueta(15, null, null, 20, 19), 'Brisa');
  assert.equal(etiqueta(15, '', null, 20, 19), 'Brisa');
  assert.equal(etiqueta(0, 90, null, 20, 20), 'Calma');
  assert.equal(etiqueta(1, 90, null, 20, 20), 'Aire leve');
});

test('sudestada: wind from the southeast of 20 km/h or more', () => {
  assert.equal(texto(30, 135, null, 15, 15), 'Sudestada · 30 km/h');
  // Aunque enfríe, si es sudestada se dice eso.
  assert.equal(etiqueta(35, 140, null, 15, 12), 'Sudestada');
  assert(!iwWindHtml(35, 140, null, 15, 12).includes('is-cold'));
  assert(iwWindHtml(30, 135, null, 15, 15).includes('is-sudestada'));
  assert.equal(etiqueta(15, 135, null, 20, 19), 'Brisa del sudeste');   // floja: todavía no es sudestada
  assert.equal(etiqueta(45, 150, null, 14, 14), 'Sudestada');           // fuerte, igual se llama así
  assert(iwWindHtml(45, 150, null, 14, 14).includes('is-strong'));
});

test('cold wind when the feels-like temperature is really cold', () => {
  assert.equal(etiqueta(20, 200, null, 13, 9), 'Viento frío del sur');
  assert.equal(etiqueta(15, 225, null, 16, 14), 'Viento frío del sudoeste');
  assert(iwWindHtml(20, 200, null, 13, 9).includes('is-cold'));
});

test('no cold label without enough wind, without the wind cooling, or with strong wind', () => {
  assert.equal(etiqueta(8, 180, null, 10, 6), 'Brisa leve del sur');   // casi sin viento
  assert.equal(etiqueta(15, 180, null, 12, 11), 'Brisa del sur');      // el viento no enfría
  assert.equal(etiqueta(45, 180, null, 10, 4), 'Viento fuerte del sur'); // manda la fuerza
});

test('gusts go in their own row, only when they hit much harder than the average wind', () => {
  assert.equal(texto(20, 200, 55, 18, 17), 'Brisa moderada del sur · 20 km/h Ráfagas · 55 km/h');
  assert.equal(texto(20, 200, 30, 18, 17), 'Brisa moderada del sur · 20 km/h');   // solo 10 más
  assert.equal(texto(10, 200, 28, 18, 17), 'Brisa leve del sur · 10 km/h');       // menos de 30
  assert.equal(texto(10, 200, null, 18, 17), 'Brisa leve del sur · 10 km/h');
  assert(iwWindHtml(20, 200, 55, 18, 17).includes('title="Viento del sur · 20 km/h · ráfagas de 55 km/h"'));
});
