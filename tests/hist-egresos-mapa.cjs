const assert=require('node:assert/strict');
const map=require('../historial-egresos-mapa.js');

const gastos=[
  {fecha:'2026-09-18',nombre:'Pago Arcor',monto:1500},
  {fecha:'2026-09-17',nombre:'Telecentro',monto:800}
];
const pagos=[
  {fecha:'2026-09-18',nombre:'Arcor',monto:2500,es_enviada:true,status:'approved'},
  {fecha:'2026-09-18',nombre:'Edenor',monto:3200,es_enviada:'true',status:'approved'},
  {fecha:'2026-09-18',nombre:'Devuelta',monto:9000,es_enviada:true,devuelta:true,status:'approved'},
  {fecha:'2026-09-18',nombre:'Rechazada',monto:8000,es_enviada:true,status:'rejected'},
  {fecha:'2026-09-18',nombre:'Ingreso',monto:7000,es_enviada:false,status:'approved'}
];

const rows=map.prepare(gastos,pagos);
assert.equal(rows.length,4,'solo incluye gastos de caja y salidas MP validas');
assert.equal(rows.reduce((sum,row)=>sum+row.monto,0),8000,'preserva el total sin ingresos, devoluciones ni rechazados');

const todos=map.group(rows,'todos');
assert.equal(todos.find(group=>group.nombre==='Arcor').total,4000,'unifica el mismo concepto entre efectivo y MP');
assert.deepEqual(todos.find(group=>group.nombre==='Arcor').medios.sort(),['efectivo','mp'],'conserva ambos medios para el detalle');
assert.equal(map.group(rows,'efectivo').reduce((sum,group)=>sum+group.total,0),2300,'filtro efectivo');
assert.equal(map.group(rows,'mp').reduce((sum,group)=>sum+group.total,0),5700,'filtro Mercado Pago');

const bulk=[];
for(let i=0;i<10000;i++)bulk.push({nombre:'Concepto '+String(i%1000).padStart(4,'0'),monto:i%17+1,medio:i%2?'mp':'efectivo',concepto:'Concepto '+String(i%1000).padStart(4,'0')});
const grouped=map.group(bulk);
assert.equal(grouped.length,1000,'escala a miles de movimientos sin perder conceptos');
const first=map.page(grouped,0),deep=map.page(grouped,199);
assert.equal(first.visible.length,5,'muestra cinco conceptos por nivel');
assert.equal(first.remaining.length,995,'agrupa todo el resto dentro de Otros');
assert.equal(deep.visible.length,5,'permite llegar al ultimo nivel');
assert.equal(deep.remaining.length,0,'el ultimo nivel no inventa otro bloque');
assert.equal(grouped.reduce((sum,group)=>sum+group.total,0),bulk.reduce((sum,row)=>sum+row.monto,0),'la navegacion conserva el total completo');
assert.equal(map.fold('MAPFRE Aconcágua'),'mapfre aconcagua','la busqueda ignora mayusculas y tildes');

console.log('OK historial egresos mapa: filtros, agrupacion, paginado y 10.000 movimientos');
