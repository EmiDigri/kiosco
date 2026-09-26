const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const unitPrices=require('../price-unit.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../api/catalogo.js'),'utf8')
  .replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
function fixture(){
  const ctx=vm.createContext({unitPrices,process:{env:{}},URL,URLSearchParams,AbortController,setTimeout,clearTimeout});
  vm.runInContext(source,ctx);return ctx;
}
const selected={name:'Chocolate Milka leche almendras 155g',brand:'Milka',presentation:'155g'};

test('selection searches suppliers and official stores again with the full identity',async()=>{
  const ctx=fixture();
  ctx.product=selected;
  vm.runInContext(`
    var queries=[];
    searchSource=async(kind,q)=>{queries.push(q);return {products:[{id:'4006381333931',nombre:product.name,marca:'Milka'}]}};
    detailSource=async()=>({product:{...product,ean:'4006381333931'},rows:[{price:4000},{price:6000}]});
    supplierSearch=async(q)=>{queries.push(q);return {items:[
      {id:'new',source:'open25',title:'Choc.Leche C/Alm.Milka 0,155 kg',brand:'Milka',unitPrice:5500},
      {id:'wrong',source:'open25',title:'Chocolate Milka leche almendras 55g',brand:'Milka',unitPrice:1500},
      {id:'pack',source:'open25',title:'Chocolate Milka leche almendras 155g pack x6',brand:'Milka',unitPrice:1000}
    ],sources:{open25:true,rappi:false,dulceSur:true}}};
  `,ctx);
  const result=await ctx.handleCompare(selected,-34.6,-58.4,'caba');
  assert.equal(ctx.queries.length,2);
  assert(ctx.queries.every(q=>q.includes('155g')&&q.includes('almendra')&&q.includes('milka')));
  assert.deepEqual(Array.from(result.supplierItems,item=>item.id),['new']);
  assert.equal(result.items[0].referencePrice,5000);
  assert.equal(result.items[0].retail.min,4000);
  assert.equal(result.sources.rappi,false);
});

test('valid barcode queries the exact official detail and rejects contradictory sizes',async()=>{
  const ctx=fixture();ctx.product={...selected,ean:'4006381333931'};
  vm.runInContext(`
    searchSource=async()=>{throw new Error('must not search by text')};
    detailSource=async(kind,ean)=>({product:{...product,presentation:'55g',name:'Chocolate Milka leche almendras 55g'},rows:[{price:500} ]});
    supplierSearch=async()=>({items:[],sources:{open25:true,rappi:true,dulceSur:true}});
  `,ctx);
  const result=await ctx.handleCompare(ctx.product,0,0,'caba');
  assert.equal(result.items.length,0);
  assert.equal(result.sources.retail,true);
});

test('source errors are distinct from a successful query with zero matches',async()=>{
  const ctx=fixture();
  vm.runInContext(`
    searchSource=async()=>{throw new Error('unavailable')};
    open25Search=async()=>[];rappiSearch=async()=>{throw new Error('timeout')};dulceSurSearch=async()=>[];
  `,ctx);
  const result=await ctx.handleCompare(selected,0,0,'caba');
  assert.equal(result.sources.retail,false);
  assert.equal(result.sources.rappi,false);
  assert.equal(result.sources.open25,true);
  assert.equal(result.sources.dulceSur,true);
  assert.equal(result.supplierItems.length,0);
});

test('official search and branch failures cannot masquerade as no products',async()=>{
  const ctx=fixture();
  vm.runInContext(`getBranches=async()=>{throw new Error('branches down')};`,ctx);
  await assert.rejects(ctx.getCoverageBranches('retail',0,0,'caba'),/branches down/);
  vm.runInContext(`getCoverageBranches=async()=>[{id:'1'}];officialJson=async()=>{throw new Error('products down')};`,ctx);
  await assert.rejects(ctx.searchSource('retail','milka',0,0,'caba'),/products down/);
});

test('partial official results remain useful but are marked incomplete',async()=>{
  const ctx=fixture();
  vm.runInContext(`
    getCoverageBranches=async()=>Array.from({length:66},(_,i)=>({id:String(i)}));
    var calls=0;
    officialJson=async()=>{if(++calls===1)throw new Error('one chunk failed');return {productos:[{id:'4006381333931',nombre:'Chocolate Milka almendras 155g',marca:'Milka'}]}};
  `,ctx);
  const result=await ctx.searchSource('retail','milka',0,0,'caba');
  assert(result.partial);
  assert.equal(result.products.length,1);
});

test('comparison validates single items and does not cache failed sources',async()=>{
  const ctx=fixture();let payload,status;const headers={};
  const res={setHeader:(k,v)=>{headers[k]=v},status(s){status=s;return this},json(data){payload=data}};
  await ctx.handler({method:'GET',query:{action:'compare',name:'Chocolate Milka pack x6'}},res);
  assert.equal(status,400);
  vm.runInContext(`handleCompare=async()=>({items:[],supplierItems:[],sources:{retail:false,open25:true}});`,ctx);
  await ctx.handler({method:'GET',query:{action:'compare',...selected}},res);
  assert.equal(status,200);
  assert.equal(headers['Cache-Control'],'no-store');
  assert.equal(payload.sources.retail,false);
});

test('a slow source has a deadline and cannot hold all comparisons indefinitely',async()=>{
  const ctx=fixture();
  await assert.rejects(ctx.comparisonDeadline(new Promise(()=>{}),5),/tardó demasiado/);
  assert.equal(await ctx.comparisonDeadline(Promise.resolve('ok'),1000),'ok');
});
