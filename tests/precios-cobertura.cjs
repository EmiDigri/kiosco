const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const unitPrices=require('../price-unit.js');
const source=fs.readFileSync(path.join(__dirname,'../api/catalogo.js'),'utf8')
  .replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
function fixture(){
  const ctx=vm.createContext({unitPrices,process:{env:{}},URL,URLSearchParams,AbortController,setTimeout,clearTimeout});
  vm.runInContext(source,ctx);return ctx;
}
function product(name,extra={}){
  return {'@type':'Product',name,sku:name,brand:{name:'BIC'},weight:{value:0.05,unitCode:'KGM'},
    offers:{'@type':'Offer',price:'900',priceCurrency:'ARS',availability:'https://schema.org/InStock',url:'https://ramospapeleria.com.ar/productos/bic/',...extra}};
}
function page(products){return products.map(p=>`<script type="application/ld+json">${JSON.stringify(p)}</script>`).join('');}

test('stationery reads only available unit prices in ARS, never packs or aggregate/conditional prices',async()=>{
  const ctx=fixture();
  ctx.html=page([
    product('Boligrafo Bic Cristal Azul'),product('Boligrafo Bic Cristal Azul X 50'),product('Boligrafo Bic Cristal Negro'),
    product('Boligrafo Bic Azul sin stock',{availability:'https://schema.org/OutOfStock'}),
    product('Boligrafo Bic Azul desconocido',{availability:undefined}),
    product('Boligrafo Bic Azul dolares',{priceCurrency:'USD'}),
    product('Boligrafo Bic Azul minimo',{eligibleQuantity:{minValue:12}}),
    product('Boligrafo Bic Azul agregado',{'@type':'AggregateOffer',lowPrice:20}),
    product('Boligrafo Bic Azul stock cero',{inventoryLevel:{value:0}}),
    product('Boligrafo Bic Azul externo',{url:'https://otra-tienda.example/productos/bic/'}),
  ]);
  vm.runInContext('supplierFetch=async url=>{requestUrl=url;return html}',ctx);
  const items=await ctx.stationerySearch('birome bic azul',20,'ramos');
  assert.equal(items.length,1);
  assert.equal(items[0].unitPrice,900);
  assert.equal(items[0].ean,'');
  assert.equal(items[0].presentation,'Unidad');
  assert(ctx.requestUrl.includes('boligrafo%20bic%20azul'));
  assert(!items[0].presentation.includes('50g'),'shipping weight must not become presentation');
});

test('paper grammage and sheet abbreviations stay exact without admitting bundles',async()=>{
  const ctx=fixture();
  ctx.html=page([product('Resma Ledesma A4 75 Grms'),product('Resma Ledesma A3 75 Grms'),product('Resma Ledesma A4 80 Grms'),product('Resma Ledesma A4 75 Grms X 10')]);
  vm.runInContext('supplierFetch=async url=>{requestUrl=url;return html}',ctx);
  const rows=await ctx.stationerySearch('resma a4 75g',10,'ramos');
  assert.equal(rows.length,1);
  assert(!ctx.requestUrl.includes('a4'));
  assert(unitPrices.sameProduct({title:'Resma Ledesma A4 75 grms 500 hjs'},{title:'Resma Ledesma A4 75g 500 hojas'}));
  assert(!unitPrices.sameProduct({title:'Resma Ledesma A4 75 grms 500 hjs'},{title:'Resma Ledesma A4 80g 500 hojas'}));
  assert(unitPrices.isIndividual({title:'Resma Ledesma A4 x500hjs 75grms'}));
  assert(!unitPrices.isIndividual({title:'Resma Ledesma A4 75grms x10'}));
  for(const title of ['Marcador Filgo (x8 colores)','Set De Marcadores Filgo','Bic (x2 unidades)'])assert(!unitPrices.isIndividual({title}),title);
  assert(unitPrices.isIndividual({title:'Marcador Filgo (x1 azul)'}));
});

test('stationery reports unparseable pages as a failed source and does not cache them',async()=>{
  const ctx=fixture();ctx.html='<html>Service unavailable</html>';
  vm.runInContext('supplierFetch=async()=>html',ctx);
  await assert.rejects(ctx.stationerySearch('bic',10,'clips'),/no devolvió/);
  ctx.html='No encontramos productos';
  assert.equal((await ctx.stationerySearch('bic',10,'clips')).length,0);
});

test('Josimar isolates source, barcode and sizes and excludes unknown stock',async()=>{
  const ctx=fixture();
  const sku=(id,name,extra={})=>({itemId:id,name,ean:'7622300990152',measurementUnit:'un',unitMultiplier:1,
    sellers:[{sellerDefault:true,commertialOffer:{Price:12600,AvailableQuantity:1}}],...extra});
  ctx.rows=[{link:'https://www.josimar.com.ar/milka-almendras-155gr/p',brand:'Milka',items:[
    sku('one','Chocolate con Almendras Milka 155 gr'),sku('small','Chocolate con Almendras Milka 55 gr'),
    sku('unknown','Chocolate con Almendras Milka 155 gr',{sellers:[{sellerDefault:true,commertialOffer:{Price:100}}]}),
    sku('pack','Chocolate con Almendras Milka 155 gr',{unitMultiplier:6})
  ]}];
  vm.runInContext('supplierFetch=async url=>{requestUrl=url;return JSON.stringify(rows)}',ctx);
  const result=await ctx.josimarSearch('milka almendras 155g');
  assert.equal(result.length,1);assert.equal(result[0].id,'josimar:one');
  assert.equal(result[0].unitPrice,12600);assert.equal(result[0].ean,'7622300990152');
  assert(ctx.requestUrl.startsWith('https://www.josimar.com.ar/'));
});

test('new direct stores contribute to the reference and retain independent failure statuses',async()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../catalogo-ui.js'),'utf8');
  const ctx=fixture();
  vm.runInContext(ui.slice(ui.indexOf('  function combinedUnitReference('),ui.indexOf('  function renderDetail(')),ctx);
  const result=ctx.combinedUnitReference({sourceOffers:['josimar','ramos','clips'].map((source,i)=>({source,id:source,sourceLabel:source,referencePrice:1000+i*100,matchType:'same'}))});
  assert.equal(result.count,3);assert.equal(result.median,1100);
  vm.runInContext(`rappiSearch=open25Search=dulceSurSearch=diaSearch=async()=>[];
    josimarSearch=async()=>[];stationerySearch=async(q,n,source)=>{if(source==='ramos')throw Error('timeout');return []};`,ctx);
  const suppliers=await ctx.supplierSearch('resma');
  assert.equal(suppliers.sources.josimar,true);assert.equal(suppliers.sources.ramos,false);assert.equal(suppliers.sources.clips,true);
});
