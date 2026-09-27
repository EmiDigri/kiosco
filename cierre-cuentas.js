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
  function conceptoGasto(value) {
    const text = String(value || '').trim();
    if (/^pago\s+(?:de|producto\s+de)$/i.test(text) || /^pago\s+f[a\u00e1]cil(?:\s|$)/i.test(text)) return text;
    return text.replace(/^pago\s+(?:producto\s+de\s+|de\s+)?/i, '') || text;
  }
  async function idGastoFoto(dia, gasto, occurrence) {
    const key = JSON.stringify([dia, nombre(gasto.nombre), monto(gasto.monto), occurrence]);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return 'g_foto_' + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const unicos = (rows, keyOf) => {
    const seen = new Set();
    return (rows || []).filter(row => {
      const key = keyOf(row);
      if (key == null) return true;
      if (seen.has(String(key))) return false;
      seen.add(String(key)); return true;
    });
  };
  // Palabras que no identifican a un proveedor ("Pago Producto de Coca-Cola FEMSA de
  // Buenos Aires S.A." tiene que coincidir con "Coca" por "coca", no por "pago").
  const RELLENO = new Set(['pago', 'producto', 'del', 'las', 'los', 'con', 'transferencia', 'enviada', 'sac', 'srl', 'buenos', 'aires', 'varios']);
  const tokensProveedor = text => nombre(text).split(' ').filter(t => t.length >= 3 && !RELLENO.has(t));
  // Empareja 1 a 1 los gastos del cuaderno con las salidas de MP. Un gasto y una salida
  // son el mismo pago si son del MISMO día (en septiembre 2026 los 12 pares reales lo
  // fueron; un día de diferencia no alcanza para asumir que es el mismo pago) y además:
  //   - tienen el mismo importe (redondeando centavos: MP los trae, el cuaderno no), o
  //   - nombran al mismo proveedor y el importe difiere poco (hasta 25%: un error de
  //     tipeo como Edenor anotado 418.409 y pagado 481.408,07).
  // Cada salida cubre a lo sumo UN gasto y cada gasto a lo sumo UNA salida: nunca una
  // salida de Arcor tapa todos los Arcor del mes. Se asignan primero los pares más
  // seguros (importe + nombre). `ambiguo` marca empates que no se pueden
  // resolver (dos gastos idénticos para una sola salida: ¿dos compras o uno repetido?).
  function emparejarGastos(gastos, salidas) {
    const pares = [];
    gastos.forEach((g, gi) => {
      const a = Math.abs(Number(g.monto)), dg = String(g.fecha || '').slice(0, 10), tg = tokensProveedor(g.nombre);
      if (!(a > 0)) return;
      salidas.forEach((p, si) => {
        const b = Math.abs(Number(p.monto)), dp = String(p.fecha || '').slice(0, 10);
        if (!(b > 0) || (dg && dp && dg !== dp)) return;
        const dif = Math.abs(a - b);
        const mismoImporte = dif < 1;
        const tp = tokensProveedor(p.nombre);
        const mismoNombre = tg.some(t => tp.includes(t));
        if (!mismoImporte && !(mismoNombre && dif <= Math.max(a, b) * .25)) return;
        pares.push({gi, si, puntos:(mismoImporte ? 2 : 0) + (mismoNombre ? 1 : 0), dif});
      });
    });
    pares.sort((x, y) => y.puntos - x.puntos || x.dif - y.dif || x.gi - y.gi || x.si - y.si);
    const deGasto = new Map(), deSalida = new Map();
    pares.forEach(par => {
      if (deGasto.has(par.gi) || deSalida.has(par.si)) return;
      deGasto.set(par.gi, par); deSalida.set(par.si, par);
    });
    const ambiguos = new Set();
    pares.forEach(par => {
      const ganador = deSalida.get(par.si);
      if (!ganador || ganador.gi === par.gi || deGasto.has(par.gi)) return;
      const empate = par.puntos === ganador.puntos && par.dif === ganador.dif;
      if (empate) { ambiguos.add(par.gi); ambiguos.add(ganador.gi); }
    });
    return gastos.map((g, gi) => {
      const par = deGasto.get(gi);
      return par ? {pago:salidas[par.si], ambiguo:ambiguos.has(gi)} : {pago:null, ambiguo:ambiguos.has(gi)};
    });
  }
  function conciliarGastos(gastos, pagos, disponible = true) {
    // Match one expense to one outgoing payment; never add the payment a second time.
    // NOTA (cambio pedido por digra 9/9/2026, hecho por Claude, NO por Codex): los
    // textos de `medio` se simplificaron a solo el medio de pago (Efectivo / MP)
    // porque "Efectivo presunto" / "MP coincidente" confundian al usuario. La logica
    // de `medio` no cambio, solo el `texto` visible. Codex: si tocas esto, incorpora
    // el cambio (mantene los textos simples Efectivo / MP).
    if (!disponible) return gastos.map(() => ({medio:'pendiente', texto:'Sin consultar'}));
    const salidas = unicos((pagos || []).filter(salida), p => p.pago_id ?? p.id);
    return emparejarGastos(gastos, salidas).map(par => {
      if (par.ambiguo) return {medio:'revisar', texto:'MP'};
      if (!par.pago) return {medio:'efectivo', texto:'Efectivo'};
      return {medio:'mp', texto:'MP', pago:par.pago};
    });
  }
  // Egresos del mes sin contar dos veces lo que está en el cuaderno Y en MP: todas las
  // salidas de MP (con su importe real) + los gastos del cuaderno que ninguna salida
  // cubre. Cada salida emparejada trae su gasto del cuaderno (`gasto`) para nombrarla
  // como la anotaron en el kiosco ("Pepsico" en vez de "Transferencia enviada").
  function conciliarMes(gastos, pagos) {
    const registrados = unicos(gastos, g => g.uid ?? g.id).filter(g => Number(g.monto) > 0);
    const salidas = unicos((pagos || []).filter(salida), p => p.pago_id ?? p.id).filter(p => Math.abs(Number(p.monto)) > 0);
    const cubre = new Map(), efectivo = [];
    emparejarGastos(registrados, salidas).forEach((par, i) => {
      if (par.pago) cubre.set(par.pago, registrados[i]);
      else efectivo.push(registrados[i]);
    });
    return {
      efectivo,
      salidas: salidas.map(p => ({...p, monto:Math.abs(Number(p.monto)), gasto:cubre.get(p) || null})),
    };
  }
  function resumenGastosDia(gastos, pagos, disponible = true) {
    const registrados = unicos(gastos, g => g.uid ?? g.id).filter(g => monto(g.monto) !== null);
    const salidas = unicos((pagos || []).filter(salida), p => p.pago_id ?? p.id)
      .filter(p => monto(Math.abs(Number(p.monto))) !== null);
    const medios = conciliarGastos(registrados, salidas);
    const usados = new Set();
    let porRevisar = false;
    const filas = registrados.map((g, i) => {
      const medio = medios[i];
      if (medio.medio === 'revisar' || (medio.pago && usados.has(medio.pago))) porRevisar = true;
      if (medio.pago) usados.add(medio.pago);
      const fila = {...g, monto:monto(g.monto), medio:medio.medio, origen:'cuaderno'};
      // Si por MP salió otro importe (error al anotar: Edenor 418.409 anotado, 481.408,07
      // pagado) cuenta lo que salió de verdad, igual que Métricas, y se guarda lo anotado
      // para mostrarlo. El registro del cuaderno no se toca.
      const real = medio.pago ? monto(Math.abs(Number(medio.pago.monto))) : null;
      if (real !== null && Math.abs(real - fila.monto) >= 1) { fila.anotado = fila.monto; fila.monto = real; }
      return fila;
    });
    salidas.filter(p => !usados.has(p)).forEach(p => {
      filas.push({...p, monto:Math.abs(Number(p.monto)), medio:'mp', origen:'mp'});
    });
    // An ambiguous match cannot produce a reliable total without counting a payment twice.
    const total = porRevisar ? null : filas.reduce((sum, g) => sum + Math.round(g.monto * 100), 0) / 100;
    return {total, filas, porRevisar, local:!disponible};
  }
  function validarFoto(foto, mpPorTurno, dia, gastosCaja = {}) {
    const errores = [], diferencias = [];
    if (!fecha(dia, dia)) errores.push('Falta una fecha valida.');
    const expected = turnos(dia);
    if (!Array.isArray(foto.turnos) || foto.turnos.length !== expected.length) errores.push(`Este dia necesita ${expected.length} turnos. Revisa si falta parte de la foto.`);
    (foto.turnos || []).forEach((t, i) => {
      const label = expected[i] || `Turno ${i + 1}`;
      const campos = {cierre:'Cierre total', mp:'MP del cuaderno', mpo:'MPO', once:'Once'};
      for (const f of Object.keys(campos)) if (monto(t[f]) === null) errores.push(`${label}: revisa ${campos[f]}.`);
      if (monto(t.mp) !== null && monto(t.cierre) !== null && t.mp > t.cierre) errores.push(`${label}: MP del cuaderno supera el Cierre total. Revisa esos importes.`);
      if (monto(t.mp) !== null && monto(t.mpo) !== null && t.mpo > t.mp) errores.push(`${label}: MPO supera MP del cuaderno. Revisa las columnas.`);
      if (monto(t.cierre) === null || monto(t.once) === null) return;
      if (monto(t.mp) !== null && t.mp + t.once > t.cierre) errores.push(`${label}: MP y Once del cuaderno superan el Cierre total.`);
      const mp = monto(mpPorTurno?.[label]);
      if (mp === null) { errores.push(`${label}: falta consultar MP.`); return; }
      if (t.cierre - mp - t.once - (Number(gastosCaja[label]) || 0) < 0) errores.push(`${label}: el efectivo calculado es negativo.`);
      if (monto(t.mp) !== null && Math.abs(t.mp - mp) > .005) diferencias.push(label);
      if (monto(t.mpo) !== null && t.mpo > mp) errores.push(`${label}: MPO no puede superar MP.`);
    });
    const suma = (foto.turnos || []).reduce((s, t) => s + (monto(t.cierre) || 0), 0);
    if (monto(foto.total_dia) !== null && (foto.turnos || []).every(t => monto(t.cierre) !== null) && Math.abs(suma - foto.total_dia) > .005) {
      const pesos = n => '$' + Number(n).toLocaleString('es-AR');
      errores.push(`Los cierres suman ${pesos(suma)}; el total escrito es ${pesos(foto.total_dia)}. Diferencia: ${pesos(Math.abs(suma-foto.total_dia))}. Revisa los importes, no los ajustes solo para que coincidan.`);
    }
    (foto.gastos || []).forEach((g, i) => {
      if (!String(g.nombre || '').trim() || monto(g.monto) === null || Number(g.monto) <= 0) errores.push(`Gasto ${i + 1}: completa concepto e importe, o quita el renglon.`);
    });
    return {errores, diferencias, suma};
  }
  function resumenMes(dias, desde, hasta) {
    let total = 0, mp = 0, efectivo = 0, once = 0, gastos = 0, cerrados = 0, esperados = 0, completos = 0, totalCompletos = 0;
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
        // Nota de Claude para Codex (25/9/2026): el Once del cierre es un INGRESO aparte
        // (efectivo que entra por regalos; NO es el gasto "Once" de compra de mercadería).
        // Se devuelve en `once` para mostrarlo por separado. `efectivo` lo sigue incluyendo
        // a propósito, así no cambia nada de lo que ya lo usaba (mp + efectivo = total).
        once += Number(c.once_monto ?? c.once) || 0;
      });
      mp += mpDia;
      gastos += (data?.gastos || []).reduce((s, g) => s + (monto(g.monto) || 0), 0);
      if (completo(data, dia)) { completos++; totalCompletos += totalDia(data); }
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return {total, mp, efectivo, once, gastos, resultado:total - gastos, cerrados, esperados, completos, totalCompletos};
  }
  return {monto, fecha, ingreso, salida, totalCierre, totalDia, completo, turnos, nombre, conceptoGasto, idGastoFoto, emparejarGastos, conciliarGastos, conciliarMes, resumenGastosDia, validarFoto, resumenMes};
});
