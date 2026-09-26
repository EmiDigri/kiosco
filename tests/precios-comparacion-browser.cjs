const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const {start}=require('./catalogo-preview.cjs');
(async()=>{
  let fixture,browser;
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'kiosco-comparacion-nueva-'));
  try{
    fixture=await start(0);
    const origin='http://127.0.0.1:'+fixture.server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    for(const width of [1280,390,320]){
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await page.addInitScript(()=>{
        const base={source:'rappi',sourceLabel:'Rappi',brand:'Milka',unitPrice:6000,presentation:'155g'};
        window.__products=[{...base,id:'rappi:a',title:'Chocolate Milka leche almendras 155g'},
          {...base,id:'rappi:b',title:'Chocolate Milka Oreo 155g'}];
        window.__priceFixture={search:{items:[],supplierItems:window.__products,sources:{retail:true,rappi:true,open25:false,dulceSur:true}},suggest:{items:window.__products}};
      });
      await page.goto(origin);
      await page.evaluate(()=>{
        const previous=window.fetch;
        window.__requests=[];
        window.fetch=(url,opts)=>{
          const params=new URL(url,location.origin).searchParams;
          if(params.get('action')==='compare')return new Promise((resolve,reject)=>{
            window.__requests.push({name:params.get('name'),ean:params.get('ean'),
              finish:payload=>resolve(new Response(JSON.stringify(payload))),fail:()=>reject(new Error('timeout'))});
          });
          return previous(url,opts);
        };
      });
      await page.locator('#btnPrecios').click();
      await page.locator('#priceSearchInput').fill('milka');
      await page.locator('#priceSearchButton').click();
      const results=page.locator('#priceResults .price-result');
      await results.first().click();
      await page.getByText('Buscando este producto en las otras fuentes…').waitFor();
      await page.locator('#priceOwnSale').fill('7000');
      await page.locator('#priceOwnCost').fill('3000');
      await page.locator('#priceCalcForm button[type="submit"]').click();
      await page.locator('#priceMetrics').waitFor();
      await page.evaluate(()=>window.__requests[0].finish({
        items:[],supplierItems:[
          {id:'open25:a',source:'open25',sourceLabel:'Open 25',brand:'Milka',title:'Choc.Leche C/Alm.Milka 0,155 kg',unitPrice:5000},
          {id:'open25:wrong',source:'open25',sourceLabel:'Open 25',brand:'Milka',title:'Chocolate Milka Oreo 155g',unitPrice:2000},
          {id:'open25:pack',source:'open25',sourceLabel:'Open 25',brand:'Milka',title:'Chocolate Milka leche almendras 155g pack x6',unitPrice:1000}
        ],sources:{retail:true,open25:true,rappi:false,dulceSur:true},partialSources:[]
      }));
      await page.getByText('Fuentes consultadas',{exact:true}).waitFor();
      assert.equal(await page.locator('#priceOwnSale').inputValue(),'7000');
      assert.equal(await page.locator('#priceOwnCost').inputValue(),'3000');
      assert((await page.locator('.price-reference-value').innerText()).includes('5.000'));
      assert((await page.locator('#priceMetricGrid').innerText()).includes('40,0%'));
      assert(!/Oreo|pack x6/.test(await page.locator('#priceDetail').innerText()));
      await page.getByText('Fuentes consultadas',{exact:true}).click();
      assert((await page.locator('#priceDetail').innerText()).includes('Sin coincidencia exacta con precio'));
      assert((await page.locator('#priceDetail').innerText()).includes('No respondió'));
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
      assert(!(await page.locator('#priceDetail').evaluate(el=>el.scrollWidth>el.clientWidth)));
      await page.locator('#priceReferenceContent').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`${width}.png`)});

      // A late response must never replace the newly selected product.
      await results.first().click();
      await results.last().click();
      await page.evaluate(()=>window.__requests[1].finish({items:[],supplierItems:[],sources:{}}));
      assert((await page.locator('.price-product-name').innerText()).includes('Oreo'));
      assert(await page.getByText('Buscando este producto en las otras fuentes…').isVisible());
      await page.evaluate(()=>window.__requests[2].fail());
      await page.getByText('No pudimos completar la comparación.',{exact:false}).waitFor();
      assert((await page.locator('.price-product-name').innerText()).includes('Oreo'));

      // Starting a different search invalidates an in-flight comparison too.
      await results.first().click();
      await page.locator('#priceSearchInput').fill('producto inexistente');
      await page.locator('#priceSearchButton').click();
      await page.waitForFunction(()=>!document.getElementById('priceSearchButton').disabled);
      await page.evaluate(()=>window.__requests[3].finish({items:[],supplierItems:[],sources:{}}));
      assert((await page.locator('#priceDetail').innerText()).includes('Sin variante seleccionada'));
      assert((await page.locator('#priceResults').innerText()).includes('Consulta incompleta'));
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('Comparison, partial sources, editable fields and stale responses passed at 1280/390/320px. Screenshots: '+output);
  }finally{
    if(browser)await browser.close();
    if(fixture){await new Promise(resolve=>fixture.server.close(resolve));await fixture.db.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
