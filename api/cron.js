const SUPABASE_URL = 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_KEY = 'sb_secret_I-zc6YWn33cDY6jfIZwyAA_lJEDHXVu';
const MP_TOKEN = 'APP_USR-2677690000928530-060419-6c49e8560bd0de2e71129377f502b62a-443581160';

function turnoDeHora(h) {
  if (h >= 7 && h < 12) return 'Vale';
  if (h >= 12 && h < 17) return 'Ani';
  if (h >= 17 && h < 23) return 'Marta';
  return 'Fuera de horario';
}

// Retorna fecha y hora en Argentina como strings
function ahoraAR() {
  const now = new Date();
  // Argentina UTC-3
  const ar = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const yyyy = ar.getUTCFullYear();
  const mm = String(ar.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ar.getUTCDate()).padStart(2, '0');
  const hh = ar.getUTCHours();
  const min = ar.getUTCMinutes();
  return { yyyy, mm, dd, hh, min, fecha: `${yyyy}-${mm}-${dd}` };
}

// Construye ISO con offset -03:00 para que MP filtre correctamente
function toISO_AR(yyyy, mm, dd, h, m, s) {
  return `${yyyy}-${mm}-${dd}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}-03:00`;
}

async function fetchYGuardar(desdeH, desdeM, hastaH, hastaM) {
  const { yyyy, mm, dd, fecha } = ahoraAR();

  const begin = toISO_AR(yyyy, mm, dd, desdeH, desdeM, 0);
  const end   = toISO_AR(yyyy, mm, dd, hastaH, hastaM, 59);

  console.log(`Buscando: ${begin} → ${end}`);

  const params = new URLSearchParams({
    begin_date: begin,
    end_date:   end,
    status:     'approved',
    sort:       'date_approved',
    criteria:   'asc',
    limit:      100,
    offset:     0,
  });

  const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` }
  });
  if (!res.ok) { console.error('MP error', res.status); return 0; }

  const data = await res.json();
  const pagos = data.results || [];
  console.log(`MP devolvió ${pagos.length} pagos (total: ${data.paging?.total})`);

  for (const pago of pagos) {
    // hora en Argentina
    const d = new Date(pago.date_approved);
    const pagoFecha = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const hora = `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;

    let nombre = '';
    if (pago.operation_type === 'pos_payment') {
      const ch = pago.card?.cardholder?.name || '';
      const tar = pago.payment_method?.id || '';
      const tp = tar.includes('visa') ? 'Visa' : tar.includes('master') ? 'Mastercard' : 'Débito';
      nombre = ch && !ch.includes('PAYWAVE') && !ch.toLowerCase().includes('cardholder') && ch.length > 3 ? ch.trim() : `Point Smart · ${tp}`;
    } else {
      nombre = pago.payer?.first_name ? `${pago.payer.first_name} ${pago.payer.last_name || ''}`.trim() : 'Transferencia recibida';
    }

    const tipo = pago.operation_type === 'pos_payment' ? 'Venta Point' : 'Transferencia recibida';
    const hNum = parseInt(hora.split(':')[0]);

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
        fecha: pagoFecha,
        hora,
        nombre,
        tipo,
        monto: pago.transaction_amount,
        turno: turnoDeHora(hNum),
        status: pago.status,
        operation_type: pago.operation_type
      })
    });
  }
  return pagos.length;
}

export default async function handler(req, res) {
  try {
    const { hh, min, fecha } = ahoraAR();
    console.log(`Cron - Hora AR: ${hh}:${String(min).padStart(2,'0')} fecha: ${fecha}`);

    let procesados = 0;
    if      (hh >= 7  && hh < 12) procesados = await fetchYGuardar(7,  0, 11, 59);
    else if (hh >= 12 && hh < 17) procesados = await fetchYGuardar(12, 1, 16, 59);
    else if (hh >= 17 && hh < 23) procesados = await fetchYGuardar(17, 1, 22, 59);
    else console.log('Fuera de horario');

    return res.status(200).json({ ok: true, procesados, hora: hh });
  } catch (err) {
    console.error('Cron error:', err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
