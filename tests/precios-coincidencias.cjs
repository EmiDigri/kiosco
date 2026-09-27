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

// Casos reales del 27/9/2026: la misma Coca-Cola con nombres distintos en cada tienda.
const U=require('../price-unit.js');
const prod=(title,source)=>({title,source,category:'Kiosco',presentation:(title.match(/\d+(?:[.,]\d+)?\s*(?:cc|ml|l|lt)\b/i)||['Unidad'])[0]});
test('same product across stores even if one adds filler words (gaseosa, sabor, original, no retornable)',()=>{
  assert.equal(U.sameProduct(prod('Gaseosa Coca-Cola Sabor Original 600 Ml.','dia'),prod('Gaseosa Original Coca Cola 600 cc','josimar')),true);
  assert.equal(U.sameProduct(prod('Coca-Cola Sabor Original 354 Ml','rappi'),prod('Gaseosa Coca Cola 354 cc','josimar')),true);
  assert.equal(U.sameProduct(prod('Gaseosa Coca Cola Original 1,75L','open25'),prod('Gaseosa No Retornable Coca Cola 1.75 lt','josimar')),true);
  assert.equal(U.comparisonQuery(prod('Gaseosa Coca-Cola Sabor Original 600 Ml.','dia')),'coca cola 600ml');
});
test('variants and sizes stay separate',()=>{
  assert.equal(U.sameProduct(prod('Gaseosa Coca-Cola Sabor Original 600 Ml.','dia'),prod('Gaseosa Zero Coca Cola 600 cc','josimar')),false);
  assert.equal(U.sameProduct(prod('Gaseosa Original Coca Cola 600 cc','josimar'),prod('Gaseosa Light Coca Cola 600 cc','josimar')),false);
  assert.equal(U.sameProduct(prod('Gaseosa No Retornable Coca Cola 1.75 lt','josimar'),prod('Gaseosa Zero No Retornable Coca Cola 1.75 lt','josimar')),false);
  assert.equal(U.sameProduct(prod('Gaseosa Original Coca Cola 600 cc','josimar'),prod('Gaseosa Coca Cola 354 cc','josimar')),false);
});
test('typed searches: a bare number is a size and filler words are not required',()=>{
  assert.equal(U.matchesSearch(prod('Gaseosa Original Coca Cola 600 cc','josimar'),'coca cola 600',{partial:true}),true);
  assert.equal(U.matchesSearch(prod('Gaseosa Coca Cola 354 cc','josimar'),'coca cola 600',{partial:true}),false);
  assert.equal(U.matchesSearch(prod('Gaseosa Coca Cola Original 1,75L','open25'),'coca 1.75',{partial:true}),true);
  assert.equal(U.matchesSearch(prod('Gaseosa Original Coca Cola 600 cc','josimar'),'coca cola zero 600',{partial:true}),false);
  assert.equal(U.matchesSearch(prod('Gaseosa Coca Cola 354 cc','josimar'),'coca cola sabor original 354',{partial:true}),true);
  assert.equal(U.matchesSearch(prod('Gaseosa Original Coca Cola 600 cc','josimar'),'gaseosa',{partial:true}),true);
  assert.equal(U.matchesSearch(prod('Gaseosa Coca Cola Zero 600ml - Pack x 6un','open25'),'coca cola 600',{partial:true}),false,'packs stay out');
});

// Tabaquería (Cigar Point, 27/9/2026): tabaco para armar, papelillos y filtros son de kiosco.
test('rolling tobacco, papers and filters count as kiosk products; a bag of filters is one unit',()=>{
  for(const title of ['REDFIELD VAINILLA 30 g','PAPELES SMOKING 200 HOJAS','FILTROS OCB SLIM','SMOKING CUADRO MAIZ','Tabaco Red Field Vainilla 30 g'])
    assert.equal(U.isKioskProduct({title,category:'Kiosco'}),true,title);
  assert.equal(U.isIndividual({title:'FILTROS STAMPS REGULAR X100'}),true);
  assert.equal(U.isIndividual({title:'FILTROS SMOKING SLIM X 120'}),true);
  assert.equal(U.isIndividual({title:'Filtros OCB Slim caja x 10 paquetes'}),false,'una caja sigue siendo pack');
  assert.equal(U.isIndividual({title:'Alfajor Guaymallen x 6'}),false,'fuera de la tabaquería, x6 sigue siendo pack');
});
test('"red field" and "redfield" are the same brand',()=>{
  const cp=prod('REDFIELD VAINILLA 30 g','cigarpoint'),otra=prod('Tabaco Red Field Vainilla 30 g','otra');
  assert.equal(U.matchesSearch(cp,'red field vainilla',{partial:true}),true);
  assert.equal(U.matchesSearch(otra,'redfield',{partial:true}),true);
  assert.equal(U.sameProduct(cp,prod('Red Field Vainilla 30 gr','otra')),true);
  assert.equal(U.sameProduct(cp,prod('REDFIELD GRAPE 30 g','cigarpoint')),false);
});
