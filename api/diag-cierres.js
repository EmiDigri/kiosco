// TEMPORAL / ADMIN (Claude, a pedido de digra): trae los cierres de septiembre para ver
// qué turnos faltan cerrar. Gated por ?k=<secreto>. Service key. BORRAR despues.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'cc5-cierres-Yt3n';
const svc = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }, extra || {});
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(503).json({ error: 'sin service key' });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/cierres_caja?select=fecha,turno,total_turno&fecha=gte.2026-09-01&fecha=lte.2026-09-30&order=fecha.asc,turno.asc&limit=2000`, { headers: svc() });
    const rows = await r.json().catch(() => []);
    return res.status(200).json({ cierres: Array.isArray(rows) ? rows : [] });
  } catch (e) { return res.status(502).json({ error: e.message }); }
}
