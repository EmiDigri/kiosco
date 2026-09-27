const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-agregar-gasto-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${source.match(/<style>[\s\S]*?<\/style>/)[0]}<link rel="stylesheet" href="/historial-gastos.css"></head><body>
<div class="historial-overlay open"><div class="historial-panel">
<div id="histVistaDetalle"><div class="hist-dia-encabezado"><h2 id="histDiaTitulo" class="hist-dia-titulo"></h2>
<button id="histDiaGastos" class="hist-dia-gastos"><span>Gastos:</span><strong></strong><small hidden></small></button></div>
<div id="histTurnosDetalle"></div></div></div></div>
<script src="/cierre-cuentas.js"></script><script>
const db=[],calls=[],toasts=[],refreshes=[];let fail=false,delay=false,release=null,sequence=0;
const histMoney=n=>'$'+Number(n).toLocaleString('es-AR');
const cmEsc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cmUid=()=> 'expense-'+(++sequence),showToast=s=>toasts.push(s);
async function cmGuardarGastoRemoto(g,fecha){
  calls.push({...g,fecha});
  if(delay)await new Promise(resolve=>release=resolve);
  if(fail)throw new Error('Offline');
  const row={...g,fecha},index=db.findIndex(x=>x.uid===g.uid);
  if(index<0)db.push(row);else db[index]=row;
}
// Igual que index.html en producción: NO marca la vista con data-dia. El botón tiene
// que saber la fecha por su cuenta (antes solo andaba en esta prueba).
async function mostrarDetalleDia(dia){
  HistorialGastos.cargando();
  document.getElementById('histDiaTitulo').textContent=new Date(dia+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'});
  document.getElementById('histTurnosDetalle').innerHTML='';
  HistorialGastos.render(db.filter(g=>g.fecha===dia),[],true);
  refreshes.push(dia);
}
</script><script src="/historial-gastos.js"></script><script>mostrarDetalleDia('2026-09-16');</script></body></html>`;
const server = http.createServer((req,res)=>{
  const name=req.url.slice(1);
  if(['cierre-cuentas.js','historial-gastos.js','historial-gastos.css'].includes(name)){
    res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');
    return res.end(fs.readFileSync(path.join(root,name)));
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});
(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    if(process.argv.includes('--preview')){console.log(origin);return;}
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    const add=()=>page.getByRole('button',{name:'Agregar gasto'}).click();
    const fill=async(name,amount)=>{await page.getByLabel('Concepto',{exact:true}).fill(name);await page.getByLabel('Importe ($)',{exact:true}).fill(amount);};
    const save=()=>page.getByRole('button',{name:'Guardar gasto',exact:true}).click();
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:900});await page.goto(origin);await add();
      await add();assert.equal(await page.locator('#histNuevoGasto').count(),1);
      await save();assert.equal(await page.evaluate(()=>calls.length),0);
      await fill('Nobleza','-1');await save();assert.equal(await page.evaluate(()=>calls.length),0);
      await fill('Nobleza','1.001');await save();assert.equal(await page.evaluate(()=>calls.length),0);
      await fill('Nobleza','1138210.50');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(output,'agregar-'+width+'.png')});
      await save();await page.locator('#histNuevoGasto').waitFor({state:'detached'});
      assert.deepEqual(await page.evaluate(()=>calls),[{uid:'expense-1',nombre:'Nobleza',monto:1138210.5,caja:'',turno:'',fecha:'2026-09-16'}]);
      assert.equal(await page.locator('#histDiaGastos strong').innerText(),'$1.138.210,5');
      assert.equal(await page.locator('.hist-gasto-line').count(),1);
    }
    await page.goto(origin);await add();await fill('Arcor','123.45');
    await page.evaluate(()=>fail=true);await save();
    assert.equal(await page.locator('[role="alert"]').isVisible(),true);
    assert.equal(await page.getByLabel('Concepto',{exact:true}).inputValue(),'Arcor');
    await page.evaluate(()=>fail=false);await save();await page.locator('#histNuevoGasto').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>calls[0].uid===calls[1].uid && db.length===1),true);
    await add();await fill('No guardar','25');await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    assert.equal(await page.evaluate(()=>calls.length),2);
    await page.evaluate(()=>mostrarDetalleDia('2026-09-20'));await add();await fill('Domingo','50');
    await page.evaluate(()=>delay=true);await save();
    await page.locator('#histNuevoGasto').evaluate(form=>form.requestSubmit());
    assert.equal(await page.evaluate(()=>calls.length),3,'block repeated submission');
    await page.evaluate(()=>mostrarDetalleDia('2026-09-21'));
    await page.evaluate(()=>release());
    await page.waitForFunction(()=>db.length===2);
    assert.equal(await page.evaluate(()=>refreshes.at(-1)),'2026-09-21','saving a previous day must not jump back to it');
    assert.equal(await page.locator('#histVistaDetalle').getAttribute('data-dia'),null);
    assert.equal(await page.locator('#histDiaGastos strong').innerText(),'$0');
    assert.equal(await page.evaluate(()=>db[1].fecha),'2026-09-20');
    assert.deepEqual(errors,[]);
    console.log('Add expense: date, Sunday, totals, validation, retry, duplicates, navigation and responsive checks passed. '+output);
  }finally{
    if(browser)await browser.close();
    if(!process.argv.includes('--preview'))await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
