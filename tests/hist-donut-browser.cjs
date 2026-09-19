const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const styles=source.match(/<style>([\s\S]*?)<\/style>/)[0];
const start=source.indexOf('let histGastosFuenteRemota=');
const end=source.indexOf('function histTotalDia(',start);
if(start<0||end<0)throw Error('No pude extraer el render mensual de egresos');
const renderSource=source.slice(start,end);
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="histGastosMes"></div><script src="/cierre-cuentas.js"></script><script>
const histMoney=n=>'$'+Number(n||0).toLocaleString('es-AR');
const histMoneyCompact=n=>n>=1e6?'$'+(n/1e6).toLocaleString('es-AR',{maximumFractionDigits:1})+'M':'$'+Math.round(n/1000)+'k';
const cmEsc=s=>String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let histRowsGastosMes=[{fecha:'2026-09-18',nombre:'Pago Arcor',monto:125000},{fecha:'2026-09-16',nombre:'Telecentro',monto:32342}];
let histRowsPagosMes=[['Coca-Cola FEMSA',553976],['Edenor',481408],['Transferencia enviada',272327],['Producto',63460],['MAPFRE Aconcagua',54589],['Barracas Logistica',34875],['Lector',39539],['Norbieta',30000],['Santos',27000],['Todo Dulce',24000],['Limpieza',21000],['Internet',18000],['Reparaciones',15000],['Impuestos',12000],['Flete',9000]].map((x,i)=>({fecha:'2026-09-'+String(Math.max(1,18-i)).padStart(2,'0'),nombre:x[0],monto:x[1],es_enviada:true,status:'approved'}));
${renderSource}
histRenderGastosMes();
</script></body></html>`;
const server=http.createServer((req,res)=>{
  if(req.url==='/cierre-cuentas.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,'cierre-cuentas.js')));}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});

(async()=>{
  await new Promise(resolve=>server.listen(4198,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    await page.goto('http://127.0.0.1:4198');
    await page.waitForTimeout(900);
    const check=(condition,label)=>{if(!condition)throw Error(label);console.log('OK '+label);};
    check(await page.locator('.hist-egresos-cols').count()===1,'conserva las columnas originales');
    check(await page.locator('.hist-egresos-col').count()===2,'muestra Efectivo y MercadoPago');
    check(await page.locator('.hist-egr-grp').count()===17,'no oculta conceptos de la lista');
    check(await page.locator('.hist-egr-arc').count()===7,'dona moderna conserva categorias y Otros');
    check(!(await page.locator('.hist-egr-arc').first().getAttribute('stroke-dasharray')).startsWith('0 '),'los segmentos se animan al aparecer');
    await page.locator('.hist-egr-leg').first().hover();
    check(await page.locator('.hist-egr-arc.is-active').count()===1,'leyenda y segmento se resaltan juntos');
    await page.locator('.hist-egr-leg[data-egr-more]').click();
    check((await page.locator('.hist-egr-c1').textContent())==='OTROS','Otros abre su propio desglose');
    check((await page.locator('.hist-egr-drillbar').textContent()).includes('7–12 de 17'),'indica que conceptos se estan viendo');
    check(await page.locator('.hist-egr-leg[data-egr-more]').count()===1,'permite continuar cuando todavia quedan conceptos');
    await page.screenshot({path:path.join(process.env.TEMP||root,'hist-egresos-otros-desktop.png'),fullPage:true});
    await page.locator('.hist-egr-leg[data-egr-more]').click();
    check(await page.locator('.hist-egr-arc').count()===5,'el ultimo nivel muestra todos los conceptos restantes');
    await page.locator('[data-egr-back]').click();
    await page.locator('[data-egr-back]').click();
    check(await page.locator('.hist-egr-drillbar').count()===0&&(await page.locator('.hist-egr-legend').textContent()).includes('Otros'),'puede volver al total');
    await page.mouse.move(1000,850);
    await page.screenshot({path:path.join(process.env.TEMP||root,'hist-egresos-donut-desktop.png'),fullPage:true});
    for(const width of [390,320]){
      await page.setViewportSize({width,height:1000});
      check(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'sin desborde horizontal a '+width+'px');
    }
    await page.setViewportSize({width:390,height:1000});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(process.env.TEMP||root,'hist-egresos-donut-mobile.png'),fullPage:true});
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
