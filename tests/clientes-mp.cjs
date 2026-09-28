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
