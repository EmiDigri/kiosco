// TEMPORAL — lista de nombres de proveedores/egresos reales para mapear logos. Solo lectura. Borrar después.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'prov-8c4d1a';
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
    const [gastos, salidas] = await Promise.all([
      all('gastos_caja?select=nombre,monto&order=nombre.asc'),
      all('pagos?select=nombre,monto&es_enviada=eq.true&order=nombre.asc'),
    ]);
    const agrupar = rows => {
      const m = {};
      rows.forEach(r => { const k = String(r.nombre || '').trim(); (m[k] = m[k] || { n: 0, total: 0 }); m[k].n++; m[k].total += Math.abs(Number(r.monto) || 0); });
      return Object.entries(m).map(([nombre, v]) => ({ nombre, n: v.n, total: Math.round(v.total) })).sort((a, b) => b.total - a.total);
    };
    res.status(200).json({ gastos: agrupar(gastos), salidasMP: agrupar(salidas) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
