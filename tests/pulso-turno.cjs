// Proyección del turno en el Pulso (index.html): sale de la del día, no de multiplicar los pocos
// cobros del arranque; primera hora de la mañana sin proyección; notas absurdas no se aprenden.
// Usa las funciones reales de index.html con datos inventados.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Saca una función completa de index.html contando llaves.
function funcion(nombre) {
  const ini = src.indexOf(`function ${nombre}(`);
  assert(ini >= 0, `no encontré ${nombre}`);
  let i = src.indexOf('{', ini), prof = 0;
  for (; i < src.length; i++) { if (src[i] === '{') prof++; else if (src[i] === '}' && --prof === 0) break; }
  return src.slice(ini, i + 1);
}
const nombres = ['pulseIso', 'pulseDate', 'pulseMinutes', 'pulseMediana', 'pulseVentanaTotal', 'pulseFactores', 'pulseBacktestError',
  'pulseLearnRead', 'pulseLearnWrite', 'pulseAprender', 'pulseRegistrar', 'pulseProyeccion', 'pulseParteRestoEnTurno',
  'pulseBacktestTurno', 'pulseProyeccionTurno', 'pulseTurnoTemprano'];
const guardado = {};
const localStorage = {getItem: k => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = String(v); }};
const app = new Function('localStorage', 'learnSbPush', `const PULSE_LEARN_KEY='pulse_learn_v1';${nombres.map(funcion).join('\n')}return {${nombres.join(',')}};`)(localStorage, () => {});

// 9 miércoles anteriores con la forma de un día real: cobros cada 10 minutos de 7 a 22 h,
// más fuertes a la tarde y a la noche. Hoy (miércoles) el arranque del turno de Ani trae un
// solo cobro chiquito: es lo que hacía que el método viejo proyectara x60 de menos.
const cobro = (fecha, hora, monto) => ({fecha, hora, monto});
const hh = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function dia(fecha, escala = 1, tarde = 1) {
  const filas = [];
  for (let m = 420; m < 1320; m += 10) filas.push(cobro(fecha, hh(m), Math.round((m < 721 ? 3000 : m < 1021 ? 5000 * tarde : 7000) * escala)));
  return filas;
}
const byDate = new Map();
const miercoles = ['2026-08-26', '2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21'];
// Las tardes no son todas iguales (como en la realidad), así el margen de error no da 0.
miercoles.forEach((f, i) => byDate.set(f, dia(f, 0.9 + i * 0.025, [1, 1.15, 0.85][i % 3])));
const HOY = '2026-10-28';
const corte = 750; // 12:30, media hora después de que arrancó Ani (12:01)
const hoy = dia(HOY).filter(r => app.pulseMinutes(r.hora) < 721).concat([cobro(HOY, '12:20', 500)]);
byDate.set(HOY, hoy);
const parcialDia = app.pulseVentanaTotal(hoy, 0, corte + 1), parcialAni = app.pulseVentanaTotal(hoy, 721, corte + 1);
const realAniTipico = app.pulseVentanaTotal(dia('x'), 721, 1021);

test('the shift projection comes from the day: a tiny start no longer means a tiny shift', () => {
  const diaProj = app.pulseProyeccion(byDate, HOY, 3, 0, 1440, corte, parcialDia, 'dia');
  assert(diaProj.value > 0);
  const viejo = app.pulseProyeccion(byDate, HOY, 3, 721, 1021, corte, parcialAni, 'turno:Ani');
  const nuevo = app.pulseProyeccionTurno(byDate, HOY, 3, 721, 1021, corte, parcialAni, parcialDia, diaProj, 'turnoV2:Ani');
  // El método viejo multiplicaba el cobro de $500: daba una fracción mínima del turno.
  assert(viejo.value < realAniTipico * 0.2, `viejo ${viejo.value}`);
  // El nuevo queda cerca de lo que suele hacer el turno.
  assert(Math.abs(nuevo.value - realAniTipico) / realAniTipico < 0.25, `nuevo ${nuevo.value} vs ${realAniTipico}`);
  assert(nuevo.low <= nuevo.value && nuevo.value <= nuevo.high && nuevo.err > 0 && nuevo.err < 0.5);
  assert.equal(nuevo.n, 9);
});

test('without a day projection or enough same days, there is no shift projection', () => {
  assert.equal(app.pulseProyeccionTurno(byDate, HOY, 3, 721, 1021, corte, parcialAni, parcialDia, null, 'k').value, undefined);
  const poco = new Map([...byDate].filter(([f]) => f >= '2026-10-14'));
  assert.equal(app.pulseProyeccionTurno(poco, HOY, 3, 721, 1021, corte, parcialAni, parcialDia, {value: 900000}, 'k').value, undefined);
});

test('first hour of the morning shift: no projection (Vale 7-8 h, Sunday Turno 1 9-10 h)', () => {
  assert.equal(app.pulseTurnoTemprano(0, 7 * 60 + 30, 420), true);
  assert.equal(app.pulseTurnoTemprano(0, 8 * 60, 420), false);
  assert.equal(app.pulseTurnoTemprano(0, 9 * 60 + 59, 540), true);
  assert.equal(app.pulseTurnoTemprano(1, 12 * 60 + 10, 721), false); // Ani: se proyecta desde el arranque
});

test('absurd notes are not learned; normal ones are', () => {
  const learn = {'turnoV2:Ani': {log: {'2026-10-21': {s: 721, e: 1021, proj: 1000}}, errs: [], bias: []},
    dia: {log: {'2026-10-21': {s: 0, e: 1440, proj: Math.round(app.pulseVentanaTotal(byDate.get('2026-10-21'), 0, 1440) * 0.95)}}, errs: [], bias: []}};
  guardado.pulse_learn_v1 = JSON.stringify(learn);
  app.pulseAprender(byDate, HOY);
  const out = JSON.parse(guardado.pulse_learn_v1);
  assert.deepEqual(out['turnoV2:Ani'].bias, []);          // cerró x150 de lo proyectado: se descarta
  assert.equal(out['turnoV2:Ani'].log['2026-10-21'], undefined);
  assert.equal(out.dia.bias.length, 1);                    // nota normal: se aprende
  assert(out.dia.bias[0] > 1 && out.dia.bias[0] < 1.1);
});
