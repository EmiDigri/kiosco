const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../cierre-cuentas.js');
const outgoing = (id, monto, extra = {}) => ({pago_id:id, monto, es_enviada:true, status:'approved', ...extra});

test('confirmed supplier names also apply to old expenses, with exact normalized matching', () => {
  for (const name of ['Pago Producto de Barracas Logistica', 'Pago de BARRACAS LOGÍSTICA', 'Levite']) {
    assert.equal(C.conceptoGasto(name), 'Levité');
  }
  assert.equal(C.conceptoGasto('TODOIMPRESORAS 10'), 'Fotocopiadora');
  assert.equal(C.conceptoGasto('pablo casas'), 'Todo Dulce');
  assert.equal(C.proveedorGasto('Barracas Logistica Nueva'), 'Barracas Logistica Nueva');
  assert.equal(C.proveedorGasto('Pago Producto de Proveedor Inventado'), 'Pago Producto de Proveedor Inventado');
});

test('supplier aliases reconcile one to one on the same day and preserve stored names', () => {
  const gastos = [
    {uid:'a', fecha:'2026-10-01', nombre:'Levite', monto:10000},
    {uid:'b', fecha:'2026-10-02', nombre:'Levite', monto:10000},
  ];
  const pagos = [outgoing('mp', 10500, {fecha:'2026-10-01', nombre:'Pago Producto de Barracas Logistica'})];
  const before = JSON.stringify({gastos, pagos});
  const result = C.conciliarMes(gastos, pagos);
  assert.equal(result.salidas[0].gasto.uid, 'a');
  assert.deepEqual(result.efectivo.map(g=>g.uid), ['b']);
  assert.equal(result.salidas[0].monto, 10500);
  assert.equal(JSON.stringify({gastos, pagos}), before);
});

test('monthly labels unify aliases and photocopy supplies count as variable costs', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const start = html.indexOf('const MET_FIJOS='), end = html.indexOf('// ECharts se carga', start);
  assert(start >= 0 && end > start);
  const ctx = {CierreCuentas:C};
  vm.runInNewContext(html.slice(start, end) + ';this.api={metTipoGasto,metTipoSalidaMp,metLabelSalida,metLabel,provLogoHtml};', ctx);
  const api = ctx.api;
  assert.equal(api.metTipoGasto('Fotocopiadora'), 'variable');
  assert.equal(api.metTipoGasto('Todoimpresoras 10'), 'variable');
  assert.equal(api.metTipoSalidaMp('TODOIMPRESORAS 10'), 'variable');
  assert.equal(api.metLabelSalida('Todoimpresoras 10'), 'Insumos fotocopiadora');
  assert.equal(api.metLabelSalida('Pago Producto de Barracas Logistica'), api.metLabel('Levite'));
  assert.equal(api.metLabelSalida('Pablo Casas'), api.metLabel('Todo Dulce'));
  assert.equal(api.metTipoSalidaMp('Pago Edenor'), 'fijo');
  assert.equal(api.metTipoSalidaMp('Pago Lector De Codigo'), 'inversion');
  assert(api.provLogoHtml(api.metLabelSalida('Pablo Casas')).includes('tododulce.png'));
  assert(api.provLogoHtml(api.metLabelSalida('Pago Producto de Barracas Logistica')).includes('levite.png'));
});

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

// Casos reales de septiembre 2026 (cuaderno vs salidas de MP).
test('MP cents do not create a second expense (Coca 381.846 written, 381.845,15 paid)', () => {
  const result = C.resumenGastosDia([{uid:'c',fecha:'2026-09-04',nombre:'Coca',monto:381846}],
    [outgoing('mp',381845.15,{fecha:'2026-09-04',nombre:'Pago Producto de  Coca-Cola FEMSA de Buenos Aires S.A.'})]);
  assert.equal(result.filas.length,1);
  assert.equal(result.filas[0].medio,'mp');
  assert.equal(result.total,381846);
});

test('a typo in the notebook counts what MP paid and keeps the written amount visible', () => {
  const result = C.resumenGastosDia([{uid:'e',fecha:'2026-09-07',nombre:'Edenor',monto:418409}],
    [outgoing('mp',481408.07,{fecha:'2026-09-07',nombre:'Pago Edenor'})]);
  assert.equal(result.filas.length,1);
  assert.equal(result.filas[0].monto,481408.07);
  assert.equal(result.filas[0].anotado,418409);
  assert.equal(result.total,481408.07);
});

test('one MP payment covers one notebook expense, never every expense of that supplier', () => {
  const gastos = [
    {uid:'1',fecha:'2026-09-04',nombre:'Coca',monto:381846},
    {uid:'2',fecha:'2026-09-11',nombre:'Coca',monto:150000},
    {uid:'3',fecha:'2026-09-04',nombre:'Coca',monto:90000}
  ];
  const mes = C.conciliarMes(gastos,[outgoing('mp',381845.15,{fecha:'2026-09-04',nombre:'Pago Producto de Coca-Cola FEMSA'})]);
  assert.deepEqual(mes.efectivo.map(g=>g.uid),['2','3']);
  assert.equal(mes.salidas[0].gasto.uid,'1');
});

test('shared words or equal amounts on distant days do not hide a cash expense', () => {
  const mes = C.conciliarMes([
    {uid:'hub',fecha:'2026-09-09',nombre:'Hub USB',monto:7000},
    {uid:'x',fecha:'2026-09-20',nombre:'Flete',monto:66633}
  ],[
    outgoing('lector',39539.39,{fecha:'2026-09-04',nombre:'Pago Lector De Codigo De Barras Usb'}),
    outgoing('t',66633,{fecha:'2026-09-01',nombre:'Transferencia enviada'})
  ]);
  assert.deepEqual(mes.efectivo.map(g=>g.uid),['hub','x']);
  assert(mes.salidas.every(s=>s.gasto===null));
});

test('only the same day matches: a payment a day apart is a different movement', () => {
  const pago = outgoing('m',54589.13,{fecha:'2026-09-13',nombre:'Pago MAPFRE Aconcagua'});
  assert.equal(C.conciliarMes([{uid:'a',fecha:'2026-09-13',nombre:'Seguro Mapfre',monto:54589}],[pago]).efectivo.length,0);
  assert.equal(C.conciliarMes([{uid:'a',fecha:'2026-09-14',nombre:'Seguro Mapfre',monto:54589}],[pago]).efectivo.length,1);
});

test('month total counts each paid expense once (cash not covered + every MP payment)', () => {
  const gastos = [
    {uid:'p',fecha:'2026-09-01',nombre:'Pepsico',monto:66633},
    {uid:'s',fecha:'2026-09-01',nombre:'Santos',monto:899850}
  ];
  const salidas = [
    outgoing('t',66633,{fecha:'2026-09-01',nombre:'Transferencia enviada'}),
    outgoing('arca',79552.18,{fecha:'2026-09-19',nombre:'Pago ARCA'}),
    outgoing('dev',5000,{fecha:'2026-09-02',devuelta:true})
  ];
  const mes = C.conciliarMes(gastos,salidas);
  const total = mes.efectivo.reduce((s,g)=>s+g.monto,0)+mes.salidas.reduce((s,p)=>s+p.monto,0);
  assert.equal(Math.round(total*100)/100,1046035.18);
  assert.equal(mes.salidas.find(s=>s.pago_id==='t').gasto.nombre,'Pepsico');
});
