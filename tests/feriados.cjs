// /api/feriados: une ArgentinaDatos + archivo oficial + anunciados, solo feriados nacionales.
const {test} = require('node:test');
const assert = require('node:assert/strict');

const cargar = () => import('../api/feriados.js');
const item = (startDate, name, tipo, endDate) => ({item:{name, startDate, ...(endDate ? {endDate} : {}), additionalProperty:{name:'tipo', value:tipo}}});
// Mismo formato que https://www.argentina.gob.ar/sites/default/files/holidays-2026-es.json
const OFICIAL = {mainEntity:{itemListElement:[
  item('2026-01-01', 'Año Nuevo.', 'inamovible'),
  item('2026-04-02', 'Jueves Santo Festividad Cristiana', 'no_laborable'),
  item('2026-09-12', 'Año Nuevo Judío (b)', 'no_laborable'),
  item('2026-03-20', 'Fiesta de la Ruptura del Ayuno del Sagrado Mes de Ramadán (c)', 'no_laborable'),
  item('2026-07-10', 'Día no laborable con fines turísticos', 'turistico'),
  item('2026-10-12', 'Día de la  Raza', 'trasladable'),
  item('2026-12-24', 'Feriado de prueba de dos días', 'inamovible', '2026-12-25'),
  item('2027-01-01', 'Año nuevo', 'inamovible'),
]}};
const AD = [
  {fecha:'2026-01-01', tipo:'inamovible', nombre:'Año nuevo'},
  {fecha:'2026-10-12', tipo:'trasladable', nombre:'Día del Respeto a la Diversidad Cultural'},
];

test('official file: only national holidays and bridge days, no religious optional days', async () => {
  const {oficiales} = await cargar();
  const lista = oficiales(OFICIAL);
  const fechas = lista.map(f => f.fecha);
  for (const religioso of ['2026-04-02', '2026-09-12', '2026-03-20']) assert(!fechas.includes(religioso), religioso);
  assert.equal(lista.find(f => f.fecha === '2026-07-10').tipo, 'puente');
  assert.equal(lista.find(f => f.fecha === '2026-10-12').nombre, 'Día de la Raza');
  assert.equal(lista.find(f => f.fecha === '2026-01-01').nombre, 'Año Nuevo');
  assert(fechas.includes('2026-12-24') && fechas.includes('2026-12-25'), 'rango de dos días');
});

test('merge keeps one entry per date, the first source names it', async () => {
  const {unir} = await cargar();
  const r = unir(AD, [{fecha:'2026-10-12', tipo:'trasladable', nombre:'Día de la Raza'}, {fecha:'2026-07-10', tipo:'puente', nombre:'Puente'}]);
  assert.equal(r.length, 3);
  assert.equal(r.find(f => f.fecha === '2026-10-12').nombre, 'Día del Respeto a la Diversidad Cultural');
  assert.deepEqual(r.map(f => f.fecha), ['2026-01-01', '2026-07-10', '2026-10-12']);
});

// Llama al endpoint con las fuentes simuladas.
async function llamar(year, {ad = AD, oficial = OFICIAL} = {}) {
  const {default: handler} = await cargar();
  const realFetch = global.fetch;
  global.fetch = async url => {
    const u = String(url);
    const valor = u.includes('argentinadatos') ? ad : u.includes('argentina.gob.ar') ? oficial : null;
    if (valor instanceof Error || valor == null) throw valor || new Error('sin ruta');
    return {ok:true, json:async () => valor};
  };
  const res = {headers:{}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }};
  try { await handler({query:{year:String(year)}}, res); } finally { global.fetch = realFetch; }
  return res;
}

test('endpoint adds the announced national holiday (Pope visit, 9/11/2026) and nothing regional', async () => {
  const res = await llamar(2026);
  assert.equal(res.code, 200);
  const fechas = res.body.map(f => f.fecha);
  assert(fechas.includes('2026-11-09'));
  assert.equal(res.body.find(f => f.fecha === '2026-11-09').nombre, 'Visita del papa León XIV');
  assert(!fechas.includes('2026-11-10') && !fechas.includes('2026-11-11'), '10 y 11 son solo CABA/PBA');
  assert(!fechas.includes('2027-01-01'), 'solo el año pedido');
  assert(!fechas.includes('2026-09-12'), 'sin religiosos opcionales');
  assert.match(res.headers['Cache-Control'], /s-maxage=21600/);
});

test('once a source publishes it, it is not duplicated', async () => {
  const res = await llamar(2026, {ad:[...AD, {fecha:'2026-11-09', tipo:'inamovible', nombre:'Feriado por la visita del Papa'}]});
  assert.equal(res.body.filter(f => f.fecha === '2026-11-09').length, 1);
  assert.equal(res.body.find(f => f.fecha === '2026-11-09').nombre, 'Feriado por la visita del Papa');
});

test('works with one source down; with both down it fails so the app falls back', async () => {
  const sinAD = await llamar(2026, {ad:new Error('caido')});
  assert.equal(sinAD.code, 200);
  assert(sinAD.body.some(f => f.fecha === '2026-07-10'));
  const sinOficial = await llamar(2026, {oficial:new Error('caido')});
  assert.equal(sinOficial.code, 200);
  assert(sinOficial.body.some(f => f.fecha === '2026-10-12'));
  const nada = await llamar(2026, {ad:new Error('x'), oficial:new Error('y')});
  assert.equal(nada.code, 502);
  assert.equal((await llamar(1999)).code, 400);
});
