const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';

function turnoDeHora(hora) {
  const h = parseInt(hora.split(':')[0]);
  // Las transferencias de madrugada (00-06:59) se asignan a Vale, que arranca
  // el dia y las ve en pantalla apenas abre. Ver TURNOS_SEMANA.capturaDesdeH en index.html.
  if (h < 12) return 'Vale';
  if (h >= 12 && h < 17) return 'Ani';
  if (h >= 17 && h < 23) return 'Marta';
  return 'Fuera de horario';
}

// Estados terminales que vale la pena guardar. Se ignoran los intermedios
// (pending, in_process, authorized, in_mediation) porque todavia pueden
// cambiar de estado y generarian filas ruidosas o duplicadas.
const ESTADOS_TERMINALES = ['approved', 'rejected', 'cancelled'];

async function procesarPago(pagoId) {
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` }
  });
  const pago = await mpRes.json();

  if (!ESTADOS_TERMINALES.includes(pago.status)) return;
  if (!pago.transaction_amount || pago.transaction_amount <= 0) return;

  // date_approved es null en pagos rechazados/cancelados: usamos date_created como respaldo.
  const d = new Date(pago.date_approved || pago.date_created);
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
