const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MAX_RESULTS = 500;

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function dayWindow(date) {
  const [year, month, day] = date.split('-').map(Number);
  const begin = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, 2, 59, 59));
  if (Number.isNaN(begin.getTime()) || begin.toISOString().slice(0, 10) !== date) return null;
  return { begin, end };
}

function publicPayment(payment) {
  return {
    date_approved: payment.date_approved || null,
    date_created: payment.date_created || null,
    transaction_amount: Number(payment.transaction_amount) || 0,
    operation_type: payment.operation_type || '',
    status: payment.status || '',
    description: payment.description || '',
    payer: {
      first_name: payment.payer?.first_name || '',
      last_name: payment.payer?.last_name || '',
    },
    additional_info: {
      payer: {
        first_name: payment.additional_info?.payer?.first_name || '',
        last_name: payment.additional_info?.payer?.last_name || '',
      },
    },
    card: { cardholder: { name: payment.card?.cardholder?.name || '' } },
    payment_method: { id: payment.payment_method?.id || '' },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  if (!MP_TOKEN) return res.status(503).json({ error: 'Mercado Pago no está configurado' });

  const date = String(req.query.date || '');
  const window = validDate(date) ? dayWindow(date) : null;
  if (!window) return res.status(400).json({ error: 'Fecha inválida' });

  try {
    const all = [];
    for (let offset = 0; offset < MAX_RESULTS; offset += 100) {
      const params = new URLSearchParams({
        begin_date: window.begin.toISOString(),
        end_date: window.end.toISOString(),
        status: 'approved',
        sort: 'date_approved',
        criteria: 'asc',
        limit: '100',
        offset: String(offset),
      });
      const response = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}`, accept: 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) return res.status(response.status).json({ error: data?.message || 'Mercado Pago rechazó la consulta' });
      const results = Array.isArray(data?.results) ? data.results : [];
      all.push(...results.map(publicPayment));
      if (results.length < 100) break;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: all });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'No se pudo consultar Mercado Pago' });
  }
}
