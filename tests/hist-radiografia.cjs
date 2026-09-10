// Isolated history summary renderer; no account, database or API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[0];
const between = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing production block: ${start}`);
  return source.slice(a, b);
};
const quick = between('function histAyerIso(){', 'function histMoney(');
const radiography = between('function histRadAnimarMonto(', 'async function mostrarDetalleDia(');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-hist-rad-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body>
<button class="home-yesterday-access" id="homeYesterdayAccess" type="button">
  <span class="home-yesterday-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 15h.01M12 15h.01M16 15h.01"/></svg></span>
  <span class="home-yesterday-copy"><strong>Radiografía de ayer</strong><small id="homeYesterdayDate"></small></span>
  <span class="home-yesterday-arrow" aria-hidden="true">›</span>
</button>
<div id="historialOverlay"></div><div id="histRadiografiaDia"></div>
<script src="/cierre-cuentas.js"></script><script>
const TURNOS_SEMANA=[
  {nombre:'Vale',label:'mañana',color:'#3D5AFE'},
  {nombre:'Ani',label:'tarde',color:'#6B7FFF'},
  {nombre:'Marta',label:'noche',color:'#2541CC'}
];
const TURNOS_DOMINGO=[{nombre:'Turno 1',color:'#3D5AFE'},{nombre:'Turno 2',color:'#6B7FFF'}];
const turnosDelDia=dia=>new Date(dia+'T12:00:00-03:00').getDay()===0?TURNOS_DOMINGO:TURNOS_SEMANA;
const cmEsc=s=>String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const histMoney=n=>'$'+(Number(n)||0).toLocaleString('es-AR');
const formatFecha=dia=>new Date(dia+'T12:00:00-03:00').toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'});
const formatFechaCorta=dia=>new Date(dia+'T12:00:00-03:00').toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'});
let histMesActual=new Date(),histResumenMes={stale:true},histRowsPagosMes=[1],histRowsCierresMes=[1],histRowsGastosMes=[1],opened=null;
const lockBody=()=>{};
const mostrarDetalleDia=dia=>{opened=dia};
${quick}
${radiography}
</script></body></html>`;

const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/cierre-cuentas.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    return res.end(fs.readFileSync(path.join(root, 'cierre-cuentas.js')));
  }
  if (req.url !== '/') return res.writeHead(404).end();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');res.end(html);
});

(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage();
    await page.emulateMedia({reducedMotion:'no-preference'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const data={
      cierres:[
        {turno:'Vale',total_turno:368500,efectivo:288500,mp:80000,mpo:15000,once_monto:0},
        {turno:'Ani',total_turno:375300,efectivo:288000,mp:83300,mpo:13000,once_monto:4000},
        {turno:'Marta',total_turno:561300,efectivo:280900,mp:275400,mpo:7000,once_monto:5000}
      ],
      pagos:[
        {turno:'Vale',monto:80000},{turno:'Ani',monto:83300},{turno:'Marta',monto:275400}
      ],
      gastos:[{nombre:'Arcor',monto:188165},{nombre:'Santos',monto:576500}]
    };
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:900});await page.goto(origin);
      await page.evaluate(d=>histRenderRadiografiaDia('2026-09-09',d.cierres,d.gastos,d.pagos,1305100),data);
      await page.waitForTimeout(800);
      assert.equal(await page.locator('.hist-rad-row').count(),3);
      const text=await page.locator('#histRadiografiaDia').innerText();
      for(const expected of ['$1.305.100','$857.400','$438.700','MPO $35.000','Once $9.000','Gastos $764.665'])assert(text.includes(expected),expected);
      assert(!text.includes('Más fuerte'));
      assert(!text.includes('Lectura rápida'));
      assert((await page.locator('.hist-rad-ring').getAttribute('aria-label')).includes('Efectivo 66 por ciento'));
      const layout=await page.locator('.hist-radiografia-card').evaluate(el=>({right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,viewport:innerWidth,animation:getComputedStyle(el,'::before').animationName}));
      assert(layout.right<=layout.viewport+.5&&layout.scroll<=layout.viewport&&layout.width>250,'card must fit viewport');
      assert(/\.hist-radiografia-card::before\{[\s\S]*animation:histRadBeam 8s linear infinite/.test(source),'live border animation must be present');
      await page.screenshot({path:path.join(output,'radiografia-'+width+'.png')});
    }
    await page.evaluate(d=>histRenderRadiografiaDia('2026-09-09',d.cierres.slice(0,2),d.gastos,d.pagos,1024200),data);
    assert(await page.locator('.hist-radiografia-card').evaluate(el=>el.classList.contains('is-partial')));
    assert((await page.locator('.hist-rad-status').innerText()).includes('CIERRE PARCIAL'));
    await page.evaluate(d=>histRenderRadiografiaDia('2026-09-06',d.cierres.slice(0,2).map((c,i)=>({...c,turno:'Turno '+(i+1)})),[],[],743800),data);
    assert.equal(await page.locator('.hist-rad-row').count(),2);
    const expectedYesterday=await page.evaluate(()=>histAyerIso());
    await page.locator('#homeYesterdayAccess').click();
    assert.equal(await page.evaluate(()=>opened),expectedYesterday);
    assert.deepEqual(await page.evaluate(()=>({summary:histResumenMes,pagos:histRowsPagosMes,cierres:histRowsCierresMes,gastos:histRowsGastosMes})),{summary:{},pagos:[],cierres:[],gastos:[]});
    assert((await page.locator('#homeYesterdayDate').innerText()).toLocaleLowerCase('es-AR').includes('efectivo, mp y turnos'));
    assert.deepEqual(errors,[]);
    console.log(`Radiography checks passed. Screenshots: ${output}`);
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
