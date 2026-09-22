// TEMPORAL — diagnóstico de septiembre 2026 + aprendizaje. Borrar después de usar.
// Lectura con service key (bypassa RLS), gateado por ?k=<secreto>.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'sep-9f3a2c';
const DESDE = '2026-09-01', HASTA = '2026-09-30';

async function fetchAll(path) {
  const out = [];
  let offset = 0;
  const page = 1000;
  for (;;) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=${page}&offset=${offset}`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < page) break;
    offset += page;
  }
  return out;
}
const num = v => Math.abs(Number(v) || 0);
const truthy = v => v === true || v === 'true';

export default async function handler(req, res) {
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(500).json({ error: 'sin service key' });
  try {
    const [cierres, gastos, pagos, learn] = await Promise.all([
      fetchAll(`cierres_caja?select=fecha,turno,total_turno,mp,efectivo,once_monto,mpo,gastos_caja&fecha=gte.${DESDE}&fecha=lte.${HASTA}&order=fecha.asc`),
      fetchAll(`gastos_caja?select=fecha,nombre,monto,caja,turno&fecha=gte.${DESDE}&fecha=lte.${HASTA}&order=fecha.asc`),
      fetchAll(`pagos?select=fecha,hora,turno,monto,tipo,es_enviada,excluido,devuelta,status&fecha=gte.${DESDE}&fecha=lte.${HASTA}&order=fecha.asc`),
      fetchAll(`app_learn?select=clave,valor&clave=in.(pulse_learn_v1,hist_mes_learn)`),
    ]);

    // ── Cierres / facturación ──
    let facturacion = 0, mpCuaderno = 0;
    const porTurno = {}, porDia = {};
    cierres.forEach(c => {
      const t = num(c.total_turno);
      facturacion += t; mpCuaderno += num(c.mp);
      (porTurno[c.turno] = porTurno[c.turno] || { sum: 0, count: 0 }).sum += t;
      porTurno[c.turno].count++;
      porDia[c.fecha] = (porDia[c.fecha] || 0) + t;
    });
    // Facturación por día de semana (0=Dom): promedio por día.
    const dow = {};
    Object.entries(porDia).forEach(([f, v]) => {
      const d = new Date(`${f}T12:00:00Z`).getUTCDay();
      (dow[d] = dow[d] || { sum: 0, dias: 0 }).sum += v; dow[d].dias++;
    });
    const dowProm = {};
    Object.entries(dow).forEach(([d, o]) => dowProm[d] = { prom: Math.round(o.sum / o.dias), dias: o.dias, total: o.sum });
    const dias = Object.entries(porDia).map(([f, v]) => ({ f, v })).sort((a, b) => b.v - a.v);

    // ── Gastos del cuaderno ──
    let gastosTotal = 0;
    const gxNombre = {};
    gastos.forEach(g => { const m = num(g.monto); gastosTotal += m; (gxNombre[g.nombre] = gxNombre[g.nombre] || { sum: 0, n: 0 }).sum += m; gxNombre[g.nombre].n++; });
    const gastosTop = Object.entries(gxNombre).map(([nombre, o]) => ({ nombre, sum: o.sum, n: o.n })).sort((a, b) => b.sum - a.sum);

    // ── MP ingresos (pulso) ──
    const esIngreso = p => !truthy(p.es_enviada) && !truthy(p.excluido) && !truthy(p.devuelta) && (!p.status || p.status === 'approved');
    const ingresos = pagos.filter(esIngreso);
    let mpTotal = 0; const mpTurno = {}, mpHora = {}, mpTipo = {};
    ingresos.forEach(p => {
      const m = num(p.monto); mpTotal += m;
      (mpTurno[p.turno] = mpTurno[p.turno] || { sum: 0, n: 0 }).sum += m; mpTurno[p.turno].n++;
      const hh = String(p.hora || '').slice(0, 2); if (hh) (mpHora[hh] = mpHora[hh] || { sum: 0, n: 0 }), mpHora[hh].sum += m, mpHora[hh].n++;
      (mpTipo[p.tipo] = mpTipo[p.tipo] || { sum: 0, n: 0 }).sum += m; mpTipo[p.tipo].n++;
    });
    const ticket = ingresos.length ? Math.round(mpTotal / ingresos.length) : 0;

    // ── Salidas MP ──
    const salidas = pagos.filter(p => truthy(p.es_enviada) && !truthy(p.devuelta))
      .map(p => ({ nombre: (p.nombre || p.tipo || '').toString(), monto: num(p.monto), fecha: p.fecha }))
      .sort((a, b) => b.monto - a.monto);
    const salidasTotal = salidas.reduce((a, s) => a + s.monto, 0);

    // ── Aprendizaje ──
    const learnByKey = {}; learn.forEach(r => learnByKey[r.clave] = r.valor);
    const pulse = learnByKey.pulse_learn_v1 || {};
    const pulseResumen = Object.entries(pulse).map(([key, rec]) => {
      const errs = (rec && rec.errs) || [], bias = (rec && rec.bias) || [];
      const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
      return { key, nCierres: errs.length, errMed: med(errs), biasMed: med(bias), pendientes: rec && rec.log ? Object.keys(rec.log).length : 0 };
    }).sort((a, b) => b.nCierres - a.nCierres);

    res.status(200).json({
      rango: { DESDE, HASTA },
      cuenta: { cierres: cierres.length, gastos: gastos.length, pagos: pagos.length, ingresos: ingresos.length },
      facturacion, mpCuaderno, mpTotal, ticket,
      porTurno, dowProm,
      diasTop: dias.slice(0, 5), diasBottom: dias.slice(-5),
      mpTurno, mpTipo,
      mpHora: Object.fromEntries(Object.entries(mpHora).sort((a, b) => a[0].localeCompare(b[0])).map(([h, o]) => [h, { sum: o.sum, n: o.n }])),
      gastos: { total: gastosTotal, count: gastos.length, top: gastosTop },
      salidas: { total: salidasTotal, count: salidas.length, lista: salidas },
      aprendizaje: { pulse: pulseResumen, hist_mes: learnByKey.hist_mes_learn || null },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
