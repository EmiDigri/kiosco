const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../cierre-cuentas.js');
test('notebook accepts saved photos without forcing camera capture', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const input = html.match(/<input\b[^>]*id="cmFotoInput"[^>]*>/)[0];
  assert.ok(input.includes('type="file"'));
  assert.ok(input.includes('image/*'));
  assert.ok(!/\bcapture\b/.test(input));
  const source = fs.readFileSync(require.resolve('../cierre-foto-ui.js'), 'utf8');
  const context = vm.createContext({CierreCuentas:C});
  vm.runInContext(source.slice(0, source.indexOf('function cmComprimirFoto')), context);
  for (const ext of ['jpg','jpeg','png','webp','gif','avif','bmp','HEIC','heif']) {
    assert.equal(context.cmFotoEsImagen({name:'cuaderno.'+ext, type:''}), true, ext);
    assert.equal(context.cmFotoEsImagen({name:'cuaderno.'+ext, type:'application/octet-stream'}), true, ext);
  }
  for (const type of ['image/jpeg','image/png','image/webp','image/heic']) {
    assert.equal(context.cmFotoEsImagen({name:'foto', type}), true, type);
  }
  for (const file of [null,{name:'cuaderno.pdf',type:'application/pdf'},{name:'archivo',type:''},{name:'archivo.jpg',type:'text/html'}]) {
    assert.equal(context.cmFotoEsImagen(file), false);
  }
});
const foto = () => ({fecha:'2026-09-08', total_dia:1681800, turnos:[
  {cierre:521450, mp:221450, once:0, mpo:36000},
  {cierre:502600, mp:201600, once:8000, mpo:3500},
  {cierre:657750, mp:290250, once:0, mpo:12000}
], gastos:[{nombre:'Arcor', monto:254403}]});
const mp = {Vale:221450, Ani:201600, Marta:290250};
function dataDay() {
  return {mpTotal:713300, turnos:Object.fromEntries(Object.entries(mp).map(([t,n])=>[t,{mp:n}])),
    cierres:foto().turnos.map((t,i)=>({turno:C.turnos(foto().fecha)[i], total_turno:t.cierre, mp:t.mp, efectivo:t.cierre-t.mp-t.once, once_monto:t.once, mpo:t.mpo, apertura:10000})), gastos:foto().gastos};
}
test('photo totals, MPO and Once are counted once; the float changes nothing', () => {
  const state = C.validarFoto(foto(), mp, '2026-09-08');
  assert.deepEqual(state.errores, []); assert.deepEqual(state.diferencias, []); assert.equal(state.suma,1681800);
  const day=dataDay(), totals=C.resumenMes({'2026-09-08':day},'2026-09-08','2026-09-08');
  assert.equal(totals.total,1681800); assert.equal(totals.mp,713300); assert.equal(totals.efectivo,968500);
  assert.equal(totals.resultado,1427397); assert.equal(totals.cerrados,3); assert.equal(totals.completos,1);
  day.cierres.forEach(c=>c.apertura=999999);
  assert.equal(C.totalDia(day),1681800);
});
test('missing and ambiguous amounts stay missing, zero and cents survive', () => {
  for(const value of [null,undefined,'',' ',false,-10,Infinity,'25?403']) assert.equal(C.monto(value),null);
  assert.equal(C.monto(0),0); assert.equal(C.monto('0'),0);
  assert.equal(C.monto('1.681.800'),1681800); assert.equal(C.monto('254.403,50'),254403.5);
  assert.equal(C.monto(254403.5),254403.5);
});
test('dates use explicit target year and reject impossible dates', () => {
  assert.equal(C.fecha('8/9','2026-09-01'),'2026-09-08');
  assert.equal(C.fecha('31/12','2025-12-31'),'2025-12-31');
  assert.equal(C.fecha('2026-02-30','2026-02-01'),null);
  assert.equal(C.fecha('29/2/2024','2026-02-01'),'2024-02-29');
  assert.equal(C.fecha(null,'2026-09-08'),null);
});
test('invalid photo totals, missing expenses and negative cash block saving', () => {
  const f=foto(); f.turnos[0].cierre=null; f.gastos[0].monto=null;
  assert.ok(C.validarFoto(f,mp,f.fecha).errores.length>=3);
  const g=foto();g.turnos[1].cierre=200000;
  assert.ok(C.validarFoto(g,mp,g.fecha).errores.some(s=>s.includes('negativo')));
  const h=foto();h.turnos[0].mpo=999999;
  assert.ok(C.validarFoto(h,mp,h.fecha).errores.some(s=>s.includes('MPO')));
});
test('MP disagreements require explicit review; do not replace MP from the photo', () => {
  const f=foto();f.turnos[0].mp=99;
  assert.deepEqual(C.validarFoto(f,mp,f.fecha).diferencias,['Vale']);
  assert.ok(C.validarFoto(f,null,f.fecha).errores.some(s=>s.includes('consultar MP')));
});
test('partial closures preserve MP from other shifts without double counting', () => {
  const day=dataDay();day.cierres=day.cierres.slice(0,1);
  assert.equal(C.totalDia(day),521450+201600+290250);
  const totals=C.resumenMes({'2026-09-08':day},'2026-09-08','2026-09-08');
  assert.equal(totals.cerrados,1);assert.equal(totals.esperados,3);assert.equal(totals.completos,0);
  assert.equal(totals.mp+totals.efectivo,totals.total);
});
test('Sundays require the two actual Sunday shifts, not merely any two rows', () => {
  const day=dataDay();day.cierres=day.cierres.slice(0,2);
  assert.equal(C.completo(day,'2026-09-06'),false);
  day.cierres.forEach((c,i)=>c.turno=`Turno ${i+1}`);
  assert.equal(C.completo(day,'2026-09-06'),true);
  assert.ok(C.validarFoto(foto(),mp,'2026-09-06').errores.some(s=>s.includes('2 turnos')));
});
test('later expenses never change the stored revenue', () => {
  const c=dataDay().cierres[0];assert.equal(C.totalCierre(c,200000),521450);
  assert.equal(C.totalCierre({total_turno:0,mp:999}),0);
});
test('expense reconciliation reclassifies later MP without duplicating the expense', () => {
  const gastos=[{fecha:'2026-09-08',nombre:'Arcor',monto:254403}];
  const outgoing={id:1,fecha:'2026-09-08',nombre:'Arcor SA',monto:254403,es_enviada:true,status:'approved'};
  assert.equal(C.conciliarGastos(gastos,[])[0].medio,'efectivo');
  assert.equal(C.conciliarGastos(gastos,[outgoing,outgoing])[0].medio,'mp');
  assert.equal(C.conciliarGastos(gastos,[outgoing],false)[0].medio,'pendiente');
  assert.equal(C.conciliarGastos(gastos,[{...outgoing,fecha:'2026-09-07'}])[0].medio,'efectivo');
  assert.equal(gastos.length,1);
});
test('photo expenses have the same ID on different devices, repeated rows remain distinct', async () => {
  const g={nombre:' Arcor ',monto:254403},id=await C.idGastoFoto('2026-09-08',g,0);
  assert.equal(id,await C.idGastoFoto('2026-09-08',{nombre:'ARCOR',monto:254403},0));
  assert.notEqual(id,await C.idGastoFoto('2026-09-08',g,1));
  assert.notEqual(id,await C.idGastoFoto('2026-09-09',g,0));
});
test('rejected, returned and incoming movements cannot match a cash expense', () => {
  const g=[{nombre:'Arcor',monto:100}];
  for(const p of [{status:'rejected',es_enviada:true},{es_enviada:false},{es_enviada:true,devuelta:true}]) assert.equal(C.conciliarGastos(g,[{...p,monto:100}])[0].medio,'efectivo');
  assert.equal(C.ingreso({monto:100,es_enviada:'true'}),false);
});
test('two expenses competing for one payment are marked ambiguous', () => {
  const g=[{nombre:'Arcor',monto:100},{nombre:'Arcor',monto:100}];
  assert.ok(C.conciliarGastos(g,[{id:1,nombre:'Arcor',monto:100,es_enviada:true}]).every(m=>m.medio==='revisar'));
  g[1].nombre='Arcor SA';
  assert.ok(C.conciliarGastos(g,[{id:1,nombre:'Arcor SA',monto:100,es_enviada:true}]).every(m=>m.medio==='revisar'));
});
test('closed months cannot invent missing historical cash', () => {
  const totals=C.resumenMes({'2026-09-08':dataDay()},'2026-09-01','2026-09-08');
  assert.equal(totals.total,1681800);assert.equal(totals.cerrados,3);assert.equal(totals.esperados,23);
});
test('inline scripts still parse', () => {
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) if(!/type=\"(?:module|application\/)/.test(m[1]) && m[2].trim()) new vm.Script(m[2]);
});
test('pending closings and expenses appear even when the day already has remote records', () => {
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  const code=html.slice(html.indexOf('function histUnirCierresLocales('),html.indexOf('async function histSbSelect('));
  const ctx={};vm.createContext(ctx);vm.runInContext(code,ctx);
  const cierres=[{fecha:'2026-09-08',turno:'Vale',total_turno:1}],gastos=[{uid:'old',fecha:'2026-09-08',monto:10}];
  ctx.histUnirCierresLocales(cierres,gastos,{cierres:[{fecha:'2026-09-08',turno:'Ani',total_turno:100,synced:false}],gastos:[{uid:'new',fecha:'2026-09-08',monto:20,synced:false}]});
  assert.equal(cierres.length,2);assert.equal(gastos.length,2);
  ctx.histUnirCierresLocales(cierres,gastos,{cierres:[{fecha:'2026-09-08',turno:'Vale',total_turno:2,synced:false}],gastos:[{uid:'new',fecha:'2026-09-08',monto:20,synced:false}]});
  assert.equal(cierres[0].total_turno,2);assert.equal(gastos.length,2);
});
test('photo API authenticates and preserves unreadable values without storing images', async () => {
  const source=fs.readFileSync(require('node:path').join(__dirname,'../api/cierre-foto.js'),'utf8').replace('export default async function handler','async function handler');
  let calls=[];
  const ctx={process:{env:{ANTHROPIC_API_KEY:'fixture'}},AbortSignal,
    fetch:async(url,opts)=>{calls.push({url,opts});if(url.includes('/auth/'))return {ok:true,json:async()=>({id:'fixture-user'})};return {ok:true,json:async()=>({content:[{type:'tool_use',input:{...foto(),turnos:[{cierre:null,mp:100,once:0,mpo:0}],gastos:[{nombre:'Arcor',monto:null}]} }]})};}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await ctx.handler({method:'POST',headers:{},body:{}},res);
  assert.equal(res.code,401);assert.equal(calls.length,0);
  await ctx.handler({method:'POST',headers:{authorization:'Bearer fixture-user'},body:{image:'a'.repeat(100),mime:'image/jpeg'}},res);
  assert.equal(res.code,200);assert.equal(res.body.turnos[0].cierre,null);assert.equal(res.body.turnos[0].once,0);
  assert.equal(res.body.gastos[0].monto,null);assert.equal(res.body.turnos[0].apertura,undefined);
  assert.equal(calls.length,2);assert.equal(res.body.image,undefined);
});
