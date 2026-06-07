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

async function fetchYGuardar(desdeH, desdeM, hastaH, hastaM) {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), desdeH, desdeM, 0);
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), hastaH, hastaM, 59);

  const params = new URLSearchParams({
    begin_date: desde.toISOString(),
    end_date: hasta.toISOString(),
    status: 'approved',
    sort: 'date_approved',
    criteria: 'asc',
    limit: 30,
    offset: 0,
  });

  const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` }
  });
  if (!res.ok) return;
  const data = await res.json();
  const pagos = (data.results || []).filter(p => {
    const aprobado = new Date(p.date_approved);
    return aprobado >= desde && aprobado <= hasta;
  });

  for (const pago of pagos) {
    const d = new Date(pago.date_approved);
    const fecha = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hora = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    let nombre = '';
    if (pago.operation_type === 'pos_payment') {
      const cardholder = pago.card?.cardholder?.name || '';
      const tarjeta = pago.payment_method?.id || '';
      const tipo = tarjeta.includes('visa') ? 'Visa' : tarjeta.includes('master') ? 'Mastercard' : 'Débito';
      nombre = cardholder && !cardholder.includes('PAYWAVE') && !cardholder.toLowerCase().includes('cardholder') && cardholder.length > 3
        ? cardholder.trim() : `Point Smart · ${tipo}`;
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
  return pagos.length;
}

export default async function handler(req, res) {
  try {
    const hoy = new Date();
    const h = hoy.getHours();

    let procesados = 0;
    if (h >= 7 && h < 12) procesados = await fetchYGuardar(7, 0, 11, 59);
    else if (h >= 12 && h < 17) procesados = await fetchYGuardar(12, 1, 16, 59);
    else if (h >= 17 && h < 23) procesados = await fetchYGuardar(17, 1, 22, 59);

    console.log('Cron ejecutado:', procesados, 'pagos procesados');
    return res.status(200).json({ ok: true, procesados });
  } catch (err) {
    console.error('Cron error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
