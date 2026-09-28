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
      <div class="cmp-buscar">
        <label class="cmp-buscar-lbl" for="cmpBuscar">Buscar un cobro</label>
        <input type="search" id="cmpBuscar" placeholder="Nombre o monto, ej. lucia o 4500" autocomplete="off" inputmode="search">
        <div class="cmp-resultados" id="cmpResultados" aria-live="polite"></div>
      </div>
    </div>`;
  }

  // ── Nombres ──────────────────────────────────────────────────────────────────────────
  // "LUCIA DE LA FUENTE" -> "Lucia de la Fuente". El reporte viene en mayúsculas.
  const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  function nombreVisible(nombre) {
    return nombreLimpio(nombre).toLocaleLowerCase('es-AR').split(' ')
      .map((p, i) => (i && PARTICULAS.has(p)) ? p : p.charAt(0).toLocaleUpperCase('es-AR') + p.slice(1)).join(' ');
  }
  const sinTildes = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  // ── Buscador ─────────────────────────────────────────────────────────────────────────
  // Un número busca por monto exacto; un texto, por nombre (sin importar tildes ni mayúsculas).
  function consultaBusqueda(texto) {
    const q = String(texto || '').trim();
    const soloNumero = q.replace(/[$\s]/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(soloNumero)) {
      const monto = montoDe(/^\d{1,3}(\.\d{3})+$/.test(soloNumero) ? soloNumero.replace(/\./g, '') : soloNumero);
      return {tipo: 'monto', monto, path: `${TABLA}?select=pago_id,nombre,fecha,hora,monto,devuelto&monto=eq.${monto}&order=fecha.desc,hora.desc&limit=40`};
    }
    const palabras = sinTildes(q).replace(/[^a-zñ ]/g, ' ').split(/\s+/).filter(p => p.length >= 2);
    if (!palabras.length) return null;
    // A la base se le pide la palabra más larga (así "fer lucia" también encuentra a
    // "Lucia Fernandez"). Puede haber tildes: cada vocal va como "cualquier letra" y después
    // se filtra bien acá, con todas las palabras y sin tildes.
    const patron = palabras.slice().sort((a, b) => b.length - a.length)[0].replace(/[aeiou]/g, '_');
    return {tipo: 'nombre', palabras, path: `${TABLA}?select=pago_id,nombre,fecha,hora,monto,devuelto&nombre=ilike.*${encodeURIComponent(patron)}*&order=fecha.desc,hora.desc&limit=200`};
  }
  function filtrarPorNombre(filas, palabras) {
    return filas.filter(f => { const n = sinTildes(f.nombre); return palabras.every(p => n.includes(p)); });
  }
  let busquedaActual = 0;
  async function buscar(texto) {
    const el = root.document.getElementById('cmpResultados');
    if (!el) return;
    const consulta = consultaBusqueda(texto), id = ++busquedaActual;
    if (!consulta) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="cmp-nada">Buscando…</div>';
    try {
      let filas = await root.histSbSelect(consulta.path);
      if (id !== busquedaActual) return;
      if (consulta.tipo === 'nombre') filas = filtrarPorNombre(filas, consulta.palabras);
      filas = filas.slice(0, 40);
      el.innerHTML = filas.length ? filas.map(f => `<div class="cmp-res"><span class="cmp-res-nom">${esc(nombreVisible(f.nombre))}${f.devuelto ? '<em>devuelto</em>' : ''}</span>`
        + `<span class="cmp-res-cuando">${fechaCorta(f.fecha)} · ${esc(f.hora || '')}</span><b class="cmp-res-monto">$${$(f.monto)}</b></div>`).join('')
        + (filas.length === 40 ? '<div class="cmp-nada">Se muestran los 40 más recientes.</div>' : '')
        : `<div class="cmp-nada">No encontré cobros ${consulta.tipo === 'monto' ? 'de ese monto' : 'con ese nombre'}.</div>`;
    } catch (e) {
      if (id === busquedaActual) el.innerHTML = `<div class="cmp-nada">${tablaFaltante(e) ? 'Falta crear la tabla mp_pagadores en Supabase.' : 'No pude buscar. Revisá la conexión.'}</div>`;
    }
  }

  // ── Historial: el nombre en cada transferencia del día ───────────────────────────────
  // Cada transferencia del detalle del día trae su número de operación en el botón ↩
  // (data-devolver). Con eso se busca quién pagó y se reemplaza "Transferencia recibida".
  async function nombresDelDia() {
    const doc = root.document, cont = doc && doc.getElementById('histTurnosDetalle');
    if (!cont) return;
    const filas = [...cont.querySelectorAll('.t-row')].map(row => ({row, id: row.querySelector('[data-devolver]')?.dataset.devolver})).filter(f => /^\d+$/.test(f.id || ''));
    if (!filas.length) return;
    let nombres;
    try {
      const ids = [...new Set(filas.map(f => f.id))];
      nombres = [];
      for (let i = 0; i < ids.length; i += 150) nombres = nombres.concat(await root.histSbSelect(`${TABLA}?select=pago_id,nombre&pago_id=in.(${ids.slice(i, i + 150).join(',')})`));
    } catch (e) { return; }
    const porId = new Map(nombres.map(n => [String(n.pago_id), n.nombre]));
    filas.forEach(({row, id}) => {
      const nombre = porId.get(id), el = row.querySelector('.t-n');
      if (!nombre || !el || !row.isConnected) return;
      el.textContent = nombreVisible(nombre);
      el.classList.add('cmp-pagador');
      el.title = `Transferencia de ${nombreVisible(nombre)}`;
    });
  }
  if (root.document && typeof root.mostrarDetalleDia === 'function') {
    const detalle = root.mostrarDetalleDia;
    root.mostrarDetalleDia = async function() { const r = await detalle.apply(this, arguments); await nombresDelDia(); return r; };
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
    let espera = null;
    doc.getElementById('cmpBuscar').addEventListener('input', e => { clearTimeout(espera); const v = e.target.value; espera = setTimeout(() => buscar(v), 300); });
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
  return {parsearReporte, guardar, coincidencias, montoDe, fechaHoraAR, tablaFaltante, tarjetaHtml, nombreVisible, consultaBusqueda, filtrarPorNombre};
});
