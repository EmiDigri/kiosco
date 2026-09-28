// Lector del reporte "Todas las transacciones" de Mercado Pago (clientes-mp.js).
// Nombres inventados: nunca poner acá datos reales de clientes.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../clientes-mp.js');

const CAB = 'TRANSACTION_DATE;SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ISSUER_NAME;PAYER_NAME';
const fila = (fecha, id, tipo, monto, emisor, nombre) => `${fecha};${id};${tipo};${monto};${monto};${monto};${emisor};${nombre}`;

test('reads the MP report: only incoming payments with a name, refunds marked, dates in Argentina', () => {
  const csv = '﻿' + [CAB,
    fila('2026-09-28T17:28:42.000-03:00', '1001', 'SETTLEMENT', '1200.00', '', 'LUCIA   FERNANDEZ'),
    fila('2026-09-28T09:05:00.000-03:00', '1002', 'SETTLEMENT', '4500.50', 'Banco Galicia', 'JUAN PEREZ'),
    fila('2026-09-27T21:10:00.000-03:00', '1003', 'SETTLEMENT', '800.00', 'Visa', ''),
    fila('2026-09-01T01:17:58.000-03:00', '1004', 'SETTLEMENT', '300.00', '', 'LUCIA FERNANDEZ'),
    fila('2026-09-15T12:00:00.000-03:00', '1002', 'SETTLEMENT', '4500.50', '', 'JUAN PEREZ'),
    fila('2026-09-20T12:00:00.000-03:00', '1005', 'REFUND', '-2000.00', '', 'ANA GOMEZ'),
    fila('2026-09-19T12:00:00.000-03:00', '1005', 'SETTLEMENT', '2000.00', '', 'ANA GOMEZ'),
    fila('2026-09-18T12:00:00.000-03:00', '1006', 'SETTLEMENT', '-50.00', '', 'PAGO SALIENTE'),
  ].join('\r\n');
  const r = C.parsearReporte(csv);
  assert.equal(r.ingresos, 6);
  assert.equal(r.sinNombre, 1);
  assert.equal(r.desde, '2026-09-01');
  assert.equal(r.hasta, '2026-09-28');
  assert.deepEqual(r.filas.map(f => f.pago_id).sort(), ['1001', '1002', '1004', '1005']);
  const lucia = r.filas.find(f => f.pago_id === '1001');
  assert.deepEqual(lucia, {pago_id: '1001', nombre: 'LUCIA FERNANDEZ', fecha: '2026-09-28', hora: '17:28', monto: 1200, devuelto: false});
  assert.equal(r.filas.find(f => f.pago_id === '1005').devuelto, true);
  assert.equal(r.filas.find(f => f.pago_id === '1002').monto, 4500.5);
});

test('another time zone is converted to Argentina time (the API answers in -04:00)', () => {
  const r = C.parsearReporte([CAB, fila('2026-09-28T23:30:00.000-04:00', '9', 'SETTLEMENT', '100', '', 'X Y')].join('\n'));
  assert.equal(r.filas[0].fecha, '2026-09-29');
  assert.equal(r.filas[0].hora, '00:30');
});

test('comma-separated files and quoted names also work', () => {
  const csv = ['TRANSACTION_DATE,SOURCE_ID,TRANSACTION_TYPE,TRANSACTION_AMOUNT,PAYER_NAME',
    '2026-09-10T10:00:00.000-03:00,77,SETTLEMENT,"1.250,50","PEREZ, JUAN"'].join('\n');
  const r = C.parsearReporte(csv);
  assert.equal(r.filas[0].nombre, 'PEREZ, JUAN');
  assert.equal(r.filas[0].monto, 1250.5);
});

test('wrong files explain what is missing', () => {
  assert.throws(() => C.parsearReporte(''), /vacío/);
  assert.throws(() => C.parsearReporte('TRANSACTION_DATE;SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT\n2026-09-10T10:00:00-03:00;1;SETTLEMENT;10'), /PAYER_NAME/);
  assert.throws(() => C.parsearReporte('fecha;monto\n2026-09-10;10'), /no es el reporte/);
  assert.throws(() => C.parsearReporte(CAB + '\n' + fila('2026-09-10T10:00:00-03:00', '5', 'REFUND', '-10', '', 'A')), /no tiene cobros/);
});

test('amounts in any common format', () => {
  assert.equal(C.montoDe('1200.00'), 1200);
  assert.equal(C.montoDe('1.200,50'), 1200.5);
  assert.equal(C.montoDe('1,200.50'), 1200.5);
  assert.equal(C.montoDe('$ 4500'), 4500);
  assert(Number.isNaN(C.montoDe('abc')));
});

test('saves in batches by operation number, so uploading twice never duplicates', async () => {
  const llamadas = [];
  const filas = Array.from({length: 1200}, (_, i) => ({pago_id: String(i), nombre: 'N', fecha: '2026-09-01', hora: '10:00', monto: 1, devuelto: false}));
  const n = await C.guardar(filas, async (...args) => { llamadas.push(args); });
  assert.equal(n, 1200);
  assert.equal(llamadas.length, 3);
  assert.deepEqual(llamadas[0].slice(0, 2), ['mp_pagadores?on_conflict=pago_id', 'POST']);
  assert.equal(llamadas[0][3], 'resolution=merge-duplicates,return=minimal');
  assert.equal(llamadas[2][2].length, 200);
});

test('counts how many report payments the app also has', async () => {
  const resumen = {desde: '2026-09-01', hasta: '2026-09-28', filas: [{pago_id: '1'}, {pago_id: '2'}, {pago_id: '3'}]};
  let consulta = '';
  const n = await C.coincidencias(resumen, async q => { consulta = q; return [{pago_id: 1}, {pago_id: '3'}, {pago_id: '99'}]; });
  assert.equal(n, 2);
  assert.equal(consulta, 'pagos?select=pago_id&fecha=gte.2026-09-01&fecha=lte.2026-09-28');
});

test('a missing table is recognized to explain the one-time Supabase step', () => {
  assert.equal(C.tablaFaltante(new Error('{"code":"42P01","message":"relation \\"public.mp_pagadores\\" does not exist"}')), true);
  assert.equal(C.tablaFaltante(new Error('{"code":"PGRST205","message":"Could not find the table"}')), true);
  assert.equal(C.tablaFaltante(new Error('Failed to fetch')), false);
});

test('names are shown in normal case, keeping particles lowercase', () => {
  assert.equal(C.nombreVisible('  LUCIA   DE LA FUENTE '), 'Lucia de la Fuente');
  assert.equal(C.nombreVisible('JOSÉ ÑANDÚ'), 'José Ñandú');
  assert.equal(C.nombreVisible('DE LOS SANTOS ANA'), 'De los Santos Ana');
});

test('the search tells amounts from names', () => {
  for (const [texto, monto] of [['4500', 4500], ['$ 4.500', 4500], ['4500,50', 4500.5], ['12.000', 12000]]) {
    const q = C.consultaBusqueda(texto);
    assert.equal(q.tipo, 'monto', texto);
    assert.equal(q.monto, monto, texto);
    assert(q.path.includes(`monto=eq.${monto}&`), q.path);
  }
  const q = C.consultaBusqueda('fer Lucía');
  assert.equal(q.tipo, 'nombre');
  assert.deepEqual(q.palabras, ['fer', 'lucia']);
  // Pide la palabra más larga con las vocales libres (tildes), ordenado del más reciente.
  assert(q.path.includes('nombre=ilike.*l_c__*'), q.path);
  assert(q.path.includes('order=fecha.desc,hora.desc'), q.path);
  assert.equal(C.consultaBusqueda('  '), null);
  assert.equal(C.consultaBusqueda('a'), null);
});

test('the name search ignores accents, case and word order', () => {
  const filas = [{nombre: 'LUCÍA FERNÁNDEZ'}, {nombre: 'LUCAS FERRO'}, {nombre: 'ANA FERNANDEZ LUCIANI'}];
  assert.deepEqual(C.filtrarPorNombre(filas, ['fer', 'lucia']).map(f => f.nombre), ['LUCÍA FERNÁNDEZ', 'ANA FERNANDEZ LUCIANI']);
  assert.deepEqual(C.filtrarPorNombre(filas, ['ferro']).map(f => f.nombre), ['LUCAS FERRO']);
});

// Cobros inventados para las cuentas de clientes.
const cobro = (id, nombre, fecha, hora, monto, devuelto = false) => ({pago_id: String(id), nombre, fecha, hora, monto, devuelto});
const MES = [
  // Lucía: 5 días a la mañana a principios de mes y después no vino más -> habitual que dejó de venir.
  cobro(1, 'LUCÍA FERNÁNDEZ', '2026-09-01', '10:00', 1000), cobro(2, 'LUCIA FERNANDEZ', '2026-09-03', '10:30', 1500),
  cobro(3, 'LUCÍA FERNÁNDEZ', '2026-09-05', '11:00', 2000), cobro(4, 'LUCÍA FERNÁNDEZ', '2026-09-08', '09:15', 1000),
  cobro(5, 'LUCÍA FERNÁNDEZ', '2026-09-10', '09:40', 1200),
  // Juan: 2 días, 3 compras de noche (dos el mismo día = una visita).
  cobro(6, 'JUAN PEREZ', '2026-09-27', '18:00', 4500), cobro(7, 'JUAN PEREZ', '2026-09-28', '19:10', 3000), cobro(8, 'JUAN PEREZ', '2026-09-28', '20:00', 500),
  // Ana: una sola vez; y una compra devuelta que no cuenta.
  cobro(9, 'ANA GOMEZ', '2026-09-28', '13:00', 900), cobro(10, 'ANA GOMEZ', '2026-09-20', '13:00', 7000, true),
];

test('the month: ranking by money, visits are distinct days, habitual vs one-time, who stopped coming', () => {
  const a = C.analizarClientes(MES, '2026-09-01', '2026-09-30');
  assert.equal(a.clientes, 3);
  assert.equal(a.cobros, 9);
  assert.equal(a.total, 15600);
  assert.deepEqual(a.ranking.map(c => [c.nombre, c.total, c.visitas, c.cobros, c.ticket, c.franja]), [
    ['Juan Perez', 8000, 2, 3, 2667, 2], ['Lucía Fernández', 6700, 5, 5, 1340, 0], ['Ana Gomez', 900, 1, 1, 900, 1]]);
  assert.deepEqual(a.grupos.map(g => [g.id, g.clientes, g.total]), [['habituales', 1, 6700], ['aveces', 1, 8000], ['unavez', 1, 900]]);
  assert.deepEqual(a.dejaron.map(c => [c.nombre, c.visitasVentana, c.ultima]), [['Lucía Fernández', 5, '2026-09-10']]);
  // Sin reportes de meses anteriores no se sabe quién es nuevo.
  assert.equal(a.nuevos, null);
  assert.equal(C.analizarClientes(MES, '2026-10-01', '2026-10-31'), null);
});

test('new clients need an earlier report; a habitual from last month who did not come is listed', () => {
  const agosto = [5, 8, 12, 19].map((d, i) => cobro(100 + i, 'PEDRO SOSA', `2026-08-${String(d).padStart(2, '0')}`, '12:30', 2000))
    .concat([cobro(200, 'JUAN PEREZ', '2026-08-30', '18:00', 1000)]);
  const a = C.analizarClientes(agosto.concat(MES), '2026-09-01', '2026-09-30');
  assert.deepEqual(a.nuevos.map(c => c.nombre), ['Lucía Fernández', 'Ana Gomez']);
  assert.deepEqual(a.dejaron.map(c => c.nombre), ['Lucía Fernández', 'Pedro Sosa']);
  assert.equal(a.clientes, 3);
});

test('shifts: morning up to 12, afternoon up to 17, night after (early morning counts as night)', () => {
  assert.deepEqual(['07:00', '12:00', '12:01', '17:00', '17:01', '23:30', '01:15', ''].map(C.franjaDe), [0, 0, 1, 1, 2, 2, 2, null]);
});

test('search results are grouped by client', () => {
  const r = C.agruparClientes(MES);
  assert.deepEqual(r.map(c => [c.nombre, c.cobros, c.visitas, c.total, c.ultima]), [
    ['Lucía Fernández', 5, 5, 6700, '2026-09-10'], ['Juan Perez', 3, 2, 8000, '2026-09-28'], ['Ana Gomez', 1, 1, 900, '2026-09-28']]);
});

test('client card: totals, usual shift and weekday, months and latest purchases first', () => {
  const lucia = MES.filter(f => C.clave(f.nombre) === 'lucia fernandez');
  const extra = [cobro(11, 'LUCÍA FERNÁNDEZ', '2026-08-18', '10:00', 800), cobro(12, 'LUCÍA FERNÁNDEZ', '2026-09-12', '10:00', 500, true)];
  const f = C.fichaCliente(lucia.concat(extra));
  assert.equal(f.nombre, 'Lucía Fernández');
  assert.equal(f.total, 7500);
  assert.equal(f.visitas, 6);
  assert.equal(f.cobros, 6);
  assert.equal(f.ticket, 1250);
  assert.equal(f.franja, 0);
  // 1/9, 8/9 y 18/8 fueron martes: 3 de 6 días.
  assert.deepEqual(f.dias, [2]);
  assert.equal(f.primera, '2026-08-18');
  assert.equal(f.ultima, '2026-09-10');
  assert.deepEqual(f.meses, [{mes: '2026-09', total: 6700, visitas: 5}, {mes: '2026-08', total: 800, visitas: 1}]);
  assert.deepEqual(f.compras.map(c => c.pago_id).slice(0, 3), ['12', '5', '4']);
  // Con pocos días no se inventa un día preferido.
  assert.deepEqual(C.fichaCliente(MES.filter(x => x.nombre === 'JUAN PEREZ')).dias, []);
  // Empate entre dos días: se nombran los dos.
  assert.deepEqual(C.fichaCliente(MES.filter(x => C.clave(x.nombre) === 'lucia fernandez')).dias, [2, 4]);
});

test('the card asks the database for a name that may carry accents or ñ', () => {
  assert.equal(C.patronNombre(C.clave('  LUCÍA   NUÑEZ ')), 'l_c__ ____z');
});

test('client of the month: most days, then most money; nobody with a single day', () => {
  const a = C.analizarClientes(MES, '2026-09-01', '2026-09-30');
  assert.equal(a.estrella.nombre, 'Lucía Fernández');
  assert.equal(a.estrella.visitas, 5);
  assert.equal(C.analizarClientes(MES.filter(f => f.nombre === 'ANA GOMEZ'), '2026-09-01', '2026-09-30').estrella, null);
});

test('adjustments: excluded clients leave the numbers, merged names count as one person', () => {
  const aj = C.normalizarAjustes({
    excluidos: {'ana gomez': {nombre: 'Ana Gomez'}},
    unidos: {'juan perez': {a: 'lucia fernandez', nombreA: 'Lucía Fernández', nombre: 'Juan Perez'}},
  });
  assert.equal(C.principalDe('juan perez', aj), 'lucia fernandez');
  const filas = C.aplicarAjustes(MES, aj);
  assert(!filas.some(f => f.nombre === 'ANA GOMEZ'));
  assert.equal(filas.filter(f => f.nombre === 'Lucía Fernández').length, 3);
  const a = C.analizarClientes(filas, '2026-09-01', '2026-09-30');
  assert.deepEqual(a.ranking.map(c => [c.nombre, c.total, c.visitas, c.cobros]), [['Lucía Fernández', 14700, 7, 8]]);
  // Marcados (para el buscador y la ficha) quedan, con la marca.
  const marcados = C.aplicarAjustes(MES, aj, {marcar: true});
  assert.equal(marcados.filter(f => f.excluido).length, 2);
  assert.deepEqual(C.agruparClientes(marcados).find(c => c.nombre === 'Ana Gomez').excluido, true);
  // Cadena: si Pedro se unió a Juan y Juan a Lucía, Pedro también cuenta como Lucía.
  aj.unidos['pedro sosa'] = {a: 'juan perez', nombreA: 'Juan Perez', nombre: 'Pedro Sosa'};
  assert.equal(C.principalDe('pedro sosa', aj), 'lucia fernandez');
  assert.equal(C.aplicarAjustes([{nombre: 'PEDRO SOSA', fecha: '2026-09-02', hora: '10:00', monto: 1}], aj)[0].nombre, 'Lucía Fernández');
  // Datos rotos en la base no rompen nada.
  assert.deepEqual(C.normalizarAjustes('x'), {excluidos: {}, unidos: {}});
  assert.deepEqual(C.normalizarAjustes({excluidos: [], unidos: null}), {excluidos: {}, unidos: {}});
});
