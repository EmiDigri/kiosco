// Local fixture: production markup and functions, fake MP and database, no paid API.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw Error(start);return source.slice(a,b);};
const styles=source.match(/<style>([\s\S]*?)<\/style>/)[0];
const markup=between('<div class="historial-overlay" id="cierreManualOverlay">','<!-- REFERENCIA DE PRECIOS -->');
const functions=between('function histRenderMetricas(', '// Total MP de un mes,')
  +between('function histDeduplicarGastos(', '// Total REAL de un día:')
  +between('let histGastosFuenteRemota=', '// Igual que histTotalDia')
  +between('function cmEsDomingo(', '// Lectura y revision del cuaderno:');
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba local de cierres</title>${styles}<style>body:has(#cierreManualOverlay.open){overflow:hidden}</style></head><body>
<header style="padding:18px;display:flex;gap:10px"><button id="example" class="btn-historial">Foto de ejemplo</button><button id="monthly" class="btn-historial">Resumen mensual</button></header>
<pre id="qaResults" style="white-space:pre-wrap;padding:16px"></pre><div id="historialOverlay"><div id="histMetricas"></div><div id="histGastosMes" class="hist-gastos-mes"></div></div>
${markup}<div id="toast" class="toast"></div><script src="/cierre-cuentas.js"></script>
<script>
const esDomingo=false,turno={nombre:'Marta'},turnoReciente=null,SUPABASE_URL='https://fixture.invalid';
let histResumenMes={},histRowsGastosMes=[],histRowsPagosMes=[];
const fixed='2026-09-08',db={pagos:[],cierres:[],gastos:[],writes:[]};
const fechaHoy=()=>fixed,histIso=(y,m,d)=>y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
const histMoney=n=>'$'+Number(n||0).toLocaleString('es-AR'),histMoneyCompact=histMoney,formatFecha=d=>d;
const histMediana=a=>a.length?a[Math.floor(a.length/2)]:0,histMesLearnRead=()=>({bias:[],errs:[]});
const histTendenciaPill=()=>'',histSvgBarsDias=()=>'',histAnimarGraficoDias=()=>{},histTooltipGraficoDias=()=>{},histKioscoEnriquecer=()=>{},learnSbPush=()=>{};
const turnosDelDia=dia=>CierreCuentas.turnos(dia).map(nombre=>({nombre})),esTransferenciaFueraHorario=()=>false;
const sbAuthHeaders=async()=>({}),lockBody=()=>{},unlockBody=()=>{},leerHistorial=()=>({}),histCargarMes=async()=>renderMonth();
const histGetLocalCierreDia=dia=>JSON.parse(localStorage.getItem('kiosco_cierre_manual')||'{}')[dia]||{cierres:{},gastos:[]};
const histSbSelectAll=async p=>{if(db.failRead)throw Error('MP no disponible');const rows=p.startsWith('pagos?')?db.pagos:p.startsWith('cierres_caja?')?db.cierres:db.gastos;const day=new URLSearchParams(p.split('?')[1]).get('fecha')?.slice(3);return structuredClone(rows.filter(r=>!day||r.fecha===day));};
const histSbSelect=histSbSelectAll,mostrarDetalleDia=dia=>document.getElementById('qaResults').textContent='Dia '+dia;
window.fetch=async(url,opts)=>{if(!String(url).startsWith(SUPABASE_URL+'/rest/v1/'))throw Error('External traffic blocked');if(db.failWrite)throw Error('Guardado no disponible');const row=JSON.parse(opts.body);db.writes.push({url,row});const list=String(url).includes('/cierres_caja')?db.cierres:db.gastos;const i=list.findIndex(r=>row.uid?r.uid===row.uid:r.fecha===row.fecha&&r.turno===row.turno);if(i<0)list.push(row);else list[i]=row;return new Response('[]',{status:200});};
window.confirm=()=>true;
function showToast(text){document.getElementById('toast').textContent=text;}
window.addEventListener('error',e=>document.getElementById('qaResults').textContent+='ERROR '+e.message+'\\n');
window.addEventListener('unhandledrejection',e=>document.getElementById('qaResults').textContent+='ERROR '+e.reason+'\\n');
${functions}
</script><script src="/cierre-foto-ui.js"></script><script>
const example=()=>({fecha:fixed,total_dia:1681800,turnos:[{cierre:521450,mp:221450,once:0,mpo:36000},{cierre:502600,mp:201600,once:8000,mpo:3500},{cierre:657750,mp:290250,once:0,mpo:12000}],gastos:[{nombre:'Arcor',monto:254403}]});
function resetFixture(){localStorage.removeItem('kiosco_cierre_manual');db.cierres=[];db.gastos=[];db.writes=[];db.failRead=false;db.failWrite=false;db.pagos=example().turnos.map((t,i)=>({id:i+1,fecha:fixed,turno:['Vale','Ani','Marta'][i],monto:t.mp,nombre:'Ventas del turno',status:'approved',es_enviada:false}));}
async function loadExample(){cmFotoData=example();document.getElementById('cierreManualOverlay').classList.add('open');document.getElementById('cmFotoFecha').value=fixed;document.getElementById('cmFotoTotal').value=1681800;cmRenderFotoReview();await cmFotoConsultar(cmFotoData);}
function renderMonth(){histRowsPagosMes=db.pagos;histRowsGastosMes=db.gastos;histResumenMes=histAgruparPorDia(db.pagos,db.cierres,db.gastos);histGastosFuenteRemota=true;histRenderMetricas(2026,9,30);histRenderGastosMes();}
document.getElementById('example').addEventListener('click',loadExample);
document.getElementById('monthly').addEventListener('click',()=>{document.getElementById('cierreManualOverlay').classList.remove('open');renderMonth();});
resetFixture();loadExample();
</script><script src="/fixture-tests.js"></script></body></html>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'");
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  const files={'/cierre-cuentas.js':'cierre-cuentas.js','/cierre-foto-ui.js':'cierre-foto-ui.js','/fixture-tests.js':'tests/cierre-browser.js'};
  if(files[url.pathname]){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(fs.readFileSync(path.join(root,files[url.pathname])));}
  res.writeHead(404).end();
});
server.listen(Number(process.argv[2])||4191,'127.0.0.1',()=>console.log('Local-only closing preview: http://127.0.0.1:'+server.address().port));
