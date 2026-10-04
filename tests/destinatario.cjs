// A quién se le transfirió (api/_destinatario.js). Respuestas de Mercado Pago simuladas con la
// forma real vista el 3/10/2026; los nombres son inventados.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const cargar = () => import('../api/_destinatario.js');
const DUENO = 443581160;
const transferencia = id => ({operation_type: 'money_transfer', description: 'Varios', payer_id: DUENO, collector: {id}});
function mpFalso(respuestas) {
  const pedidos = [];
  const pedir = async url => {
    pedidos.push(url);
    const id = url.split('/users/')[1];
    const r = respuestas[id];
    if (r === 'caido') throw new Error('timeout');
    return {ok: Boolean(r), status: r ? 200 : 403, json: async () => r || {message: 'unauthorized'}};
  };
  return {pedir, pedidos};
}

test('names are shown in normal case', async () => {
  const {nombreLindo} = await cargar();
  assert.equal(nombreLindo('  PROVEEDOR   INVENTADO 10 '), 'Proveedor Inventado 10');
  assert.equal(nombreLindo('JUANA PÉREZ-GÓMEZ'), 'Juana Pérez-Gómez');
});

test('a sent transfer is named after the account that received it', async () => {
  const {nombreSalida} = await cargar();
  const mp = mpFalso({1206724317: {nickname: 'PROVEEDOR INVENTADO 10', user_type: 'normal'}});
  const nombre = await nombreSalida(transferencia(1206724317), {token: 't', ownerId: DUENO, pedir: mp.pedir});
  assert.equal(nombre, 'Proveedor Inventado 10');
  assert.equal(mp.pedidos[0], 'https://api.mercadopago.com/users/1206724317');
});

test('without the name it stays as before, and it never breaks the sync', async () => {
  const {nombreSalida} = await cargar();
  const mp = mpFalso({2: 'caido'});
  const op = {token: 't', ownerId: DUENO, pedir: mp.pedir};
  assert.equal(await nombreSalida(transferencia(1), op), 'Transferencia enviada');      // MP no lo da
  assert.equal(await nombreSalida(transferencia(2), op), 'Transferencia enviada');      // MP no responde
  assert.equal(await nombreSalida({operation_type: 'money_transfer'}, op), 'Transferencia enviada'); // sin cuenta
  assert.equal(await nombreSalida(transferencia(DUENO), op), 'Transferencia enviada');  // la propia cuenta
  assert.equal(await nombreSalida(transferencia(9), {ownerId: DUENO, pedir: mp.pedir}), 'Transferencia enviada'); // sin clave
  assert.equal(mp.pedidos.length, 2);
});

test('service and QR payments keep their description', async () => {
  const {nombreSalida} = await cargar();
  const mp = mpFalso({});
  const pago = {operation_type: 'regular_payment', description: 'Producto de Logistica Inventada', payer_id: DUENO, collector: {id: 5}};
  assert.equal(await nombreSalida(pago, {token: 't', ownerId: DUENO, pedir: mp.pedir}), 'Pago Producto de Logistica Inventada');
  assert.equal(mp.pedidos.length, 0);
});

test('the same account is asked only once per run', async () => {
  const {nombreSalida} = await cargar();
  const mp = mpFalso({77: {nickname: 'PERSONA INVENTADA'}});
  const cache = new Map();
  for (let i = 0; i < 3; i++) assert.equal(await nombreSalida(transferencia(77), {token: 't', ownerId: DUENO, cache, pedir: mp.pedir}), 'Persona Inventada');
  assert.equal(mp.pedidos.length, 1);
});

test('confirmed supplier aliases apply to new transfers and regular payments', async () => {
  const {nombreSalida} = await cargar();
  const mp = mpFalso({77: {nickname: 'TODOIMPRESORAS 10'}, 78: {nickname: 'PABLO CASAS'}});
  const opciones = {token: 't', ownerId: DUENO, pedir: mp.pedir};
  assert.equal(await nombreSalida(transferencia(77), opciones), 'Fotocopiadora');
  assert.equal(await nombreSalida(transferencia(78), opciones), 'Todo Dulce');
  assert.equal(await nombreSalida({operation_type: 'regular_payment', description: 'Producto de Barracas Logistica'}, opciones), 'Levité');
  assert.equal(mp.pedidos.length, 2);
});
