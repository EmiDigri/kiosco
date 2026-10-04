const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const root = process.env.KIOSCO_SOURCE_ROOT || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const between = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const markup = source.match(/<div id="histVistaDetalle"[\s\S]*?<div id="histTurnosDetalle"><\/div>\s*<\/div>/)[0].replace('display:none','display:block');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-gastos-dia-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${source.match(/<style>[\s\S]*?<\/style>/)[0]}<link rel="stylesheet" href="/historial-gastos.css"></head><body>
<div id="histVistaLista"></div><div id="histTitleText"></div>
<div class="historial-overlay open" id="historialOverlay"><div class="historial-panel">${markup}</div></div>
<script src="/cierre-cuentas.js"></script><script>
let fixture={pagos:[],gastos:[],cierres:[],remoto:true},waiting={},saved=[];
const cmUid=()=> 'nuevo-'+(saved.length+1),showToast=()=>{};
const cmGuardarGastoRemoto=async(g,fecha)=>{saved.push({...g,fecha});fixture.gastos.push({...g,fecha});};
const histResumenMes={},histMoney=n=>'$'+Number(n).toLocaleString('es-AR');
const cmEsc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatFecha=dia=>new Date(dia+'T12:00:00-03:00').toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'}),formatFechaCorta=formatFecha;
const turnosDelDia=dia=>CierreCuentas.turnos(dia).map(nombre=>({nombre,color:'#7b8eff'}));
const histCargarFotoDia=()=>{document.getElementById('histFotoDia').innerHTML='';};
const histFetchDia=async dia=>waiting[dia] ? new Promise(resolve=>waiting[dia]=resolve) : structuredClone(fixture);
const histTotalDesdePagos=()=>500000,fechaHoy=()=> '2026-09-15',esTransferenciaFueraHorario=()=>false,cardLogoHtml=()=>'',motivoExclusionTexto=()=> 'Excluido';
${between('function histRadAnimarMonto(', '// \u2500\u2500\u2500 API / FETCH')}
</script><script src="/historial-gastos.js"></script></body></html>`;
const server = http.createServer((req,res)=>{
  const name = req.url.slice(1);
  if (['cierre-cuentas.js','historial-gastos.js','historial-gastos.css'].includes(name)) {
    res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');
    return res.end(fs.readFileSync(path.join(root,name)));
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});
(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    await page.emulateMedia({reducedMotion:'reduce'});
    for (const width of [1280,390,320]) {
      await page.setViewportSize({width,height:900});await page.goto(origin);
      await page.evaluate(async()=>{
        fixture={cierres:[],remoto:true,gastos:[{uid:'a',nombre:'Arcor',monto:254403},{uid:'b',nombre:'Flete',monto:10000}],pagos:[
          {pago_id:'a',nombre:'Arcor SA',monto:254403,es_enviada:true,status:'approved'},
          {pago_id:'b',nombre:'Proveedor MP',monto:5000,es_enviada:true,status:'approved'}
        ]};
        await mostrarDetalleDia('2026-09-15');
      });
      assert.equal(await page.locator('#histDiaGastos strong').innerText(),'$269.403');
      assert.equal(await page.locator('[data-hist-gasto-total]').innerText(),'$269.403');
      assert.equal(await page.locator('#histGastosDiaDetalle .hist-gasto-line').count(),3);
      const layout=await page.locator('.hist-dia-encabezado').evaluate(el=>{
        const date=el.querySelector('#histDiaTitulo').getBoundingClientRect(),button=el.querySelector('button').getBoundingClientRect();
        return {scroll:document.documentElement.scrollWidth,viewport:innerWidth,date:{bottom:date.bottom,right:date.right},button:{top:button.top,left:button.left,right:button.right}};
      });
      assert(layout.scroll<=width && layout.button.right<=width,'header must fit');
      assert(width<=600 ? layout.button.top>=layout.date.bottom : layout.button.left>=layout.date.right,'header layout');
      await page.screenshot({path:path.join(output,`gastos-${width}.png`)});
      await page.locator('#histGastosDiaDetalle').evaluate(el=>el.open=false);
      await page.locator('#histDiaGastos').click();
      assert.equal(await page.locator('#histGastosDiaDetalle').evaluate(el=>el.open),true);
      assert.equal(await page.locator('#histGastosDiaDetalle summary').evaluate(el=>el===document.activeElement),true);
      await page.evaluate(async()=>{fixture={pagos:[],gastos:[],cierres:[],remoto:true};await mostrarDetalleDia('2026-09-13');});
      assert.equal(await page.locator('#histDiaGastos strong').innerText(),'$0');
      await page.locator('#histDiaGastos').click();
      assert((await page.locator('#histGastosDiaDetalle').innerText()).includes('Sin gastos registrados'));
    }
    await page.evaluate(async()=>{
      fixture={gastos:[],cierres:[],remoto:true,pagos:[{pago_id:'only-mp',nombre:'Proveedor Uno',monto:100,es_enviada:true}]};
      await mostrarDetalleDia('2026-09-22');
      for(const el of document.querySelectorAll('details[data-hist-section]'))el.open=false;
      await mostrarDetalleDia('2026-09-23');
      await mostrarDetalleDia('2026-09-22');
    });
    assert.equal(await page.locator('#histGastosDiaDetalle').count(),1);
    for(const key of ['resumen','foto','gastos']){
      assert.equal(await page.locator(`[data-hist-section="${key}"]`).evaluate(el=>el.open),false,'preserves '+key+' even with only MP expenses');
    }
    await page.evaluate(async()=>{
      fixture.gastos=[{nombre:'Arcor',monto:100},{nombre:'Arcor',monto:100}];
      fixture.pagos=[{pago_id:'one',nombre:'Arcor',monto:100,es_enviada:true}];
      await mostrarDetalleDia('2026-09-15');
    });
    assert.equal(await page.locator('#histDiaGastos strong').innerText(),'Por revisar');
    await page.evaluate(async()=>{fixture={gastos:[{nombre:'Flete',monto:100}],pagos:[],cierres:[],remoto:false};await mostrarDetalleDia('2026-09-15');});
    assert.equal(await page.locator('#histDiaGastos small').innerText(),'Respaldo local');
    await page.evaluate(()=>{waiting['2026-09-10']=true;void mostrarDetalleDia('2026-09-10');});
    assert.equal(await page.locator('#histDiaGastos').isDisabled(),true);
    assert.equal(await page.locator('#histDiaGastos strong').innerText(),'...');
    await page.evaluate(async()=>{fixture={pagos:[],gastos:[],cierres:[],remoto:true};await mostrarDetalleDia('2026-09-11');waiting['2026-09-10']({pagos:[],gastos:[{nombre:'Viejo',monto:9999}],cierres:[],remoto:true});});
    assert.equal(await page.locator('#histDiaGastos strong').innerText(),'$0','slow previous day must not overwrite current total');
    // Notebook typo: counts what MP paid and shows what was written.
    await page.evaluate(async()=>{fixture={cierres:[],remoto:true,gastos:[{uid:'e',nombre:'Edenor',monto:418409}],
      pagos:[{pago_id:'e',nombre:'Pago Edenor',monto:481408.07,es_enviada:true,status:'approved'}]};await mostrarDetalleDia('2026-09-07');});
    assert.equal(await page.locator('#histDiaGastos strong').innerText(),'$481.408,07');
    assert.equal(await page.locator('#histGastosDiaDetalle .hist-gasto-line').count(),1);
    assert((await page.locator('#histGastosDiaDetalle .hist-gasto-meta').innerText()).includes('anotado $418.409'));
    assert.equal(await page.locator('#histGastosDiaDetalle .hist-gasto-edit').getAttribute('data-monto'),'418409');
    // "+ Agregar gasto" with the real day renderer: the date comes from the opened day.
    await page.evaluate(async()=>{fixture={pagos:[],gastos:[],cierres:[],remoto:true};await mostrarDetalleDia('2026-09-16');});
    await page.getByRole('button',{name:'Agregar gasto'}).click();
    assert((await page.locator('#histNuevoGasto h4').innerText()).includes('16/09/2026'));
    await page.getByLabel('Concepto',{exact:true}).fill('Nobleza');
    await page.getByLabel('Importe ($)',{exact:true}).fill('1138210');
    await page.getByRole('button',{name:'Guardar gasto',exact:true}).click();
    await page.locator('#histNuevoGasto').waitFor({state:'detached'});
    assert.deepEqual(await page.evaluate(()=>saved),[{uid:'nuevo-1',nombre:'Nobleza',monto:1138210,caja:'',turno:'',fecha:'2026-09-16'}]);
    assert.equal(await page.locator('#histDiaGastos strong').innerText(),'$1.138.210');
    await page.evaluate(async()=>{fixture={pagos:[],gastos:[],cierres:[],remoto:true};await mostrarDetalleDia('2026-09-17');});
    assert.equal(await page.locator('#histDiaGastos strong').innerText(),'$0','another day must not show it');
    assert.deepEqual(errors,[]);
    console.log('Daily expense header checks passed. Screenshots: '+output);
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
