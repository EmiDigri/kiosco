// Opt-in live, read-only audit. Stores public product results in the OS temp folder.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const unitPrices=require('../price-unit.js');
const source=fs.readFileSync(path.join(__dirname,'../api/catalogo.js'),'utf8')
  .replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
const ctx=vm.createContext({unitPrices,process:{env:{}},fetch,URL,URLSearchParams,AbortController,AbortSignal,setTimeout,clearTimeout,console,TextDecoder});
vm.runInContext(source,ctx);
(async()=>{
  const data={searches:{},comparisons:{}};
  for(const query of ['bon o bon','beldent menta','coca cola 500 ml','oreo 118g','lays clasicas','kinder bueno','mogul','resma a4','birome bic azul','milka almendras 155g']){
    const started=Date.now();
    const result=await ctx.handleSearch(query,-34.6037,-58.3816,'caba');
    const items=[...result.items,...result.supplierItems];
    data.searches[query]={...result,checkedAt:new Date().toISOString()};
    console.log(JSON.stringify({query,ms:Date.now()-started,offers:items.length,variants:unitPrices.groupProducts(items).length,sources:result.sources,items:items.map(i=>({id:i.id||i.ean,title:i.title||i.name,source:i.source||'pc',price:i.unitPrice||i.retail?.min}))}));
    if(query==='lays clasicas'||query==='milka almendras 155g'||query==='coca cola 500 ml'){
      const selected=result.supplierItems.find(i=>query==='lays clasicas'?/85\s*g/i.test(i.title+' '+i.presentation):true);
      if(selected){const comparison=await ctx.handleCompare(selected,-34.6037,-58.3816,'caba');data.comparisons[selected.title]=comparison;console.log('COMPARE '+JSON.stringify({title:selected.title,sources:comparison.sources,items:[...comparison.items,...comparison.supplierItems].map(i=>({id:i.id||i.ean,title:i.title||i.name,source:i.source||'pc'}))}));}
    }
  }
  const file=path.join(os.tmpdir(),'kiosco-price-audit.json');fs.writeFileSync(file,JSON.stringify(data));console.log('Saved '+file);
})().catch(error=>{console.error(error);process.exitCode=1;});
