const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const {start}=require('./catalogo-preview.cjs');
(async()=>{
  let fixture,browser;
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'kiosco-unit-prices-'));
  try{
    fixture=await start(0);
    const origin='http://127.0.0.1:'+fixture.server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    for(const width of [1280,390]){
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await page.addInitScript(()=>{
        const items=[
          {id:'rappi:1',code:'p1',source:'rappi',sourceLabel:'Rappi',priceType:'retail',title:'Rasta Negro 70g',unitPrice:1800},
          {id:'open25:2',source:'open25',priceType:'retail',title:'Rasta Negro Pack x6',unitPrice:7040},
          {id:'dulce:3',source:'dulce-sur',title:'Rasta Negro 70g',unitPrice:1000},
          {id:'dulce:4',source:'dulce-sur',sourceLabel:'Dulce Sur',priceType:'unit',unitSaleVerified:true,minimum:1,title:'Rasta Negro 70g',unitPrice:1700},
          {id:'dulce:5',source:'dulce-sur',priceType:'unit',unitSaleVerified:true,minimum:6,title:'Rasta Negro 70g',unitPrice:900},
        ];
        window.__priceFixture={search:{items:[],supplierItems:items},suggest:{items}};
      });
      await page.goto(origin);
      await page.locator('#btnPrecios').click();
      await page.locator('#priceSearchInput').fill('Rasta');
      await page.locator('#priceSuggestions [data-suggestion-index]').first().waitFor({timeout:5000}).catch(()=>{});
      await page.locator('#priceSearchButton').click();
      const result=page.locator('#priceResults .price-result');
      await result.first().waitFor();
      assert.equal(await result.count(),2);
      await result.last().click();
      assert((await page.locator('#priceDetail').innerText()).includes('comprar una unidad en Dulce Sur'));
      assert((await page.locator('#priceDetail').innerText()).includes('1.700'));
      await result.first().click();
      assert.equal(await page.locator('.price-reference').count(),1);
      assert(!/mayorista|bulto|pack x6/i.test(await page.locator('#priceDetail').innerText()));
      await page.locator('#priceOwnSale').fill('2000');
      await page.locator('#priceCalcForm button[type="submit"]').click();
      await page.locator('#priceMetrics').waitFor();
      assert((await page.locator('#priceCostUsed').innerText()).includes('Sin costo cargado'));
      assert.equal((await page.locator('.price-metric').nth(1).locator('.price-metric-value').innerText()).trim(),'—');
      await page.waitForFunction(()=>document.getElementById('priceSavedStatus').classList.contains('show'));
      await page.locator('#priceOwnCost').fill('1000');
      await page.locator('#priceCalcForm button[type="submit"]').click();
      assert((await page.locator('#priceMetricGrid').innerText()).includes('50,0%'));
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
      await page.locator('#priceDetail').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,'precios-'+width+'.png')});
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('Unit-price UI passed on desktop and mobile. Screenshots: '+output);
  }finally{
    if(browser)await browser.close();
    if(fixture){await new Promise(resolve=>fixture.server.close(resolve));await fixture.db.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
