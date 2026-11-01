// Lunita "fuera de horario": 30 minutos de tolerancia antes de abrir y después de cerrar.
// Usa las funciones reales de index.html; los cobros son inventados.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const desde = src.indexOf('const GRACIA_FUERA_HORARIO_MIN='), hasta = src.indexOf('function trcFueraHorarioHtml(');
assert(desde > 0 && hasta > desde);
const visFin = src.match(/function visFin\(t\)\{[^\n]*\}/)[0];
const SEMANA = [{nombre: 'Vale', desdeH: 7, desdeM: 0, hastaH: 12, hastaM: 0}, {nombre: 'Ani', desdeH: 12, desdeM: 1, hastaH: 17, hastaM: 0},
  {nombre: 'Marta', desdeH: 17, desdeM: 1, hastaH: 23, hastaM: 59, cierreH: 22, cierreM: 0}];
const DOMINGO = [{nombre: 'Turno 1', desdeH: 9, desdeM: 0, hastaH: 16, hastaM: 0}, {nombre: 'Turno 2', desdeH: 16, desdeM: 1, hastaH: 23, hastaM: 59, cierreH: 22, cierreM: 0}];
const app = new Function('TURNOS', `${visFin}\n${src.slice(desde, hasta)}\nreturn {esFueraDeHorario, esTransferenciaFueraHorario, textoFueraHorario};`)(SEMANA);

test('weekday: a payment just before opening or just after closing is not out of hours', () => {
  for (const h of ['06:30:00', '06:59:00', '07:00:00', '15:00:00', '22:00:00', '22:10:00', '22:30:59']) assert.equal(app.esFueraDeHorario(h, SEMANA), false, h);
  for (const h of ['06:29:00', '03:15:00', '22:31:00', '23:40:00']) assert.equal(app.esFueraDeHorario(h, SEMANA), true, h);
});

test('sunday opens at 9: the window starts at 8:30', () => {
  assert.equal(app.esFueraDeHorario('08:45:00', DOMINGO), false);
  assert.equal(app.esFueraDeHorario('08:29:00', DOMINGO), true);
  assert.equal(app.textoFueraHorario(DOMINGO), 'antes de las 8:30 o después de las 22:30');
  assert.equal(app.textoFueraHorario(SEMANA), 'antes de las 6:30 o después de las 22:30');
});

test('only received transfers get the moon', () => {
  assert.equal(app.esTransferenciaFueraHorario({tipo: 'Transferencia recibida', hora: '06:59:00'}, SEMANA), false);
  assert.equal(app.esTransferenciaFueraHorario({tipo: 'Transferencia recibida', hora: '05:10:00'}, SEMANA), true);
  assert.equal(app.esTransferenciaFueraHorario({tipo: 'Venta Point', hora: '05:10:00'}, SEMANA), false);
});
