// Desafío del día: la misma palabra para todos los turnos y dispositivos, distinta cada día,
// y una partida real (escribir la palabra y mandarla) sin errores. Carga la app completa;
// Supabase y /api/* se responden vacíos (no toca datos reales).
// KIOSCO_INDEX_FILE permite probar otra copia de index.html (por ejemplo, la versión de HEAD).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const indexFile = process.env.KIOSCO_INDEX_FILE || path.join(root, 'index.html');
const tipos = {'.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.ico':'image/x-icon', '.webp':'image/webp'};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end('{}'); }
  const file = url === '/' ? indexFile : path.join(root, url);
  if (!file.startsWith(root) && file !== indexFile) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', tipos[path.extname(file)] || 'text/html; charset=utf-8');
    res.end(data);
  });
});

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({channel:'msedge', headless:true});
    // Un "dispositivo" nuevo (almacenamiento vacío) a una hora dada.
    const dispositivo = async hora => {
      const ctx = await browser.newContext({timezoneId:'America/Argentina/Buenos_Aires', viewport:{width:1280, height:900}});
      const page = await ctx.newPage();
      const errores = [];
      page.on('pageerror', e => errores.push(e.message));
      await page.clock.install({time:new Date(hora)});
      await page.route('**/*', route => {
        const u = route.request().url();
        if (u.includes('supabase.co')) return route.fulfill({status:200, contentType:'application/json', body:'[]'});
        return route.continue();
      });
      await page.goto(origin + '/');
      await page.waitForFunction(() => {
        try { return Boolean(JSON.parse(localStorage.getItem('kiosco_turn_game_v2') || '{}').activeChallenge); } catch (e) { return false; }
      }, null, {timeout:30000});
      const estado = await page.evaluate(() => JSON.parse(localStorage.getItem('kiosco_turn_game_v2')));
      return {ctx, page, errores, palabra:estado.activeChallenge.word, puzzle:estado.activeChallenge.puzzleId};
    };
    const valeLunes = await dispositivo('2026-09-28T09:30:00-03:00');
    const aniLunes = await dispositivo('2026-09-28T15:00:00-03:00');
    const martes = await dispositivo('2026-09-29T09:30:00-03:00');
    assert.notEqual(valeLunes.puzzle, aniLunes.puzzle, 'cada turno tiene su propia partida');
    assert.equal(aniLunes.palabra, valeLunes.palabra, 'Vale y Ani, en dispositivos distintos, juegan la misma palabra');
    assert.notEqual(martes.palabra, valeLunes.palabra, 'al día siguiente cambia la palabra');

    // Partida real: escribir la palabra y mandarla.
    const {page} = valeLunes;
    // La pantalla de ingreso de la app puede quedarse con el foco: se le manda la palabra y
    // el Enter directo a la casilla del juego (mismos eventos que al tipear).
    await page.locator('#tgInput').evaluate((input, palabra) => {
      input.value = palabra;
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    }, valeLunes.palabra);
    await page.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('kiosco_turn_game_v2') || '{}');
      return Object.values(s.games || {}).some(g => g.won);
    }, null, {timeout:10000}).catch(async error => {
      const pantalla = await page.evaluate(() => ({
        estado: document.getElementById('tgStatus').textContent, candado: document.getElementById('tgLock').hidden ? '' : document.getElementById('tgLock').textContent,
        foco: document.activeElement && document.activeElement.id, partidas: JSON.parse(localStorage.getItem('kiosco_turn_game_v2') || '{}').games,
      }));
      console.log('Lo que muestra el juego:', JSON.stringify(pantalla), '| errores:', valeLunes.errores);
      throw error;
    });

    const deJuego = e => /assignWord|palabraDelDia|ordenPalabras|rememberUsed|tg[A-Z]|turnGame|desaf/i.test(e);
    for (const d of [valeLunes, aniLunes, martes]) assert.deepEqual(d.errores.filter(deJuego), [], 'errores del juego');
    console.log(`Desafío: lunes "${valeLunes.palabra}" para Vale y Ani, martes "${martes.palabra}"; partida ganada sin errores.`);
    for (const d of [valeLunes, aniLunes, martes]) await d.ctx.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
