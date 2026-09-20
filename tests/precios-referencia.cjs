const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../catalogo-ui.js'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function combinedUnitReference('),source.indexOf('  function renderDetail(')),ctx);
const offer=(id,source,price,extra={})=>({id,source,sourceLabel:source,referencePrice:price,matchType:'same',...extra});
const reference=(offers,extra={})=>ctx.combinedUnitReference({sourceOffers:offers,...extra});
test('combines exact direct-sale sources, not delivery, alternatives or unavailable offers',()=>{
  const result=reference([
    offer('a','open25',1500,{matchType:'selected'}),offer('b','dulce-sur',1700),
    offer('c','rappi',4000),offer('d','open25',800,{matchType:'similar'}),
    offer('e','dulce-sur',900,{available:false}),
  ]);
  assert.equal(result.median,1600);
  assert.equal(result.count,2);
  assert.equal(result.min,1500);
  assert.equal(result.max,1700);
});
test('one source is not counted multiple times and empty results have no invented reference',()=>{
  const result=reference([offer('a','open25',1500),offer('a','open25',1500),offer('b','open25',1700)]);
  assert.equal(result.count,1);
  assert.equal(result.median,1600);
  assert.equal(reference([offer('a','rappi',2000)]),null);
  assert.equal(reference([offer('a','open25',0),offer('b','dulce-sur',NaN)]),null);
});
test('does not treat the minimum from Precios Claros as its median',()=>{
  assert.equal(reference([{...offer('pc','precios-claros',null),retailPrice:1000}]),null);
  const result=reference([offer('pc','precios-claros',null,{selected:true}),offer('a','open25',1600)],{retailReference:{median:1400}});
  assert.equal(result.median,1500);
  assert.equal(result.count,2);
});
