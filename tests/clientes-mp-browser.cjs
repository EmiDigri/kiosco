// Tarjeta "Clientes de Mercado Pago" en Métricas: carga del reporte, clientes del mes (podio,
// anillo, mapa de calor, los que dejaron de venir, nuevos), buscador de clientes con su ficha,
// atajo al lado del título y nombres en el Historial. Supabase simulado; nombres inventados.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = source.match(/<style>[\s\S]*?<\/style>/)[0];

// Agosto ya cargado (reporte anterior): Pedro venía seguido y dejó de venir; Carlos ya era cliente.
const agosto = [
  ...[5, 8, 12, 19].map((d, i) => ({pago_id: String(900 + i), nombre: 'PEDRO SOSA', fecha: `2026-08-${String(d).padStart(2, '0')}`, hora: '12:30', monto: 2000, devuelto: false})),
  {pago_id: '950', nombre: 'CARLOS DIAZ', fecha: '2026-08-20', hora: '08:30', monto: 2500, devuelto: false},
  {pago_id: '951', nombre: 'CARLOS DIAZ', fecha: '2026-08-25', hora: '08:30', monto: 2500, devuelto: false},
];
// Reporte de septiembre: [id, día, hora, monto, nombre].
const septiembre = [
  ...[1, 3, 5, 8, 10].map((d, i) => [2001 + i, d, ['10:00', '10:30', '11:00', '09:15', '09:40'][i], [1000, 1500, 2000, 1000, 1200][i], 'LUCÍA FERNÁNDEZ']),
  [1001, 27, '18:00', 4500, 'JUAN PEREZ'], [1002, 28, '19:10', 3000, 'JUAN PEREZ'], [1003, 28, '20:00', 500, 'JUAN PEREZ'],
  [1004, 28, '13:00', 900, 'ANA GOMEZ'],
  ...[2, 6, 9, 13, 16, 20, 23, 27].map((d, i) => [3001 + i, d, '08:30', 2500, 'CARLOS DIAZ']),
  [4001, 4, '15:00', 3000, 'MARTINA ROJAS'], [4002, 18, '16:00', 2000, 'MARTINA ROJAS'], [4003, 25, '14:30', 5000, 'MARTINA ROJAS'],
  [5001, 12, '21:00', 1500, 'SOFIA LOPEZ'],
  [1005, 26, '10:00', 900, ''],
];
const csv = ['TRANSACTION_DATE;SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;SETTLEMENT_NET_AMOUNT;REAL_AMOUNT;ISSUER_NAME;PAYER_NAME',
  ...septiembre.map(([id, d, h, m, n]) => `2026-09-${String(d).padStart(2, '0')}T${h}:00.000-03:00;${id};SETTLEMENT;${m}.00;${m}.00;${m}.00;${n ? '' : 'Visa'};${n}`)].join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}
<link rel="stylesheet" href="/clientes-mp.css"></head><body>
<div class="historial-overlay met-overlay" id="metricasOverlay" style="position:static;display:block;opacity:1;visibility:visible;transform:none"><div class="historial-panel" style="position:static;transform:none;max-height:none">
<div class="historial-header"><span class="historial-title">📊 Métricas del negocio</span><button class="btn-cerrar-hist" type="button">x</button></div>
<div id="metricasBody" style="display:grid;gap:12px"></div></div></div>
<div id="histTurnosDetalle"></div>
<script>
const TURNOS_SEMANA=[{nombre:'Vale'},{nombre:'Ani'},{nombre:'Marta'}];
let metMes=new Date(2026,8,1);
let tablaExiste=true,guardado=${JSON.stringify(agosto)},consultas=[];
function metRender(){document.getElementById('metricasBody').innerHTML='<div class="met-card"><div class="met-card-title">Resultado</div></div>';}
// PostgREST simulado: entiende fecha gte/lte, monto eq, nombre ilike (* % _) y pago_id in.
function filtrar(q){const params=(q.split('?')[1]||'').split('&');let filas=guardado.slice();
  for(const p of params){const i=p.indexOf('=');const campo=p.slice(0,i),valor=decodeURIComponent(p.slice(i+1));
    if(campo==='fecha'&&valor.startsWith('gte.'))filas=filas.filter(f=>f.fecha>=valor.slice(4));
    if(campo==='fecha'&&valor.startsWith('lte.'))filas=filas.filter(f=>f.fecha<=valor.slice(4));
    if(campo==='monto'&&valor.startsWith('eq.'))filas=filas.filter(f=>Number(f.monto)===Number(valor.slice(3)));
    if(campo==='pago_id'&&valor.startsWith('in.(')){const ids=valor.slice(4,-1).split(',');filas=filas.filter(f=>ids.includes(f.pago_id));}
    if(campo==='nombre'&&valor.startsWith('ilike.')){const re=new RegExp('^'+valor.slice(6).split('*').join('.*').split('%').join('.*').split('_').join('.')+'$','i');filas=filas.filter(f=>re.test(f.nombre));}}
  return filas;}
async function histSbSelectAll(q){consultas.push(q);if(!tablaExiste)throw new Error('{"code":"42P01","message":"relation mp_pagadores does not exist"}');
  if(q.startsWith('pagos'))return [{pago_id:1001},{pago_id:1002}];return filtrar(q);}
async function histSbSelect(q){consultas.push(q);return filtrar(q);}
async function cmSbWrite(p,m,body){if(!tablaExiste)throw new Error('relation "public.mp_pagadores" does not exist');
  const ids=new Set(body.map(f=>f.pago_id));guardado=guardado.filter(f=>!ids.has(f.pago_id)).concat(body);}
// Detalle del día como lo dibuja index.html: transferencia, transferencia fuera de horario,
// Point (sin botón ↩) y una transferencia que no está en el reporte.
async function mostrarDetalleDia(dia){await new Promise(r=>setTimeout(r,20));
  const fila=(id,nombre,extra='')=>'<div class="t-row"><span class="t-hora">10:00</span><span class="t-nombre"><span class="t-n"'+extra+'>'+nombre+'</span></span><span class="t-monto">$1</span>'+(id?'<button class="hist-dev-btn" data-devolver="'+id+'">↩</button>':'')+'</div>';
  document.getElementById('histTurnosDetalle').innerHTML=fila('1001','Transferencia recibida')+fila('1002','Transferencia fuera de horario',' style="color:#a78bfa"')+fila('','Venta con tarjeta')+fila('5555','Transferencia recibida');
  return dia;}
</script><script src="/clientes-mp.js"></script><script>metRender();</script></body></html>`;

const server = http.createServer((req, res) => {
  const name = req.url.slice(1);
  if (['clientes-mp.js', 'clientes-mp.css'].includes(name)) {
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
    return res.end(fs.readFileSync(path.join(root, name)));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
const textos = loc => loc.allTextContents().then(t => t.map(s => s.replace(/\s+/g, ' ').trim()));

(async () => {
  let browser;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-clientes-'));
  const archivo = path.join(dir, 'reporte.csv'); fs.writeFileSync(archivo, csv);
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({channel: 'msedge', headless: true});
    for (const width of [1280, 390]) {
      const page = await browser.newPage({viewport: {width, height: 900}});
      const errores = []; page.on('pageerror', e => errores.push(e.message));
      await page.goto(origin);
      // La tarjeta aparece al final de Métricas y dice que falta el reporte del mes.
      await page.locator('#cmpEstado').filter({hasText: 'Todavía no cargaste el reporte de septiembre'}).waitFor();
      assert.equal(await page.locator('#metricasBody > .met-card').last().getAttribute('id'), 'metClientes');
      assert.equal(await page.evaluate(() => consultas[0]), 'mp_pagadores?select=pago_id,nombre,fecha,hora,monto,devuelto&fecha=gte.2026-07-03&fecha=lte.2026-09-30&order=pago_id.asc');
      assert.equal(await page.locator('#cmpAnalisis').innerHTML(), '');
      // Atajo al lado del título, con el cartel mientras la sección es nueva.
      assert.equal(await page.locator('.historial-title + #cmpAtajo').count(), 1);
      if (new Date() <= new Date('2026-10-31T23:59:00-03:00')) assert.equal((await page.locator('#cmpAtajo .cmp-atajo-nueva').innerText()).toLowerCase(), 'nueva sección');
      assert((await page.locator('#cmpAtajo').innerText()).includes('Clientes'));
      await page.locator('#metricasOverlay .historial-header').screenshot({path: path.join(dir, `clientes-atajo-${width}.png`)});
      // Volver a dibujar Métricas no duplica ni la tarjeta ni el atajo.
      await page.evaluate(() => metRender());
      assert.equal(await page.locator('#metClientes').count(), 1);
      assert.equal(await page.locator('#cmpAtajo').count(), 1);

      // Subir el reporte.
      await page.locator('#cmpArchivo').setInputFiles(archivo);
      await page.locator('#cmpEstado.is-ok').waitFor();
      const texto = await page.locator('#cmpEstado').innerText();
      assert(texto.includes('Listo: 21 cobros con nombre del 01/09 al 28/09, de 6 clientes distintos'), texto);
      assert(texto.includes('1 cobro viene sin nombre'), texto);
      assert(texto.includes('2 de 21 coinciden con los cobros que tiene la app'), texto);
      assert.equal(await page.locator('#cmpArchivo').isDisabled(), false);

      // Clientes del mes: números, podio, ranking, anillo, mapa, los que dejaron de venir y nuevos.
      await page.locator('.cmp-podio').waitFor();
      assert.deepEqual(await textos(page.locator('#cmpAnalisis > .cmp-kpis b')), ['6', '21', '$2.243', '$47.100']);
      assert.deepEqual(await textos(page.locator('.cmp-podio-lugar .cmp-podio-nom')), ['Martina Rojas', 'Carlos Diaz', 'Juan Perez']);
      assert.equal(await page.locator('.cmp-podio-lugar.is-1 .cmp-podio-monto').innerText(), '$20.000');
      assert.equal(await page.locator('.cmp-podio-lugar.is-1 .cmp-av').innerText(), 'CD');
      assert.deepEqual(await textos(page.locator('#cmpRanking .cmp-cli-txt')), ['Lucía Fernández', 'Sofia Lopez', 'Ana Gomez']);
      assert.equal(await page.locator('#cmpVerMas').count(), 0);
      assert.deepEqual(await textos(page.locator('.cmp-dona text')), ['57%', 'habituales']);
      assert.deepEqual(await textos(page.locator('.cmp-ley-val b')), ['57%', '38%', '5%']);
      assert.equal(await page.locator('#cmpAnalisis .cmp-mapa-celda').count(), 21);
      // Carlos: miércoles y domingos a la mañana, 4 veces cada uno.
      assert.equal(await page.locator('#cmpAnalisis .cmp-mapa-celda').nth(6).innerText(), '4');
      const dejaron = await textos(page.locator('.cmp-cli.is-apagado .cmp-cli-txt'));
      assert.deepEqual(dejaron, ['Lucía Fernández', 'Pedro Sosa']);
      assert((await page.locator('.cmp-cli.is-apagado .cmp-chip').first().innerText()).startsWith('hace '));
      assert((await page.locator('.cmp-nuevos').innerText()).includes('5 clientes compraron por primera vez'));
      assert.equal(await page.locator('.cmp-chip.is-nuevo').count(), 5);
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'sin scroll horizontal');
      await page.locator('#metClientes').screenshot({path: path.join(dir, `clientes-mes-${width}.png`)});

      // El atajo del título lleva a la tarjeta.
      await page.evaluate(() => scrollTo(0, 0));
      await page.locator('#cmpAtajo').click();
      await page.waitForFunction(() => Math.abs(document.getElementById('metClientes').getBoundingClientRect().top) < 30);

      // Buscador: devuelve clientes, no cobros. Por monto...
      await page.locator('#cmpBuscar').fill('$ 4.500');
      await page.locator('#cmpResultados .cmp-cli').filter({hasText: 'Juan Perez'}).waitFor();
      assert.equal(await page.locator('#cmpResultados .cmp-cli').count(), 1);
      assert((await page.locator('#cmpResultados').innerText()).includes('1 cliente pagó $4.500'));
      assert((await page.locator('#cmpResultados .cmp-cli-det').innerText()).includes('1 vez · última vez el 27/09'));
      // ...y por nombre, sin tildes y en cualquier orden: 5 cobros de Lucía = 1 cliente.
      await page.locator('#cmpBuscar').fill('fernandez lucia');
      await page.locator('#cmpResultados .cmp-cli').filter({hasText: 'Lucía Fernández'}).waitFor();
      assert.equal(await page.locator('#cmpResultados .cmp-cli').count(), 1);
      assert.equal(await page.locator('#cmpResultados .cmp-cli-monto').innerText(), '$6.700');
      await page.locator('#cmpBuscar').fill('zzzz');
      await page.locator('.cmp-nada').filter({hasText: 'No encontré clientes con ese nombre'}).waitFor();

      // Tocar un cliente abre su ficha.
      await page.locator('#cmpBuscar').fill('lucia');
      await page.locator('#cmpResultados .cmp-cli').first().waitFor();
      await page.locator('#cmpResultados .cmp-cli').first().click();
      await page.locator('#cmpFicha .cmp-ficha-nom').filter({hasText: 'Lucía Fernández'}).waitFor();
      assert.equal(await page.locator('#cmpResultados').isHidden(), true);
      assert.deepEqual(await textos(page.locator('#cmpFicha .cmp-kpis b')), ['$6.700', '5', '5', '$1.340']);
      assert((await page.locator('#cmpFicha .cmp-habito').innerText()).includes('Suele venir en el turno de Vale (mañana)'));
      assert.equal(await page.locator('#cmpFicha .cmp-chip').innerText(), 'Habitual');
      assert.equal(await page.locator('#cmpFicha .cmp-barras rect').count(), 5);
      assert.equal(await page.locator('#cmpFicha .cmp-compra').count(), 5);
      assert.deepEqual(await textos(page.locator('#cmpFicha .cmp-compra').first().locator('span, b')), ['jue 10/09', '09:40', '$1.200']);
      // Cerrar vuelve a la lista de resultados.
      await page.locator('.cmp-ficha-cerrar').click();
      assert.equal(await page.locator('#cmpFicha').isHidden(), true);
      assert.equal(await page.locator('#cmpResultados').isVisible(), true);

      // Tocar el 1º del podio abre su ficha: dos meses, sus días y turno.
      await page.locator('.cmp-podio-lugar.is-1').click();
      await page.locator('#cmpFicha .cmp-ficha-nom').filter({hasText: 'Carlos Diaz'}).waitFor();
      assert.deepEqual(await textos(page.locator('#cmpFicha .cmp-kpis b')), ['$25.000', '10', '10', '$2.500']);
      assert((await page.locator('#cmpFicha .cmp-habito').innerText()).includes('turno de Vale (mañana), sobre todo los miércoles y domingos'));
      assert.equal(await page.locator('#cmpFicha .cmp-mes').count(), 2);
      assert.equal(await page.locator('#cmpFicha .cmp-mapa-celda').count(), 21);
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'sin scroll horizontal');
      await page.locator('#cmpFicha').screenshot({path: path.join(dir, `clientes-ficha-${width}.png`)});

      // Historial: cada transferencia del día muestra quién pagó; lo demás queda igual.
      await page.evaluate(() => mostrarDetalleDia('2026-09-28'));
      assert.deepEqual(await page.locator('#histTurnosDetalle .t-n').allInnerTexts(), ['Juan Perez', 'Juan Perez', 'Venta con tarjeta', 'Transferencia recibida']);
      assert(await page.evaluate(() => consultas.includes('mp_pagadores?select=pago_id,nombre&pago_id=in.(1001,1002,5555)')));
      assert.equal(await page.locator('#histTurnosDetalle .t-n').nth(1).getAttribute('style'), 'color:#a78bfa');

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
    console.log('Clientes MP: carga, clientes del mes, buscador, ficha, atajo e Historial OK en 1280/390. ' + dir);
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
