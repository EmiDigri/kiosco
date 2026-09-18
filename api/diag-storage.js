// TEMPORAL / DIAGNOSTICO (Claude, a pedido de digra): mide cuanto ocupan los buckets
// de Storage (cierres-foto y caligrafia-prueba). Gated por ?k=<secreto>. Usa la
// service key del servidor. BORRAR despues de usar. No expone URLs ni contenido.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'kz9Q3-storage-7Xm2';

const svc = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }, extra || {});

async function medirBucket(bucket) {
  let offset = 0, count = 0, bytes = 0;
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: svc({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix: '', limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) return { error: r.status, count, bytes };
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const o of rows) { count++; bytes += Number(o?.metadata?.size) || 0; }
    if (rows.length < 100) break;
    offset += 100;
  }
  return { count, bytes, mb: Math.round(bytes / 1048576 * 100) / 100 };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!SERVICE) return res.status(503).json({ error: 'sin service key' });
  try {
    const [cierres, caligrafia] = await Promise.all([medirBucket('cierres-foto'), medirBucket('caligrafia-prueba')]);
    const totalMb = Math.round((((cierres.bytes || 0) + (caligrafia.bytes || 0)) / 1048576) * 100) / 100;
    return res.status(200).json({ cierresFoto: cierres, caligrafiaPrueba: caligrafia, totalMb });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
