const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const unitPrices=require('../price-unit.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../api/catalogo.js'),'utf8')
  .replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
function fixture(){const ctx=vm.createContext({unitPrices,process:{env:{}},URL,URLSearchParams,Map,Set,AbortController,setTimeout,clearTimeout});vm.runInContext(source,ctx);return ctx;}
test('queries suppliers without literal weight, but keeps exact size constraints',()=>{
  const ctx=fixture();
  for(const q of ['milka almendras 155g','milka almendras 155 g','milka almendras 155GR'])assert.equal(ctx.supplierQueryText(q),'milka almendras');
  assert(ctx.matchesRequestedSize({title:'Milka almendras',presentation:'0.155 kg'},'milka almendras 155g'));
  assert(!ctx.matchesRequestedSize({title:'Milka almendras',presentation:'55 g'},'milka almendras 155g'));
  assert(!ctx.matchesRequestedSize({title:'Milka almendras',presentation:'Unidad'},'milka almendras 155g'));
  assert(ctx.matchesRequestedSize({title:'Milka almendras'},'milka almendras'));
  assert.equal(ctx.supplierQueryText('155g'),'155g');
});
test('reads Rappi size by master product id, not cart quantity or another product',async()=>{
  const ctx=fixture();
  const products=[
    {masterProductId:65307,saleType:'U',unitType:'gr',quantity:155},
    {masterProductId:93376,saleType:'U',unitType:'gr',quantity:55},
  ];
  const html='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{products}})+'</script>'
    +'<script type="application/ld+json">'+JSON.stringify(products.map(p=>({'@type':'Product',name:'Milka Barra de Chocolate con Leche y Almendras',url:'https://www.rappi.com.ar/p/milka-'+p.masterProductId,offers:{price:12000}})))+'</script>';
  ctx.html=html;
  vm.runInContext('var requested=[];supplierFetch=async url=>{requested.push(url);return html}',ctx);
  const result=await ctx.rappiSearch('milka almendras 155g');
  assert.equal(result.length,1);
  assert.equal(result[0].presentation,'155 g');
  assert.equal(result[0].code,'65307');
  assert.equal(new URL(ctx.requested[0]).searchParams.get('query'),'milka almendras');
  assert.equal(ctx.rappiPresentations('<script id="__NEXT_DATA__">invalid</script>').size,0);
});
test('conflicting Rappi sizes are not guessed',()=>{
  const ctx=fixture();
  const rows=[155,55].map(quantity=>({masterProductId:1,saleType:'U',unitType:'gr',quantity}));
  assert.equal(ctx.rappiPresentations('<script id="__NEXT_DATA__">'+JSON.stringify(rows)+'</script>').get('1'),null);
});
