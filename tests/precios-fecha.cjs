const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../catalogo-ui.js'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function priceCheckedText('),source.indexOf('  function radarDate(')),ctx);
test('shows the server consultation date in Buenos Aires, not the device timezone',()=>{
  const label=ctx.priceCheckedText('2026-09-19T01:30:00Z');
  assert(label.includes('18/9/26') && label.includes('22:30'),label);
  assert(label.startsWith('Consulta de la app: '));
});
test('never invents a date for missing or invalid timestamps',()=>{
  for(const value of [null,undefined,'','invalid'])assert.equal(ctx.priceCheckedText(value),'');
});
