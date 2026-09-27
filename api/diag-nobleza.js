// TEMPORAL / ADMIN (Claude, a pedido de digra 27/9/2026): carga UNA vez el gasto
// Nobleza $1.138.210 del 16/9 que falta en la app (esta en el Excel del socio).
// Mismo uid que generaria la foto del cierre: si se vuelve a leer, no se duplica.
// Si ya hay un Nobleza ese dia, no escribe nada. Gated por ?k=. BORRAR despues de usar.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'nb2-carga-Hx4r';
const GASTO = { uid: 'g_foto_cb665ae12f530f38b613a70ba206a4069186d7ee1f61ba6429fad0ac2c062550', fecha: '2026-09-16', nombre: 'Nobleza', monto: 1138210, caja: null, turno: null };
const svc = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, extra || {});
const dia = () => fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?select=uid,fecha,nombre,monto,caja,turno&fecha=eq.2026-09-16&order=created_at.asc`, { headers: svc() }).then(r => r.json());

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(503).json({ error: 'sin service key' });
  try {
    const antes = await dia();
    const yaEsta = Array.isArray(antes) && antes.some(g => /nobleza/i.test(g.nombre || ''));
    let escrito = null;
    if (!yaEsta && req.query.cargar === '1') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?on_conflict=uid`, {
        method: 'POST', headers: svc({ Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(GASTO),
      });
      escrito = { status: r.status, body: await r.json().catch(() => null) };
    }
    return res.status(200).json({ yaEstaba: yaEsta, escrito, despues: await dia() });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
