const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'..');
const port=4197;
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--bg1:#1B1B1D;--glass:#242426;--surface:#242426;--glass-border:#343437;--glass-hover:#2A2A2D;--text:#F2F1ED;--text-mid:#A8A7A4;--text-soft:#75747A;--accent:#7C90FF;--amber:#F0B860}*{box-sizing:border-box}body{margin:0;background:var(--bg1);color:var(--text);font-family:Inter,Arial;padding:16px}.hist-gastos-mes{max-width:1100px;margin:auto}.hist-egresos{border:1px solid var(--glass-border);border-radius:14px;margin-top:16px}.hist-egresos-head{display:flex;align-items:center;gap:10px}.hist-egresos-head span{font-size:13px;font-weight:900}.hist-egresos-head strong{font-size:18px;color:var(--amber)}</style>
<link rel="stylesheet" href="/historial-egresos-mapa.css"></head><body><div id="histGastosMes" class="hist-gastos-mes"></div>
<script src="/historial-egresos-mapa.js"></script><script>
const gastos=[
 {fecha:'2026-09-18',nombre:'Pago Arcor',monto:125000},{fecha:'2026-09-16',nombre:'Telecentro',monto:32342.89},{fecha:'2026-09-10',nombre:'Limpieza',monto:18000}
];
const pagos=[
 ['Coca-Cola FEMSA',553976.15],['Edenor',481408.07],['Transferencia enviada',272327.44],['Producto',63460],['MAPFRE Aconcagua',54589.13],['Lector de codigo de barras',39539.39],['Barracas Logistica',34875.43],['Norbieta',22000]
].map((row,index)=>({fecha:'2026-09-'+String(18-index).padStart(2,'0'),nombre:row[0],monto:row[1],es_enviada:true,status:'approved'}));
HistorialEgresosMapa.render({container:document.getElementById('histGastosMes'),gastos,pagos});
</script></body></html>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  const file={'/historial-egresos-mapa.css':'historial-egresos-mapa.css','/historial-egresos-mapa.js':'historial-egresos-mapa.js'}[url.pathname];
  if(file){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(path.join(root,file)));}
  res.writeHead(404).end();
});

(async()=>{
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1024,height:900}});
    await page.goto(`http://127.0.0.1:${port}`);
    const check=(condition,label)=>{if(!condition)throw Error(label);console.log('OK '+label);};
    check(await page.locator('.hem-tile').count()===6,'mapa inicial compacto con Otros');
    check((await page.locator('.hem-card').evaluate(el=>getComputedStyle(el).backgroundColor))!=='rgb(255, 255, 255)','fondo oscuro, no blanco');
    await page.locator('[data-hem-more]').click();
    check(await page.locator('[data-hem-back]').isVisible(),'Otros abre el siguiente grupo');
    await page.locator('[data-hem-back]').click();
    await page.locator('.hem-search input').fill('Barracas');
    check(await page.locator('.hem-tile-name').first().textContent()==='Barracas Logistica','busqueda encuentra un concepto profundo');
    await page.locator('.hem-tile').first().click();
    check((await page.locator('.hem-detail').textContent()).includes('Mercado Pago'),'detalle muestra el medio');
    await page.locator('[data-hem-mode="efectivo"]').click();
    check((await page.locator('.hem-summary strong').textContent()).includes('175.342'),'filtro efectivo recalcula el total');
    await page.locator('.hem-search input').fill('');
    await page.locator('[data-hem-mode="todos"]').click();
    for(const width of [390,320]){
      await page.setViewportSize({width,height:850});
      check(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'sin desborde horizontal a '+width+'px');
    }
    await page.setViewportSize({width:390,height:850});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(process.env.TEMP||root,'hist-egresos-mapa-mobile.png'),fullPage:true});
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
