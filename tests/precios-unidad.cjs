const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const unitPrices=require('../price-unit.js');

test('keeps individual food and stationery, including their measurements and sheet counts',()=>{
  for(const title of ['Alfajor Rasta Negro 70g','Chocolate Milka 100 g','Galletitas Oreo paquete 118g','Resma Boreal A4 75grs','Resma A4 x 500 hojas','Resma 210 x 297 mm','Cuaderno x 100 hojas','Birome azul 1 unidad','Coca Cola x 2,25 litros','Azucar x 1000 gramos']){
    assert(unitPrices.isIndividual({title,source:'rappi',priceType:'retail'}),title);
  }
});
test('rejects multiple items, unverified wholesale offers and minimum purchases',()=>{
  for(const title of ['Alfajor Rasta Negro 70g - Pack x 6un','Alfajor Rasta Negro 70g - Caja x 18un','Rasta 70g x18','Rasta 70g x6un','Gaseosa 6 unidades','Alfajor 2x70g','Biromes caja de 50','Combo golosinas','Lote de resmas','Chocolate desde 6 unidades','Chocolate minimo 12 unidades','Oreo tripack','Promo 2x1'])assert(!unitPrices.isIndividual({title}),title);
  for(const extra of [{source:'dulce-sur'},{source:'casa-paso'},{priceType:'wholesale'},{minimum:6},{packUnits:12},{unitsPerPack:2},{saleFormat:'Pack'}])assert(!unitPrices.isIndividual({title:'Alfajor',...extra}),JSON.stringify(extra));
});
test('accepts a wholesaler only with verified individual sale, never a divided box price',()=>{
  for(const source of ['dulce-sur','casa-paso','otro-proveedor']){
    const item={source,title:'Alfajor negro 70g',priceType:'wholesale',unitSaleVerified:true,minimum:1};
    assert(unitPrices.isIndividual(item));
    assert(!unitPrices.isIndividual({...item,minimum:6}));
    assert(!unitPrices.isIndividual({...item,priceBasis:'pack-derived'}));
    assert(!unitPrices.isIndividual({...item,title:'Alfajor caja x18'}));
  }
});

function apiFixture(){
  const source=fs.readFileSync(path.join(__dirname,'../api/catalogo.js'),'utf8').replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
  const ctx=vm.createContext({unitPrices,process:{env:{}},URL,URLSearchParams,Map,Set,AbortController,setTimeout,clearTimeout,console});
  vm.runInContext(source,ctx);
  vm.runInContext(`
    var calls=[];
    var unit={ean:'7790000000013',nombre:'Rasta negro',marca:'Rasta',presentacion:'70g',precioMin:1800,precioMax:1900};
    searchSource=async kind=>{calls.push(kind);return {products:[unit],branches:[]}};
    rappiSearch=async()=>[{id:'rappi:1',title:'Rasta negro 70g',priceType:'retail',source:'rappi',unitPrice:1800}];
    open25Search=async()=>[{id:'open25:1',title:'Rasta negro - Pack x 6un',priceType:'retail',source:'open25',unitPrice:7040}];
    casaPasoSearch=async()=>{throw new Error('Unverified wholesale source must not run')};
    dulceSurSearch=async()=>[{id:'dulce:unit',source:'dulce-sur',title:'Rasta negro 70g',priceType:'unit',unitSaleVerified:true,minimum:1,unitPrice:1700}, {id:'dulce:pack',source:'dulce-sur',title:'Rasta caja x18',unitPrice:900}];
    detailSource=async kind=>{calls.push(kind);return {product:{ean:'7790000000013',name:'Rasta negro',presentation:'70g'},rows:[{price:1800,updatedToday:true}]}};
    productImage=async()=>null;
    mlEnabled=()=>false;
  `,ctx);
  return ctx;
}
test('search and detail query retail only and never return a pack as a unit price',async()=>{
  const ctx=apiFixture();
  const search=await ctx.handleSearch('rasta',-34.6,-58.38,'caba');
  assert.deepEqual(Array.from(ctx.calls),['retail']);
  assert.equal(search.supplierItems.length,2);
  assert.equal(search.supplierItems[0].unitPrice,1800);
  assert.equal(search.sources.open25,true);
  assert.equal(search.sources.dulceSur,true);
  assert.equal(search.supplierItems[1].unitPrice,1700);
  assert(!('wholesale' in search.sources));
  const detail=await ctx.handleDetail('7790000000013',-34.6,-58.38,'caba');
  assert.equal(detail.retailReference.median,1800);
  assert(!('wholesaleReference' in detail));
  assert.deepEqual(Array.from(ctx.calls),['retail','retail']);
});
test('Dulce Sur uses the explicit single item price, not the cheaper box price',async()=>{
  const ctx=apiFixture();
  vm.runInContext(sourceDulce(),ctx);
  vm.runInContext(`dulceSurJson=async table=>table==='productos'
    ? ['unit','box','unknown','nostock'].map(id=>({id,nombre:'Alfajor Rasta negro 70g',stock:id==='nostock'?0:10,precio:800,mostrar_precio_unidad:true}))
    : [
      {producto_id:'unit',cantidad:1,nombre:'Unidad',precio:1600},
      {producto_id:'unit',cantidad:18,nombre:'Caja x18',precio:18000},
      {producto_id:'box',cantidad:18,nombre:'Caja x18',precio:18000},
      {producto_id:'unknown',cantidad:null,nombre:'Unidad',precio:700},
      {producto_id:'nostock',cantidad:1,nombre:'Unidad',precio:1500}
    ];`,ctx);
  const items=await ctx.dulceSurSearch('rasta');
  assert.equal(items.length,1);
  assert.equal(items[0].unitPrice,1600);
  assert.equal(items[0].minimum,1);
  assert.equal(items[0].unitSaleVerified,true);
  assert(!('packPrice' in items[0]));
});
function sourceDulce(){
  const source=fs.readFileSync(path.join(__dirname,'../api/catalogo.js'),'utf8');
  return source.slice(source.indexOf('async function dulceSurSearch('),source.indexOf('function rappiQuery('));
}
test('Mercado Libre fallback does not use the first similarly named item as an exact price',async()=>{
  const ctx=apiFixture();
  vm.runInContext(`mlEnabled=()=>true;mlSearch=async()=>({items:[{ean:'7790000000020',reference:{median:999},image:'wrong-product.jpg'}]});`,ctx);
  const detail=await ctx.handleDetail('7790000000013',-34.6,-58.38,'caba');
  assert.equal(detail.mlReference,null);
  assert.equal(detail.image,null);
});
