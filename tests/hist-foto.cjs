// Isolated production photo renderer; no account, database or paid API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const root = path.join(__dirname, '..');
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[0];
const start = source.indexOf('async function histCargarFotoDia(dia){');
const end = source.indexOf('function histRadAnimarMonto(', start);
assert(start >= 0 && end > start);
const render = source.slice(start, end);
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-hist-foto-'));
const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${styles}
<link rel="stylesheet" href="/assets/vendor/cropper-1.6.2/cropper.min.css"><link rel="stylesheet" href="/historial-foto-recorte.css">
<style>body{padding:24px}main{width:100%;min-width:0}</style></head>
<body><main><div id="histFotoDia" class="hist-foto-dia" hidden></div></main>
<script>
let fixtureUrl = '/foto.svg?w=900&h=1200';
let fixtureFailSave=false,fixtureWrites=[];
const sbAuthHeaders = async extra => ({Authorization:'Bearer fixture',...extra});
const showToast = text => {window.fixtureToast=text;};
const fixtureNativeFetch=window.fetch.bind(window);
window.fetch = async (url, options) => {
  if(url==='/api/cierre-foto-guardar'&&options?.method==='POST'){
    if(fixtureFailSave)return {ok:false,status:502};
    const row=JSON.parse(options.body);
    fixtureWrites.push({row,headers:options.headers});
    await fixtureNativeFetch('/saved-photo',{method:'POST',body:JSON.stringify(row)});
    fixtureUrl='/saved-photo?version='+fixtureWrites.length;
    return {ok:true};
  }
  if (options?.method || !url.startsWith('/api/cierre-foto-guardar?')) {
    throw new Error('Unexpected write or network call');
  }
  return {ok:true, json:async()=>({url:fixtureUrl})};
};
${render}
</script><script src="/historial-foto-recorte.js"></script></body></html>`;

let storedImage;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if(url.pathname==='/saved-photo'){
    if(req.method==='POST'){
      let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{storedImage=Buffer.from(JSON.parse(body).image,'base64');res.end('{}');});return;
    }
    res.setHeader('Content-Type','image/jpeg');return res.end(storedImage);
  }
  const asset={'/historial-foto-recorte.js':'text/javascript','/historial-foto-recorte.css':'text/css',
    '/assets/vendor/cropper-1.6.2/cropper.min.js':'text/javascript','/assets/vendor/cropper-1.6.2/cropper.min.css':'text/css',
    '/assets/vendor/lucide/crop.svg':'image/svg+xml'}[url.pathname];
  if(asset){res.setHeader('Content-Type',asset);return res.end(fs.readFileSync(path.join(root,url.pathname.slice(1))));}
  if (url.pathname === '/foto.svg') {
    const w = Number(url.searchParams.get('w')), h = Number(url.searchParams.get('h'));
    res.setHeader('Content-Type', 'image/svg+xml');
    const lines = Array.from({length:18}, (_,i) => `<path d="M40 ${100+i*45}H${w-40}"/>`).join('');
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f7f7f2"/><g stroke="#a7b7c0">${lines}</g><g fill="#314a68" font-family="sans-serif" font-size="30"><text x="50" y="75">CIERRE DEL DIA</text><text x="50" y="160">Turno 1</text><text x="50" y="250">Turno 2</text><text x="50" y="340">Turno 3</text></g><rect x="0" y="${h*.7}" width="${w}" height="${h*.3}" fill="#e62b30"/></svg>`);
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
    await page.locator('.hist-foto-reemplazar').click();
    assert.equal((await chooser).isMultiple(), false);

    const openCrop=async p=>{
      await p.locator('.hist-foto-recortar').click();
      await p.waitForFunction(()=>!document.querySelector('.hfc-save').disabled);
    };
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(async()=>{fixtureUrl='/foto.svg?w=900&h=1200';await histCargarFotoDia('2026-09-18');});
    const originalUrl=await page.locator('#histFotoDia img').getAttribute('src');
    await openCrop(page);
    // Drag the bottom edge above the red background, preserving the notebook.
    const handle=await page.locator('.hfc-stage .point-s').boundingBox();
    const cropBox=await page.locator('.hfc-stage .cropper-crop-box').boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
    await page.mouse.down();
    await page.mouse.move(handle.x+handle.width/2,cropBox.y+cropBox.height*.6,{steps:15});
    await page.mouse.up();
    await page.locator('[data-hfc-mode="preview"]').click();
    await page.locator('.hfc-preview img').evaluate(img=>img.decode());
    const previewResult=await page.locator('.hfc-preview img').evaluate(img=>{
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
      const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let red=0;for(let i=0;i<data.length;i+=4)if(data[i]>160&&data[i+1]<90&&data[i+2]<90)red++;
      return {w:canvas.width,h:canvas.height,red};
    });
    assert.equal(previewResult.w,900,'Cropping does not downscale or upscale the notebook width');
    assert(previewResult.h<840&&previewResult.h>500,'Bottom edge drag changes real crop dimensions: '+JSON.stringify(previewResult));
    assert.equal(previewResult.red,0,'Preview physically excludes the unwanted bottom of the photo');
    await page.locator('.hfc-cancel').click();
    assert.equal(await page.locator('#histFotoDia img').getAttribute('src'),originalUrl,'Cancel leaves the photo untouched');
    assert.equal(await page.evaluate(()=>fixtureWrites.length),0,'Preview and cancel never write');
    await openCrop(page);
    await page.locator('.hfc-original').evaluate(img=>img.cropper.setData({x:80,y:50,width:700,height:650}));
    await page.locator('.hfc-reset').click();
    const resetSize=await page.locator('.hfc-original').evaluate(img=>img.cropper.getData(true));
    assert.equal(resetSize.width,900,'Reset restores the full selection');
    assert.equal(resetSize.height,1200);
    await page.locator('.hfc-original').evaluate(img=>img.cropper.setData({x:80,y:50,width:700,height:650}));
    await page.evaluate(()=>{fixtureFailSave=true;});
    await page.locator('.hfc-save').click();
    await page.waitForFunction(()=>!document.querySelector('.hfc-error').hidden);
    assert.equal(await page.evaluate(()=>fixtureWrites.length),0,'Failed save does not replace the photo');
    assert(await page.locator('dialog').isVisible(),'Selection stays available after failure');
    await page.evaluate(()=>{fixtureFailSave=false;});
    await page.locator('.hfc-save').click();
    await page.waitForFunction(()=>!document.querySelector('.hist-foto-recorte'));
    await page.waitForFunction(()=>document.querySelector('#histFotoDia img')?.src.includes('/saved-photo'));
    await page.locator('#histFotoDia img').evaluate(img=>img.decode());
    const saved=await page.evaluate(()=>({writes:fixtureWrites.length,date:fixtureWrites[0].row.fecha,mime:fixtureWrites[0].row.mime,
      auth:fixtureWrites[0].headers.Authorization,w:document.querySelector('#histFotoDia img').naturalWidth,h:document.querySelector('#histFotoDia img').naturalHeight}));
    assert.deepEqual(saved,{writes:1,date:'2026-09-18',mime:'image/jpeg',auth:'Bearer fixture',w:700,h:650});
    await page.locator('.hist-foto-girar').click();
    await page.waitForFunction(()=>fixtureWrites.length===2);
    await page.waitForFunction(()=>document.querySelector('#histFotoDia img')?.naturalWidth===650);
    assert.equal(await page.locator('#histFotoDia img').evaluate(img=>img.naturalHeight),700,'Rotate still works on the saved crop');
    await openCrop(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.hist-foto-recorte'));
    assert.equal(await page.locator('dialog').count(),0,'Escape cancels crop editor');
    checks+=14;

    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    mobile.on('pageerror',err=>errors.push(err.message));
    await mobile.goto(origin);
    await mobile.evaluate(()=>histCargarFotoDia('2026-09-19'));
    await openCrop(mobile);
    await mobile.locator('[data-hfc-mode="preview"]').tap();
    await mobile.locator('.hfc-preview').waitFor({state:'visible',timeout:2500});
    await mobile.locator('[data-hfc-mode="edit"]').tap();
    await mobile.locator('.hfc-preview').waitFor({state:'hidden'});
    const beforeTouch=await mobile.locator('.hfc-original').evaluate(img=>img.cropper.getData().height);
    const touchHandle=await mobile.locator('.hfc-stage .point-s').boundingBox();
    const cdp=await mobile.context().newCDPSession(mobile);
    const x=touchHandle.x+touchHandle.width/2,y=touchHandle.y+touchHandle.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let step=1;step<=8;step++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*12}]});
      await mobile.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const afterTouch=await mobile.locator('.hfc-original').evaluate(img=>img.cropper.getData().height);
    assert(afterTouch<beforeTouch-100,'A real touch drag resizes the crop on mobile');
    await mobile.screenshot({path:path.join(output,'crop-mobile.png')});
    await mobile.waitForTimeout(500);
    const previewButton=await mobile.locator('[data-hfc-mode="preview"]').boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:previewButton.x+previewButton.width/2,y:previewButton.y+previewButton.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await mobile.locator('.hfc-preview').waitFor({state:'visible',timeout:2500});
    assert(await mobile.locator('.hfc-preview').isVisible());
    for(const width of [390,320]){
      await mobile.setViewportSize({width,height:640});
      assert(await mobile.locator('.hfc-save').evaluate(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight;}),'Save stays within the mobile viewport');
      assert(await mobile.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'Editor never scrolls horizontally');
    }
    await mobile.locator('.hfc-cancel').tap();
    assert.equal(await mobile.evaluate(()=>fixtureWrites.length),0);
    await mobile.close();
    checks+=7;

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
