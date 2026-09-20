// TEMPORAL / ADMIN (Claude, a pedido de digra): trae las salidas de MP (es_enviada) y
// los gastos_caja para conciliar y detectar gastos de MP no anotados en el cuaderno.
// Gated por ?k=<secreto>. Service key (bypassa RLS). BORRAR despues de usar.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'rc7-recon-Zx9m';
const svc = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }, extra || {});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(503).json({ error: 'sin service key' });
  try {
    const [sal, gas] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/pagos?select=fecha,hora,monto,nombre,tipo,operation_type,status,devuelta&es_enviada=eq.true&order=fecha.asc&limit=5000`, { headers: svc() }).then(r => r.json()).catch(() => []),
      fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?select=fecha,nombre,monto&order=fecha.asc&limit=5000`, { headers: svc() }).then(r => r.json()).catch(() => []),
    ]);
    return res.status(200).json({ salidas: Array.isArray(sal) ? sal : [], gastos: Array.isArray(gas) ? gas : [] });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
