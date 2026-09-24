const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const unitPrices=require('../price-unit.js');
const matches=(title,q,extra={})=>unitPrices.matchesSearch({title,...extra},q);

test('requires every requested attribute, not a relevance score or a substring',()=>{
  assert(matches('Chocolate Milka con Almendras 155g','milka almendras 155g'));
  assert(matches('Choc.Leche C/Alm.Milka 0,155 kg','milka almendras 155g'));
  for(const title of ['Chocolate Milka Oreo 155g','Chocolate Milka Almendras 55g','Chocolate Aguila Almendras 155g','Chocolate Milka Almendras','Chocolate Milkado Almendras 155g'])assert(!matches(title,'milka almendras 155g'),title);
  assert(matches('Alfajor Rasta negro 70g','rasta'));
  assert(matches('Alfajor Rasta blanco 70g','rasta'));
  assert(!matches('Alfajor Rasta blanco 70g','rasta negro'));
});

test('rejects cleaning products even with misleading category or food words',()=>{
  for(const title of ['Jabon de almendras 155g','Detergente Rasta negro','Limpiador chocolate Milka 155g','Lavandina Ayudin','Shampoo de coco','Esponja Arcor','Suavizante vainilla','Leche limpiadora','Remera Milka','Vaso Coca Cola']){
    assert(!unitPrices.isKioskProduct({title,category:'Kiosco'}),title);
  }
  assert(!unitPrices.isKioskProduct({title:'Repuesto universal',category:'Kiosco'}));
  assert(!unitPrices.isKioskProduct({title:'Chocolate',category:'Limpieza'}));
});

test('retains stationery, everyday kiosk products and verified single-unit offers',()=>{
  for(const [title,q] of [['Resma Autor A4 75g 500 hojas','resma'],['Boligrafo Bic azul','birome bic azul'],['Marcador Filgo negro','fibron filgo'],['Bombon Bon o Bon 15g','bonobon'],['Gaseosa Coca Cola 1500 ml','coca cola 1,5 litros'],['Azucar Ledesma 1kg','azucar'],['Pilas Duracell AA','pilas'],['Encendedor Bic','encendedor']])assert(matches(title,q),title);
  assert(matches('Alfajor Rasta negro 70g','rasta',{source:'dulce-sur',unitSaleVerified:true,minimum:1}));
  assert(!matches('Alfajor Rasta negro caja x18','rasta'));
  assert(!matches('Alfajor Rasta negro 70g','rasta',{source:'dulce-sur',minimum:18}));
});

test('autocomplete may complete the last word but submitted searches cannot',()=>{
  const item={title:'Chocolate Milka almendras 155g'};
  assert(unitPrices.matchesSearch(item,'milka alm',{partial:true}));
  assert(unitPrices.matchesSearch(item,'mil',{partial:true}));
  assert(!unitPrices.matchesSearch(item,'mil'));
  assert(!unitPrices.matchesSearch(item,'milka avell',{partial:true}));
  assert(!matches('Chocolate con azucar','chocolate sin azucar'));
  assert(!matches('Chocolate sin azucar','chocolate con azucar'));
});

test('barcode search matches actual identifiers, never a supplier SKU',()=>{
  assert(matches('Chocolate Milka','4006381333931',{ean:'04006381333931'}));
  assert(!matches('Chocolate Milka','4006381333931',{code:'4006381333931'}));
});

const api=fs.readFileSync(path.join(__dirname,'../api/catalogo.js'),'utf8')
  .replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
function fixture(){
  const ctx=vm.createContext({unitPrices,process:{env:{}},URL,URLSearchParams,AbortController,setTimeout,clearTimeout});
  vm.runInContext(api,ctx);return ctx;
}

test('official search discards irrelevant results before limits and before fallback stops',async()=>{
  const ctx=fixture();
  vm.runInContext(`
    var calls=0;
    getCoverageBranches=async()=>[{id:'1'}];
    officialJson=async()=>({productos:++calls===1
      ? Array.from({length:50},(_,i)=>({id:String(i),nombre:'Jabon de almendras 155g',marca:'Milka'}))
      : [{id:'4006381333931',nombre:'Chocolate Milka almendras 155g',marca:'Milka'}]});
  `,ctx);
  const result=await ctx.searchSource('retail','chocolate milka almendras 155g',0,0,'caba');
  assert.equal(ctx.calls,2);
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].id,'4006381333931');
});

test('suggestions and Mercado Libre fallback enforce the same scope and query',async()=>{
  const ctx=fixture();
  vm.runInContext(`
    var rows=[{title:'Chocolate Milka almendras 155g'},{title:'Chocolate Milka Oreo 155g'},{title:'Jabon Milka almendras 155g'}];
    rappiSearch=async()=>rows;open25Search=async()=>[];dulceSurSearch=async()=>[];
    mlSearch=async()=>({items:rows});
  `,ctx);
  const suggested=await ctx.supplierSearch('milka almend',6,{partial:true});
  assert.equal(suggested.items.length,1);
  let payload;
  const res={setHeader(){},status(){return this},json(data){payload=data}};
  await ctx.handler({method:'GET',query:{action:'ml',q:'milka almendras 155g'}},res);
  assert.equal(payload.items.length,1);
  assert.equal(payload.items[0].title,'Chocolate Milka almendras 155g');
});

test('comparison collects only the selected product and confirmed equivalents',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../catalogo-ui.js'),'utf8');
  const selected={id:'a',source:'open25',brand:'Rasta',title:'Alfajor Rasta negro 70g',unitPrice:1500};
  const exact={...selected,id:'b',source:'rappi'};
  const ctx=vm.createContext({isIndividual:unitPrices.isIndividual,catalogText:s=>s.toLowerCase(),state:{items:[],supplierItems:[selected,exact,{...exact,id:'c',title:'Alfajor Rasta blanco 70g'},{...exact,id:'d',title:'Alfajor Rasta negro 40g'}]}});
  vm.runInContext(source.slice(source.indexOf('  function supplierMatchTokens('),source.indexOf('  function supplierDetailData(')),ctx);
  const offers=ctx.sourceOffersFor(selected);
  assert.deepEqual(Array.from(offers,row=>row.id),['a','b']);
  assert(offers.every(row=>row.matchType!=='similar'));
});
