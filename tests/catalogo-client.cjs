const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const src = fs.readFileSync(require('node:path').join(__dirname, '../catalogo-ui.js'), 'utf8');
const slice = (a,b) => src.slice(src.indexOf(a),src.indexOf(b));
function fixture(fetcher) {
  const storage = new Map(), calls = [];
  const ctx = {
    CATALOG_STORAGE_KEY:'catalog', CATALOG_PENDING_KEY:'pending', SB_URL:'https://fixture.invalid',
    catRefreshPromise:null, catWriteQueue:Promise.resolve(), catLastSync:null, catSyncError:'',
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    catHeaders:async()=>({}), updateCatalogCount(){}, renderCatSyncStatus(){}, renderCatalog(){}, notify(){},
    catUid:()=> 'c_' + randomUUID(), crypto:require('node:crypto').webcrypto, TextEncoder, CustomEvent:class {constructor(type,data){this.type=type;this.detail=data?.detail;}},
    window:{kioscoAuth:{token:async()=> 'fixture'},dispatchEvent(){}},
    setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch:async(url,opts)=>{calls.push({url,...opts});return fetcher(url,opts,calls.length);},
  };
  vm.createContext(ctx);
  vm.runInContext(slice('  function readCatalog()', '  function catMargin(')
    + slice('  function catRecordToRow(', '  function catCountPending(')
    + slice('  async function catUpsert(', '  const CAT_ICONS')
    + slice('  async function catPriceIdentity(', '  async function calculateMetrics(')
    + slice('  function catMatchExistente(', '  async function catLeerFactura('),ctx);
  return {ctx, storage, calls};
}
const row = (version,stock,extra={}) => ({uid:'c_demo',nombre:'Alfajor Rasta blanco',ean:'7790000000013',categoria:'Golosinas',precio:1000,costo:500,version,stock,...extra});
const response = (data,status=200) => new Response(JSON.stringify(data),{status});

test('failed save does not alter confirmed stock or claim synchronization', async()=> {
  const {ctx} = fixture(async()=>response({message:'Rejected'},409));
  ctx.catMergeRows([row(1,10)]);
  await assert.rejects(ctx.catUpsert({...ctx.readCatalog().c_demo,stock:9}),/Rejected/);
  assert.equal(ctx.readCatalog().c_demo.stock,10);
  assert.equal(ctx.catPending(),null);
});
test('uncertain response survives and retry uses the same operation ID',async()=> {
  const {ctx,calls} = fixture(async(url,opts,n)=> {
    if(n===1)throw new TypeError('connection lost');
    const request=JSON.parse(opts.body);
    return response({id:request.p_id,productos:[row(2,9)]});
  });
  await assert.rejects(ctx.catRpc('venta',{items:[{uid:'c_demo',cantidad:1,precio:1000}],medio_pago:'mp'}));
  assert.ok(ctx.catPending());
  await assert.rejects(ctx.catRpc('entrada',{items:[]}),/pendiente/);
  assert.equal(calls.length,1);
  await ctx.catRpc(null,null,true);
  assert.equal(JSON.parse(calls[0].body).p_id,JSON.parse(calls[1].body).p_id);
  assert.equal(ctx.catPending(),null); assert.equal(ctx.readCatalog().c_demo.stock,9);
});
test('late reads cannot undo newer stock or resurrect archived products',()=> {
  const {ctx}=fixture(()=>{});
  ctx.catMergeRows([row(2,9)]);ctx.catMergeRows([row(1,10)]);
  assert.equal(ctx.readCatalog().c_demo.stock,9);
  ctx.catMergeRows([row(3,9,{archived_at:'2026-09-08T12:00:00Z'})]);
  ctx.catMergeRows([row(2,9)]);
  assert.equal(ctx.readCatalog().c_demo,undefined);
});
test('metadata save does not send an unspecified stock', async()=> {
  const {ctx,calls}=fixture(async(url,opts)=>response({id:JSON.parse(opts.body).p_id,productos:[row(2,8)]}));
  ctx.catMergeRows([row(1,8)]);
  const {stock,...metadata}=ctx.readCatalog().c_demo;
  await ctx.catUpsert({...metadata,precio:1200});
  assert.equal(Object.hasOwn(JSON.parse(calls[0].body).p_datos,'stock'),false);
});
test('invoice variants and conflicting barcodes never match by resemblance',()=> {
  const {ctx}=fixture(()=>{});ctx.catMergeRows([row(1,10)]);
  assert.equal(ctx.catMatchExistente({descripcion:'Alfajor Rasta negro',ean:'7790000000020'}),null);
  assert.equal(ctx.catMatchExistente({descripcion:'Alfajor Rasta negro'}),null);
  assert.equal(ctx.catMatchExistente({descripcion:' ALFAJOR RASTA BLANCO '}).uid,'c_demo');
  assert.equal(ctx.catMatchExistente({descripcion:'Alfajor Rasta blanco',ean:'7790000000020'}),null);
});
test('supplier IDs have stable product identities but are not saved as barcodes',async()=> {
  const {ctx}=fixture(()=>{});
  const one=await ctx.catPriceIdentity({ean:'rappi-abc-123'}), two=await ctx.catPriceIdentity({ean:'rappi-abc-123'});
  assert.equal(one.uid,two.uid);assert.equal(one.ean,null);assert.match(one.uid,/^c_ref_[0-9a-f]+$/);
  assert.equal((await ctx.catPriceIdentity({ean:'7790000000013'})).ean,'7790000000013');
});
