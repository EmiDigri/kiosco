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
  // Visita del Papa, tal cual lo publica el Gobierno: el 9 nacional y el 10 y 11 "especial",
  // con un link HTML metido en el nombre.
  item('2026-11-09', 'Visita de Su Santidad el Papa León XIV', 'inamovible'),
  item('2026-11-10', 'Visita de Su Santidad el Papa León XIV (<a href="/normativa/nacional/norma-430580/texto">feriado en Córdoba y Ciudad Autónoma de Buenos Aires</a>)', 'especial'),
  item('2026-11-11', 'Visita de Su Santidad el Papa León XIV (<a href="/normativa/nacional/norma-430580/texto">feriado en Provincia de Buenos Aires</a>)', 'especial'),
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

test('names come clean: no HTML from the official file', async () => {
  const {limpiarNombre, jurisdiccion} = await cargar();
  const sucio = 'Visita de Su Santidad el Papa León XIV (<a href="/normativa/nacional/norma-430580/texto">feriado en Provincia de Buenos Aires</a>)';
  assert.equal(limpiarNombre(sucio), 'Visita de Su Santidad el Papa León XIV (feriado en Provincia de Buenos Aires)');
  assert.deepEqual(jurisdiccion(limpiarNombre(sucio)), {nombre: 'Visita de Su Santidad el Papa León XIV', donde: 'Provincia de Buenos Aires'});
  assert.deepEqual(jurisdiccion('Año Nuevo'), {nombre: 'Año Nuevo', donde: ''});
});

test('Pope visit: the 9th is national; the 10th and 11th are local and say where they apply', async () => {
  const res = await llamar(2026);
  assert.equal(res.code, 200);
  const fechas = res.body.map(f => f.fecha), dia = f => res.body.find(x => x.fecha === f);
  assert.deepEqual(dia('2026-11-09'), {fecha: '2026-11-09', tipo: 'inamovible', nombre: 'Visita de Su Santidad el Papa León XIV'});
  // El 10 rige en CABA (donde está el kiosco); el 11 solo en Provincia.
  assert.deepEqual(dia('2026-11-10'), {fecha: '2026-11-10', tipo: 'local', nombre: 'Visita de Su Santidad el Papa León XIV', donde: 'Córdoba y Ciudad Autónoma de Buenos Aires', caba: true});
  assert.deepEqual(dia('2026-11-11'), {fecha: '2026-11-11', tipo: 'local', nombre: 'Visita de Su Santidad el Papa León XIV', donde: 'Provincia de Buenos Aires', caba: false});
  assert(res.body.every(f => !/[<>]/.test(f.nombre + (f.donde || ''))), 'ningún nombre trae HTML');
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
