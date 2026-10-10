// Calendario de feriados de Info del día: nacionales, locales que rigen en CABA (donde está
// el kiosco) y locales de otra jurisdicción. Usa el código real de index.html.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const desde = src.indexOf('let iwCalendarData='), hasta = src.indexOf('function iwCalendarioFeriadoHtml(');
assert(desde > 0 && hasta > desde, 'no encontré el código del calendario');
const codigo = src.slice(desde, hasta).replace('async function fetchFeriadosInfo(){', 'async function fetchFeriadosInfo(){return null;');
const app = new Function(codigo + 'return {iwFeriadoNormal, iwFeriadoAyuda, iwFeriadoEtiqueta, iwBuildLongWeekends, iwCalendarioMesHtml};')();

// Como los devuelve /api/feriados para la visita del Papa (noviembre 2026).
const API = [
  {fecha: '2026-11-09', tipo: 'inamovible', nombre: 'Visita del papa León XIV'},
  {fecha: '2026-11-10', tipo: 'local', nombre: 'Visita de Su Santidad el Papa León XIV', donde: 'Córdoba y Ciudad Autónoma de Buenos Aires', caba: true},
  {fecha: '2026-11-11', tipo: 'local', nombre: 'Visita de Su Santidad el Papa León XIV', donde: 'Provincia de Buenos Aires', caba: false},
  {fecha: '2026-11-23', tipo: 'trasladable', nombre: 'Día de la Soberanía Nacional (20/11)'},
];
const feriados = API.map(app.iwFeriadoNormal);
const datos = () => ({holidays: feriados, longWeekends: app.iwBuildLongWeekends(feriados.filter(f => f.aplica)), minYear: 2026, maxYear: 2026});
const celda = (html, dia) => html.match(new RegExp(`<span class="iw-calendar-day[^>]*>${dia}<small>[^<]*</small></span>`))?.[0] || '';

test('each holiday knows if it applies to the kiosk (CABA)', () => {
  assert.deepEqual(feriados.map(f => [f.fecha.slice(-2), f.local, f.aplica]), [['09', false, true], ['10', true, true], ['11', true, false], ['23', false, true]]);
  assert.deepEqual(feriados.map(app.iwFeriadoEtiqueta), ['FERIADO', 'CABA', 'PROVINCIA', 'FERIADO']);
});

test('the help text says what it is and where it applies, without HTML', () => {
  assert.equal(app.iwFeriadoAyuda(feriados[0]), 'Visita del papa León XIV. Feriado nacional.');
  assert.equal(app.iwFeriadoAyuda(feriados[1]), 'Visita de Su Santidad el Papa León XIV. Feriado solo en Córdoba y CABA: en el kiosco es feriado.');
  assert.equal(app.iwFeriadoAyuda(feriados[2]), 'Visita de Su Santidad el Papa León XIV. Feriado solo en Provincia de Bs. As.: en CABA es un día normal.');
  // Si llegara el nombre crudo del Gobierno (con el link adentro), igual sale limpio.
  const crudo = app.iwFeriadoNormal({fecha: '2026-11-11', tipo: 'especial', nombre: 'Visita del Papa (<a href="/normativa/x">feriado en Provincia de Buenos Aires</a>)'});
  assert.equal(crudo.nombre, 'Visita del Papa (feriado en Provincia de Buenos Aires)');
});

test('long weekend counts the CABA holiday but not the Province one', () => {
  const fines = datos().longWeekends.filter(r => r.startKey.startsWith('2026-11'));
  assert.deepEqual(fines.map(r => [r.startKey, r.endKey, r.days]), [['2026-11-07', '2026-11-10', 4], ['2026-11-21', '2026-11-23', 3]]);
});

test('calendar: national filled, CABA marked, Province only outlined', () => {
  const html = app.iwCalendarioMesHtml(2026, 11, datos());
  const d9 = celda(html, 9), d10 = celda(html, 10), d11 = celda(html, 11);
  assert(/class="iw-calendar-day is-long-weekend is-holiday"/.test(d9) && d9.includes('<small>FERIADO</small>'), d9);
  assert(/class="iw-calendar-day is-long-weekend is-holiday is-local"/.test(d10) && d10.includes('<small>CABA</small>'), d10);
  assert(/class="iw-calendar-day is-holiday-ajeno"/.test(d11) && d11.includes('<small>PROVINCIA</small>'), d11);
  assert(d10.includes('data-iw-tooltip="Visita de Su Santidad el Papa León XIV. Feriado solo en Córdoba y CABA: en el kiosco es feriado."'), d10);
  assert(d11.includes('en CABA es un día normal.'), d11);
  // Nada de HTML del Gobierno colado en la pantalla.
  assert(!/&lt;a |<a |href/.test(html), 'sin links');
  // El contador del mes cuenta los que rigen en el kiosco: 9, 10 y 23.
  assert(html.includes('>3 feriados<'), 'contador');
  // En el resumen de abajo, cada local dice dónde rige.
  assert(html.includes('is-local') && html.includes('10 · solo Córdoba y CABA'));
  assert(html.includes('is-ajeno') && html.includes('11 · no en CABA: solo Provincia de Bs. As.'));
});
