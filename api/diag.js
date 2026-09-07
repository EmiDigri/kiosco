// TEMPORAL - diagnostico de salidas MP. Protegido por clave al azar. BORRAR despues de usar.
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const SECRET = '30bf64ff98c273ea12009e7d734fa6443cfad3bc08ff0460';

function inicioDiaAR(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
}

async function buscarPagosMP(extraParams) {
  const todos = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const params = new URLSearchParams({
      status: 'approved', range: 'date_approved', sort: 'date_approved', criteria: 'asc',
      limit: 100, offset, ...extraParams,
    });
    const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });
    if (!res.ok) throw new Error(`MP ${res.status}`);
    const data = await res.json();
    const pagos = data.results || [];
    todos.push(...pagos);
    if (pagos.length < 100) break;
  }
  return todos;
}

export default async function handler(req, res) {
  if (req.query.k !== SECRET) return res.status(404).json({ error: 'not found' });
  if (!MP_TOKEN) return res.status(503).json({ error: 'no mp token' });
  const fecha = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : null;
  if (!fecha) return res.status(400).json({ error: 'date invalida' });

  try {
    // owner id real
    let ownerId = null;
    try {
      const me = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
      const u = await me.json().catch(() => null);
      ownerId = u?.id ?? null;
    } catch {}

    const begin = inicioDiaAR(fecha);
    const now = new Date();
    const end = new Date(Math.min(begin.getTime() + 24 * 60 * 60 * 1000 - 1, now.getTime()));
    const win = { begin_date: begin.toISOString(), end_date: end.toISOString() };

    const [generales, enviados] = await Promise.all([
      buscarPagosMP(win),
      buscarPagosMP({ ...win, operation_type: 'money_transfer_send' }),
    ]);
    const map = new Map();
    [...generales, ...enviados].forEach(p => { if (p.id != null) map.set(String(p.id), p); });
    const pagos = [...map.values()];

    const filas = pagos.map(p => {
      const d = new Date(p.date_approved || p.date_created);
      const dAR = new Date(d.getTime() - 3 * 60 * 60 * 1000);
      const hora = `${String(dAR.getUTCHours()).padStart(2,'0')}:${String(dAR.getUTCMinutes()).padStart(2,'0')}`;
      return {
        id: p.id,
        hora,
        monto: p.transaction_amount,
        operation_type: p.operation_type,
        sub_unit: p.point_of_interaction?.business_info?.sub_unit ?? null,
        sub_type: p.point_of_interaction?.business_info?.sub_type ?? null,
        payer_id: p.payer?.id ?? p.payer_id ?? null,
        collector_id: p.collector_id ?? null,
        description: p.description || '',
        status: p.status,
      };
    }).sort((a, b) => a.hora.localeCompare(b.hora));

    return res.status(200).json({ ownerId, total: filas.length, filas });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
