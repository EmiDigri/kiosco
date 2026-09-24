// Production renderer and styles with synthetic financial data; no account access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = source.indexOf('const MET_FIJOS=');
const end = source.indexOf('function histAyerIso(){', start);
assert(start > 0 && end > start);
const styles = source.match(/<style>[\s\S]*?<\/style>/)[0];
const markupStart = source.indexOf('<div class="historial-overlay met-overlay"');
const markupEnd = source.indexOf('<!--', markupStart);
const markup = source.slice(markupStart, markupEnd).replace('met-overlay"', 'met-overlay open"');
// Use the app's pinned ECharts build, downloaded once to TEMP (or ECHARTS_TEST_PATH).
const library = fs.readFileSync(process.env.ECHARTS_TEST_PATH || path.join(os.tmpdir(), 'kiosco-echarts-5.5.1.min.js'));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-metricas-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body>${markup}<script>
const histMoney=n=>'$'+Number(n||0).toLocaleString('es-AR');
const histMoneyCompact=n=>'$'+(n/1e6).toLocaleString('es-AR',{maximumFractionDigits:1})+'M';
const histMesNombre=d=>d.toLocaleDateString('es-AR',{month:'long',year:'numeric'});
const histPrimerYUltimoDiaMes=d=>({y:d.getFullYear(),m:d.getMonth()+1,last:30});
const histIso=(y,m,d)=>y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
let histMesActual, histResumenMes={}, histRowsPagosMes=[], histRowsGastosMes=[];
let revenue=24568000;
const CierreCuentas={resumenMes:()=>({total:revenue}),turnos:()=>[]};
const lockBody=()=>{},unlockBody=()=>{},histCargarMes=async()=>{};
${source.slice(start, end)}
window.renderFixture=(sales,variable,fixed,investment=0)=>{
  revenue=sales;
  histRowsGastosMes=[{nombre:'Arcor',monto:variable},{nombre:'Alquiler',monto:fixed},{nombre:'Toldo',monto:investment}];
  metActualizarNav();metRender();
};
renderFixture(24568000,15280000,2412000,450000);
</script></body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
});

(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      if(route.request().url().includes('/echarts@5.5.1/'))return route.fulfill({body:library,contentType:'text/javascript'});
      return new URL(route.request().url()).origin===origin?route.continue():route.abort();
    });
    await page.goto(origin);
    assert.equal(await page.evaluate(()=>!!window.echarts),false,'mobile must not load a hidden desktop chart');
    for(const width of [320,390,430,600]){
      await page.setViewportSize({width,height:900});
      await page.waitForTimeout(200);
      assert(await page.locator('.met-waterfall').isVisible());
      assert(!(await page.locator('#metCascada').isVisible()));
      assert.equal(await page.locator('.met-waterfall-step').count(),5);
      const text=await page.locator('.met-waterfall').innerText();
      for(const expected of ['$24.568.000','−$15.280.000','−$2.412.000','−$450.000','$6.426.000'])assert(text.includes(expected),expected);
      const overflow=await page.locator('.met-waterfall-head,.met-kpi-val,.met-row.hero').evaluateAll(els=>els.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.className));
      assert.deepEqual(overflow,[],`text must fit at ${width}px`);
      const heads=await page.locator('.met-waterfall-head').evaluateAll(els=>els.map(el=>{
        const [label,amount]=[...el.children].map(x=>x.getBoundingClientRect());
        return label.right<=amount.left+1||label.bottom<=amount.top+1;
      }));
      assert(heads.every(Boolean),'labels and amounts must not overlap');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(width===390)await page.screenshot({path:path.join(output,'mobile-dark.png')});
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('.met-kpi-q').first().tap();
    assert(await page.locator('#metKpiHelp').isVisible(),'help must work with touch');
    await page.locator('.met-kpi-q').first().tap();
    assert(!(await page.locator('#metKpiHelp').isVisible()));
    await page.evaluate(()=>{document.body.classList.add('light');document.getElementById('metricasOverlay').scrollTop=0;});
    await page.screenshot({path:path.join(output,'mobile-light.png')});
    await page.evaluate(()=>{document.body.classList.remove('light');renderFixture(1000000,1500000,100000);});
    assert.equal(await page.locator('.met-waterfall-step').count(),4);
    assert((await page.locator('.met-waterfall-result').innerText()).includes('−$600.000'));
    const bars=await page.locator('.met-waterfall-bar').evaluateAll(els=>els.map(el=>{
      const bar=el.getBoundingClientRect(),track=el.parentElement.getBoundingClientRect();
      return bar.left>=track.left-1&&bar.right<=track.right+1;
    }));
    assert(bars.every(Boolean),'negative result bars must stay on the shared axis');
    await page.screenshot({path:path.join(output,'mobile-loss.png')});
    await page.evaluate(()=>renderFixture(0,150000,100000));
    assert((await page.locator('.met-waterfall').innerText()).includes('Sin facturación registrada'));
    assert(!/NaN|Infinity/.test(await page.locator('.met-waterfall').getAttribute('style')));
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.met-waterfall-bar').first().evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.setViewportSize({width:320,height:844});
    await page.evaluate(()=>renderFixture(987654321.12,456789123.45,2412000));
    assert((await page.locator('.met-waterfall').innerText()).includes('$987.654.321,12'));
    assert(await page.locator('.met-waterfall-head,.met-kpi-val,.met-row.hero').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)),'large amounts with cents must fit');
    await page.evaluate(()=>renderFixture(24568000,15280000,2412000,450000));
    await page.setViewportSize({width:1280,height:900});
    await page.locator('#metCascada svg').waitFor();
    assert(!(await page.locator('.met-waterfall').isVisible()));
    assert(await page.locator('#metCascada').isVisible());
    await page.waitForTimeout(1100);
    await page.evaluate(()=>document.getElementById('metricasOverlay').scrollTop=0);
    await page.screenshot({path:path.join(output,'desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(250);
    assert(await page.locator('.met-waterfall').isVisible());
    assert.equal(await page.evaluate(()=>_metCasc),null,'dispose desktop chart on mobile');
    await page.evaluate(()=>renderFixture(0,0,0));
    assert(await page.locator('.met-empty').isVisible());
    assert.deepEqual(errors,[]);
    console.log('PASS: mobile widths, exact values, loss, zero revenue, touch help, themes, reduced motion and desktop resize. Screenshots: '+output);
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
