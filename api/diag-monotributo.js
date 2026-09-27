// TEMPORAL / ADMIN (Claude, a pedido explicito de digra 27/9/2026): el 19/9 el cuaderno anota
// "Monotributo 159.104" (dos monotributos juntos, como en el Excel del socio) y uno de
// ellos (79.552,18) salio por MercadoPago a ARCA, que la app ya cuenta. Se separa en dos
// renglones: 79.552 (el otro, efectivo/otro medio) + 79.552,18 (el de MP, se empareja con
// la salida). Total 159.104 = Excel. Idempotente. Gated por ?k=. BORRAR despues de usar.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'mt3-split-Kv8d';
const UID_ORIGINAL = 'g_foto_846b9485fff2bcd60b71c1fcdbee678b9ed02626080a49f1322d2eb4dd999796';
const NUEVO = { uid: 'g_ajuste_20260919_monotributo_mp', fecha: '2026-09-19', nombre: 'Monotributo', monto: 79552.18, caja: null, turno: null };
const svc = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, extra || {});
const dia = () => fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?select=uid,fecha,nombre,monto&fecha=eq.2026-09-19&order=created_at.asc`, { headers: svc() }).then(r => r.json());

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(503).json({ error: 'sin service key' });
  try {
    const antes = await dia();
    const original = Array.isArray(antes) ? antes.find(g => g.uid === UID_ORIGINAL) : null;
    const hecho = [];
    if (req.query.aplicar === '1') {
      if (!original) return res.status(409).json({ error: 'no encontre el renglon original', antes });
      if (Number(original.monto) === 159104) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?uid=eq.${UID_ORIGINAL}`, {
          method: 'PATCH', headers: svc({ Prefer: 'return=representation' }), body: JSON.stringify({ monto: 79552 }),
        });
        hecho.push({ paso: 'original 159.104 -> 79.552', status: r.status, body: await r.json().catch(() => null) });
      }
      const r2 = await fetch(`${SUPABASE_URL}/rest/v1/gastos_caja?on_conflict=uid`, {
        method: 'POST', headers: svc({ Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(NUEVO),
      });
      hecho.push({ paso: 'nuevo 79.552,18 (MP)', status: r2.status, body: await r2.json().catch(() => null) });
    }
    return res.status(200).json({ original, hecho, despues: await dia() });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
