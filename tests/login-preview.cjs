// Local-only fixture: real page styles, login markup and handlers, no Supabase.
// Run: node tests/login-preview.cjs [port]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[0];
const start = source.indexOf('<div id="loginOverlay"');
const end = source.indexOf('<script>try{var _s=', start);
const initStart = source.indexOf('(function initLogin(){');
const initEnd = source.indexOf('\n})();', initStart) + 6;
assert(start > 0 && end > start && initStart > 0 && initEnd > initStart);
const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prueba local del login</title>${styles}
<link rel="stylesheet" href="/login.css">
<script src="/login.js" defer></script></head><body>
${source.slice(start, end)}
<main id="qaResult" style="padding:32px;white-space:pre-wrap;color:white;background:#222;min-height:100vh" tabindex="-1">Prueba local: no se conecta con Supabase.</main>
<script>
const result = { mode: 'local mock, no credentials sent', states: [], frames: [], hidden: false, refreshes: 0 };
function record() { document.getElementById('qaResult').textContent = JSON.stringify(result, null, 2); }
const overlay = document.getElementById('loginOverlay');
new MutationObserver(() => {
  const state = overlay.dataset.mood;
  if (result.states.at(-1) === state) return;
  result.states.push(state);
  if (state === 'success') {
    result.animationNames = [...overlay.querySelectorAll('.login-character-body')].map(el => getComputedStyle(el).animationName);
    result.particles = overlay.querySelectorAll('.login-confetti').length;
    [70, 350].forEach(delay => setTimeout(() => {
      result.frames.push([...overlay.querySelectorAll('.login-character-body')].map(el => getComputedStyle(el).transform));
      record();
    }, delay));
  }
  record();
}).observe(overlay, { attributes: true, attributeFilter: ['data-mood'] });
async function sbSignIn() {
  await new Promise(resolve => setTimeout(resolve, 250));
  if (new URLSearchParams(location.search).has('error')) throw new Error('Prueba: credenciales incorrectas');
  result.startedAt = performance.now();
}
function authBoot() {}
async function renderOtrosTurnos() { result.refreshes++; }
async function learnSbLoad() { result.refreshes++; }
function programarPulso() { result.refreshes++; }
function autoTurnoReanudarSiCorresponde() { result.refreshes++; }
function loginOcultar() {
  result.elapsed = Math.round(performance.now() - result.startedAt);
  result.hidden = true;
  result.remainingParticles = overlay.querySelectorAll('.login-confetti').length;
  result.fadeDuration = getComputedStyle(overlay).transitionDuration;
  result.animationMoved = result.frames.length === 2 && result.frames[0].every((value, i) => value !== result.frames[1][i]);
  overlay.classList.add('oculto');
  record();
  requestAnimationFrame(() => document.getElementById('qaResult').focus());
}
${source.slice(initStart, initEnd)}
</script></body></html>`;
const assets = new Map([
  ['/login.css', ['login.css', 'text/css']],
  ['/login.js', ['login.js', 'text/javascript']],
  ['/assets/candy-shop.png', ['assets/candy-shop.png', 'image/png']],
  ...['eye', 'eye-off', 'arrow-right', 'lock-keyhole'].map(name => [
    '/assets/login/' + name + '.svg', ['assets/login/' + name + '.svg', 'image/svg+xml']
  ])
]);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  const asset = assets.get(url.pathname);
  if (!asset) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', asset[1]);
  res.end(fs.readFileSync(path.join(root, asset[0])));
}).listen(Number(process.argv[2]) || 4177, '127.0.0.1', function() {
  console.log('Isolated login test: http://127.0.0.1:' + this.address().port);
});
