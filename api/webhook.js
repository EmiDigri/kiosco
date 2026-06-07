const SUPABASE_URL = 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_KEY = 'sb_secret_I-zc6YWn33cDY6jfIZwyAA_lJEDHXVu';
const MP_TOKEN = 'APP_USR-2677690000928530-060419-6c49e8560bd0de2e71129377f502b62a-443581160';

function turnoDeHora(hora) {
  const h = parseInt(hora.split(':')[0]);
  if (h >= 7 && h < 12) return 'Vale';
  if (h >= 12 && h < 17) return 'Ani';
  if (h >= 17 && h < 23) return 'Marta';
  return 'Fuera de horario';
}

async function procesarPago(pagoId) {
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` }
  });
  const pago = await mpRes.json();

  if (pago.status !== 'approved') return;
  if (!pago.transaction_amount || pago.transaction_amount <= 0) return;

  const d = new Date(pago.date_approved);
  const fecha = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const hora = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  let nombre = '';
  if (pago.operation_type === 'pos_payment') {
    const cardholder = pago.card?.cardholder?.name || '';
    const tarjeta = pago.payment_method?.id || '';
    const tipo = tarjeta.includes('visa') ? 'Visa' : tarjeta.includes('master') ? 'Mastercard' : 'Débito';
    nombre = cardholder && !cardholder.includes('PAYWAVE') && !cardholder.toLowerCase().includes('cardholder') && cardholder.length > 3
      ? cardholder.trim()
      : `Point Smart · ${tipo}`;
  } else {
    nombre = pago.payer?.first_name
      ? `${pago.payer.first_name} ${pago.payer.last_name || ''}`.trim()
      : 'Transferencia recibida';
  }

  const tipo = pago.operation_type === 'pos_payment' ? 'Venta Point' : 'Transferencia recibida';

  await fetch(`${SUPABASE_URL}/rest/v1/pagos`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({
      pago_id: pago.id,
      fecha,
      hora,
      nombre,
      tipo,
      monto: pago.transaction_amount,
      turno: turnoDeHora(hora),
      status: pago.status,
      operation_type: pago.operation_type
    })
  });
}

export default async function handler(req, res) {
  try {
    let pagoId = null;

    if (req.method === 'GET') {
      // IPN: llega como GET ?topic=payment&id=123456
      const topic = req.query.topic;
      if (topic === 'payment') {
        pagoId = req.query.id;
      }
    } else if (req.method === 'POST') {
      // Webhook: llega como POST con JSON
      const body = req.body;
      if (body?.type === 'payment') {
        pagoId = body?.data?.id;
      } else if (body?.data?.id) {
        pagoId = body.data.id;
      }
    }

    if (pagoId) {
      await procesarPago(pagoId);
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
