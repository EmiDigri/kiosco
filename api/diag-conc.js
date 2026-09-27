// TEMPORAL / ADMIN (Claude, a pedido de digra): trae gastos_caja, salidas de MP y
// cierres de septiembre 2026 para revisar la conciliacion cuaderno vs MP (1 a 1).
// Solo lectura. Gated por ?k=<secreto>. Service key (bypassa RLS). BORRAR despues de usar.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'cc4-conc-Qw7p';
const svc = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }, extra || {});
const get = path => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc() }).then(r => r.json()).catch(e => ({ error: e.message }));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(503).json({ error: 'sin service key' });
  const rango = 'fecha=gte.2026-09-01&fecha=lte.2026-09-30';
  try {
    const [salidas, gastos, cierres] = await Promise.all([
      get(`pagos?select=pago_id,fecha,hora,monto,nombre,tipo,operation_type,status,devuelta,excluido&es_enviada=eq.true&${rango}&order=fecha.asc,hora.asc&limit=5000`),
      get(`gastos_caja?select=*&${rango}&order=fecha.asc&limit=5000`),
      get(`cierres_caja?select=*&${rango}&order=fecha.asc,turno.asc&limit=5000`),
    ]);
    return res.status(200).json({ salidas, gastos, cierres });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
