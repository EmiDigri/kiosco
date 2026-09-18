// TEMPORAL / ADMIN (Claude, a pedido de digra): lista y renombra gastos de gastos_caja
// para corregir errores de OCR en el nombre (ej "Paz"->"Raz" Cigarrillos). Gated por
// ?k=<secreto>. Usa la service key del servidor (bypassa RLS). BORRAR despues de usar.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'gz7-gasto-fix-Qm4x';
const svc = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }, extra || {});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(503).json({ error: 'sin service key' });
  const op = req.query.op || 'list';
  try {
    if (op === 'list') {
      const q = String(req.query.q || '');
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?select=*&nombre=ilike.*${encodeURIComponent(q)}*&order=fecha.asc&limit=100`, { headers: svc() });
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
      return res.status(r.ok ? 200 : 502).json({ op, ok: r.ok, updated: Array.isArray(rows) ? rows.length : 0, rows });
    }
    return res.status(400).json({ error: 'op invalido' });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
