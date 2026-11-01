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

test('monthly ambiguity flags every affected day without changing stored movements', () => {
  const gastos = ['2026-10-03','2026-10-01'].flatMap(fecha => [
    {uid:fecha+'a',fecha,nombre:'Proveedor Uno',monto:100},
    {uid:fecha+'b',fecha,nombre:'Proveedor Uno',monto:100}
  ]);
  const pagos = ['2026-10-01','2026-10-03'].map(fecha => outgoing(fecha,100,{fecha,nombre:'Proveedor Uno'}));
  const before = JSON.stringify({gastos,pagos});
  const mes = C.conciliarMes(gastos.concat(gastos[0]),pagos.concat(pagos[0]));
  assert.equal(mes.porRevisar,true);
  assert.deepEqual(mes.diasPorRevisar,['2026-10-01','2026-10-03']);
  assert.equal(mes.efectivo.length,2);
  assert.equal(mes.salidas.length,2);
  assert.equal(JSON.stringify({gastos,pagos}),before);
  for (const dia of mes.diasPorRevisar) {
    assert(C.resumenGastosDia(gastos.filter(g=>g.fecha===dia),pagos.filter(p=>p.fecha===dia)).porRevisar);
  }
});

test('monthly review warning clears after an unambiguous match, never crosses days', () => {
  const gastos = [
    {uid:'a',fecha:'2026-10-01',nombre:'Proveedor Uno',monto:100},
    {uid:'b',fecha:'2026-10-01',nombre:'Proveedor Uno',monto:100},
    {uid:'c',fecha:'2026-10-02',nombre:'Proveedor Uno',monto:100}
  ];
  const pagos = [outgoing('a',100,{fecha:'2026-10-01',nombre:'Proveedor Uno'})];
  assert.equal(C.conciliarMes(gastos,pagos).porRevisar,true);
  const mes = C.conciliarMes(gastos,pagos.concat(outgoing('b',100,{fecha:'2026-10-01',nombre:'Proveedor Uno'})));
  assert.equal(mes.porRevisar,false);
  assert.deepEqual(mes.diasPorRevisar,[]);
  assert.deepEqual(mes.efectivo.map(g=>g.uid),['c']);
  assert.equal(C.conciliarMes([],[]).porRevisar,false);
});

test('monthly ambiguity without a date still warns, but never generates invalid day links', () => {
  const mes = C.conciliarMes([{nombre:'Proveedor Uno',monto:100},{nombre:'Proveedor Uno',monto:100}],
    [outgoing('a',100,{nombre:'Proveedor Uno'})]);
  assert.equal(mes.porRevisar,true);
  assert.deepEqual(mes.diasPorRevisar,[]);
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

// Sábado 17/10/2026, datos reales del día: el cuaderno anota los dos monotributos juntos
// (159.104) y uno de ellos salió por MP a ARCA (79.552,18).
const DIA_17 = '2026-10-17';
const gastos17 = [
  {uid:'m', fecha:DIA_17, nombre:'Monotributo', monto:159104},
  {uid:'td', fecha:DIA_17, nombre:'Todo dulce', monto:124000},
  {uid:'b1', fecha:DIA_17, nombre:'Bebidas', monto:13200},
  {uid:'b2', fecha:DIA_17, nombre:'Bebidas', monto:83700},
  {uid:'o', fecha:DIA_17, nombre:'Once', monto:47000},
  {uid:'k', fecha:DIA_17, nombre:'Kiosco varios', monto:80000},
];
const salidas17 = [
  outgoing('lev', 26641.18, {fecha:DIA_17, nombre:'Levité'}),
  outgoing('arca', 79552.18, {fecha:DIA_17, nombre:'Pago ARCA'}),   // así se guarda; el día muestra ARCA
  outgoing('tel', 123376.5, {fecha:DIA_17, nombre:'Telecentro'}),
];

test('monotributo paid partly by MP (ARCA) counts once: the written total, not written + MP', () => {
  const dia = C.resumenGastosDia(gastos17, salidas17);
  assert.equal(dia.total, 657021.68);   // antes 736.573,86: contaba 79.552,18 de más
  assert.equal(dia.porRevisar, false);
  const mono = dia.filas.find(f => f.uid === 'm');
  assert.deepEqual([mono.medio, mono.monto, mono.mp, mono.resto], ['mixto', 159104, 79552.18, 79551.82]);
  assert(!dia.filas.some(f => f.origen === 'mp' && f.pago_id === 'arca'), 'ARCA no se suma aparte');
  assert.deepEqual(dia.filas.filter(f => f.origen === 'mp').map(f => f.pago_id), ['lev', 'tel']);
  // Métricas / Egresos del mes: misma cuenta, y la salida de ARCA toma el nombre del cuaderno.
  const mes = C.conciliarMes(gastos17, salidas17);
  const total = [...mes.efectivo, ...mes.salidas].reduce((s, x) => s + Math.round(x.monto * 100), 0) / 100;
  assert.equal(total, 657021.68);
  assert.equal(mes.salidas.find(s => s.pago_id === 'arca').gasto.uid, 'm');
  assert.deepEqual(mes.efectivo.filter(g => g.uid === 'm').map(g => [g.monto, g.parcial]), [[79551.82, true]]);
  assert.equal(C.conciliarGastos(gastos17, salidas17)[0].texto, 'MP + efectivo');
  // Lo guardado no se toca.
  assert.equal(gastos17[0].monto, 159104);
});

test('both monotributos by MP cover the whole line despite cents', () => {
  const pagos = [outgoing('a1', 79552.18, {fecha:DIA_17, nombre:'Pago ARCA'}), outgoing('a2', 79552.18, {fecha:DIA_17, nombre:'ARCA'})];
  const dia = C.resumenGastosDia([{uid:'m', fecha:DIA_17, nombre:'Monotributos', monto:159104}], pagos);
  assert.equal(dia.total, 159104);
  assert.equal(dia.filas.length, 1);
  assert.equal(dia.filas[0].mp, 159104.36);
});

test('19/9 already split by hand keeps working (no partial, one MP match)', () => {
  const gastos = [
    {uid:'foto', fecha:'2026-09-19', nombre:'Monotributo', monto:79552},
    {uid:'ajuste', fecha:'2026-09-19', nombre:'Monotributo', monto:79552.18},
  ];
  const dia = C.resumenGastosDia(gastos, [outgoing('arca', 79552.18, {fecha:'2026-09-19', nombre:'Pago ARCA'})]);
  assert.equal(dia.total, 159104.18);
  assert.deepEqual(dia.filas.map(f => [f.uid, f.medio]), [['foto', 'efectivo'], ['ajuste', 'mp']]);
});

test('a partial payment needs the same day and the same supplier, never a shared word', () => {
  const gasto = (nombre, monto, fecha = DIA_17) => ({uid:nombre, fecha, nombre, monto});
  const casos = [
    [[gasto('Monotributo', 159104)], [outgoing('v', 79552.18, {fecha:DIA_17, nombre:'Arca Vep'})]],      // otro pago a ARCA
    [[gasto('Monotributo', 159104, '2026-10-16')], [outgoing('a', 79552.18, {fecha:DIA_17, nombre:'ARCA'})]], // otro día
    [[gasto('Hub USB', 7000)], [outgoing('u', 3000, {fecha:DIA_17, nombre:'Lector USB'})]],              // palabra suelta
    [[gasto('Monotributo', 50000)], [outgoing('g', 79552.18, {fecha:DIA_17, nombre:'ARCA'})]],           // MP pagó más de lo anotado
  ];
  for (const [gastos, pagos] of casos) {
    const dia = C.resumenGastosDia(gastos, pagos);
    assert(!dia.filas.some(f => f.medio === 'mixto'), JSON.stringify(gastos) + ' / ' + JSON.stringify(pagos));
  }
});

test('the same supplier written with other capitals or accents is shown and grouped as one', () => {
  C.unificarNombres(['Proveedor Inventado Uno', 'proveedor inventado uno', 'Proveedor inventado uno', 'Proveedor Inventado Uno',
    'Golosinas Inventadas', 'Golosinas Inventadas', 'Golosínas inventadas', '  ']);
  for (const variante of ['proveedor inventado uno', 'Proveedor inventado uno', 'PROVEEDOR INVENTADO UNO']) {
    assert.equal(C.proveedorGasto(variante), 'Proveedor Inventado Uno');
  }
  assert.equal(C.proveedorGasto('Golosinas Inventadas'), 'Golosínas inventadas'); // la forma con tilde gana
  assert.equal(C.conceptoGasto('levite'), 'Levité');                              // los alias confirmados siguen primero
  assert.equal(C.proveedorGasto('Otro Sin Registrar'), 'Otro Sin Registrar');
  // "vs" = "varios" y la marca de caja del final no cambian el proveedor; gana la forma limpia.
  C.unificarNombres(['Deposito vs', 'Deposito vs', 'Deposito Varios', 'Libreria Inventada c/n', 'Libreria Inventada c/n', 'Libreria Inventada', 'Mayorista Inventado CN']);
  assert.equal(C.proveedorGasto('Deposito vs'), 'Deposito Varios');
  assert.equal(C.proveedorGasto('Libreria Inventada c/n'), 'Libreria Inventada');
  assert.equal(C.proveedorGasto('Mayorista Inventado CN'), 'Mayorista Inventado CN'); // sin la forma limpia, queda como está
  // Emparejar no cambia: mismo proveedor aunque cambie la mayúscula.
  const r = C.conciliarMes([{uid:'x', fecha:'2026-10-05', nombre:'proveedor inventado uno', monto:1000}],
    [outgoing('m', 1000, {fecha:'2026-10-05', nombre:'Proveedor Inventado Uno'})]);
  assert.equal(r.salidas[0].gasto.uid, 'x');
});
