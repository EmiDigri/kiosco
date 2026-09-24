const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'catalogo-ui.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ctx=vm.createContext({escapeHtml:value=>String(value||''),sourceOfferValues:()=>'<strong>$1.500</strong>'});
vm.runInContext(source.slice(source.indexOf('  function sourceOffersHtml('),source.indexOf('  function renderDetail(')),ctx);
const content=ctx.sourceOffersHtml([
  {matchType:'selected',source:'open25',sourceLabel:'Open 25',title:'Alfajor Rasta negro',presentation:'70 g'},
  {matchType:'same',source:'precios-claros',sourceLabel:'Precios Claros',title:'Alfajor Rasta negro',presentation:'70 g'},
  {matchType:'same',source:'rappi',sourceLabel:'Rappi',title:'Alfajor Rasta negro',presentation:'70 g'},
  {matchType:'similar',source:'rappi',sourceLabel:'Rappi',title:'Alfajor Rasta blanco',presentation:'40 g'},
]);
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const output=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'kiosco-comparacion-'));
  try{
    for(const width of [1280,390,320]){
      const page=await browser.newPage({viewport:{width,height:850}});
      await page.route('**/*',route=>route.abort());
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${html.match(/<style>[\s\S]*?<\/style>/)[0]}<main style="max-width:800px;margin:20px auto;padding:12px">${content}</main>`);
      const details=page.locator('details');
      assert.equal(await details.getAttribute('open'),null);
      assert.equal(await page.getByText('Alfajor Rasta blanco').isVisible(),false);
      await details.locator('summary').click();
      assert.equal(await page.getByText('Alfajor Rasta blanco').count(),0);
      assert(await details.getByText('Alfajor Rasta negro').isVisible());
      assert.equal(await page.getByText('Otras opciones',{exact:false}).count(),0);
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
      await page.screenshot({path:path.join(output,`${width}.png`)});
      await details.locator('summary').click();
      assert.equal(await page.getByText('Alfajor Rasta blanco').isVisible(),false);
      await page.close();
    }
    console.log('Comparison UI passed at 1280, 390 and 320px. Screenshots: '+output);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
