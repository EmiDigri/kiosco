// Local-only UI fixture. Real markup/JS, isolated PostgreSQL, no Supabase traffic.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname,'..');
const source = fs.readFileSync(path.join(root,'index.html'),'utf8');
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[0];
const most = source.slice(source.indexOf('  <div class="mostrador-overlay"'),source.indexOf('  <div class="aviso-banner"'));
const price = source.slice(source.indexOf('<div class="historial-overlay price-overlay"'),source.indexOf('<div class="toast"'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba local del lector</title>${styles}</head><body>
<header style="padding:20px;display:flex;gap:12px"><button class="btn-historial" id="btnMostrador">Mostrador</button><button class="btn-historial" id="btnPrecios">Precios</button></header>
<p style="padding:0 20px;font-size:13px">Prueba local. Codigos: 7790000000013 y 7790000000020. No modifica el kiosco.</p>
${most}${price}<div class="toast" id="toast"></div><pre id="qaResults" style="padding:20px;white-space:pre-wrap"></pre>
<script>
window.kioscoAuth={token:async()=> 'fixture',headers:async()=>({})};
window.showToast=text=>{const el=document.getElementById('toast');el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),4500);};
const originalFetch=window.fetch.bind(window);
window.fetch=(url,opts)=> {
  if(String(url).includes('pilfeptwylgufhbmmday.supabase.co'))return originalFetch('/fixture-api'+new URL(url).pathname+new URL(url).search,opts);
  if(String(url).startsWith('/api/catalogo'))return Promise.resolve(new Response(JSON.stringify({items:[],now:[],ranking:[],alfajores:[],products:[]})));
  if(String(url).startsWith('/')||String(url).startsWith(location.origin))return originalFetch(url,opts);
  return Promise.reject(new Error('External network blocked in test fixture'));
};
window.addEventListener('error',event=>{document.getElementById('qaResults').textContent+='ERROR: '+event.message+'\\n';});
window.addEventListener('unhandledrejection',event=>{document.getElementById('qaResults').textContent+='REJECTION: '+event.reason+'\\n';});
</script><script src="/mostrador.js"></script><script src="/catalogo-ui.js"></script>
<script>if(new URLSearchParams(location.search).has('test')){const script=document.createElement('script');script.src='/fixture-tests.js';document.body.append(script);}</script>
</body></html>`;
async function start(port = 4186) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/catalogo-transacciones.sql'),'utf8'));
  const rpc = async request => (await db.query('select public.catalogo_aplicar($1,$2,$3) as result',[request.p_id,request.p_tipo,JSON.stringify(request.p_datos)])).rows[0].result;
  for(const [i,nombre,stock] of [[1,'Alfajor Rasta blanco',10],[2,'Chocolate Milka con almendras 100 g',20]]) {
    await rpc({p_id:require('node:crypto').randomUUID(),p_tipo:'guardar',p_datos:{uid:'c_fixture_'+i,ean:i===1?'7790000000013':'7790000000020',nombre,categoria:'Golosinas',precio:i===1?1600:3200,costo:i===1?900:1800,stock}});
  }
  const server = http.createServer(async(req,res)=> {
    res.setHeader('Cache-Control','no-store');
    const url = new URL(req.url,'http://localhost');
    try {
      if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
      if(url.pathname==='/mobile') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Mobile 390px</title><body style="margin:0;background:#444"><iframe title="Mobile" src="/" style="display:block;width:390px;height:844px;border:0"></iframe>');return;}
      if(['/catalogo-ui.js','/mostrador.js'].includes(url.pathname)) {res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(root,url.pathname.slice(1))));return;}
      if(url.pathname==='/fixture-tests.js') {res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'tests/catalogo-browser.js')));return;}
      if(url.pathname.endsWith('/rpc/catalogo_aplicar')) {
        let body='';for await(const chunk of req)body+=chunk;
        const result=await rpc(JSON.parse(body));
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
      }
      if(url.pathname.endsWith('/catalogo_operaciones')) {
        const rows=(await db.query("select * from public.catalogo_operaciones where tipo in ('venta','anular') order by created_at desc limit 200")).rows;
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(rows));return;
      }
      if(url.pathname.endsWith('/catalogo')) {
        const rows=(await db.query('select * from public.catalogo order by uid')).rows;
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(rows));return;
      }
      res.writeHead(404).end();
    } catch(error) {res.writeHead(error.code?.startsWith('PT')?Number(error.code.slice(2)):400,{'Content-Type':'application/json'});res.end(JSON.stringify({message:error.message,code:error.code}));}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  console.log('Local-only scanner preview: http://127.0.0.1:'+server.address().port);
  return {server,db};
}
module.exports={start};
if(require.main===module)start(Number(process.argv[2])||4186).catch(error=>{console.error(error);process.exitCode=1;});
