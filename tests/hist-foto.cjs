// Isolated production photo renderer; no account, database or paid API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[0];
const start = source.indexOf('async function histCargarFotoDia(dia){');
const end = source.indexOf('async function mostrarDetalleDia(dia){', start);
assert(start >= 0 && end > start);
const render = source.slice(start, end);
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-hist-foto-'));
const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${styles}
<style>body{padding:24px}main{width:100%;min-width:0}</style></head>
<body><main><div id="histFotoDia" class="hist-foto-dia" hidden></div></main>
<script>
let fixtureUrl = '/foto.svg?w=900&h=1200';
const sbAuthHeaders = async () => ({});
window.fetch = async (url, options) => {
  if (options?.method || !url.startsWith('/api/cierre-foto-guardar?')) {
    throw new Error('Unexpected write or network call');
  }
  return {ok:true, json:async()=>({url:fixtureUrl})};
};
${render}
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/foto.svg') {
    const w = Number(url.searchParams.get('w')), h = Number(url.searchParams.get('h'));
    res.setHeader('Content-Type', 'image/svg+xml');
    const lines = Array.from({length:18}, (_,i) => `<path d="M40 ${100+i*45}H${w-40}"/>`).join('');
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f7f7f2"/><g stroke="#a7b7c0">${lines}</g><g fill="#314a68" font-family="sans-serif" font-size="30"><text x="50" y="75">CIERRE DEL DIA</text><text x="50" y="160">Turno 1</text><text x="50" y="250">Turno 2</text><text x="50" y="340">Turno 3</text></g></svg>`);
  }
  if (url.pathname !== '/') return res.writeHead(404).end();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
});

(async () => {
  let browser;
  let checks = 0;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({channel:'msedge', headless:true});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width, height:900});
      await page.goto(origin);
      for (const [name,w,h] of [['portrait',900,1200],['landscape',1200,900],['wide',1800,500]]) {
        await page.evaluate(async ({w,h}) => {
          fixtureUrl = '/foto.svg?w='+w+'&h='+h;
          await histCargarFotoDia('2026-09-09');
          await document.querySelector('#histFotoDia img').decode();
        }, {w,h});
        const size = await page.locator('#histFotoDia').evaluate(container => {
          const img = container.querySelector('img'), frame = container.querySelector('.hist-foto-documento');
          const rect = img.getBoundingClientRect(), parent = container.getBoundingClientRect();
          const css = getComputedStyle(img);
          return {w:rect.width, h:rect.height, bw:parseFloat(css.borderLeftWidth)*2, bh:parseFloat(css.borderTopWidth)*2,
            frameW:frame.getBoundingClientRect().width, bg:css.backgroundColor,
            centered:Math.abs((rect.left+rect.right)-(parent.left+parent.right)) < 2,
            overflow:document.documentElement.scrollWidth > innerWidth};
        });
        assert(Math.abs((size.w-size.bw)/(size.h-size.bh)-w/h)<0.01, 'Photo must keep its aspect ratio');
        assert(size.h <= 442, 'Photo must stay compact');
        assert(Math.abs(size.frameW-size.w)<2, 'Frame must fit the photo, without side bands');
        assert.equal(size.bg, 'rgba(0, 0, 0, 0)');
        assert(size.centered && !size.overflow, 'Centered photo must not overflow on mobile');
        checks += 5;
        if (name === 'portrait') await page.screenshot({path:path.join(output, `portrait-${width}.png`)});
      }
    }
    const link = page.locator('.hist-foto-abrir');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    await link.focus();
    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert(popup.url().startsWith(origin+'/foto.svg'), 'Keyboard should open the full photo');
    await popup.close();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.hist-foto-cambiar').click();
    assert.equal((await chooser).isMultiple(), false);
    await page.evaluate(async () => {fixtureUrl=null; await histCargarFotoDia('2026-09-09');});
    assert(await page.locator('.hist-foto-attach').isVisible(), 'Missing photo must still allow upload');
    assert.equal(await page.locator('.hist-foto-documento').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${checks+7} checks passed. Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error);process.exitCode=1;});
