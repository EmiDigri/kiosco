// Explicitly opt-in: public catalog reads only. No credentials or database writes.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const unitPrices=require('../price-unit.js');
const source=fs.readFileSync(path.join(__dirname,'../api/catalogo.js'),'utf8')
  .replace("import unitPrices from '../price-unit.js';",'').replace('export default async function handler','async function handler');
const ctx=vm.createContext({unitPrices,process:{env:{}},fetch,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,TextDecoder});
vm.runInContext(source,ctx);
(async()=>{
  const audit={searches:{},comparisons:{}};
  for(const q of ['milka almendras 155g','birome bic azul','resma a4','marcador filgo','oreo 118g']){
    const start=Date.now();
    const result=await ctx.supplierSearch(q,20);
    audit.searches[q]={items:[],supplierItems:result.items,sources:result.sources,checkedAt:new Date().toISOString()};
    console.log(JSON.stringify({q,ms:Date.now()-start,sources:result.sources,items:result.items.map(i=>({source:i.source,title:i.title,price:i.unitPrice,ean:i.ean}))}));
    if(q==='milka almendras 155g'){
      const item=result.items.find(i=>i.source==='josimar');
      if(!item)throw Error('Milka 155g not found in new source');
      const comparison=await ctx.handleCompare(item,-34.6037,-58.3816,'caba');
      audit.comparisons[item.title]=comparison;
      console.log('COMPARE '+JSON.stringify({title:item.title,sources:comparison.sources,items:comparison.supplierItems.map(i=>({source:i.source,title:i.title,price:i.unitPrice}))}));
    }
  }
  const file=path.join(os.tmpdir(),'kiosco-price-coverage.json');
  fs.writeFileSync(file,JSON.stringify(audit));console.log('Saved '+file);
})().catch(error=>{console.error(error);process.exitCode=1;});
