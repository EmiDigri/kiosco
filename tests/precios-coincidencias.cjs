const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../catalogo-ui.js'),'utf8');
const matchSource=source.slice(source.indexOf('  function samePriceProduct('),source.indexOf('  function sourceOffer('));
const ctx=vm.createContext({window:{KioscoPriceUnit:require('../price-unit.js')}});
vm.runInContext(matchSource,ctx);
const same=ctx.samePriceProduct;
const item=(title,extra={})=>({title,brand:'Marca de prueba',...extra});

test('requires the same weight, variety, sheet count and format',()=>{
  for(const [a,b] of [
    ['Alfajor Rasta negro 70g','Alfajor Rasta negro 40g'],
    ['Alfajor Rasta negro 70g','Alfajor Rasta blanco 70g'],
    ['Resma Autor A4 70g 500 hojas','Resma Autor A4 80g 500 hojas'],
    ['Resma Autor A4 70g 500 hojas','Resma Autor A3 70g 500 hojas'],
    ['Resma Autor A4 70g 500 hojas','Resma Autor A4 70g 100 hojas'],
    ['Alfajor Rasta negro 70g','Alfajor Rasta negro'],
    ['Alfajor Rasta negro 70g','Alfajor Rasta negro 2x70g'],
    ['Birome Bic azul','Birome Bic roja'],
  ])assert.equal(same(item(a),item(b)),false,`${a} / ${b}`);
});
test('normalizes units and ordering without discarding sizes',()=>{
  for(const [a,b] of [
    ['Alfajor Rasta negro 70g','Rasta Alfajor negro x 70 gramos'],
    ['Chocolate Milka 100g','Chocolate Milka 0,1 kg'],
    ['Gaseosa Coca Cola 1,5 litros','Coca Cola Gaseosa 1500 ml'],
    ['Resma Autor A4 75 grs x500 hojas','Resma Autor A4 75 g 500 hojas'],
    ['Choc.Leche C/Alm.Milka 0,155 kg','Chocolate Milka con leche y almendras 155g'],
    ['Birome Bic azul','Boligrafo Bic azul'],
    ['Bombon Bon o Bon 15g','Bombones bonobon 15 gramos'],
  ])assert.equal(same(item(a),item(b)),true,`${a} / ${b}`);
});

test('abbreviations never erase a flavour, size, sugar restriction or pack format',()=>{
  for(const [a,b] of [
    ['Choc Milka alm 155g','Chocolate Milka avellanas 155g'],
    ['Choc Milka alm 155g','Chocolate Milka almendras 55g'],
    ['Chocolate s/azucar 100g','Chocolate con azucar 100g'],
    ['Chocolate s/azucar 100g','Chocolate 100g'],
    ['Birome Bic azul','Boligrafo Bic negro'],
  ])assert(!same(item(a),item(b)),a+' / '+b);
  assert(same(item('Chocolate s/azucar 100g'),item('Chocolate sin azucar 100g')));
});
test('trusts valid barcode fields but not store codes or invalid EANs',()=>{
  assert(same(item('Nombre A',{ean:'4006381333931'}),item('Nombre B',{barcode:'4006381333931'})));
  assert(same(item('Nombre A',{ean:'4006381333931'}),item('Nombre B',{gtin:'04006381333931'})));
  assert(!same(item('Alfajor Rasta negro 70g',{ean:'4006381333931'}),item('Alfajor Rasta negro 70g',{ean:'5901234123457'})));
  assert(!same(item('Nombre A',{code:'4006381333931'}),item('Nombre B',{code:'4006381333931'})));
  assert(!same(item('Nombre A',{ean:'1234567890123'}),item('Nombre B',{ean:'1234567890123'})));
  assert(!same(item('Alfajor Rasta negro 70g',{ean:'4006381333931'}),item('Alfajor Rasta negro 40g',{ean:'4006381333931'})));
});
test('missing identity and different brands or pack counts cannot confirm equivalence',()=>{
  assert(!same(item('Chocolate',{brand:''}),item('Chocolate',{brand:''})));
  assert(!same(item('Azucar blanca 1kg',{brand:''}),item('Azucar blanca 1kg',{brand:''})));
  assert(!same(item('Birome trazo fino',{brand:'Bic'}),item('Birome trazo fino',{brand:'Filgo'})));
  assert(!same(item('Alfajor Rasta negro 70g',{packUnits:6}),item('Alfajor Rasta negro 70g')));
});
test('comparison never renders unconfirmed alternatives, even in collapsed sections',()=>{
  vm.runInContext(source.slice(source.indexOf('  function sourceOffersHtml('),source.indexOf('  function renderDetail(')),ctx);
  ctx.escapeHtml=value=>String(value||'');
  ctx.sourceOfferValues=()=>'$100';
  const html=ctx.sourceOffersHtml([
    {matchType:'selected',source:'open25',sourceLabel:'Open 25',title:'Rasta 70g'},
    {matchType:'same',source:'rappi',sourceLabel:'Rappi',title:'Rasta 70g'},
    {matchType:'similar',source:'rappi',sourceLabel:'Rappi',title:'Rasta 40g'}
  ]);
  assert(html.includes('Una referencia disponible'));
  assert(!html.includes('Rasta 40g'));
  assert(!html.includes('Otras opciones'));
  assert(html.includes('Delivery'));
  assert(!/<details[^>]*\bopen\b/.test(html));
});
