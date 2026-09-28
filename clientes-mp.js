// Clientes de Mercado Pago (pedido de digra, 28/9/2026). A fin de mes se sube el reporte
// "Todas las transacciones" de MP (CSV) y la app guarda quién pagó cada cobro en la tabla
// mp_pagadores, por número de operación (SOURCE_ID = pagos.pago_id). La API de pagos no trae
// esos nombres (lo probó Codex con 10 operaciones reales); el reporte sí. Uso interno del
// kiosco. No toca la tabla pagos ni los cierres.
(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClientesMP = api;
})(typeof window !== 'undefined' ? window : this, function(root) {
  'use strict';
  const TABLA = 'mp_pagadores';
  const TZ = 'America/Argentina/Buenos_Aires';
  const COLUMNAS = ['SOURCE_ID', 'TRANSACTION_DATE', 'TRANSACTION_TYPE', 'TRANSACTION_AMOUNT', 'PAYER_NAME'];

  // ── Lectura del reporte ──────────────────────────────────────────────────────────────
  // Una línea de CSV con comillas opcionales ("a;b" cuenta como un solo campo).
  function camposDe(linea, sep) {
    const out = [];
    let actual = '', entre = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (entre) {
        if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
        else if (c === '"') entre = false;
        else actual += c;
      } else if (c === '"') entre = true;
      else if (c === sep) { out.push(actual); actual = ''; }
      else actual += c;
    }
    out.push(actual);
    return out.map(v => v.trim());
  }
  // "1200.00", "1.200,50" o "1,200.50" -> número.
  function montoDe(valor) {
    let s = String(valor || '').replace(/[$\s]/g, '');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  // Fecha y hora en Argentina, aunque el reporte venga con otro huso (la API usa -04:00).
  function fechaHoraAR(valor) {
    const d = new Date(String(valor || '').trim());
    if (!Number.isFinite(d.getTime())) return null;
    const p = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).formatToParts(d);
    const v = t => p.find(x => x.type === t).value;
    return {fecha: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour') === '24' ? '00' : v('hour')}:${v('minute')}`};
  }
  function nombreLimpio(valor) { return String(valor || '').replace(/\s+/g, ' ').trim(); }

  // Devuelve los cobros con nombre listos para guardar, o lanza un Error con un mensaje para
  // mostrarle a la persona que subió el archivo.
  function parsearReporte(texto) {
    const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (lineas.length < 2) throw new Error('El archivo está vacío.');
    const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';
    const cab = camposDe(lineas[0], sep).map(c => c.toUpperCase());
    const faltan = COLUMNAS.filter(c => !cab.includes(c));
    if (faltan.length) {
      if (faltan.includes('PAYER_NAME') && faltan.length === 1) throw new Error('El reporte no trae el nombre del pagador (columna PAYER_NAME). Bajá "Todas las transacciones" con esa columna activada.');
      throw new Error('Este archivo no es el reporte "Todas las transacciones" de Mercado Pago.');
    }
    const col = nombre => cab.indexOf(nombre);
    const porId = new Map(), devueltos = new Set();
    let ingresos = 0, sinNombre = 0, desde = '', hasta = '';
    for (const linea of lineas.slice(1)) {
      const f = camposDe(linea, sep);
      const id = String(f[col('SOURCE_ID')] || '').trim(), tipo = String(f[col('TRANSACTION_TYPE')] || '').trim().toUpperCase();
      if (!/^\d+$/.test(id)) continue;
      if (tipo === 'REFUND' || tipo === 'CHARGEBACK') { devueltos.add(id); continue; }
      const monto = montoDe(f[col('TRANSACTION_AMOUNT')]);
      if (tipo !== 'SETTLEMENT' || !(monto > 0)) continue;
      const cuando = fechaHoraAR(f[col('TRANSACTION_DATE')]);
      if (!cuando) continue;
      ingresos++;
      if (!desde || cuando.fecha < desde) desde = cuando.fecha;
      if (!hasta || cuando.fecha > hasta) hasta = cuando.fecha;
      const nombre = nombreLimpio(f[col('PAYER_NAME')]);
      if (!nombre) { sinNombre++; continue; }
      if (!porId.has(id)) porId.set(id, {pago_id: id, nombre, fecha: cuando.fecha, hora: cuando.hora, monto: Math.round(monto * 100) / 100});
    }
    if (!ingresos) throw new Error('El reporte no tiene cobros.');
    const filas = [...porId.values()].map(fila => ({...fila, devuelto: devueltos.has(fila.pago_id)}));
    return {filas, ingresos, sinNombre, desde, hasta};
  }

  // ── Guardado ─────────────────────────────────────────────────────────────────────────
  // Por número de operación: volver a subir el mismo reporte (o uno que se superpone) no
  // duplica nada, solo actualiza.
  async function guardar(filas, escribir, tanda = 500) {
    for (let i = 0; i < filas.length; i += tanda) {
      await escribir(`${TABLA}?on_conflict=pago_id`, 'POST', filas.slice(i, i + tanda), 'resolution=merge-duplicates,return=minimal');
    }
    return filas.length;
  }
  // ¿Cuántos cobros del reporte están también en la app? Confirma que el número de operación
  // del reporte es el mismo que guarda la app.
  async function coincidencias(resumen, leerTodo) {
    const pagos = await leerTodo(`pagos?select=pago_id&fecha=gte.${resumen.desde}&fecha=lte.${resumen.hasta}`);
    const enApp = new Set(pagos.map(p => String(p.pago_id)));
    return resumen.filas.filter(f => enApp.has(f.pago_id)).length;
  }
  function tablaFaltante(error) { return /mp_pagadores|42P01|PGRST205|does not exist|relation/i.test(String(error && error.message || error)); }

  // ── Tarjeta en Métricas ──────────────────────────────────────────────────────────────
  const $ = n => Number(n || 0).toLocaleString('es-AR');
  const fechaCorta = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  function rangoMes(fecha) {
    const y = fecha.getFullYear(), m = fecha.getMonth() + 1, ult = new Date(y, m, 0).getDate();
    const p = n => String(n).padStart(2, '0');
    return {desde: `${y}-${p(m)}-01`, hasta: `${y}-${p(m)}-${p(ult)}`, nombre: fecha.toLocaleDateString('es-AR', {month: 'long'})};
  }
  function tarjetaHtml() {
    return `<div class="met-card cmp-card" id="metClientes">
      <div class="met-card-title">Clientes de Mercado Pago</div>
      <div class="cmp-intro">A fin de mes subí el reporte <b>Todas las transacciones</b> de Mercado Pago y la app sabe quién pagó cada transferencia.</div>
      <div class="cmp-acciones"><label class="cmp-subir"><input type="file" accept=".csv,text/csv" id="cmpArchivo"><span>Cargar reporte de Mercado Pago</span></label></div>
      <div class="cmp-estado" id="cmpEstado" role="status" aria-live="polite"></div>
    </div>`;
  }
  function estado(html, tipo = '') {
    const el = root.document && root.document.getElementById('cmpEstado');
    if (!el) return;
    el.className = 'cmp-estado' + (tipo ? ' is-' + tipo : '');
    el.innerHTML = html;
  }
  async function mostrarCobertura(mes) {
    const r = rangoMes(mes);
    try {
      const filas = await root.histSbSelectAll(`${TABLA}?select=pago_id&fecha=gte.${r.desde}&fecha=lte.${r.hasta}`);
      estado(filas.length ? `En ${r.nombre} hay <b>${$(filas.length)}</b> cobros con el nombre de quién pagó.` : `Todavía no cargaste el reporte de ${r.nombre}.`);
    } catch (e) {
      estado(tablaFaltante(e) ? 'Falta un paso: crear la tabla <b>mp_pagadores</b> en Supabase.' : 'No pude consultar los clientes. Revisá la conexión.', 'error');
    }
  }
  async function subir(archivo) {
    const input = root.document.getElementById('cmpArchivo');
    if (input) input.disabled = true;
    estado('Leyendo el reporte…');
    try {
      const resumen = parsearReporte(await archivo.text());
      estado(`Guardando ${$(resumen.filas.length)} cobros con nombre…`);
      await guardar(resumen.filas, root.cmSbWrite);
      let enApp = null;
      try { enApp = await coincidencias(resumen, root.histSbSelectAll); } catch (e) {}
      const clientes = new Set(resumen.filas.map(f => f.nombre.toUpperCase())).size;
      estado(`Listo: <b>${$(resumen.filas.length)}</b> cobros con nombre del ${fechaCorta(resumen.desde)} al ${fechaCorta(resumen.hasta)}, de <b>${$(clientes)}</b> clientes distintos.`
        + `<small>${resumen.sinNombre === 1 ? '1 cobro viene' : `${$(resumen.sinNombre)} cobros vienen`} sin nombre en el reporte (casi siempre pagos con tarjeta).`
        + (enApp != null ? ` ${$(enApp)} de ${$(resumen.filas.length)} coinciden con los cobros que tiene la app.` : '') + '</small>', 'ok');
    } catch (e) {
      estado(tablaFaltante(e) ? 'Falta un paso: crear la tabla <b>mp_pagadores</b> en Supabase.' : esc(e && e.message || 'No se pudo cargar el reporte.'), 'error');
    } finally {
      if (input) { input.disabled = false; input.value = ''; }
    }
  }
  function pintarTarjeta() {
    const doc = root.document, body = doc && doc.getElementById('metricasBody');
    if (!body || doc.getElementById('metClientes')) return;
    body.insertAdjacentHTML('beforeend', tarjetaHtml());
    doc.getElementById('cmpArchivo').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) subir(f); });
    // metMes es el mes que se está mirando en Métricas (variable global de index.html).
    // eslint-disable-next-line no-undef
    const mes = typeof metMes !== 'undefined' && metMes instanceof Date ? new Date(metMes) : new Date();
    mostrarCobertura(mes);
  }
  // Se engancha a Métricas sin tocar su código: después de cada dibujo, agrega la tarjeta.
  if (root.document && typeof root.metRender === 'function') {
    const dibujar = root.metRender;
    root.metRender = function() { const r = dibujar.apply(this, arguments); pintarTarjeta(); return r; };
  }
  return {parsearReporte, guardar, coincidencias, montoDe, fechaHoraAR, tablaFaltante, tarjetaHtml};
});
