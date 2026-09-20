// TEMPORAL / ADMIN (Claude, a pedido de digra): agrupar duplicados obvios de gastos_caja
// (may/min/acento). Gated por ?k=<secreto>. Service key (bypassa RLS). BORRAR despues.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'gz7-gasto-fix-Qm4x';
const svc = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }, extra || {});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(503).json({ error: 'sin service key' });
  const op = req.query.op || 'all';
  try {
    if (op === 'all') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?select=id,fecha,nombre,monto&order=nombre.asc&limit=3000`, { headers: svc() });
      const rows = await r.json().catch(() => []);
      return res.status(r.ok ? 200 : 502).json({ op, ok: r.ok, count: Array.isArray(rows) ? rows.length : 0, rows });
    }
    if (op === 'rename') {
      const from = String(req.query.from || ''), to = String(req.query.to || '');
      if (!from || !to) return res.status(400).json({ error: 'faltan from/to' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?nombre=eq.${encodeURIComponent(from)}`, {
        method: 'PATCH',
        headers: svc({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify({ nombre: to }),
      });
      const rows = await r.json().catch(() => []);
      return res.status(r.ok ? 200 : 502).json({ op, ok: r.ok, updated: Array.isArray(rows) ? rows.length : 0 });
    }
    return res.status(400).json({ error: 'op invalido' });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
