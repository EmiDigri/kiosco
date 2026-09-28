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

  // ── Formatos ─────────────────────────────────────────────────────────────────────────
  const $ = n => Number(n || 0).toLocaleString('es-AR');
  const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const plural = (n, uno, varios) => `${$(n)} ${n === 1 ? uno : varios}`;
  const fechaCorta = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  function rangoMes(fecha) {
    const y = fecha.getFullYear(), m = fecha.getMonth() + 1, ult = new Date(y, m, 0).getDate();
    const p = n => String(n).padStart(2, '0');
    return {desde: `${y}-${p(m)}-01`, hasta: `${y}-${p(m)}-${p(ult)}`, nombre: fecha.toLocaleDateString('es-AR', {month: 'long'})};
  }
  function sumarDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  const diasEntre = (desde, hasta) => Math.round((new Date(hasta + 'T12:00:00Z') - new Date(desde + 'T12:00:00Z')) / 864e5);
  const diaSemana = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
  const DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
  const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  // ── Nombres ──────────────────────────────────────────────────────────────────────────
  // "LUCIA DE LA FUENTE" -> "Lucia de la Fuente". El reporte viene en mayúsculas.
  const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  function nombreVisible(nombre) {
    return nombreLimpio(nombre).toLocaleLowerCase('es-AR').split(' ')
      .map((p, i) => (i && PARTICULAS.has(p)) ? p : p.charAt(0).toLocaleUpperCase('es-AR') + p.slice(1)).join(' ');
  }
  const sinTildes = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  // Un cliente es un nombre del reporte, sin tildes ni mayúsculas.
  const clave = n => sinTildes(nombreLimpio(n));
  // Para pedirle a la base un nombre que puede venir con tildes o eñes: esas letras van
  // como "cualquier letra" y después se compara bien acá.
  const patronNombre = k => k.replace(/[aeioun]/g, '_');

  // ── Turnos ───────────────────────────────────────────────────────────────────────────
  // Franjas de los turnos de semana: 7 a 12, 12 a 17 y de 17 al cierre (la madrugada va con la noche).
  function franjaDe(hora) {
    if (!/^\d{1,2}:\d{2}/.test(String(hora || ''))) return null;
    const [h, m] = String(hora).split(':').map(Number), min = h * 60 + m;
    return min < 7 * 60 ? 2 : min <= 12 * 60 ? 0 : min <= 17 * 60 ? 1 : 2;
  }
  const FRANJAS = ['mañana', 'tarde', 'noche'];
  function turnoDe(i) {
    // TURNOS_SEMANA es de index.html (Vale, Ani, Marta).
    // eslint-disable-next-line no-undef
    const semana = typeof TURNOS_SEMANA !== 'undefined' && Array.isArray(TURNOS_SEMANA) && TURNOS_SEMANA.length === 3 ? TURNOS_SEMANA : null;
    return semana ? semana[i].nombre : null;
  }
  const franjaCorta = i => i == null ? 'horario variado' : (turnoDe(i) ? `turno ${turnoDe(i)}` : `a la ${FRANJAS[i]}`);
  const franjaLarga = i => turnoDe(i) ? `en el turno de ${turnoDe(i)} (${FRANJAS[i]})` : `a la ${FRANJAS[i]}`;
  function franjaPreferida(franjas) {
    const n = franjas.reduce((a, b) => a + b, 0), max = Math.max(...franjas);
    return n && max / n >= 0.5 ? franjas.indexOf(max) : null;
  }

  // ── Clientes del mes ─────────────────────────────────────────────────────────────────
  // Una visita es un día distinto: tres transferencias el mismo día son una sola visita.
  // Solo mira lo que ya pasó.
  const HABITUAL_DIAS = 4;    // vino 4 días o más: una vez por semana o más
  const SIN_VENIR_DIAS = 10;  // un habitual que no aparece hace 10 días o más "dejó de venir"
  const VENTANA_DIAS = 60;    // para saber si era habitual y si es nuevo se miran 2 meses
  function analizarClientes(filas, desde, hasta) {
    const validas = filas.filter(f => !f.devuelto && Number(f.monto) > 0 && f.fecha && f.fecha <= hasta && clave(f.nombre));
    const ultimoDia = validas.filter(f => f.fecha >= desde).reduce((u, f) => f.fecha > u ? f.fecha : u, '');
    if (!ultimoDia) return null;
    const inicioVentana = sumarDias(ultimoDia, -VENTANA_DIAS), limiteSinVenir = sumarDias(ultimoDia, -SIN_VENIR_DIAS);
    const clientes = new Map();
    // Mapa de calor del mes: compras por día de la semana (0 = domingo) y franja.
    const mapa = Array.from({length: 7}, () => [0, 0, 0]);
    let hayAnteriores = false;
    for (const f of validas) {
      const k = clave(f.nombre);
      let c = clientes.get(k);
      if (!c) clientes.set(k, c = {nombre: nombreVisible(f.nombre), total: 0, cobros: 0, dias: new Set(), diasVentana: new Set(), franjas: [0, 0, 0], ultima: '', previo: false});
      if (f.fecha > c.ultima) c.ultima = f.fecha;
      if (f.fecha >= inicioVentana) c.diasVentana.add(f.fecha);
      if (f.fecha < desde) { hayAnteriores = c.previo = true; continue; }
      c.total += Number(f.monto); c.cobros++; c.dias.add(f.fecha);
      const fr = franjaDe(f.hora); if (fr != null) { c.franjas[fr]++; mapa[diaSemana(f.fecha)][fr]++; }
    }
    const resumen = c => ({nombre: c.nombre, total: Math.round(c.total * 100) / 100, cobros: c.cobros, visitas: c.dias.size,
      ticket: c.cobros ? Math.round(c.total / c.cobros) : 0, franja: franjaPreferida(c.franjas), ultima: c.ultima, visitasVentana: c.diasVentana.size});
    const todos = [...clientes.values()];
    const delMes = todos.filter(c => c.cobros).map(resumen).sort((a, b) => b.total - a.total || b.visitas - a.visitas);
    const total = delMes.reduce((s, c) => s + c.total, 0);
    const grupo = (id, cond) => { const cs = delMes.filter(cond); return {id, clientes: cs.length, total: cs.reduce((s, c) => s + c.total, 0)}; };
    return {
      desde, hasta, ultimoDia, total, clientes: delMes.length, cobros: delMes.reduce((s, c) => s + c.cobros, 0),
      ranking: delMes, mapa,
      grupos: [grupo('habituales', c => c.visitas >= HABITUAL_DIAS), grupo('aveces', c => c.visitas >= 2 && c.visitas < HABITUAL_DIAS), grupo('unavez', c => c.visitas === 1)],
      dejaron: todos.filter(c => c.diasVentana.size >= HABITUAL_DIAS && c.ultima <= limiteSinVenir).map(resumen)
        .sort((a, b) => b.visitasVentana - a.visitasVentana || (a.ultima < b.ultima ? 1 : -1)),
      // Sin reportes de meses anteriores no se puede saber quién es nuevo.
      nuevos: hayAnteriores ? todos.filter(c => c.cobros && !c.previo).map(resumen).sort((a, b) => b.total - a.total) : null,
      // Cliente del mes: el que más días vino (si empatan, el que más gastó). Desde 2 días.
      estrella: delMes.filter(c => c.visitas >= 2).sort((a, b) => b.visitas - a.visitas || b.total - a.total)[0] || null,
    };
  }

  // ── Ficha de un cliente ──────────────────────────────────────────────────────────────
  // Todo lo que hay cargado de una persona: cuánto gastó, cuándo viene, sus compras.
  function fichaCliente(filas) {
    const validas = filas.filter(f => !f.devuelto && Number(f.monto) > 0);
    const dias = new Set(validas.map(f => f.fecha)), franjas = [0, 0, 0], porDia = Array(7).fill(0), meses = new Map();
    const mapa = Array.from({length: 7}, () => [0, 0, 0]), gastoPorDia = new Map();
    let total = 0;
    for (const f of validas) {
      total += Number(f.monto);
      const fr = franjaDe(f.hora); if (fr != null) { franjas[fr]++; mapa[diaSemana(f.fecha)][fr]++; }
      const m = meses.get(f.fecha.slice(0, 7)) || {mes: f.fecha.slice(0, 7), total: 0, dias: new Set()};
      m.total += Number(f.monto); m.dias.add(f.fecha); meses.set(m.mes, m);
      gastoPorDia.set(f.fecha, (gastoPorDia.get(f.fecha) || 0) + Number(f.monto));
    }
    dias.forEach(d => porDia[diaSemana(d)]++);
    const maxDia = Math.max(...porDia), orden = [...dias].sort();
    return {
      nombre: nombreVisible(filas[0] ? filas[0].nombre : ''),
      total: Math.round(total * 100) / 100, cobros: validas.length, visitas: dias.size,
      ticket: validas.length ? Math.round(total / validas.length) : 0,
      franja: franjaPreferida(franjas),
      // Días de la semana que más viene (uno, o dos si empatan): solo si vino 3 días o más y
      // cada uno de esos días pesa al menos 30%.
      dias: (() => {
        const top = [1, 2, 3, 4, 5, 6, 0].filter(d => porDia[d] === maxDia);
        return dias.size >= 3 && top.length <= 2 && maxDia / dias.size >= 0.3 ? top : [];
      })(),
      primera: orden[0] || '', ultima: orden[orden.length - 1] || '',
      meses: [...meses.values()].sort((a, b) => a.mes < b.mes ? 1 : -1).map(m => ({mes: m.mes, total: Math.round(m.total * 100) / 100, visitas: m.dias.size})),
      compras: filas.slice().sort((a, b) => `${b.fecha} ${b.hora || ''}`.localeCompare(`${a.fecha} ${a.hora || ''}`)),
      mapa,
      // Lo que gastó cada día que vino, del más viejo al más nuevo (para el gráfico de barras).
      visitasDetalle: [...gastoPorDia].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([fecha, monto]) => ({fecha, total: Math.round(monto * 100) / 100})),
    };
  }

  // ── Ajustes: a quién no contar y quiénes son la misma persona ───────────────────────
  // Se guardan en app_learn (la tabla clave/valor de la app), así valen igual en la compu
  // y en el celular. Nunca se tocan los cobros: solo cambia cómo se cuentan.
  //   excluidos: {clave: {nombre, desde}}            -> no entra en el ranking ni en los números
  //   unidos:    {clave: {a, nombreA, nombre}}      -> ese nombre se cuenta como el cliente "a"
  const AJUSTES_CLAVE = 'clientes_mp_ajustes';
  function normalizarAjustes(v) {
    const a = v && typeof v === 'object' ? v : {}, obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
    return {excluidos: obj(a.excluidos), unidos: obj(a.unidos)};
  }
  // A qué cliente apunta un nombre (sigue la cadena si se unió más de una vez).
  function principalDe(k, aj) { let x = k; for (let n = 0; n < 10 && aj.unidos[x]; n++) x = aj.unidos[x].a; return x; }
  function nombrePrincipal(p, aj) { for (const u of Object.values(aj.unidos)) if (u.a === p && u.nombreA) return u.nombreA; return null; }
  const aliasDe = (p, aj) => Object.keys(aj.unidos).filter(k => principalDe(k, aj) === p);
  // Los cobros de un nombre unido pasan a llamarse como el cliente principal. Los que no se
  // cuentan se sacan (o, con marcar, quedan marcados para el buscador y la ficha).
  function aplicarAjustes(filas, aj, {marcar = false} = {}) {
    const out = [];
    for (const f of filas) {
      const k = clave(f.nombre), p = principalDe(k, aj), excluido = !!aj.excluidos[p];
      if (excluido && !marcar) continue;
      if (p === k && !excluido) { out.push(f); continue; }
      out.push(Object.assign({}, f, p !== k ? {nombre: nombrePrincipal(p, aj) || f.nombre} : {}, excluido ? {excluido: true} : {}));
    }
    return out;
  }
  let ajustesCache = null;
  async function leerAjustes() {
    const r = await root.histSbSelect(`app_learn?select=valor&clave=eq.${AJUSTES_CLAVE}`);
    return normalizarAjustes(Array.isArray(r) && r[0] ? r[0].valor : null);
  }
  // Para mostrar: si no se puede leer, se sigue con lo último conocido (o sin ajustes).
  async function cargarAjustes() {
    try { ajustesCache = await leerAjustes(); } catch (e) { ajustesCache = ajustesCache || normalizarAjustes(null); }
    return ajustesCache;
  }
  // Para cambiar: se relee lo último guardado (por si se tocó desde otro aparato) y si no se
  // puede leer NO se escribe, así nunca se pisan los ajustes con una lista vacía.
  async function guardarAjustes(cambio) {
    const aj = await leerAjustes();
    cambio(aj);
    await root.cmSbWrite('app_learn?on_conflict=clave', 'POST', {clave: AJUSTES_CLAVE, valor: aj, updated_at: new Date().toISOString()}, 'resolution=merge-duplicates,return=minimal');
    ajustesCache = aj;
    return aj;
  }

  // ── Buscador de clientes ─────────────────────────────────────────────────────────────
  // Un número busca quién pagó ese monto; un texto, clientes por nombre (sin importar
  // tildes, mayúsculas ni el orden de las palabras). Siempre devuelve clientes, no cobros.
  const CAMPOS = 'pago_id,nombre,fecha,hora,monto,devuelto';
  function consultaBusqueda(texto) {
    const q = String(texto || '').trim();
    const soloNumero = q.replace(/[$\s]/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(soloNumero)) {
      const monto = montoDe(/^\d{1,3}(\.\d{3})+$/.test(soloNumero) ? soloNumero.replace(/\./g, '') : soloNumero);
      return {tipo: 'monto', monto, path: `${TABLA}?select=${CAMPOS}&monto=eq.${monto}&order=fecha.desc,hora.desc&limit=1000`};
    }
    const palabras = sinTildes(q).replace(/[^a-zñ ]/g, ' ').split(/\s+/).filter(p => p.length >= 2);
    if (!palabras.length) return null;
    // A la base se le pide la palabra más larga (así "fer lucia" también encuentra a
    // "Lucia Fernandez") y acá se filtra con todas las palabras.
    const patron = palabras.slice().sort((a, b) => b.length - a.length)[0].replace(/[aeiou]/g, '_');
    return {tipo: 'nombre', palabras, path: `${TABLA}?select=${CAMPOS}&nombre=ilike.*${encodeURIComponent(patron)}*&order=fecha.desc,hora.desc&limit=3000`};
  }
  function filtrarPorNombre(filas, palabras) {
    return filas.filter(f => { const n = sinTildes(f.nombre); return palabras.every(p => n.includes(p)); });
  }
  // Junta los cobros encontrados por cliente.
  function agruparClientes(filas) {
    const porCliente = new Map();
    for (const f of filas) {
      if (f.devuelto || !(Number(f.monto) > 0)) continue;
      const k = clave(f.nombre);
      if (!k) continue;
      const c = porCliente.get(k) || {nombre: nombreVisible(f.nombre), total: 0, cobros: 0, dias: new Set(), ultima: '', excluido: false};
      c.total += Number(f.monto); c.cobros++; c.dias.add(f.fecha);
      if (f.fecha > c.ultima) c.ultima = f.fecha;
      if (f.excluido) c.excluido = true;
      porCliente.set(k, c);
    }
    return [...porCliente.values()].map(c => ({nombre: c.nombre, total: Math.round(c.total * 100) / 100, cobros: c.cobros, visitas: c.dias.size, ultima: c.ultima, excluido: c.excluido}));
  }
  const MAX_RESULTADOS = 20;
  let busquedaActual = 0;
  async function buscar(texto) {
    const doc = root.document, el = doc.getElementById('cmpResultados');
    if (!el) return;
    const consulta = consultaBusqueda(texto), id = ++busquedaActual;
    cerrarFicha();
    el.hidden = false;
    if (!consulta) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="cmp-nada">Buscando…</div>';
    try {
      let filas = await root.histSbSelect(consulta.path);
      const aj = await cargarAjustes();
      if (id !== busquedaActual) return;
      if (consulta.tipo === 'nombre') filas = filtrarPorNombre(filas, consulta.palabras);
      filas = aplicarAjustes(filas, aj, {marcar: true});
      const clientes = agruparClientes(filas).sort(consulta.tipo === 'monto'
        ? (a, b) => b.cobros - a.cobros || (a.ultima < b.ultima ? 1 : -1)
        : (a, b) => b.total - a.total);
      el.innerHTML = clientes.length
        ? (consulta.tipo === 'monto' ? `<div class="cmp-nada">${plural(clientes.length, 'cliente pagó', 'clientes pagaron')} ${pesos(consulta.monto)}:</div>` : '')
          + clientes.slice(0, MAX_RESULTADOS).map(c => filaCliente(c, null, consulta.tipo === 'monto'
            ? `${plural(c.cobros, 'vez', 'veces')} · última vez el ${fechaCorta(c.ultima)}`
            : `${plural(c.visitas, 'día', 'días')} · última vez el ${fechaCorta(c.ultima)}`,
            {monto: consulta.tipo === 'nombre', apagado: c.excluido, chip: c.excluido ? '<span class="cmp-chip is-fuera">no se cuenta</span>' : ''})).join('')
          + (clientes.length > MAX_RESULTADOS ? `<div class="cmp-nada">Hay ${$(clientes.length)}: escribí algo más para achicar la lista.</div>` : '')
        : `<div class="cmp-nada">No encontré clientes ${consulta.tipo === 'monto' ? 'que hayan pagado ese monto' : 'con ese nombre'}.</div>`;
      ponerAvatares(el);
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

  // ── Tarjeta en Métricas ──────────────────────────────────────────────────────────────
  function tarjetaHtml() {
    return `<div class="met-card cmp-card" id="metClientes">
      <div class="met-card-title">Clientes de Mercado Pago</div>
      <div class="cmp-intro">A fin de mes subí el reporte <b>Todas las transacciones</b> de Mercado Pago y la app sabe quién pagó cada transferencia.</div>
      <div class="cmp-acciones"><label class="cmp-subir"><input type="file" accept=".csv,text/csv" id="cmpArchivo"><span>Cargar reporte de Mercado Pago</span></label></div>
      <div class="cmp-estado" id="cmpEstado" role="status" aria-live="polite"></div>
      <div class="cmp-buscar">
        <label class="cmp-buscar-lbl" for="cmpBuscar">Buscar un cliente</label>
        <input type="search" id="cmpBuscar" placeholder="Nombre o monto, ej. lucia o 4500" autocomplete="off" inputmode="search">
        <div class="cmp-resultados" id="cmpResultados" aria-live="polite"></div>
        <div class="cmp-ficha" id="cmpFicha" hidden></div>
      </div>
      <div class="cmp-analisis" id="cmpAnalisis"></div>
    </div>`;
  }
  // ── Colores y dibujos ────────────────────────────────────────────────────────────────
  // Cada cliente tiene su color (sale del nombre, así es siempre el mismo) y sus iniciales.
  function tonoDe(nombre) { let h = 7; for (const ch of clave(nombre)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; }
  function iniciales(nombre) {
    const p = nombreLimpio(nombre).split(' ').filter(w => w && !PARTICULAS.has(w.toLowerCase()));
    return ((p[0] || '').charAt(0) + (p[1] || '').charAt(0)).toLocaleUpperCase('es-AR');
  }
  const avatarHtml = (nombre, clase = '') => `<span class="cmp-av${clase ? ' ' + clase : ''}" style="--h:${tonoDe(nombre)}" data-av="${esc(clave(nombre))}" aria-hidden="true">${esc(iniciales(nombre))}</span>`;
  const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];
  const SEMANA_CORTA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const SEMANA_LARGA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  // Mapa de calor: de índigo apagado (poco) a rosa y naranja (mucho).
  function colorCalor(t) {
    const h = t < 0.6 ? 235 + t / 0.6 * 95 : 330 + (t - 0.6) / 0.4 * 60;
    return `hsla(${Math.round(h % 360)},90%,62%,${(0.16 + 0.84 * t).toFixed(2)})`;
  }
  // Qué quiere decir cada número, con el ejemplo del casillero más encendido.
  function explicacionMapa(mapa, quien) {
    let top = null;
    ORDEN_SEMANA.forEach(d => mapa[d].forEach((v, fr) => { if (v && (!top || v > top.v)) top = {d, fr, v}; }));
    const base = quien === 'mes' ? 'Cada número es cuántas compras hubo ese día de la semana, en ese turno, en todo el mes.' : 'Cada número es cuántas veces compró ese día de la semana, en ese turno.';
    const ejemplo = !top ? '' : ` Por ejemplo: <b>los ${DIAS_PLURAL[top.d]} a la ${FRANJAS[top.fr]}</b> `
      + (quien === 'mes' ? `hubo <b>${plural(top.v, 'compra', 'compras')}</b>.` : `compró <b>${plural(top.v, 'vez', 'veces')}</b>.`);
    return `<div class="met-sub cmp-expl">${base}${ejemplo} Cuanto más encendido, más movimiento.</div>`;
  }
  function mapaHtml(mapa, unidad) {
    const max = Math.max(1, ...mapa.flat());
    const cab = FRANJAS.map((f, i) => `<span class="cmp-mapa-fr">${f}${turnoDe(i) ? `<small>${esc(turnoDe(i))}</small>` : ''}</span>`).join('');
    const filas = ORDEN_SEMANA.map(d => `<span class="cmp-mapa-dia">${SEMANA_CORTA[d]}</span>` + mapa[d].map((v, fr) => {
      const t = v / max;
      return `<span class="cmp-mapa-celda${t > 0.4 ? ' is-fuerte' : ''}" data-t="${t.toFixed(3)}" style="${v ? `background:${colorCalor(t)}` : ''}" title="${SEMANA_LARGA[d]} a la ${FRANJAS[fr]}: ${plural(v, unidad[0], unidad[1])}">${v ? `<b>${v}</b>` : ''}</span>`;
    }).join('')).join('');
    return `<div class="cmp-mapa"><span></span>${cab}${filas}</div>`;
  }
  function donaSvg(partes, centro, sub) {
    const total = partes.reduce((s, p) => s + p.valor, 0) || 1, R = 50, C = 2 * Math.PI * R;
    const conValor = partes.filter(p => p.valor > 0), hueco = conValor.length > 1 ? 2.5 : 0;
    let acum = 0;
    const arcos = conValor.map(p => {
      const largo = p.valor / total * C, arco = `<circle class="cmp-dona-arco" cx="70" cy="70" r="${R}" fill="none" stroke="${p.color}" stroke-width="20" stroke-dasharray="${Math.max(0, largo - hueco).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-acum).toFixed(2)}" transform="rotate(-90 70 70)"/>`;
      acum += largo;
      return arco;
    }).join('');
    return `<svg class="cmp-dona" viewBox="0 0 140 140" data-partes="${esc(JSON.stringify(partes))}" role="img" aria-label="${esc(sub)}: ${esc(centro)}"><circle cx="70" cy="70" r="${R}" fill="none" class="cmp-dona-fondo" stroke-width="20"/>${arcos}`
      + `<text x="70" y="70" text-anchor="middle" class="cmp-dona-n">${esc(centro)}</text><text x="70" y="89" text-anchor="middle" class="cmp-dona-s">${esc(sub)}</text></svg>`;
  }
  // "$80 mil", "$4,5 mil", "$1,2 M": montos cortos para que entren arriba de cada barra.
  function pesosCorto(n) {
    const v = Math.round(Number(n) || 0), f = (x, d) => x.toLocaleString('es-AR', {maximumFractionDigits: d});
    if (v >= 1e6) return `$${f(v / 1e6, 1)} M`;
    if (v >= 1000) return `$${f(v / 1000, v < 10000 ? 1 : 0)} mil`;
    return `$${v}`;
  }
  // Barras de lo que gastó cada día que vino (las últimas 30 visitas), del más viejo al más
  // nuevo. Tamaño fijo: no se estira en pantallas grandes. Con pocas visitas cada barra
  // lleva su monto arriba y su fecha abajo; con muchas, solo algunas fechas de referencia.
  const MAX_BARRAS = 30;
  function barrasHtml(visitas) {
    const ult = visitas.slice(-MAX_BARRAS), n = ult.length, max = Math.max(1, ...ult.map(v => v.total));
    const pocas = n <= 7, cada = Math.ceil(n / 6), iMax = ult.findIndex(v => v.total === max);
    const cols = ult.map((v, i) => {
      const alto = Math.max(4, v.total / max * 100).toFixed(1), fecha = pocas || i === n - 1 || (i % cada === 0 && n - 1 - i >= cada);
      return `<div class="cmp-vis-col${i === iMax ? ' is-max' : ''}" title="${SEMANA_CORTA[diaSemana(v.fecha)]} ${fechaCorta(v.fecha)}: ${pesos(v.total)}">`
        + `<div class="cmp-vis-pista"><span class="cmp-vis-barra" style="height:${alto}%">${pocas || i === iMax ? `<b class="cmp-vis-monto">${pesosCorto(v.total)}</b>` : ''}</span></div>`
        + `<span class="cmp-vis-fecha">${fecha ? `${pocas ? `<small>${DIAS_CORTOS[diaSemana(v.fecha)]}</small>` : ''}${fechaCorta(v.fecha)}` : ''}</span></div>`;
    }).join('');
    return `<div class="cmp-vis${pocas ? '' : ' is-muchas'}" role="img" aria-label="Lo que gastó cada día que vino; el máximo fue ${pesos(max)}">${cols}</div>`
      + (visitas.length > MAX_BARRAS ? `<div class="met-sub">Últimas ${MAX_BARRAS} visitas de ${$(visitas.length)}.</div>` : '');
  }

  // ── Avatares y dibujos a mano ────────────────────────────────────────────────────────
  // Dos librerías que se bajan del CDN solo cuando se abre la tarjeta. Si no cargan (sin
  // internet, CDN caído), queda todo como antes: iniciales y gráficos lisos.
  // · DiceBear arma el avatar EN EL NAVEGADOR a partir del nombre: el nombre del cliente no
  //   viaja a ningún servidor (no se usa su servicio por link, solo la librería).
  // · Rough.js redibuja los gráficos como hechos a mano, tipo cuaderno.
  const AVATAR_ESTILO = 'notionists';
  const LIBS = {
    dicebear: p => `https://cdn.jsdelivr.net/npm/@dicebear/${p}/+esm`,
    rough: 'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js',
    fuente: 'https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap',
  };
  const FONDOS_AVATAR = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c7f2d8'];
  let avataresProm = null, roughProm = null;
  const avataresHechos = new Map();
  function cargarAvatares() {
    if (!avataresProm) avataresProm = Promise.all([import(LIBS.dicebear('core@9.4.3')), import(LIBS.dicebear(`${AVATAR_ESTILO}@9.4.2`))])
      .catch(e => { avataresProm = null; throw e; });
    return avataresProm;
  }
  function ponerAvatares(cont) {
    const els = cont ? [...cont.querySelectorAll('.cmp-av[data-av]:not(.con-dibujo)')] : [];
    if (!els.length) return Promise.resolve();
    return cargarAvatares().then(([core, estilo]) => {
      els.forEach(el => {
        const k = el.dataset.av;
        if (!avataresHechos.has(k)) avataresHechos.set(k, core.createAvatar(estilo, {seed: k, size: 96, radius: 50, backgroundColor: FONDOS_AVATAR}).toDataUri());
        el.innerHTML = `<img src="${avataresHechos.get(k)}" alt="">`;
        el.classList.add('con-dibujo');
      });
    }).catch(() => {});
  }
  function cargarRough() {
    if (root.rough) return Promise.resolve(root.rough);
    if (!roughProm) roughProm = new Promise((ok, mal) => {
      const s = root.document.createElement('script');
      s.src = LIBS.rough; s.async = true;
      s.onload = () => root.rough ? ok(root.rough) : mal(new Error('rough'));
      s.onerror = mal;
      root.document.head.appendChild(s);
    }).catch(e => { roughProm = null; throw e; });
    return roughProm;
  }
  function ponerFuente() {
    const doc = root.document;
    if (!doc || doc.getElementById('cmpFuenteMano')) return;
    doc.head.insertAdjacentHTML('beforeend', `<link rel="stylesheet" id="cmpFuenteMano" href="${LIBS.fuente}">`);
  }
  // Semilla fija por elemento: el garabato sale igual cada vez que se dibuja.
  const semilla = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return (h % 2147483646) + 1; };
  // Un SVG que cubre el elemento, detrás de su texto.
  function lienzo(el) {
    el.querySelectorAll(':scope > svg.cmp-rough').forEach(s => s.remove());
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return null;
    const svg = root.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cmp-rough'); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('aria-hidden', 'true');
    el.prepend(svg);
    return {svg, w, h};
  }
  // Porción de anillo (ángulos en radianes, desde arriba y en sentido horario).
  function porcionAnillo(cx, cy, r1, r2, a0, a1) {
    a1 = Math.min(a1, a0 + Math.PI * 2 - 0.001);
    const p = (r, a) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`, g = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(r2, a0)}A${r2} ${r2} 0 ${g} 1 ${p(r2, a1)}L${p(r1, a1)}A${r1} ${r1} 0 ${g} 0 ${p(r1, a0)}Z`;
  }
  function dibujarAMano(cont) {
    if (!cont || !root.document) return Promise.resolve();
    return cargarRough().then(rough => {
      const claro = root.document.body.classList.contains('light');
      const tenue = claro ? 'rgba(15,23,42,.2)' : 'rgba(255,255,255,.16)';
      const rect = (el, clave, color, extra = {}) => {
        const l = lienzo(el);
        if (!l) return;
        l.svg.appendChild(rough.svg(l.svg).rectangle(1.5, 1.5, l.w - 3, l.h - 3, Object.assign({seed: semilla(clave), roughness: 1.3, bowing: 1.1,
          stroke: color, strokeWidth: 1.4, fill: color, fillStyle: 'hachure', hachureGap: 4, fillWeight: 1.2}, extra)));
      };
      // Barras de la ficha: la compra más grande, cuadriculada en rosa.
      cont.querySelectorAll('.cmp-vis-barra').forEach((el, i) => {
        const max = el.closest('.cmp-vis-col').classList.contains('is-max');
        rect(el, 'vis' + i, max ? '#ff6b9a' : '#a78bfa', max ? {fillStyle: 'cross-hatch', hachureGap: 3.5} : {});
      });
      // Mapa de calor: cuanto más movimiento, más apretado el rayado.
      cont.querySelectorAll('.cmp-mapa-celda').forEach((el, i) => {
        const t = Number(el.dataset.t || 0);
        if (!t) return rect(el, 'mapa' + i, tenue, {fill: undefined, strokeWidth: 1, roughness: 1.6});
        rect(el, 'mapa' + i, colorCalor(t), {hachureGap: 7 - 3.5 * t, fillWeight: 1 + t});
      });
      // Podio: bloques rayados en oro, plata y bronce.
      cont.querySelectorAll('.cmp-podio-base').forEach((el, i) => {
        rect(el, 'podio' + i, getComputedStyle(el).getPropertyValue('--m').trim() || '#fbbf24', {hachureGap: 5, roughness: 1.6});
      });
      // Cliente del mes: marco dorado dibujado a mano.
      cont.querySelectorAll('.cmp-estrella').forEach(el => rect(el, 'estrella', '#fbbf24', {fill: undefined, strokeWidth: 2.2, roughness: 2.2, bowing: 1.5}));
      // Por mes (ficha).
      cont.querySelectorAll('.cmp-mes-barra i').forEach((el, i) => rect(el, 'mes' + i, '#c77dff', {hachureGap: 3.5, strokeWidth: 1}));
      // Ranking: una pasada de resaltador.
      cont.querySelectorAll('.cmp-cli-barra i').forEach((el, i) => {
        const l = lienzo(el);
        if (!l) return;
        const color = getComputedStyle(el).getPropertyValue('--h').trim();
        l.svg.appendChild(rough.svg(l.svg).line(2, l.h / 2, Math.max(3, l.w - 2), l.h / 2, {seed: semilla('rk' + i), roughness: 1.8, bowing: 2,
          stroke: `hsl(${color || 250} 85% 64%)`, strokeWidth: 4}));
      });
      // Anillo: porciones rayadas.
      cont.querySelectorAll('svg.cmp-dona[data-partes]').forEach(svg => {
        svg.querySelectorAll('.cmp-dona-mano').forEach(g => g.remove());
        const partes = JSON.parse(svg.dataset.partes), total = partes.reduce((s, p) => s + p.valor, 0) || 1;
        const hueco = partes.filter(p => p.valor > 0).length > 1 ? 0.05 : 0, rs = rough.svg(svg);
        const grupo = root.document.createElementNS('http://www.w3.org/2000/svg', 'g');
        grupo.setAttribute('class', 'cmp-dona-mano');
        let a = 0;
        partes.forEach((p, i) => {
          if (!(p.valor > 0)) return;
          const b = a + p.valor / total * Math.PI * 2;
          grupo.appendChild(rs.path(porcionAnillo(70, 70, 40, 61, a + hueco / 2, b - hueco / 2), {seed: semilla('dona' + i), roughness: 1.2,
            stroke: p.color, strokeWidth: 1.5, fill: p.color, fillStyle: i === 0 ? 'cross-hatch' : 'hachure', hachureGap: 3.2, fillWeight: 1.3}));
          a = b;
        });
        svg.insertBefore(grupo, svg.querySelector('text'));
      });
      cont.classList.add('a-mano');
    }).catch(() => {});
  }
  // Avatares + dibujos de lo que se acaba de pintar.
  function decorar(cont) { ponerFuente(); return Promise.all([ponerAvatares(cont), dibujarAMano(cont)]); }
  // Si cambia el ancho (girar el celular, achicar la ventana) se redibuja con la medida nueva.
  let esperaRedibujo = null;
  if (root.addEventListener && root.document) root.addEventListener('resize', () => {
    clearTimeout(esperaRedibujo);
    esperaRedibujo = setTimeout(() => { const card = root.document.getElementById('metClientes'); if (card && card.querySelector('.a-mano')) dibujarAMano(card); }, 250);
  });

  // ── Tarjeta: clientes y rankings ─────────────────────────────────────────────────────
  // Cada cliente es un botón: al tocarlo se abre su ficha.
  // pos: número del ranking (null = sin número); monto: false para no mostrar el total;
  // barra: 0 a 1, cuánto gastó al lado del primero; chip: cartelito (nuevo, hace N días).
  function filaCliente(c, pos, detalle, {monto = true, extra = false, barra = null, chip = '', apagado = false} = {}) {
    return `<button type="button" class="cmp-cli${extra ? ' is-extra' : ''}${apagado ? ' is-apagado' : ''}" data-cliente="${esc(c.nombre)}">`
      + (pos == null ? '' : `<span class="cmp-cli-pos">${pos}</span>`) + avatarHtml(c.nombre)
      + `<span class="cmp-cli-info"><span class="cmp-cli-nom"><span class="cmp-cli-txt">${esc(c.nombre)}</span>${chip}</span><span class="cmp-cli-det">${detalle}</span>`
      + (barra == null ? '' : `<span class="cmp-cli-barra"><i style="width:${Math.max(3, barra * 100).toFixed(1)}%;--h:${tonoDe(c.nombre)}"></i></span>`) + '</span>'
      + (monto ? `<b class="cmp-cli-monto">${pesos(c.total)}</b>` : '') + '<span class="cmp-cli-ir" aria-hidden="true">›</span></button>';
  }
  const detalleRanking = c => [plural(c.visitas, 'día', 'días'), plural(c.cobros, 'compra', 'compras'), `ticket ${pesos(c.ticket)}`, c.visitas >= 2 ? franjaCorta(c.franja) : ''].filter(Boolean).join(' · ');
  const MEDALLAS = ['🥇', '🥈', '🥉'];
  function podioHtml(top) {
    return '<div class="cmp-podio">' + [1, 0, 2].filter(i => top[i]).map(i => {
      const c = top[i];
      return `<button type="button" class="cmp-podio-lugar is-${i + 1}" data-cliente="${esc(c.nombre)}">`
        + `<span class="cmp-podio-medalla" aria-hidden="true">${MEDALLAS[i]}</span>${avatarHtml(c.nombre, 'is-grande')}`
        + `<span class="cmp-podio-nom">${esc(c.nombre)}</span><b class="cmp-podio-monto">${pesos(c.total)}</b>`
        + `<span class="cmp-podio-det">${plural(c.visitas, 'día', 'días')} · ${plural(c.cobros, 'compra', 'compras')}</span>`
        + `<span class="cmp-podio-base"><span>${i + 1}º</span></span></button>`;
    }).join('') + '</div>';
  }
  const GRUPOS = {
    habituales: {nombre: 'Habituales', detalle: `${HABITUAL_DIAS} días o más`, color: '#8b7bff'},
    aveces: {nombre: 'De vez en cuando', detalle: '2 o 3 días', color: '#34d399'},
    unavez: {nombre: 'Una sola vez', detalle: '1 día', color: '#fbbf24'},
  };
  const VISIBLES = 10, MAS = 30;
  function kpisHtml(items) {
    return `<div class="cmp-kpis${items.length === 4 ? ' cmp-kpis-4' : ''}">` + items.map(([valor, texto, color]) =>
      `<div style="--c:${color}"><b>${valor}</b><span>${texto}</span></div>`).join('') + '</div>';
  }
  // Cliente del mes: tarjeta destacada (se festeja con confeti la primera vez que se ve).
  function estrellaHtml(a) {
    const c = a.estrella;
    if (!c) return '';
    const mes = new Date(a.desde + 'T12:00:00Z').toLocaleDateString('es-AR', {month: 'long', timeZone: 'UTC'});
    const hasta = a.ultimoDia < a.hasta ? ` (hasta el ${fechaCorta(a.ultimoDia)})` : '';
    return `<button type="button" class="cmp-estrella" id="cmpEstrella" data-cliente="${esc(c.nombre)}">`
      + `<span class="cmp-estrella-tit">⭐ Cliente del mes</span>${avatarHtml(c.nombre, 'is-estrella')}`
      + `<span class="cmp-estrella-nom">${esc(c.nombre)}</span>`
      + `<span class="cmp-estrella-det">El que más días vino en ${mes}${hasta}: <b>${plural(c.visitas, 'día', 'días')}</b></span>`
      + `<span class="cmp-estrella-num"><span><b>${pesos(c.total)}</b>gastó</span><span><b>${$(c.cobros)}</b>${c.cobros === 1 ? 'compra' : 'compras'}</span><span><b>${pesos(c.ticket)}</b>ticket</span></span>`
      + (c.franja != null ? `<span class="cmp-estrella-det">Suele venir ${franjaLarga(c.franja)}</span>` : '')
      + '</button>';
  }
  function analisisHtml(a, mesAnterior, aj = normalizarAjustes(null)) {
    const pct = x => a.total ? Math.round(x / a.total * 100) : 0, top = a.ranking[0] ? a.ranking[0].total : 1;
    const fuera = Object.values(aj.excluidos);
    const fueraHtml = fuera.length ? `<div class="cmp-fuera"><span>🚫 No se cuentan:</span>${fuera.map(x => `<button type="button" class="cmp-chip is-fuera" data-cliente="${esc(x.nombre)}">${esc(x.nombre)}</button>`).join('')}</div>` : '';
    const hab = a.grupos[0];
    const grupos = a.grupos.map(g => `<div class="cmp-ley" style="--c:${GRUPOS[g.id].color}"><span class="cmp-ley-punto"></span>`
      + `<span class="cmp-ley-txt"><b>${GRUPOS[g.id].nombre}</b><small>${GRUPOS[g.id].detalle} · ${plural(g.clientes, 'cliente', 'clientes')}</small></span>`
      + `<span class="cmp-ley-val"><b>${pct(g.total)}%</b><small>${pesos(g.total)}</small></span></div>`).join('');
    const resto = a.ranking.slice(3, MAS).map((c, i) => filaCliente(c, i + 4, detalleRanking(c), {extra: i + 3 >= VISIBLES, barra: c.total / top})).join('');
    const hoy = hoyAR();
    const dejaron = a.dejaron.length
      ? a.dejaron.slice(0, 8).map(c => filaCliente(c, null, `venía ${plural(c.visitasVentana, 'día', 'días')} · última vez el ${fechaCorta(c.ultima)}`,
          {monto: false, apagado: true, chip: `<span class="cmp-chip is-alerta">hace ${diasEntre(c.ultima, hoy)} días</span>`})).join('')
        + (a.dejaron.length > 8 ? `<div class="met-sub">Y ${$(a.dejaron.length - 8)} más.</div>` : '')
      : '<div class="cmp-vacio">🎉 Ninguno: todos los habituales vinieron en los últimos días.</div>';
    const nuevos = a.nuevos == null
      ? `<div class="cmp-vacio">Para saber quiénes son nuevos hace falta también el reporte de ${mesAnterior}.</div>`
      : a.nuevos.length
        ? `<div class="cmp-nuevos"><b>${$(a.nuevos.length)}</b> ${a.nuevos.length === 1 ? 'cliente compró' : 'clientes compraron'} por primera vez y ${a.nuevos.length === 1 ? 'dejó' : 'dejaron'} <b>${pesos(a.nuevos.reduce((s, c) => s + c.total, 0))}</b>.</div>`
          + a.nuevos.slice(0, 5).map(c => filaCliente(c, null, detalleRanking(c), {chip: '<span class="cmp-chip is-nuevo">nuevo</span>'})).join('')
        : '<div class="cmp-vacio">Este mes no hubo clientes nuevos.</div>';
    return kpisHtml([[$(a.clientes), 'clientes', '#8b7bff'], [$(a.cobros), 'compras', '#34d399'], [pesos(a.cobros ? a.total / a.cobros : 0), 'ticket promedio', '#38bdf8'], [pesos(a.total), 'cobrado con nombre', '#fbbf24']])
      + fueraHtml + estrellaHtml(a)
      + `<div class="cmp-sec">🏆 Los que más compraron</div>${podioHtml(a.ranking.slice(0, 3))}<div class="cmp-lista" id="cmpRanking">${resto}</div>`
      + (a.ranking.length > VISIBLES ? `<button type="button" class="cmp-mas" id="cmpVerMas" aria-expanded="false">Ver los ${Math.min(MAS, a.ranking.length)}</button>` : '')
      + `<div class="cmp-sec">💸 De dónde sale lo cobrado</div><div class="cmp-grupos">`
      + donaSvg(a.grupos.map(g => ({valor: g.total, color: GRUPOS[g.id].color})), `${pct(hab.total)}%`, 'habituales')
      + `<div class="cmp-leyenda">${grupos}</div></div>`
      + `<div class="cmp-sec">🔥 Cuándo compran</div>${explicacionMapa(a.mapa, 'mes')}${mapaHtml(a.mapa, ['compra', 'compras'])}`
      + `<div class="cmp-sec">👋 Habituales que dejaron de venir</div>`
      + `<div class="met-sub cmp-expl">Vinieron ${HABITUAL_DIAS} días o más en los últimos 2 meses y no aparecen desde hace ${SIN_VENIR_DIAS} días o más.</div><div class="cmp-lista">${dejaron}</div>`
      + `<div class="cmp-sec">✨ Clientes nuevos</div><div class="cmp-lista">${nuevos}</div>`
      + '<div class="met-cap">Una visita es un día: si alguien pagó tres veces el mismo día, cuenta como una. Solo entra lo cobrado por Mercado Pago que trae el nombre de quién pagó; tarjetas y efectivo no traen nombre. Tocá un cliente para ver su ficha.</div>';
  }
  const hoyAR = () => fechaHoraAR(new Date().toISOString()).fecha;
  function tipoCliente(f) {
    const v = f.meses[0] ? f.meses[0].visitas : 0;
    return v >= HABITUAL_DIAS ? ['Habitual', GRUPOS.habituales.color] : v >= 2 ? ['De vez en cuando', GRUPOS.aveces.color] : ['Vino una vez', GRUPOS.unavez.color];
  }
  // excluido: no se cuenta; alias: otros nombres unidos a este cliente; estrella: es el cliente del mes.
  function fichaAjustesHtml({excluido = false, alias = []} = {}) {
    return (excluido ? '<div class="cmp-aviso">🚫 No se cuenta en el ranking ni en los números del mes. <button type="button" class="cmp-link" data-accion="incluir">Volver a contar</button></div>' : '')
      + (alias.length ? `<div class="cmp-alias">🔗 También paga como: ${alias.map(x => `<span class="cmp-alias-n">${esc(x.nombre)} <button type="button" class="cmp-link" data-accion="separar" data-alias="${esc(x.clave)}">separar</button></span>`).join('')}</div>` : '')
      + '<div class="cmp-ficha-acc"><button type="button" class="cmp-acc" data-accion="unir-abrir" aria-controls="cmpUnir">🔗 Unir con otro nombre</button>'
      + (excluido ? '' : '<button type="button" class="cmp-acc is-fuera" data-accion="excluir">🚫 No contar</button>') + '</div>'
      + '<div class="cmp-unir" id="cmpUnir" hidden><div class="met-sub">¿Paga también con otro nombre? Buscalo y tocá <b>Unir</b>: se van a contar como una sola persona.</div>'
      + '<input type="search" id="cmpUnirBuscar" placeholder="Buscar el otro nombre" autocomplete="off"><div class="cmp-unir-res" id="cmpUnirRes"></div></div>';
  }
  function fichaHtml(f, extra = {}) {
    const hace = f.ultima ? diasEntre(f.ultima, hoyAR()) : null;
    const cuando = hace == null ? '' : hace <= 0 ? 'hoy' : hace === 1 ? 'ayer' : `hace ${hace} días`;
    const habito = [];
    if (f.visitas >= 2 && f.franja != null) habito.push(franjaLarga(f.franja));
    if (f.dias.length) habito.push(`sobre todo los ${f.dias.map(d => DIAS_PLURAL[d]).join(' y ')}`);
    const [tipo, colorTipo] = tipoCliente(f);
    const mesNombre = m => { const t = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('es-AR', {month: 'long', year: 'numeric'}); return t.charAt(0).toUpperCase() + t.slice(1); };
    const compras = f.compras.slice(0, 15).map(c => `<div class="cmp-compra${c.devuelto ? ' is-devuelta' : ''}"><span>${DIAS_CORTOS[diaSemana(c.fecha)]} ${fechaCorta(c.fecha)}</span>`
      + `<span class="cmp-compra-hora">${esc(c.hora || '')}</span><b>${pesos(c.monto)}</b>${c.devuelto ? '<em>devuelto</em>' : ''}</div>`).join('');
    const maxMes = Math.max(1, ...f.meses.map(m => m.total));
    return `<div class="cmp-ficha-top" style="--h:${tonoDe(f.nombre)}">${avatarHtml(f.nombre, 'is-ficha')}<div class="cmp-ficha-quien"><div class="cmp-ficha-nom">${esc(f.nombre)}</div>`
      + `<span class="cmp-ficha-chips"><span class="cmp-chip" style="--c:${colorTipo}">${tipo}</span>${extra.estrella ? '<span class="cmp-chip is-estrella">⭐ Cliente del mes</span>' : ''}</span>`
      + (f.primera ? `<div class="met-sub">Primera compra el ${fechaCorta(f.primera)} · última el ${fechaCorta(f.ultima)} (${cuando})</div>` : '')
      + `</div><button type="button" class="cmp-ficha-cerrar" aria-label="Cerrar la ficha">×</button></div>`
      + fichaAjustesHtml(extra)
      + kpisHtml([[pesos(f.total), 'gastó', '#fbbf24'], [$(f.visitas), f.visitas === 1 ? 'día' : 'días', '#34d399'], [$(f.cobros), f.cobros === 1 ? 'compra' : 'compras', '#8b7bff'], [pesos(f.ticket), 'ticket promedio', '#38bdf8']])
      + (habito.length ? `<div class="cmp-habito"><span aria-hidden="true">🕐</span> Suele venir ${habito.join(', ')}.</div>` : '')
      + (f.visitasDetalle.length ? `<div class="cmp-sec">📈 Lo que gastó cada día que vino</div>${barrasHtml(f.visitasDetalle)}` : '')
      + (f.visitas >= 2 ? `<div class="cmp-sec">🔥 Cuándo viene</div>${explicacionMapa(f.mapa, 'cliente')}${mapaHtml(f.mapa, ['vez', 'veces'])}` : '')
      + (f.meses.length > 1 ? '<div class="cmp-sec">📅 Por mes</div>' + f.meses.map(m => `<div class="cmp-mes"><span class="cmp-mes-nom">${mesNombre(m.mes)}</span>`
          + `<span class="cmp-mes-barra"><i style="width:${Math.max(3, m.total / maxMes * 100).toFixed(1)}%"></i></span><span class="cmp-mes-val"><b>${pesos(m.total)}</b><small>${plural(m.visitas, 'día', 'días')}</small></span></div>`).join('') : '')
      + `<div class="cmp-sec">🧾 Últimas compras</div><div class="cmp-compras">${compras}</div>`
      + (f.compras.length > 15 ? `<div class="met-sub">Y ${$(f.compras.length - 15)} compras más.</div>` : '');
  }
  function cerrarFicha() {
    const el = root.document && root.document.getElementById('cmpFicha');
    if (el) { el.hidden = true; el.innerHTML = ''; }
  }
  let pedidoFicha = 0, fichaActual = null, ultimoAnalisis = null;
  // desdeLista: 'busqueda' (esconde los resultados), 'lista' (baja hasta la ficha) o
  // 'refresco' (redibuja la misma ficha después de un ajuste, sin moverse).
  async function abrirFicha(nombre, desdeLista) {
    const doc = root.document, el = doc.getElementById('cmpFicha'), resultados = doc.getElementById('cmpResultados');
    if (!el) return;
    const id = ++pedidoFicha;
    if (resultados && desdeLista === 'busqueda') resultados.hidden = true;
    el.hidden = false;
    if (desdeLista !== 'refresco') el.innerHTML = '<div class="cmp-nada">Cargando la ficha…</div>';
    if (desdeLista === 'lista' && el.scrollIntoView) el.scrollIntoView({behavior: 'smooth', block: 'start'});
    try {
      // El cliente y todos los nombres unidos a él.
      const aj = await cargarAjustes(), p = principalDe(clave(nombre), aj), claves = [p, ...aliasDe(p, aj)];
      let filas = [];
      for (const k of claves) filas = filas.concat((await root.histSbSelectAll(`${TABLA}?select=${CAMPOS}&nombre=ilike.${encodeURIComponent(patronNombre(k))}&order=pago_id.asc`)).filter(f => clave(f.nombre) === k));
      if (id !== pedidoFicha) return;
      if (!filas.length) { fichaActual = null; el.innerHTML = '<div class="cmp-nada">No encontré compras de ese cliente.</div>'; return; }
      const f = fichaCliente(aplicarAjustes(filas, aj, {marcar: true}));
      fichaActual = {clave: p, nombre: f.nombre};
      const estrella = !!(ultimoAnalisis && ultimoAnalisis.estrella && clave(ultimoAnalisis.estrella.nombre) === p);
      el.innerHTML = fichaHtml(f, {excluido: !!aj.excluidos[p], alias: claves.slice(1).map(k => ({clave: k, nombre: aj.unidos[k].nombre})), estrella});
      decorar(el);
    } catch (e) {
      if (id === pedidoFicha) el.innerHTML = '<div class="cmp-nada">No pude abrir la ficha. Revisá la conexión.</div>';
    }
  }
  // Botones de la ficha: no contar / volver a contar / unir / separar.
  async function accionFicha(btn) {
    const act = fichaActual, doc = root.document, accion = btn.dataset.accion;
    if (!act) return;
    if (accion === 'unir-abrir') {
      const u = doc.getElementById('cmpUnir');
      if (u) { u.hidden = !u.hidden; btn.setAttribute('aria-expanded', String(!u.hidden)); if (!u.hidden) doc.getElementById('cmpUnirBuscar').focus(); }
      return;
    }
    let cambio = null, pregunta = '';
    if (accion === 'excluir') {
      pregunta = `¿No contar a ${act.nombre}?\n\nNo va a aparecer en el ranking ni en los números del mes. Sus cobros no se tocan y lo podés volver a contar cuando quieras.`;
      cambio = aj => { aj.excluidos[act.clave] = {nombre: act.nombre, desde: hoyAR()}; };
    } else if (accion === 'incluir') {
      cambio = aj => { delete aj.excluidos[act.clave]; };
    } else if (accion === 'separar') {
      cambio = aj => { delete aj.unidos[btn.dataset.alias]; };
    } else if (accion === 'unir-con') {
      const otro = btn.dataset.otro;
      pregunta = `¿${otro} y ${act.nombre} son la misma persona?\n\nSe van a contar juntos como ${act.nombre}. Lo podés separar cuando quieras.`;
      cambio = aj => { aj.unidos[clave(otro)] = {a: act.clave, nombreA: act.nombre, nombre: otro}; };
    }
    if (!cambio || (pregunta && typeof root.confirm === 'function' && !root.confirm(pregunta))) return;
    btn.disabled = true;
    try {
      await guardarAjustes(cambio);
    } catch (e) {
      btn.disabled = false;
      if (typeof root.alert === 'function') root.alert('No se pudo guardar. Revisá la conexión y probá de nuevo.');
      return;
    }
    await Promise.all([abrirFicha(act.nombre, 'refresco'), mostrarCobertura(mesVisto(), false)]);
  }
  // Buscador para unir: muestra cada nombre tal como viene en el reporte, menos los que ya son este cliente.
  let busquedaUnir = 0;
  async function buscarParaUnir(texto) {
    const el = root.document.getElementById('cmpUnirRes'), act = fichaActual;
    if (!el || !act) return;
    const consulta = consultaBusqueda(texto), id = ++busquedaUnir;
    if (!consulta) { el.innerHTML = ''; return; }
    try {
      let filas = await root.histSbSelect(consulta.path);
      const aj = await cargarAjustes();
      if (id !== busquedaUnir) return;
      if (consulta.tipo === 'nombre') filas = filtrarPorNombre(filas, consulta.palabras);
      const opciones = agruparClientes(filas.filter(f => principalDe(clave(f.nombre), aj) !== act.clave)).sort((a, b) => b.total - a.total).slice(0, 8);
      el.innerHTML = opciones.length
        ? opciones.map(c => `<button type="button" class="cmp-unir-op" data-accion="unir-con" data-otro="${esc(c.nombre)}">${avatarHtml(c.nombre)}`
          + `<span class="cmp-cli-info"><span class="cmp-cli-nom"><span class="cmp-cli-txt">${esc(c.nombre)}</span></span><span class="cmp-cli-det">${plural(c.visitas, 'día', 'días')} · ${pesos(c.total)}</span></span>`
          + '<span class="cmp-unir-btn">Unir</span></button>').join('')
        : '<div class="cmp-nada">No encontré otro cliente con ese nombre.</div>';
      ponerAvatares(el);
    } catch (e) {
      if (id === busquedaUnir) el.innerHTML = '<div class="cmp-nada">No pude buscar. Revisá la conexión.</div>';
    }
  }
  // Confeti para el cliente del mes: la primera vez que la tarjeta aparece en pantalla
  // (una vez por mes y por sesión) y cada vez que se la toca.
  const festejados = new Set();
  function tirarConfeti(el) {
    if (!el || typeof root.confetti !== 'function') return;
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    root.confetti({particleCount: 90, spread: 75, startVelocity: 32, zIndex: 100000,
      origin: {x: (r.left + r.width / 2) / root.innerWidth, y: Math.max(0.1, (r.top + r.height / 3) / root.innerHeight)},
      colors: ['#fbbf24', '#ff6b9a', '#8b7bff', '#34d399', '#38bdf8']});
  }
  function festejar(card, a) {
    if (!card || !a.estrella || typeof root.IntersectionObserver !== 'function') return;
    const k = `${a.desde}|${clave(a.estrella.nombre)}`;
    if (festejados.has(k)) return;
    const obs = new root.IntersectionObserver(entradas => {
      if (!entradas.some(e => e.isIntersecting) || festejados.has(k)) return;
      obs.disconnect();
      festejados.add(k);
      tirarConfeti(card);
    }, {threshold: 0.6});
    obs.observe(card);
  }
  function estado(html, tipo = '') {
    const el = root.document && root.document.getElementById('cmpEstado');
    if (!el) return;
    el.className = 'cmp-estado' + (tipo ? ' is-' + tipo : '');
    el.innerHTML = html;
  }
  let pedidoAnalisis = 0;
  async function mostrarCobertura(mes, conEstado = true) {
    const r = rangoMes(mes), id = ++pedidoAnalisis;
    try {
      const filas = await root.histSbSelectAll(`${TABLA}?select=${CAMPOS}&fecha=gte.${sumarDias(r.desde, -VENTANA_DIAS)}&fecha=lte.${r.hasta}&order=pago_id.asc`);
      const aj = await cargarAjustes();
      if (id !== pedidoAnalisis) return;
      const delMes = filas.filter(f => f.fecha >= r.desde).length;
      if (conEstado) estado(delMes ? `En ${r.nombre} hay <b>${$(delMes)}</b> cobros con el nombre de quién pagó.` : `Todavía no cargaste el reporte de ${r.nombre}.`);
      // Los números del mes ya vienen sin los que no se cuentan y con los nombres unidos.
      const a = delMes ? analizarClientes(aplicarAjustes(filas, aj), r.desde, r.hasta) : null, el = root.document.getElementById('cmpAnalisis');
      ultimoAnalisis = a;
      if (!el) return;
      const anterior = new Date(mes.getFullYear(), mes.getMonth() - 1, 1).toLocaleDateString('es-AR', {month: 'long'});
      el.innerHTML = a ? analisisHtml(a, anterior, aj) : '';
      if (a) { decorar(el); festejar(root.document.getElementById('cmpEstrella'), a); }
      const mas = root.document.getElementById('cmpVerMas');
      if (mas) mas.addEventListener('click', () => {
        const abierto = root.document.getElementById('cmpRanking').classList.toggle('is-abierto');
        mas.setAttribute('aria-expanded', String(abierto));
        if (abierto) decorar(root.document.getElementById('cmpRanking'));
        mas.textContent = abierto ? 'Ver menos' : `Ver los ${Math.min(MAS, a.ranking.length)}`;
      });
    } catch (e) {
      if (id !== pedidoAnalisis || !conEstado) return;
      estado(tablaFaltante(e) ? 'Falta un paso: crear la tabla <b>mp_pagadores</b> en Supabase.' : 'No pude consultar los clientes. Revisá la conexión.', 'error');
    }
  }
  // metMes es el mes que se está mirando en Métricas (variable global de index.html).
  // eslint-disable-next-line no-undef
  const mesVisto = () => typeof metMes !== 'undefined' && metMes instanceof Date ? new Date(metMes) : new Date();
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
      const clientes = new Set(resumen.filas.map(f => clave(f.nombre))).size;
      estado(`Listo: <b>${$(resumen.filas.length)}</b> cobros con nombre del ${fechaCorta(resumen.desde)} al ${fechaCorta(resumen.hasta)}, de <b>${$(clientes)}</b> clientes distintos.`
        + `<small>${resumen.sinNombre === 1 ? '1 cobro viene' : `${$(resumen.sinNombre)} cobros vienen`} sin nombre en el reporte (casi siempre pagos con tarjeta).`
        + (enApp != null ? ` ${$(enApp)} de ${$(resumen.filas.length)} coinciden con los cobros que tiene la app.` : '') + '</small>', 'ok');
      await mostrarCobertura(mesVisto(), false);
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
    const card = doc.getElementById('metClientes');
    doc.getElementById('cmpArchivo').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) subir(f); });
    let espera = null;
    doc.getElementById('cmpBuscar').addEventListener('input', e => { clearTimeout(espera); const v = e.target.value; espera = setTimeout(() => buscar(v), 300); });
    card.addEventListener('click', e => {
      if (e.target.closest('.cmp-ficha-cerrar')) {
        cerrarFicha();
        const res = doc.getElementById('cmpResultados'), q = doc.getElementById('cmpBuscar').value;
        if (res) res.hidden = false;
        // Por si se tocó algo en la ficha (no contar, unir), la lista se arma de nuevo.
        if (q.trim()) buscar(q);
        return;
      }
      const acc = e.target.closest('[data-accion]');
      if (acc) { accionFicha(acc); return; }
      const cli = e.target.closest('[data-cliente]');
      if (!cli) return;
      if (cli.id === 'cmpEstrella') tirarConfeti(cli);
      abrirFicha(cli.dataset.cliente, cli.closest('#cmpResultados') ? 'busqueda' : 'lista');
    });
    let esperaUnir = null;
    card.addEventListener('input', e => {
      if (e.target.id !== 'cmpUnirBuscar') return;
      clearTimeout(esperaUnir);
      const v = e.target.value;
      esperaUnir = setTimeout(() => buscarParaUnir(v), 300);
    });
    mostrarCobertura(mesVisto());
  }
  // Atajo al lado del título de Métricas: la tarjeta queda al fondo y así se llega de un toque.
  // El cartel "Nueva sección" se va solo a fin de octubre.
  const NUEVA_HASTA = '2026-10-31';
  function ponerAtajo() {
    const doc = root.document, titulo = doc && doc.querySelector('#metricasOverlay .historial-title');
    if (!titulo || doc.getElementById('cmpAtajo')) return;
    const nueva = hoyAR() <= NUEVA_HASTA;
    titulo.insertAdjacentHTML('afterend', `<button type="button" class="cmp-atajo" id="cmpAtajo" title="Ir a Clientes de Mercado Pago">`
      + `<span class="cmp-atajo-ico" aria-hidden="true"></span>Clientes${nueva ? '<span class="cmp-atajo-nueva">Nueva sección</span>' : ''}</button>`);
    doc.getElementById('cmpAtajo').addEventListener('click', () => {
      const card = doc.getElementById('metClientes');
      if (card) card.scrollIntoView({behavior: 'smooth', block: 'start'});
    });
  }
  // Se engancha a Métricas sin tocar su código: después de cada dibujo, agrega la tarjeta.
  if (root.document && typeof root.metRender === 'function') {
    const dibujar = root.metRender;
    root.metRender = function() { const r = dibujar.apply(this, arguments); ponerAtajo(); pintarTarjeta(); return r; };
    ponerAtajo();
  }
  return {parsearReporte, guardar, coincidencias, montoDe, fechaHoraAR, tablaFaltante, tarjetaHtml, nombreVisible, consultaBusqueda,
    filtrarPorNombre, agruparClientes, analizarClientes, fichaCliente, franjaDe, sumarDias, patronNombre, clave,
    normalizarAjustes, principalDe, aplicarAjustes};
});
