const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
const index = fs.readFileSync(path.join(root,'index.html'),'utf8');
const reader = fs.readFileSync(path.join(root,'cierre-foto-ui.js'),'utf8');
const output = fs.mkdtempSync(path.join(os.tmpdir(),'kiosco-caligrafia-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${index.match(/<style>([\s\S]*?)<\/style>/)[0]}<link rel="stylesheet" href="/caligrafia.css"></head><body>
<button id="cmBtnFoto" type="button">Cargar del cuaderno</button><input id="cmFotoInput" type="file" hidden>
<script src="/cierre-cuentas.js"></script><script>${reader.slice(0,reader.indexOf('// Only extracted numbers'))}
const sbAuthHeaders=async()=>({}),fechaHoy=()=> '2026-09-13',cmFechaObjetivo='2026-09-08';
function showToast(text){document.body.dataset.toast=text;}</script><script src="/caligrafia-ui.js"></script></body></html>`;
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  const allowed = new Set(['caligrafia.css','caligrafia-core.js','caligrafia-ui.js','cierre-cuentas.js',
    'vendor/cropper/cropper.min.css','vendor/cropper/cropper.min.js',...['x','zoom-in','zoom-out','rotate-ccw','image-up','trash-2','scan-text'].map(n=>'vendor/lucide/'+n+'.svg')]);
  const file=url.pathname.slice(1);
  if(!allowed.has(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/javascript');
  res.end(fs.readFileSync(path.join(root,file)));
});
(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    for(const width of [1280,390,320]){
      const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<500});
      const errors=[],examples=[],runs=[];let paid=0;
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await page.route('**/api/caligrafia**',async route=>{
        const req=route.request(),method=req.method(),body=req.postDataJSON(),url=new URL(req.url());
        let response;
        if(method==='GET')response=url.searchParams.has('run')?{run:runs.find(r=>r.id===url.searchParams.get('run'))}:{examples,runs};
        if(method==='DELETE'){examples.splice(examples.findIndex(e=>e.id===body.id),1);response={ok:true};}
        if(method==='POST'&&body.action==='save'){
          const item={...body,createdAt:new Date().toISOString(),cropHash:'example-hash'};
          const i=examples.findIndex(e=>e.id===body.id);if(i<0)examples.push(item);else examples[i]=item;
          response={example:item};
        }
        if(method==='POST'&&body.action==='compare'){
          assert.equal(body.consent,true);paid+=2;
          const run={...body,cropHash:'target-hash',state:'complete',createdAt:new Date().toISOString(),exampleIds:[examples[0].id],
            baseline:{text:'954403',correct:false,usage:{input:200,output:20}},memory:{text:'254403',correct:true,usage:{input:350,output:20}}};
          runs.push(run);response={run};
        }
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
      });
      await page.goto(origin);
      await page.locator('#cmCaligrafia').click();
      await page.locator('#calDialog').waitFor();
      const jpeg=await page.evaluate(()=>{
        const c=document.createElement('canvas');c.width=960;c.height=1200;const ctx=c.getContext('2d');
        ctx.fillStyle='#f7f7f3';ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle='#b4bed0';
        for(let y=110;y<1180;y+=90){ctx.beginPath();ctx.moveTo(40,y);ctx.lineTo(920,y);ctx.stroke();}
        ctx.fillStyle='#474b69';ctx.font='30px sans-serif';ctx.fillText('HOJA SINTETICA DE PRUEBA',70,70);
        ctx.font='52px "Segoe Script", cursive';ctx.fillText('$254.403',200,270);
        ctx.fillText('Cierre  521.450',100,440);ctx.fillText('MP      221.450',100,620);ctx.fillText('Arcor',100,800);
        return c.toDataURL('image/jpeg',.9).split(',')[1];
      });
      await page.locator('#calFile').setInputFiles({name:'cuaderno-prueba.jpg',mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')});
      await page.locator('.cropper-crop-box').waitFor();
      await page.waitForFunction(()=>!document.getElementById('calSave').disabled);
      await page.locator('.cal-coordinates summary').click();
      for(const [key,value] of Object.entries({x:150,y:180,width:520,height:130})){
        const input=page.locator(`[data-coordinate="${key}"]`);await input.fill(String(value));await input.press('Tab');
      }
      await page.locator('#calWriter').fill('Vale');
      await page.locator('#calExpected').fill('254403');
      await page.locator('#calVerified').check();
      await page.locator('#calSave').click();
      await page.waitForFunction(()=>document.getElementById('calStatus').textContent.includes('Ejemplo guardado'));
      assert.equal(examples.length,1);assert.equal(paid,0);assert(examples[0].image.length<100000);
      assert.equal(examples[0].writer,'Vale');
      await page.locator('#calSave').click();
      await page.waitForFunction(()=>!document.getElementById('calSave').disabled);
      assert.equal(examples.length,1,'repeat save must keep one sample');
      await page.locator('#calConsent').check();await page.locator('#calCompare').click();
      assert((await page.locator('#calStatus').innerText()).includes('otro día'));assert.equal(paid,0);
      await page.locator('#calDate').fill('2026-09-13');
      await page.locator('#calVerified').check();await page.locator('#calCompare').click();
      assert.equal(paid,0,'missing consent must never start a comparison');
      await page.locator('#calConsent').check();await page.locator('#calCompare').click();
      assert.equal(paid,0,'changing the date cannot reuse the same source photo');
      const nextJpeg=await page.evaluate(async base64=>{
        const img=new Image();img.src='data:image/jpeg;base64,'+base64;await img.decode();
        const c=document.createElement('canvas');c.width=960;c.height=1200;const ctx=c.getContext('2d');
        ctx.drawImage(img,0,0);ctx.fillStyle='#f7f7f3';ctx.fillRect(150,180,600,120);
        ctx.fillStyle='#323856';ctx.font='55px "Segoe Script", cursive';ctx.fillText('$254.403',210,268);
        ctx.font='28px sans-serif';ctx.fillText('OTRO DIA',70,125);return c.toDataURL('image/jpeg',.9).split(',')[1];
      },jpeg);
      await page.locator('#calFile').setInputFiles({name:'otro-dia.jpg',mimeType:'image/jpeg',buffer:Buffer.from(nextJpeg,'base64')});
      await page.waitForFunction(()=>!document.getElementById('calSave').disabled);
      await page.locator('.cropper-crop-box').waitFor();
      for(const [key,value] of Object.entries({x:150,y:180,width:520,height:130})){
        const input=page.locator(`[data-coordinate="${key}"]`);await input.fill(String(value));await input.press('Tab');
      }
      await page.locator('#calVerified').check();
      await page.locator('#calConsent').check();await page.locator('#calCompare').click();
      await page.waitForFunction(()=>document.getElementById('calResult').textContent.includes('No coincide'));
      await page.waitForFunction(()=>!document.getElementById('calCompare').disabled);
      assert.equal(paid,2);
      await page.locator('#calCompare').click();await page.waitForFunction(()=>!document.getElementById('calCompare').disabled);
      assert.equal(paid,2,'checking a result must not charge again');
      assert((await page.locator('#calStats').innerText()).includes('Sin ejemplos: 0/1'));
      await page.locator('#calWriter').fill('Ani');assert.equal(await page.locator('.cal-example').count(),0);
      await page.locator('#calWriter').fill('Vale');
      assert.equal(await page.locator('.cal-example').count(),1);
      await page.locator('#calDialog').evaluate(el=>{el.scrollTop=0;});
      assert(!(await page.locator('#calDialog').evaluate(el=>el.scrollWidth>el.clientWidth)), 'dialog overflow');
      if(width<500){
        await page.locator('.cropper-crop-box').scrollIntoViewIfNeeded();
        const box=await page.locator('.cropper-crop-box').boundingBox();
        const before=await page.locator('[data-coordinate="x"]').inputValue();
        const cdp=await page.context().newCDPSession(page),point={x:box.x+box.width/2,y:box.y+box.height/2};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+15,y:point.y+10}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        assert.notEqual(await page.locator('[data-coordinate="x"]').inputValue(),before,'touch drag must move the selected crop');
        await cdp.detach();
        await page.locator('#calDialog').evaluate(el=>{el.scrollTop=0;});
      }
      const crop=await page.locator('.cal-preview').screenshot();assert(crop.length>1000);
      await page.screenshot({path:path.join(output,'caligrafia-'+width+'.png')});
      if(width===1280){
        await page.locator('#calExamples').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,'caligrafia-resultados.png')});
      }
      page.once('dialog',d=>d.accept());await page.locator('[data-delete]').click();
      await page.waitForFunction(()=>!document.querySelector('[data-delete]'));assert.equal(examples.length,0);
      await page.locator('[data-close]').click();assert(!(await page.locator('#calDialog').isVisible()));
      assert.deepEqual(errors,[]);
      await page.close();console.log('Caligrafia UI passed: '+width+'px; no paid API calls.');
    }
    console.log('Screenshots: '+output);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
