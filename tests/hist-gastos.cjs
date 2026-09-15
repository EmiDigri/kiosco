const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../cierre-cuentas.js');
const outgoing = (id, monto, extra = {}) => ({pago_id:id, monto, es_enviada:true, status:'approved', ...extra});

test('daily expenses combine cash and MP and count a notebook/MP match only once', () => {
  const payment = outgoing('arcor', 254403, {nombre:'Arcor SA'});
  const result = C.resumenGastosDia([
    {uid:'a',nombre:'Arcor',monto:254403}, {uid:'b',nombre:'Flete',monto:10000}
  ], [payment, payment, outgoing('otro',5000)]);
  assert.equal(result.total,269403);
  assert.equal(result.filas.length,3);
  assert.equal(result.filas[0].medio,'mp');
  assert.equal(result.filas[1].medio,'efectivo');
});

test('rejected, returned, excluded and incoming payments do not count as expenses', () => {
  const result = C.resumenGastosDia([], [
    outgoing(1,100,{status:'rejected'}), outgoing(2,100,{devuelta:true}),
    outgoing(3,100,{devuelta:'true'}), outgoing(4,100,{excluido:true}),
    outgoing(5,100,{es_enviada:false}), outgoing(6,-125.55,{es_enviada:'true'})
  ]);
  assert.equal(result.total,125.55);
  assert.equal(result.filas.length,1);
});

test('expense IDs deduplicate sync copies, distinct identical purchases remain', () => {
  const a = {uid:'a',nombre:'Arcor',monto:100.1};
  const result = C.resumenGastosDia([a,a,{...a,uid:'b'},{nombre:'Flete',monto:0.2}],[]);
  assert.equal(result.total,200.4);
  assert.equal(result.filas.length,3);
});

test('ambiguous same-amount matches do not invent a definitive total', () => {
  const result = C.resumenGastosDia([{nombre:'Arcor',monto:100},{nombre:'Arcor',monto:100}], [outgoing(1,100,{nombre:'Arcor'})]);
  assert.equal(result.total,null);
  assert.equal(result.porRevisar,true);
});

test('empty days and local-only totals have explicit states', () => {
  assert.equal(C.resumenGastosDia([],[]).total,0);
  const local = C.resumenGastosDia([{nombre:'Flete',monto:100}],[],false);
  assert.equal(local.total,100);
  assert.equal(local.local,true);
});
