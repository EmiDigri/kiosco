(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CierreCuentas = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';
  function monto(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    let text = String(value).trim().replace(/^\$\s*/, '');
    if (!text) return null;
    if (typeof value === 'string') {
      if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
      else if (/^\d+(,\d{1,2})?$/.test(text)) text = text.replace(',', '.');
      else if (!/^\d+\.\d{1,2}$/.test(text)) return null;
    }
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }
  function fecha(value, reference) {
    const raw = String(value || '').trim();
    let parts;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) parts = raw.split('-').map(Number);
    else {
      const match = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
      if (!match) return null;
      const year = match[3] ? Number(match[3]) + (match[3].length === 2 ? 2000 : 0) : Number(String(reference).slice(0, 4));
      parts = [year, Number(match[2]), Number(match[1])];
    }
    const [y, m, d] = parts, date = new Date(Date.UTC(y, m - 1, d));
    if (y < 2000 || y > 2100 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const verdad = value => value === true || value === 'true';
  const valido = p => p && !verdad(p.devuelta) && !p.excluido && (!p.status || p.status === 'approved');
  const ingreso = p => valido(p) && !verdad(p.es_enviada) && Number(p.monto) >= 0;
  const salida = p => valido(p) && verdad(p.es_enviada);
  function totalCierre(c, gastosCaja = 0) {
    const total = monto(c.total_turno);
    return total !== null ? total : (Number(c.mp) || 0) + (Number(c.efectivo) || 0) + (Number(c.once_monto ?? c.once) || 0) + gastosCaja;
  }
  function turnos(dia) {
    return new Date(`${dia}T12:00:00-03:00`).getDay() === 0 ? ['Turno 1', 'Turno 2'] : ['Vale', 'Ani', 'Marta'];
  }
  function totalDia(data) {
    if (!data) return 0;
    let total = Number(data.mpTotal) || 0;
    const cierres = new Map((data.cierres || []).map(c => [c.turno, c]));
    cierres.forEach(c => { total += totalCierre(c, Number(c.gastos_caja) || 0) - (Number(data.turnos?.[c.turno]?.mp) || 0); });
    return total;
  }
  function completo(data, dia) {
    return turnos(dia).every(t => (data?.cierres || []).some(c => c.turno === t && monto(c.total_turno) !== null));
  }
  const nombre = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  async function idGastoFoto(dia, gasto, occurrence) {
    const key = JSON.stringify([dia, nombre(gasto.nombre), monto(gasto.monto), occurrence]);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return 'g_foto_' + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function conciliarGastos(gastos, pagos, disponible = true) {
    // Match one expense to one outgoing payment; never add the payment a second time.
    const seen = new Set();
    const salidas = (pagos || []).filter(salida).filter(p => {
      const key = p.pago_id ?? p.id;
      if (key == null) return true;
      if (seen.has(String(key))) return false;
      seen.add(String(key)); return true;
    });
    return gastos.map(g => {
      if (!disponible) return {medio:'pendiente', texto:'MP sin consultar'};
      const mismaFecha = p => !g.fecha || !p.fecha || g.fecha === p.fecha;
      const candidates = salidas.filter(p => mismaFecha(p) && Math.abs(Math.abs(Number(p.monto)) - Number(g.monto)) < .005);
      if (!candidates.length) return {medio:'efectivo', texto:'Efectivo presunto'};
      const competing = gastos.filter(x => (!g.fecha || !x.fecha || g.fecha === x.fecha) && monto(x.monto) === monto(g.monto));
      const tokens = nombre(g.nombre).split(' ').filter(t => t.length >= 3);
      const named = candidates.filter(p => tokens.some(t => nombre(p.nombre).split(' ').includes(t)));
      const uniqueNamed = named.length === 1 && competing.filter(x => nombre(x.nombre).split(' ').filter(t => t.length >= 3).some(t => nombre(named[0].nombre).split(' ').includes(t))).length === 1;
      if (uniqueNamed || (candidates.length === 1 && competing.length === 1)) {
        return {medio:'mp', texto:uniqueNamed ? 'MP coincidente' : 'MP probable: mismo importe', pago:named[0] || candidates[0]};
      }
      return {medio:'revisar', texto:'Varias coincidencias en MP'};
    });
  }
  function validarFoto(foto, mpPorTurno, dia, gastosCaja = {}) {
    const errores = [], diferencias = [];
    if (!fecha(dia, dia)) errores.push('Falta una fecha valida.');
    const expected = turnos(dia);
    if (!Array.isArray(foto.turnos) || foto.turnos.length !== expected.length) errores.push(`Este dia necesita ${expected.length} turnos. Revisa si falta parte de la foto.`);
    (foto.turnos || []).forEach((t, i) => {
      const label = expected[i] || `Turno ${i + 1}`;
      for (const f of ['cierre', 'mp', 'once', 'mpo']) if (monto(t[f]) === null) errores.push(`${label}: completa ${f === 'mp' ? 'MP del cuaderno' : f}.`);
      if (monto(t.cierre) === null || monto(t.once) === null) return;
      const mp = monto(mpPorTurno?.[label]);
      if (mp === null) { errores.push(`${label}: falta consultar MP.`); return; }
      if (t.cierre - mp - t.once - (Number(gastosCaja[label]) || 0) < 0) errores.push(`${label}: el efectivo calculado es negativo.`);
      if (monto(t.mp) !== null && Math.abs(t.mp - mp) > .005) diferencias.push(label);
      if (monto(t.mpo) !== null && t.mpo > mp) errores.push(`${label}: MPO no puede superar MP.`);
    });
    const suma = (foto.turnos || []).reduce((s, t) => s + (monto(t.cierre) || 0), 0);
    if (monto(foto.total_dia) !== null && Math.abs(suma - foto.total_dia) > .005) errores.push('La suma de los cierres no coincide con el total del cuaderno.');
    (foto.gastos || []).forEach((g, i) => {
      if (!String(g.nombre || '').trim() || monto(g.monto) === null || Number(g.monto) <= 0) errores.push(`Gasto ${i + 1}: completa concepto e importe, o quita el renglon.`);
    });
    return {errores, diferencias, suma};
  }
  function resumenMes(dias, desde, hasta) {
    let total = 0, mp = 0, efectivo = 0, gastos = 0, cerrados = 0, esperados = 0, completos = 0, totalCompletos = 0;
    const date = new Date(`${desde}T12:00:00Z`);
    while (date.toISOString().slice(0, 10) <= hasta) {
      const dia = date.toISOString().slice(0, 10), data = dias[dia];
      const required = turnos(dia), closures = new Map((data?.cierres || []).map(c => [c.turno, c]));
      esperados += required.length;
      cerrados += required.filter(t => closures.has(t) && monto(closures.get(t).total_turno) !== null).length;
      total += totalDia(data);
      // The cash breakdown uses the MP snapshot belonging to each confirmed closing.
      let mpDia = Number(data?.mpTotal) || 0;
      closures.forEach(c => {
        mpDia += (Number(c.mp) || 0) - (Number(data?.turnos?.[c.turno]?.mp) || 0);
        efectivo += totalCierre(c, Number(c.gastos_caja) || 0) - (Number(c.mp) || 0);
      });
      mp += mpDia;
      gastos += (data?.gastos || []).reduce((s, g) => s + (monto(g.monto) || 0), 0);
      if (completo(data, dia)) { completos++; totalCompletos += totalDia(data); }
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return {total, mp, efectivo, gastos, resultado:total - gastos, cerrados, esperados, completos, totalCompletos};
  }
  return {monto, fecha, ingreso, salida, totalCierre, totalDia, completo, turnos, nombre, idGastoFoto, conciliarGastos, validarFoto, resumenMes};
});
