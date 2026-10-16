const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const engine=html.slice(html.indexOf('function _cvs(){'),html.indexOf('if(EFECTOS[efectoDelDia()]?.n.startsWith'));
function context(extra={}){
  const ctx=vm.createContext({setTimeout,clearTimeout,window:{matchMedia:()=>({matches:false})},...extra});
  vm.runInContext(engine+';globalThis.fx={sources:KFX_CANDY_SOURCES,names:EFECTOS.map(e=>e.n),bag:_kfxBag,size:_kfxSpriteSize,load:_kfxLoadCandies,candy:_kfxCandyEffect};',ctx);
  return ctx;
}
const fx=context().fx;
const dir=path.join(root,'assets/effects/productos');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'fuentes.json'),'utf8'));

test('60 envases locales distintos, documentados y con archivos WebP validos',()=>{
  assert.equal(fx.sources.length,60);
  assert.equal(new Set(fx.sources).size,60);
  assert.deepEqual(new Set(fx.sources.map(s=>path.basename(s))),new Set(manifest.map(p=>p.archivo)));
  assert.equal(fs.readdirSync(dir).filter(s=>s.endsWith('.webp')).length,60);
  let bytes=0;
  for(const p of manifest){
    const b=fs.readFileSync(path.join(dir,p.archivo));bytes+=b.length;
    assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WEBP');
    assert.ok(p.ancho>0&&p.alto>0&&Math.max(p.ancho,p.alto)<=256);
    assert.equal(b.length,p.bytes);assert.ok(p.fuente);assert.ok(p.imagen);
    assert.doesNotMatch(p.archivo,/caja|display|pote|kawaii|chupetoncito/);
  }
  assert.ok(bytes<1024*1024,'El catalogo completo debe pesar menos de 1 MB');
});

test('incluye los productos pedidos y retira los dibujos de los efectos, no del encabezado',()=>{
  for(const name of ['pepitos','jorgito','rex','pico-dulce','chocolinas','merengadas','tita','rhodesia','flynn-paff','rocklets'])assert.ok(fx.sources.some(s=>s.includes(name)),name);
  assert.ok(fx.sources.every(s=>!/gomitas|confitados-mogul|palotes-extreme|gongys|saladix|papas-slices|takis/.test(s)));
  assert.ok(fx.sources.every(s=>s.startsWith('./assets/effects/productos/')));
  const loaders=html.slice(html.indexOf('function _kfxLoadStart'),html.indexOf('function _kfxLoadEnd'));
  assert.doesNotMatch(loaders,/\.svg|kawaii/);
  assert.match(loaders,/_kfxBag\(KFX_CANDY_SOURCES\)/);
  const party=html.slice(html.indexOf('function _kfxConfettiEffect'),html.indexOf('function _kfxBolt'));
  assert.doesNotMatch(party,/shapeFromText/);
  assert.match(party,/mode==='Caramelos pop'.*_kfxCandyEffect/);
  for(const name of ['bonobon-kawaii','kinder-egg-kawaii','cola-bottle-kawaii','lollipop-pop'])assert.ok(html.includes(`assets/${name}.png`));
});

test('la bolsa muestra todos antes de repetir y no repite en el cambio de ronda',()=>{
  const pick=fx.bag(fx.sources);
  let last;
  for(let round=0;round<20;round++){
    const selected=Array.from({length:60},()=>pick());
    assert.equal(new Set(selected).size,60);assert.notEqual(selected[0],last);last=selected.at(-1);
  }
  assert.equal(fx.bag([])(),undefined);assert.equal(fx.bag(['uno'])(),'uno');
});

test('los envases largos o altos conservan exactamente su proporcion',()=>{
  for(const [width,height] of [[800,100],[100,800],[256,256],[45,256]]){
    const {w,h}=fx.size({naturalWidth:width,naturalHeight:height},70);
    assert.equal(Math.max(w,h),70);assert.ok(Math.abs(w/h-width/height)<1e-10);
  }
});

test('las fotos no agrandan las golosinas: tope 54 px y 44 px en mobile',()=>{
  assert.match(engine,/_kfxSpriteSize\(img,Math\.min\(p\.size\*pulse,mobile\?44:54\)\)/);
  assert.doesNotMatch(engine,/p\.hero\?1\.2:1\.9/);
  assert.match(html,/\.kfx-load-orbit img\{[^}]*width:19px;height:19px/);
});

test('conserva las 60 animaciones y la rotacion diaria por nombre',()=>{
  assert.equal(fx.names.length,60);assert.equal(new Set(fx.names).size,60);
  assert.ok(fx.names.includes('Kiosco · Órbita de chupetines'));
  assert.ok(fx.names.includes('Fiesta · Caramelos pop'));
  assert.match(html,/kiosco_efecto_del_dia_v1/);
});

test('carga una sola vez, no solicita servidores de tiendas y entrega las 60 imagenes',async()=>{
  let loads=0;
  const ctx=context({Image:class{set src(src){assert.ok(src.startsWith('./assets/effects/productos/'));loads++;queueMicrotask(()=>this.onload());}}});
  const a=ctx.fx.load(),b=ctx.fx.load();assert.equal(a,b);
  assert.equal((await a).length,60);assert.equal(loads,60);
});

test('si falla toda la carga se puede volver a intentar',async()=>{
  let loads=0;
  const ctx=context({Image:class{set src(src){loads++;queueMicrotask(()=>this.onerror());}}});
  assert.equal((await ctx.fx.load()).length,0);assert.equal((await ctx.fx.load()).length,0);assert.equal(loads,120);
});

test('la carga no queda pendiente indefinidamente',async()=>{
  const timers=[];
  const ctx=context({setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},Image:class{set src(src){}}});
  const pending=ctx.fx.load();timers.forEach(fn=>fn());assert.equal((await pending).length,0);
});

test('respeta movimiento reducido y no carga imagenes ni crea lienzos',()=>{
  const ctx=context({window:{matchMedia:()=>({matches:true})},Image:class{constructor(){throw Error('No debe cargar');}}});
  ctx.fx.candy({},'Lluvia de golosinas',false);
});
