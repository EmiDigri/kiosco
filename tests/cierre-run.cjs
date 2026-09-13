const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  let browser;
  const server = spawn(process.execPath, [path.join(__dirname, 'cierre-preview.cjs'), '0'], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  const ended = once(server, 'exit');
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Closing fixture did not start')), 10000);
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.stderr.on('data', data => { clearTimeout(timer); reject(Error(String(data))); });
      server.stdout.on('data', data => {
        const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    browser = await chromium.launch({channel: 'msedge', headless: true});
    for (const width of [1280, 390]) {
      const page = await browser.newPage({viewport: {width, height: 900}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(origin + '/?test');
      await page.waitForFunction(() => document.body.dataset.qa, null, {timeout: 30000});
      const report = await page.locator('#qaResults').innerText();
      assert.equal(await page.locator('body').getAttribute('data-qa'), 'passed', report);
      assert.deepEqual(errors, []);
      console.log(`Closing photo flow (${width}px): ${report.split('\n').length} checks passed.`);
      console.log(report.split('\n').filter(line => /Sunday|Saturday/.test(line)).join('\n'));
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
    await ended;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
