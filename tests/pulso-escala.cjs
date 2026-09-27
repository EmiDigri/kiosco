// Production pulse renderer with synthetic payments; no account or API access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.env.KIOSCO_SOURCE_ROOT || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = source.indexOf('let pulseRefreshTimer=');
const end = source.indexOf('async function cargarPulsoKiosco()', start);
assert(start > 0 && end > start);
const styles = source.match(/<style>[\s\S]*?<\/style>/)[0];
const markup = source.match(/<section class="kiosk-pulse"[\s\S]*?<\/section>/)[0];
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-pulso-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}
<style>body{padding:20px;min-height:100vh}.fixture{max-width:1600px;margin:32px auto}@media(max-width:720px){body{padding:12px}}</style></head><body><main class="fixture">${markup}</main><script>
const NativeDate=Date;
window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-09-27T11:35:00-03:00']));}static now(){return new NativeDate('2026-09-27T11:35:00-03:00').getTime();}};
const TURNOS=[{nombre:'Vale',desdeH:7,desdeM:0,hastaH:12,hastaM:0},{nombre:'Ani',desdeH:12,desdeM:1,hastaH:17,hastaM:0},{nombre:'Marta',desdeH:17,desdeM:1,hastaH:22,hastaM:0}];
const visFin=t=>t.hastaH*60+t.hastaM;
const HIST_MES_LEARN='fixture';
const cmEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
${source.slice(start, end)}
const fixture=[['07:10',100000],['08:20',50000],['10:05',30000],['10:15',70000],['10:45',1000],['11:10',20000],['11:20',400]].map(([hora,monto],i)=>({fecha:'2026-09-27',hora,monto,nombre:'Prueba '+i}));
function renderFixture(mode='today',rows=fixture){pulseMode=mode;pulseModeInitialized=true;pulseModeUserChosen=true;pulseRender(rows);}
renderFixture();
document.getElementById('pulseReplay').onclick=()=>pulseReplay();
</script></body></html>`;
const server = http.createServer((req, res) => {
  if(req.url !== '/') return res.writeHead(404).end();
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});

(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    const errors=[];
    for(const width of [1440,390,320]){
      const context=await browser.newContext({viewport:{width,height:800},timezoneId:'America/Argentina/Buenos_Aires',hasTouch:width<720,isMobile:width<720,reducedMotion:'reduce'});
      const page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await page.goto(origin);
      // Pico por hora $101.000: la escala se ajusta a $125 mil (no a $200 mil) para usar la altura.
      assert.deepEqual(await page.locator('.pulse-y-label').allTextContents(),['$0','$25 mil','$50 mil','$75 mil','$100 mil','$125 mil']);
      assert.equal(await page.locator('.pulse-future').count(),1,'lo que falta del día se distingue');
      assert.equal(await page.locator('.pulse-event').count(),7);
      assert.equal(await page.locator('.pulse-axis span').count(),16);
      assert.equal(await page.locator('.pulse-now-label').innerText(),'Ahora');
      assert.equal(await page.locator('.pulse-legend span').count(),4);
      const geometry=await page.evaluate(()=>{
        const plot=document.querySelector('.pulse-plot').getBoundingClientRect();
        const dots=[...document.querySelectorAll('.pulse-event')].map(el=>{const r=el.getBoundingClientRect();return{fraction:parseFloat(el.style.bottom)/100,y:r.top+r.height/2};});
        const bars=[...document.querySelectorAll('.pulse-bar')].map(el=>el.getBoundingClientRect());
        const labels=[...document.querySelectorAll('.pulse-axis span')].map(el=>el.getBoundingClientRect());
        const yLabels=[...document.querySelectorAll('.pulse-y-label')].map(el=>el.getBoundingClientRect());
        return{plotBottom:plot.bottom,plotHeight:plot.height,dots,bars:bars.map(r=>({top:r.top,height:r.height})),labelsOverlap:labels.some((r,i)=>i&&r.left<labels[i-1].right),yClipped:yLabels.some(r=>r.left<0),scroll:document.documentElement.scrollWidth,viewport:innerWidth};
      });
      assert(Math.abs(geometry.dots[0].y-geometry.bars[0].top)<1,'Equal payment and hourly total must align');
      assert.equal(geometry.dots[0].fraction,geometry.dots[1].fraction*2,'Linear amounts');
      assert(geometry.bars[2].height===0,'Empty hour has no fabricated bar');
      assert(Math.abs(geometry.dots[6].fraction-400/125000)<.00001,'Small payment is not inflated');
      assert(!geometry.labelsOverlap&&!geometry.yClipped&&geometry.scroll<=geometry.viewport,'Axes fit on mobile');
      const first=page.locator('.pulse-event').first();
      if(width<720)await first.tap();else await first.hover();
      assert((await page.locator('.pulse-tooltip.show').innerText()).includes('$100.000'));
      const tip=await page.locator('.pulse-tooltip').boundingBox();
      assert(tip.x>=0&&tip.x+tip.width<=width,'Tooltip stays within viewport');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.pulse-tooltip.show').count(),0);
      await first.focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('.pulse-tooltip.show').count(),1);
      await page.keyboard.press('Escape');
      await page.screenshot({path:path.join(output,`pulse-${width}.png`)});
      await page.evaluate(()=>renderFixture('yesterday',fixture.map(r=>({...r,fecha:'2026-09-26'}))));
      assert.equal(await page.locator('.pulse-now').count(),0);
      assert.equal(await page.locator('.pulse-future').count(),0,'ayer no tiene horas por venir');
      assert.equal(await page.locator('.pulse-event').count(),7);
      await page.evaluate(()=>renderFixture('today',[]));
      assert.equal(await page.locator('.pulse-event').count(),0);
      assert(!(await page.locator('#pulseContent').innerText()).includes('NaN'));
      await page.evaluate(()=>renderFixture('yesterday',[{fecha:'2026-09-26',hora:'00:01',monto:100},{fecha:'2026-09-26',hora:'23:59',monto:1000000}]));
      assert.equal(await page.locator('.pulse-axis span').count(),25);
      assert.equal(await page.locator('.pulse-axis span').last().innerText(),'24');
      assert(await page.locator('.pulse-axis span').evaluateAll(els=>els.every((el,i)=>!i||el.getBoundingClientRect().left>=els[i-1].getBoundingClientRect().right)),'All hours remain readable');
      await page.evaluate(()=>{document.body.classList.add('light');renderFixture();});
      await page.screenshot({path:path.join(output,`pulse-light-${width}.png`)});
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.locator('#pulseReplay').click();
      assert(await page.locator('.pulse-event').first().evaluate(el=>el.getAnimations().length>0),'Replay preserved');
      await context.close();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: shared scale, small/empty values, all hours, touch, keyboard, today/yesterday, replay, dark/light at 1440/390/320.');
    console.log('Screenshots: '+output);
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
