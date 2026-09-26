const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const unitPrices=require('../price-unit.js');
const api=fs.readFileSync(path.join(__dirname,'../api/catalogo.js'),'utf8')
  .replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
function fixture(){
  const ctx=vm.createContext({unitPrices,process:{env:{}},URL,URLSearchParams,AbortController,setTimeout,clearTimeout});
  vm.runInContext(api,ctx);return ctx;
}

test('audit: rejects abbreviated boxes and branded merchandise, not stationery sheets',()=>{
  for(const title of ['Bombon Supreme Bon O Bon Cja 144 Grm','Bombones Bon O Bon Cj. 270g','Bon o bon cjs 480g','Bic estuche 12'])assert(!unitPrices.isIndividual({title}),title);
  for(const title of ['Copa termica Coca Cola 500ml','Llavero Milka','Vaso Coca Cola 500ml','Termo Coca Cola 1l'])assert(!unitPrices.matchesSearch({title},'coca cola'),title);
  assert(unitPrices.matchesSearch({title:'Resma Ledesma A4 x 500 hojas'},'resma a4'));
  assert(unitPrices.matchesSearch({title:'Bombon Bon O Bon 15 Grm'},'bon o bon 15g'));
});

test('audit: identifies real brands instead of showing the supplier as a brand',()=>{
  for(const [title,brand] of [['Lays Papas Fritas Clasicas 85g','Lays'],['Kinder Bueno 43g','Kinder'],['Birome Bic Azul','Bic'],['Gaseosa Coca-Cola 500ml','Coca Cola']]){
    assert.equal(unitPrices.brandOf({title}),brand);
  }
  assert.equal(unitPrices.brandOf({title:'Birome sin identificar',brand:'Rappi Buenos Aires'}),'');
  assert.equal(unitPrices.brandOf({title:'Galletitas Oreo 118g',brand:'Mondelez'}),'Oreo');
});

test('audit: merges exact Lays duplicates without merging sizes, flavours or brands',()=>{
  const items=['Lays Clasicas 85grs','Lays Papas Fritas Clasicas 85 g','Lays Clasicas 40g','Lays Onduladas 85g','Doritos Clasicas 85g'].map(title=>({title}));
  const groups=unitPrices.groupProducts(items);
  assert.equal(groups.length,4);
  assert.equal(groups[0].length,2);
  assert(unitPrices.sameProduct(items[0],{title:"Lay's Papas Fritas Clasicas",presentation:'85g'}));
  assert(!unitPrices.sameProduct(items[0],{title:'Lays Clasicas'}));
});

test('grouping cannot bridge contradictory barcodes through an item without EAN',()=>{
  const item={title:'Galletitas Oreo 118g'};
  const groups=unitPrices.groupProducts([{...item,ean:'4006381333931'},item,{...item,ean:'5901234123457'}]);
  assert.equal(groups.length,2);
  assert.equal(groups[0].length,2);
});

test('Dia takes the available default seller unit price, never teasers, kits or weight prices',async()=>{
  const ctx=fixture();
  const item=(id,extra={})=>({itemId:id,ean:'7790895000782',name:'Gaseosa Coca-Cola 500ml',measurementUnit:'un',unitMultiplier:1,
    images:[],sellers:[{sellerDefault:true,commertialOffer:{Price:1901,AvailableQuantity:10,Teasers:[{price:500}],ListPrice:2300}},{sellerDefault:false,commertialOffer:{Price:100,AvailableQuantity:10}}],...extra});
  ctx.rows=[{brand:'COKE/COCACOLA',link:'https://diaonline.supermercadosdia.com.ar/coca/p',categories:['/Bebidas/'],items:[
    item('unit'),item('pack',{name:'Coca Cola Cja 500ml'}),item('multiplier',{unitMultiplier:6}),item('weight',{measurementUnit:'kg'}),item('kit',{isKit:true}),
    item('empty',{sellers:[{sellerDefault:true,commertialOffer:{Price:1901,AvailableQuantity:0}}]}),item('unknown',{unitMultiplier:null})
  ]}];
  vm.runInContext('supplierFetch=async()=>JSON.stringify(rows)',ctx);
  const result=await ctx.diaSearch('coca cola 500 ml');
  assert.equal(result.length,1);
  assert.equal(result[0].id,'dia:unit');
  assert.equal(result[0].unitPrice,1901);
  assert.equal(result[0].ean,'7790895000782');
  assert.equal(result[0].source,'dia');
});

test('audit: source status acknowledges the selected search price even if a later search misses it',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../catalogo-ui.js'),'utf8');
  const ctx=vm.createContext({escapeHtml:value=>String(value||'')});
  vm.runInContext(code.slice(code.indexOf('  function sourceStatusHtml('),code.indexOf('  async function completeComparison(')),ctx);
  const result={items:[],supplierItems:[]},offers=[{source:'rappi',retailPrice:4100}];
  const html=ctx.sourceStatusHtml({rappi:true},[],result,offers);
  assert(html.includes('Precio encontrado en la búsqueda inicial'));
  assert(!html.includes('Sin coincidencia'));
  assert(ctx.sourceStatusHtml({rappi:false},[],result,offers).includes('No respondió'));
  assert(ctx.sourceStatusHtml({dia:true},[],{supplierItems:[{source:'dia'}]}).includes('Coincidencia encontrada'));
});

test('comparison retains already confirmed offers if a narrower search misses them',async()=>{
  const code=fs.readFileSync(path.join(__dirname,'../catalogo-ui.js'),'utf8');
  const selected={id:'dia:1',source:'dia',matchType:'selected',retailPrice:3150};
  const prior={id:'rappi:2',source:'rappi',matchType:'same',retailPrice:4100};
  const data={sourceOffers:[selected,prior]};
  const ctx=vm.createContext({state:{detail:data,detailRequest:1},apiRequest:async()=>({items:[],supplierItems:[],sources:{rappi:true,dia:true}}),sourceOffersFor:()=>[selected],refreshReference:()=>{}});
  vm.runInContext(code.slice(code.indexOf('  async function completeComparison('),code.indexOf('  function refreshReference(')),ctx);
  await ctx.completeComparison({title:'Lays 85g'},1);
  assert.equal(data.sourceOffers.length,2);
  assert.equal(data.sourceOffers[1].id,'rappi:2');
  assert.equal(data.comparisonPending,false);
});
