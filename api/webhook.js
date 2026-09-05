const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const FALLBACK_MP_USER_ID = Number(process.env.MP_USER_ID) || 443581160;
let cachedMpUserId = 0;

async function mpUserId() {
  if (cachedMpUserId) return cachedMpUserId;
  try {
    const res = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });
    const user = await res.json().catch(() => null);
    if (res.ok && Number(user?.id)) cachedMpUserId = Number(user.id);
  } catch {}
  return cachedMpUserId || FALLBACK_MP_USER_ID;
}

function pagoEsEnviado(pago, ownerId = FALLBACK_MP_USER_ID) {
  const payerId = Number(pago.payer_id ?? pago.payer?.id) || 0;
  const collectorId = Number(pago.collector_id ?? pago.collector?.id) || 0;
  const ownerSentTransfer = pago.operation_type === 'money_transfer'
    && payerId === ownerId
    && collectorId > 0
    && collectorId !== ownerId;
  return Number(pago.transaction_amount) < 0
    || pago.operation_type === 'money_transfer_send'
    || pago.point_of_interaction?.business_info?.sub_unit === 'money_outflows'
    || ownerSentTransfer;
}

function turnoDeHora(hora, esDomingo) {
  const [h, m] = hora.split(':').map(Number);
  const mins = h * 60 + m;
  if (esDomingo) return mins <= 16 * 60 ? 'Turno 1' : 'Turno 2';
  // Las transferencias de madrugada (00-06:59) se asignan a Vale, que arranca
  // el dia y las ve en pantalla apenas abre. Ver TURNOS_SEMANA.capturaDesdeH en index.html.
  if (mins <= 12 * 60) return 'Vale';
  if (mins <= 17 * 60) return 'Ani';
  return 'Marta';
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
  const esEnviada = pagoEsEnviado(pago, await mpUserId());
  if (!pago.transaction_amount) return;

  // date_approved es null en pagos rechazados/cancelados: usamos date_created como respaldo.
  const d = new Date(pago.date_approved || pago.date_created);
  const dAR = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const fecha = `${dAR.getUTCFullYear()}-${String(dAR.getUTCMonth()+1).padStart(2,'0')}-${String(dAR.getUTCDate()).padStart(2,'0')}`;
  const hora = `${String(dAR.getUTCHours()).padStart(2,'0')}:${String(dAR.getUTCMinutes()).padStart(2,'0')}`;
  const esDomingo = dAR.getUTCDay() === 0;

  let nombre = '';
  if (esEnviada) {
    nombre = 'Transferencia enviada';
  } else if (pago.operation_type === 'pos_payment') {
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

  const tipo = esEnviada ? 'Transferencia enviada' : pago.operation_type === 'pos_payment' ? 'Venta Point' : 'Transferencia recibida';

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
      monto: Math.abs(Number(pago.transaction_amount)),
      turno: turnoDeHora(hora, esDomingo),
      status: pago.status,
      operation_type: pago.operation_type,
      es_enviada: esEnviada
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
