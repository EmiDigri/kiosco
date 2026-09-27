// Probabilidad de lluvia de "Info del día" y lectura del METAR del Aeroparque.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = source.indexOf('// ── Lluvia: probabilidad');
const end = source.indexOf('// ── fin lluvia ──', start);
assert(start > 0 && end > start, 'no encontré el bloque de lluvia en index.html');
const ctx = {Intl, Date, Math, Number, String, Object, Array};
vm.runInNewContext(source.slice(start, end) + ';this.api={iwLluviaResumen,iwLluviaTexto,iwLluviaHtml,IW_LLUVIA_MIN};', ctx);
const {iwLluviaResumen, iwLluviaTexto, iwLluviaHtml, IW_LLUVIA_MIN} = ctx.api;

const SEMANA = [{desdeH:7}, {}, {cierreH:22, hastaH:23}];
const DOMINGO = [{desdeH:9}, {cierreH:22, hastaH:23}];
const turnosDe = iso => new Date(iso + 'T12:00:00Z').getUTCDay() === 0 ? DOMINGO : SEMANA;

// Ensemble sintético con la forma real de Open-Meteo multi-modelo: un solo objeto con
// un eje de horas y una columna por simulación. lluvia(miembro, dia, hora) -> mm.
function ensemble(miembros, lluvia, dias = ['2026-09-28', '2026-09-29']) {
  const time = [];
  dias.forEach(d => { for (let h = 0; h < 24; h++) time.push(`${d}T${String(h).padStart(2, '0')}:00`); });
  const hourly = {time};
  for (let m = 0; m < miembros; m++) {
    hourly[`precipitation_member${String(m + 1).padStart(2, '0')}_ecmwf_ifs025`] = time.map(t => lluvia(m, t.slice(0, 10), Number(t.slice(11, 13))));
  }
  return {hourly};
}
const resumen = (datos, hora) => iwLluviaResumen(datos, new Date(hora), turnosDe);

test('rainy afternoon: chance until closing and the specific hours', () => {
  // 8 de 10 simulaciones: 2 mm por hora de 14 a 17 h del lunes.
  const datos = ensemble(10, (m, d, h) => (d === '2026-09-28' && m < 8 && h >= 14 && h < 17 ? 2 : 0));
  const r = resumen(datos, '2026-09-28T09:15:00-03:00');
  assert.equal(r.total, 80);
  assert.equal(r.simulaciones, 10);
  assert.equal(r.franjas.map(f => `${f.desde}-${f.hasta}`).join(','), '14-17');
  const tx = iwLluviaTexto(r, null);
  assert.equal(tx.frase, 'Lluvia casi segura (80%)');
  assert.equal(tx.cuando, 'de 14 a 17 h');
});

test('while the rain window is going on it says until when', () => {
  const datos = ensemble(10, (m, d, h) => (m < 6 && h >= 14 && h < 17 ? 2 : 0));
  const tx = iwLluviaTexto(resumen(datos, '2026-09-28T15:20:00-03:00'), null);
  assert.equal(tx.frase, 'Lluvia probable (60%)');
  assert.equal(tx.cuando, 'hasta las 17 h');
});

test('dry days and drizzle-only days do not show the line', () => {
  const seco = ensemble(10, () => 0);
  assert.equal(iwLluviaTexto(resumen(seco, '2026-09-28T08:00:00-03:00'), null), null);
  assert.equal(iwLluviaHtml(resumen(seco, '2026-09-28T08:00:00-03:00'), null), '');
  // Todas las simulaciones con gotitas (0,2 mm en una hora): no llega a 1 mm, no molesta.
  const gotas = ensemble(10, (m, d, h) => (h === 20 ? 0.2 : 0));
  const r = resumen(gotas, '2026-09-28T08:00:00-03:00');
  assert.equal(r.total, 0);
  assert.equal(r.porHora.find(x => x.h === 20).p, 100);
  assert.equal(iwLluviaTexto(r, null), null);
  assert.equal(IW_LLUVIA_MIN, 30);
});

test('hours already past do not count', () => {
  const datos = ensemble(10, (m, d, h) => (m < 9 && h >= 8 && h < 10 ? 3 : 0));
  assert.equal(resumen(datos, '2026-09-28T07:30:00-03:00').total, 90);
  assert.equal(resumen(datos, '2026-09-28T11:00:00-03:00').total, 0);
});

test('after closing it shows tomorrow within opening hours', () => {
  const datos = ensemble(10, (m, d, h) => (d === '2026-09-29' && m < 4 && h >= 9 && h < 12 ? 2 : 0));
  const r = resumen(datos, '2026-09-28T22:30:00-03:00');
  assert.equal(r.manana, true);
  const tx = iwLluviaTexto(r, null);
  assert.equal(tx.frase, 'Mañana: puede llover (40%)');
  assert.equal(tx.cuando, 'de 9 a 12 h');
});

test('Sunday uses the Sunday opening hour', () => {
  const datos = ensemble(10, (m, d, h) => (m < 5 && h === 8 ? 5 : 0), ['2026-09-27']);
  // Llueve a las 8, antes de que abra el domingo (9 h): no cuenta.
  assert.equal(resumen(datos, '2026-09-27T06:00:00-03:00').total, 0);
});

test('raining now at Aeroparque always shows, even without forecast data', () => {
  const seco = ensemble(10, () => 0);
  assert.equal(iwLluviaTexto(resumen(seco, '2026-09-28T10:00:00-03:00'), 'Lloviendo ahora').frase, 'Lloviendo ahora');
  assert.equal(iwLluviaTexto(null, 'Tormenta ahora').frase, 'Tormenta ahora');
  assert(iwLluviaHtml(null, 'Lloviendo ahora').includes('Lloviendo ahora'));
  const conFranja = ensemble(10, (m, d, h) => (m < 7 && h >= 9 && h < 13 ? 2 : 0));
  assert.equal(iwLluviaTexto(resumen(conFranja, '2026-09-28T10:00:00-03:00'), 'Lloviendo ahora').cuando, 'sigue hasta las 13 h');
});

test('missing values and separate models are handled', () => {
  const a = ensemble(5, (m, d, h) => (h === 15 ? 2 : 0)), b = ensemble(5, () => null);
  const r = iwLluviaResumen([a, b], new Date('2026-09-28T09:00:00-03:00'), turnosDe);
  assert.equal(r.simulaciones, 5);
  assert.equal(r.total, 100);
});

test('Aeroparque METAR: forecast groups are not the current weather', async () => {
  const {default: handler} = await import('../api/weather.js');
  const realFetch = global.fetch;
  const metNo = {properties:{timeseries:[{time:new Date().toISOString(), data:{instant:{details:{air_temperature:16}}, next_1_hours:{summary:{symbol_code:'cloudy'}, details:{}}}}]}};
  const correr = async rawOb => {
    global.fetch = async url => ({ok:true, json:async () => String(url).includes('met.no') ? metNo
      : [{icaoId:'SABE', reportTime:new Date().toISOString(), temp:16, dewp:9, wspd:8, wdir:80, rawOb, clouds:[]}]});
    const res = {setHeader(){}, status(c){this.code = c; return this;}, json(o){this.body = o;}};
    try { await handler({}, res); } finally { global.fetch = realFetch; }
    return res.body.current.weather_code;
  };
  assert.equal(await correr('METAR SABE 271300Z 08014KT CAVOK 16/09 Q1016 TEMPO 7000 -TSRA BKN030 FEW040CB OVC060'), 1);
  assert.equal(await correr('METAR SABE 271300Z 08014KT 5000 -SHRA BKN030 16/09 Q1016'), 61);
  assert.equal(await correr('METAR SABE 271300Z 08014KT 3000 TSRA BKN030CB 16/09 Q1016'), 95);
  // RERA = llovió antes, no ahora: cae a las nubes / pronóstico, nunca a "lluvia".
  assert.notEqual(await correr('METAR SABE 271300Z 08014KT 9999 RERA SCT030 16/09 Q1016'), 61);
});
