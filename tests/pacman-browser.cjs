const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const sharp=require('sharp');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const styles=source.match(/<style>[\s\S]*?<\/style>/)[0];
const engine=source.slice(source.indexOf('function _pacmanEatButton('),source.indexOf('function _particlePresetEffect('));
const output=process.env.KIOSCO_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'kiosco-pacman-'));

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.abort());
    for(const width of [736,390,320]){
      await page.setViewportSize({width,height:400});
      await page.setContent(`<!doctype html><html><head>${styles}</head><body><main style="display:grid;place-items:center;min-height:320px"><div class="btn-cargar-wrap"><button class="btn-cargar" id="testButton">Actualizar ahora</button></div></main><script>
        var successes=0;function _btnExito(btn){successes++;btn.classList.add('loaded');btn.disabled=false;}
        ${engine}
        window.startPacman=()=>_pacmanEatButton(document.getElementById('testButton'));
      </script></body></html>`);
      await page.evaluate(()=>{
        startPacman();const btn=document.getElementById('testButton'),runner=document.querySelector('.pacman-eat-runner');
        for(const animation of [...btn.getAnimations(),...runner.getAnimations()]){animation.pause();animation.currentTime=1200;}
        const mouth=runner.firstElementChild.getAnimations()[0];mouth.pause();mouth.currentTime=0;
      });
      const open=await page.evaluate(()=>{
        const runner=document.querySelector('.pacman-eat-runner'),shape=runner.firstElementChild,btn=document.getElementById('testButton');
        const r=runner.getBoundingClientRect(),b=btn.getBoundingClientRect(),eye=getComputedStyle(shape,'::after');
        return{color:getComputedStyle(shape).backgroundColor,clip:getComputedStyle(shape).clipPath,
          eyeColor:eye.backgroundColor,eyeSize:parseFloat(eye.width),radius:getComputedStyle(shape).borderRadius,
          width:r.width,height:r.height,center:r.left+r.width/2,buttonCenter:b.left+b.width/2,
          buttonClip:getComputedStyle(btn).clipPath,left:r.left,right:r.right,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.equal(open.color,'rgb(255, 255, 45)');assert.equal(open.eyeColor,'rgb(23, 23, 23)');assert(open.eyeSize>=3.8);
      assert.equal(open.radius,'50%');assert.equal(open.width,open.height);assert(open.width>=32&&open.width<=56);
      assert(Math.abs(open.center-open.buttonCenter)<1);assert.match(open.buttonClip,/50%/);assert(!open.overflow);
      const png=await page.locator('.pacman-eat-runner').screenshot();
      const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      let yellow=0;for(let i=0;i<data.length;i+=4)if(data[i]>230&&data[i+1]>230&&data[i+2]<80)yellow++;
      assert(yellow>info.width*info.height*.4,'Pac-Man silhouette is blank');
      const mouthPixel=(Math.floor(info.height*.5)*info.width+Math.floor(info.width*.86))*4;
      assert(data[mouthPixel+2]>80||data[mouthPixel]<230,'The open mouth must cut a wedge');
      await page.screenshot({path:path.join(output,`pacman-${width}.png`)});
      const closed=await page.evaluate(()=>{
        const shape=document.querySelector('.pacman-eat-shape');shape.getAnimations()[0].currentTime=120;
        return getComputedStyle(shape).clipPath;
      });
      assert.notEqual(open.clip,closed,'Mouth must animate despite the CSS reset');
      await page.evaluate(()=>document.getElementById('testButton')._pacmanCleanup());
      assert.equal(await page.locator('.pacman-eat-runner').count(),0);
      assert.equal(await page.evaluate(()=>document.getElementById('testButton').disabled),false);
      assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
      console.log(`Pac-Man ${width}px: yellow silhouette, eye, moving mouth and synchronized bite OK`);
    }
    await page.evaluate(()=>{startPacman();startPacman();});
    assert.equal(await page.locator('.pacman-eat-runner').count(),1);
    await page.evaluate(()=>document.querySelector('.pacman-eat-runner').getAnimations()[0].finish());
    await page.waitForTimeout(40);
    await page.evaluate(()=>document.getElementById('testButton')._pacmanCleanup());
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>successes),0,'Cancel must stop the delayed success');
    await page.evaluate(()=>{startPacman();document.querySelector('.pacman-eat-runner').getAnimations()[0].finish();});
    await page.waitForTimeout(550);
    assert.equal(await page.evaluate(()=>successes),1);assert.equal(await page.locator('.pacman-eat-runner').count(),0);
    assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>startPacman());
    assert.equal(await page.locator('.pacman-eat-runner').count(),0);assert.equal(await page.evaluate(()=>successes),2);
    assert.deepEqual(errors,[]);console.log('Cleanup, replay, completion and reduced motion OK');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
