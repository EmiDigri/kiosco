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
// Casos reales de "beldent": nombres abreviados de Precios Claros contra Rappi.
const beldent=[
  {title:'Beldent Chicle Sabor Menta',image:'https://img/menta.png'},
  {title:'Beldent Chicle Frutilla',image:'https://img/frutilla.png'},
  {title:'Beldent Chicle Sandia Dulce',image:'https://img/sandia.png'},
  {title:'Beldent Goma de Mascar Sabor a Mentol',image:'https://img/mentol.png'},
];
test('entiende abreviaturas y palabras de relleno (sabor, goma de mascar)',()=>{
  const ctx=fixture();
  assert.equal(ctx.sameProductImage('BELDENT Chicle sabor Sandia Beldent 10 Gr',beldent),'https://img/sandia.png');
  assert.equal(ctx.sameProductImage('BELDENT Chicle Menta Beldent 10 Gr',beldent),'https://img/menta.png');
  assert.equal(ctx.sameProductImage('Chicle Beldent Mentol',beldent),'https://img/mentol.png');
  assert(ctx.tokenCoincide('sand','sandia')&&ctx.tokenCoincide('frut','frutilla')&&ctx.tokenCoincide('xtra','extra'));
});
test('la version base solo como ultimo recurso y sin sumar otro sabor',()=>{
  const ctx=fixture();
  assert.equal(ctx.sameProductImage('BELDENT Chicle Menta Fuerte Beldent 10 Gr',beldent),null);
  assert.equal(ctx.sameProductImage('BELDENT Chicle Menta Fuerte Beldent 10 Gr',beldent,true),'https://img/menta.png');
  assert.equal(ctx.sameProductImage('BELDENT Chicle Beldent Xtra Menta',beldent,true),'https://img/menta.png');
  // "Intense" nunca toma la de Frutilla, ni siquiera como version base (agrega sabores propios).
  assert.equal(ctx.sameProductImage('Cadbury Intense 162 Gr',rappi,true),'https://img/intense-162.png');
  assert.equal(ctx.sameProductImage('Cadbury Intense 162 Gr',[{title:'Chocolate Cadbury Relleno Yoghurt Frutilla 162g',image:'https://img/x.png'}],true),null);
});
test('limpia el "None none" y el "Sin marca" de Precios Claros',()=>{
  const ctx=fixture();
  const p=ctx.normalizeProduct({id:'0000077998460',nombre:'Chicle Beldent Tropical Mix X10g.',marca:'Sin marca',presentacion:'None none'});
  assert.equal(p.presentation,'');
  assert.equal(p.brand,'');
});
test('arma las candidatas: oficial por EAN primero y proveedor de respaldo',()=>{
  const ctx=fixture();
  const item=ctx.withImages({ean:'7622201800505',brand:'CADBURY',name:'Tableta de Chocolate Intense Cadbury 162 Gr'},rappi);
  assert.equal(item.images[0],'https://imagenes.preciosclaros.gob.ar/productos/7622201800505.jpg');
  assert.equal(item.images[1],'https://img/intense-162.png');
  assert.equal(ctx.withImages({ean:'3-1-0000000021565',name:'X'},[]).images.length,0);
});
test('la foto exacta por codigo (Carrefour/Jumbo) va primero; el codigo se limpia',()=>{
  const ctx=fixture();
  assert.equal(ctx.eanLimpio('0000077998460'),'77998460');
  assert.equal(ctx.eanLimpio('7622202218033'),'7622202218033');
  assert.equal(ctx.eanLimpio('3-1-0000000021565'),null);
  const item=ctx.withImages({ean:'7622202218033',brand:'BELDENT',name:'Chicle Beldent Twist Sand'},beldent,'https://carrefourar.vteximg.com.br/x.jpg');
  assert.equal(item.images[0],'https://carrefourar.vteximg.com.br/x.jpg');
  assert.equal(item.images[1],'https://imagenes.preciosclaros.gob.ar/productos/7622202218033.jpg');
});
