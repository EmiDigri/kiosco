// TEMPORAL - diagnostico mensual de lo que capturo la app (MP + cierres).
// Protegido por clave al azar. BORRAR despues de usar.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'f9021853f533a6af46f8d44f1fab913143c711b46ad1afb3';

async function fetchAll(path) {
  const out = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${offset}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
    if (offset > 80000) break;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.query.k !== SECRET) return res.status(404).json({ error: 'not found' });
  if (!KEY) return res.status(503).json({ error: 'no service key' });
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? req.query.year : '2026';
  try {
    const pagos = await fetchAll(`pagos?fecha=gte.${year}-01-01&fecha=lte.${year}-12-31&select=fecha,monto,es_enviada,status,tipo&order=fecha.asc`);
    const cierres = await fetchAll(`cierres_caja?fecha=gte.${year}-01-01&fecha=lte.${year}-12-31&select=fecha,turno,total_turno,efectivo,mp&order=fecha.asc`);
    const meses = {};
    const M = m => meses[m] || (meses[m] = { mp: 0, movs: 0, transfer: 0, point: 0, salidas: 0, caja: 0, efectivo: 0, cierres: 0, _dias: {} });
    for (const p of pagos) {
      const m = Number(String(p.fecha).slice(5, 7)); if (!m) continue;
      const x = M(m); const monto = Number(p.monto) || 0;
      if (p.es_enviada === true) { x.salidas += monto; continue; }
      if (p.status && p.status !== 'approved') continue;
      x.mp += monto; x.movs++; x._dias[p.fecha] = 1;
      if (p.tipo === 'Venta Point') x.point += monto; else x.transfer += monto;
    }
    for (const c of cierres) {
      const m = Number(String(c.fecha).slice(5, 7)); if (!m) continue;
      const x = M(m); x.caja += Number(c.total_turno) || 0; x.efectivo += Number(c.efectivo) || 0; x.cierres++;
    }
    const salida = Object.keys(meses).map(Number).sort((a, b) => a - b).map(m => {
      const x = meses[m];
      return { mes: m, mp: x.mp, movs: x.movs, transfer: x.transfer, point: x.point, salidas: x.salidas, caja: x.caja, efectivo: x.efectivo, cierres: x.cierres, diasConMp: Object.keys(x._dias).length };
    });
    return res.status(200).json({ year, totalPagos: pagos.length, totalCierres: cierres.length, meses: salida });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
