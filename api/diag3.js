// TEMPORAL - detalle de movimientos MP de un dia para reconciliar. BORRAR despues.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'b11ab5cb60d4cc3541ae5bbcc0d96ae7f480c560feb78e41';

export default async function handler(req, res) {
  if (req.query.k !== SECRET) return res.status(404).json({ error: 'not found' });
  if (!KEY) return res.status(503).json({ error: 'no service key' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
  if (!date) return res.status(400).json({ error: 'date invalida' });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/pagos?fecha=eq.${date}&select=*&order=hora.asc`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) return res.status(502).json({ error: `${r.status}: ${await r.text()}` });
    const rows = await r.json();
    const filas = rows.map(p => ({
      pago_id: p.pago_id, hora: p.hora, monto: Number(p.monto) || 0, turno: p.turno,
      tipo: p.tipo, nombre: p.nombre, es_enviada: p.es_enviada === true,
      devuelta: p.devuelta === true, status: p.status, operation_type: p.operation_type,
    }));
    return res.status(200).json({ date, total: filas.length, filas });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
