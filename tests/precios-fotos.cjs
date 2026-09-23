// Fotos de Precios: la foto se elige por PRODUCTO (marca + sabor/variante), no por
// tamaño, y nunca se acepta otro sabor. Casos reales de la búsqueda "cadbury".
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const unitPrices=require('../price-unit.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../api/catalogo.js'),'utf8')
  .replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
function fixture(){const ctx=vm.createContext({unitPrices,process:{env:{}},URL,URLSearchParams,Map,Set,AbortController,setTimeout,clearTimeout});vm.runInContext(source,ctx);return ctx;}
const rappi=[
  {title:'Cadbury Chocolate Intense 162 g',image:'https://img/intense-162.png'},
  {title:'Chocolate Cadbury Intense 25g',image:'https://img/intense-25.png'},
  {title:'Chocolate Cadbury Tres Sueños 25g',image:'https://img/tres-suenos-25.png'},
  {title:'Chocolate Cadbury Relleno Yoghurt Frutilla 162g',image:'https://img/frutilla-162.png'},
  {title:'Chocolate con Almendras Cadbury 82g',image:'https://img/almendras-82.png'},
];
test('elige el mismo sabor aunque cambie el tamaño',()=>{
  const ctx=fixture();
  assert.equal(ctx.sameProductImage('Cadbury Chocolate con Almendras Cadbury 72 Gr',rappi),'https://img/almendras-82.png');
  assert.equal(ctx.sameProductImage('Cadbury Tableta de Chocolate Tres Sueños Cadbury 80 Gr',rappi),'https://img/tres-suenos-25.png');
  assert.equal(ctx.sameProductImage('Cadbury Tableta de Chocolate con Yogur Frutilla Cadbury 29 Gr',rappi),'https://img/frutilla-162.png');
});
test('prefiere el mismo tamaño y, si no hay, el más cercano',()=>{
  const ctx=fixture();
  assert.equal(ctx.sameProductImage('Cadbury Tableta de Chocolate Intense Cadbury 162 Gr',rappi),'https://img/intense-162.png');
  assert.equal(ctx.sameProductImage('Cadbury Chocolate Intense Cadbury 24 Gr',rappi),'https://img/intense-25.png');
});
test('nunca usa la foto de otro sabor u otra marca',()=>{
  const ctx=fixture();
  assert.equal(ctx.sameProductImage('Cadbury Intense 162 Gr',[{title:'Chocolate Cadbury Relleno Yoghurt Frutilla 162g',image:'https://img/x.png'}]),null);
  assert.equal(ctx.sameProductImage('Milka Almendras 155g',[{title:'Chocolate con Almendras Cadbury 82g',image:'https://img/y.png'}]),null);
});
test('arma las candidatas: oficial por EAN primero y proveedor de respaldo',()=>{
  const ctx=fixture();
  const item=ctx.withImages({ean:'7622201800505',brand:'CADBURY',name:'Tableta de Chocolate Intense Cadbury 162 Gr'},rappi);
  assert.equal(item.images[0],'https://imagenes.preciosclaros.gob.ar/productos/7622201800505.jpg');
  assert.equal(item.images[1],'https://img/intense-162.png');
  assert.equal(ctx.withImages({ean:'3-1-0000000021565',name:'X'},[]).images.length,0);
});
