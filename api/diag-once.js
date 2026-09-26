// TEMPORAL — ¿el Once de los cierres aparece también como gasto? Solo lectura. Borrar después.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'once-5b2e8d';

async function all(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${offset}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export default async function handler(req, res) {
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  try {
    const [cierres, gastos, salidas] = await Promise.all([
      all('cierres_caja?select=fecha,turno,once_monto,total_turno,mp,efectivo&fecha=gte.2026-06-01&order=fecha.asc'),
      all('gastos_caja?select=fecha,nombre,monto&fecha=gte.2026-06-01&order=fecha.asc'),
      all('pagos?select=fecha,nombre,monto&es_enviada=eq.true&fecha=gte.2026-06-01&order=fecha.asc'),
    ]);
    const meses = {};
    const m = f => String(f).slice(0, 7);
    const mes = k => (meses[k] = meses[k] || { onceCierres: 0, diasConOnce: new Set(), facturacion: 0, gastosOnce: 0, gastosOnceN: 0, salidasOnce: 0, gastosTotal: 0 });
    cierres.forEach(c => { const x = mes(m(c.fecha)); const o = Number(c.once_monto) || 0; x.onceCierres += o; if (o > 0) x.diasConOnce.add(c.fecha); x.facturacion += Number(c.total_turno) || 0; });
    gastos.forEach(g => { const x = mes(m(g.fecha)); const v = Number(g.monto) || 0; x.gastosTotal += v; if (/once/i.test(g.nombre || '')) { x.gastosOnce += v; x.gastosOnceN++; } });
    salidas.forEach(s => { if (/once/i.test(s.nombre || '')) mes(m(s.fecha)).salidasOnce += Math.abs(Number(s.monto) || 0); });
    // Detalle de septiembre: por día, Once del cierre vs gastos "once" del cuaderno.
    const sep = {};
    cierres.filter(c => m(c.fecha) === '2026-09').forEach(c => { const d = (sep[c.fecha] = sep[c.fecha] || { cierre: 0, gasto: 0 }); d.cierre += Number(c.once_monto) || 0; });
    gastos.filter(g => m(g.fecha) === '2026-09' && /once/i.test(g.nombre || '')).forEach(g => { const d = (sep[g.fecha] = sep[g.fecha] || { cierre: 0, gasto: 0 }); d.gasto += Number(g.monto) || 0; });
    const nombresOnce = [...new Set(gastos.filter(g => /once/i.test(g.nombre || '')).map(g => g.nombre))];
    res.status(200).json({
      meses: Object.fromEntries(Object.entries(meses).map(([k, v]) => [k, { ...v, diasConOnce: v.diasConOnce.size }])),
      septiembrePorDia: Object.fromEntries(Object.entries(sep).filter(([, d]) => d.cierre || d.gasto).sort()),
      nombresGastoConOnce: nombresOnce,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
