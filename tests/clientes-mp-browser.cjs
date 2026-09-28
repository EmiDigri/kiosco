// Tarjeta "Clientes de Mercado Pago" en Métricas: aparece, informa lo cargado y sube el reporte.
// Supabase simulado; nombres inventados.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = source.match(/<style>[\s\S]*?<\/style>/)[0];
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}
<link rel="stylesheet" href="/clientes-mp.css"></head><body><div id="metricasBody" style="padding:16px;display:grid;gap:12px"></div>
<script>
let metMes=new Date(2026,8,1);
let tablaExiste=true,guardado=[],consultas=[];
function metRender(){document.getElementById('metricasBody').innerHTML='<div class="met-card"><div class="met-card-title">Resultado</div></div>';}
async function histSbSelectAll(q){consultas.push(q);if(!tablaExiste)throw new Error('{"code":"42P01","message":"relation \\\\"public.mp_pagadores\\\\" does not exist"}');
  if(q.startsWith('pagos'))return [{pago_id:1001},{pago_id:1002}];return guardado.map(f=>({pago_id:f.pago_id}));}
async function cmSbWrite(p,m,body){if(!tablaExiste)throw new Error('relation "public.mp_pagadores" does not exist');guardado=guardado.concat(body);}
</script><script src="/clientes-mp.js"></script><script>metRender();</script></body></html>`;
const csv = ['TRANSACTION_DATE;SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ISSUER_NAME;PAYER_NAME',
  '2026-09-28T17:28:42.000-03:00;1001;SETTLEMENT;1200.00;1200.00;1200.00;;LUCIA FERNANDEZ',
  '2026-09-27T10:00:00.000-03:00;1002;SETTLEMENT;4500.00;4500.00;4500.00;;JUAN PEREZ',
  '2026-09-26T10:00:00.000-03:00;1003;SETTLEMENT;900.00;900.00;900.00;Visa;'].join('\n');
const server = http.createServer((req, res) => {
  const name = req.url.slice(1);
  if (['clientes-mp.js', 'clientes-mp.css'].includes(name)) {
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
    return res.end(fs.readFileSync(path.join(root, name)));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
(async () => {
  let browser;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-clientes-'));
  const archivo = path.join(dir, 'reporte.csv'); fs.writeFileSync(archivo, csv);
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({channel: 'msedge', headless: true});
    for (const width of [1280, 390]) {
      const page = await browser.newPage({viewport: {width, height: 800}});
      const errores = []; page.on('pageerror', e => errores.push(e.message));
      await page.goto(origin);
      // La tarjeta aparece al final de Métricas y dice que falta el reporte del mes.
      await page.locator('#cmpEstado').filter({hasText: 'Todavía no cargaste'}).waitFor();
      assert.equal(await page.locator('#metricasBody > .met-card').last().getAttribute('id'), 'metClientes');
      assert((await page.locator('#cmpEstado').innerText()).includes('septiembre'));
      assert(await page.evaluate(() => consultas[0] === 'mp_pagadores?select=pago_id&fecha=gte.2026-09-01&fecha=lte.2026-09-30'));
      // Volver a dibujar Métricas no duplica la tarjeta.
      await page.evaluate(() => metRender());
      assert.equal(await page.locator('#metClientes').count(), 1);
      // Subir el reporte.
      await page.locator('#cmpArchivo').setInputFiles(archivo);
      await page.locator('#cmpEstado.is-ok').waitFor();
      const texto = await page.locator('#cmpEstado').innerText();
      // El período es el del reporte (arranca el 26/9 con un cobro con tarjeta sin nombre).
      assert(texto.includes('Listo: 2 cobros con nombre del 26/09 al 28/09, de 2 clientes distintos'), texto);
      assert(texto.includes('1 cobro viene sin nombre'), texto);
      assert(texto.includes('2 de 2 coinciden con los cobros que tiene la app'), texto);
      assert.equal(await page.evaluate(() => guardado.length), 2);
      assert.equal(await page.locator('#cmpArchivo').isDisabled(), false);
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'sin scroll horizontal');
      await page.screenshot({path: path.join(dir, `clientes-${width}.png`)});
      // Sin la tabla: explica el paso pendiente en Supabase.
      await page.evaluate(() => { tablaExiste = false; document.getElementById('metClientes').remove(); metRender(); });
      await page.locator('#cmpEstado.is-error').waitFor();
      assert((await page.locator('#cmpEstado').innerText()).includes('crear la tabla mp_pagadores'));
      // Un archivo equivocado se explica y no rompe nada.
      await page.evaluate(() => { tablaExiste = true; });
      fs.writeFileSync(path.join(dir, 'otro.csv'), 'fecha;monto\n2026-09-10;10');
      await page.locator('#cmpArchivo').setInputFiles(path.join(dir, 'otro.csv'));
      await page.locator('#cmpEstado.is-error').filter({hasText: 'no es el reporte'}).waitFor();
      assert.deepEqual(errores, []);
      await page.close();
    }
    console.log('Clientes MP: tarjeta, carga del reporte, tabla faltante y archivo equivocado OK en 1280/390. ' + dir);
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
