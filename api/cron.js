const SUPABASE_URL = 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_KEY = 'sb_secret_I-zc6YWn33cDY6jfIZwyAA_lJEDHXVu';
const MP_TOKEN = 'APP_USR-2677690000928530-060419-6c49e8560bd0de2e71129377f502b62a-443581160';

function turnoDeHora(h, esDomingo) {
  if (esDomingo) {
    if (h >= 9 && h < 16) return 'Turno 1';
    if (h >= 16 && h < 23) return 'Turno 2';
    return 'Fuera de horario';
  }
  if (h >= 7 && h < 12) return 'Vale';
  if (h >= 12 && h < 17) return 'Ani';
  if (h >= 17 && h < 23) return 'Marta';
  return 'Fuera de horario';
}

function ahoraAR() {
  const now = new Date();
  const ar = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const yyyy = ar.getUTCFullYear();
  const mm = String(ar.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ar.getUTCDate()).padStart(2, '0');
  const hh = ar.getUTCHours();
  const min = ar.getUTCMinutes();
  const diaSemana = ar.getUTCDay();
  return { yyyy, mm, dd, hh, min, fecha: `${yyyy}-${mm}-${dd}`, esDomingo: diaSemana === 0 };
}

function toISO_UTC(yyyy, mm, dd, h, m, s) {
  const d = new Date(Date.UTC(parseInt(yyyy), parseInt(mm)-1, parseInt(dd), h + 3, m, s));
  return d.toISOString();
}

async function guardarEnSupabase(registro) {
  // Usar upsert via POST con on_conflict
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pagos?on_conflict=pago_id`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(registro)
  });
  if (!res.ok) {
    const txt = await res.text();
    if (!txt.includes('23505')) console.error('Supabase error:', txt);
  }
}

function parsearPago(pago, esDomingo) {
  const d = new Date(pago.date_approved || pago.date_created);
  const dAR = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const pagoFecha = `${dAR.getUTCFullYear()}-${String(dAR.getUTCMonth()+1).padStart(2,'0')}-${String(dAR.getUTCDate()).padStart(2,'0')}`;
  const hora = `${String(dAR.getUTCHours()).padStart(2,'0')}:${String(dAR.getUTCMinutes()).padStart(2,'0')}`;
  const hNum = parseInt(hora.split(':')[0]);

  let nombre = '';
  if (pago.operation_type === 'pos_payment') {
    const ch = pago.card?.cardholder?.name || '';
    const tar = pago.payment_method?.id || '';
    const tp = tar.includes('visa') ? 'Visa' : tar.includes('master') ? 'Mastercard' : 'Débito';
    nombre = ch && !ch.includes('PAYWAVE') && !ch.toLowerCase().includes('cardholder') && ch.length > 3
      ? ch.trim() : `Point Smart · ${tp}`;
  } else {
    nombre = pago.payer?.first_name
      ? `${pago.payer.first_name} ${pago.payer.last_name || ''}`.trim()
      : 'Transferencia recibida';
  }

  return {
    pago_id: pago.id,
    fecha: pagoFecha,
    hora,
    nombre,
    tipo: pago.operation_type === 'pos_payment' ? 'Venta Point' : 'Transferencia recibida',
    monto: pago.transaction_amount,
    turno: turnoDeHora(hNum, esDomingo),
    status: pago.status,
    operation_type: pago.operation_type,
    es_enviada: false
  };
}

async function fetchYGuardar(desdeH, desdeM, hastaH, hastaM, esDomingo) {
  const { yyyy, mm, dd } = ahoraAR();
  const begin = toISO_UTC(yyyy, mm, dd, desdeH, desdeM, 0);
  const end   = toISO_UTC(yyyy, mm, dd, hastaH, hastaM, 59);

  console.log(`Buscando: ${begin} → ${end}`);

  // Buscar todos los pagos sin filtro de status para incluir Point
  const params = new URLSearchParams({
    begin_date: begin,
    end_date: end,
    status: 'approved',
    sort: 'date_approved',
    criteria: 'asc',
    limit: 100,
    offset: 0,
  });

  const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` }
  });
  if (!res.ok) { console.error('MP error', res.status); return 0; }

  const data = await res.json();
  const pagos = data.results || [];
  console.log(`MP devolvió ${pagos.length} (total: ${data.paging?.total})`);

  let count = 0;
  for (const pago of pagos) {
    const esEnviada = pago.transaction_amount < 0 || pago.operation_type === 'money_transfer_send';

    if (esEnviada) {
      const d = new Date(pago.date_approved || pago.date_created);
      const dAR = new Date(d.getTime() - 3 * 60 * 60 * 1000);
      const pagoFecha = `${dAR.getUTCFullYear()}-${String(dAR.getUTCMonth()+1).padStart(2,'0')}-${String(dAR.getUTCDate()).padStart(2,'0')}`;
      const hora = `${String(dAR.getUTCHours()).padStart(2,'0')}:${String(dAR.getUTCMinutes()).padStart(2,'0')}`;
      const hNum = parseInt(hora.split(':')[0]);
      await guardarEnSupabase({
        pago_id: pago.id, fecha: pagoFecha, hora,
        nombre: 'Transferencia enviada',
        tipo: 'Transferencia enviada',
        monto: Math.abs(pago.transaction_amount),
        turno: turnoDeHora(hNum, esDomingo),
        status: pago.status || 'approved',
        operation_type: pago.operation_type,
        es_enviada: true
      });
      count++;
      continue;
    }

    // Aceptar transferencias y ventas Point
    const esValido = ['money_transfer', 'pos_payment', 'account_fund'].includes(pago.operation_type);
    if (!esValido) {
      console.log(`Excluido: ${pago.operation_type} $${pago.transaction_amount}`);
      continue;
    }

    await guardarEnSupabase(parsearPago(pago, esDomingo));
    count++;
  }

  // Buscar ventas Point específicamente (a veces no aparecen en search general)
  const paramsPoint = new URLSearchParams({
    begin_date: begin,
    end_date: end,
    status: 'approved',
    operation_type: 'pos_payment',
    sort: 'date_approved',
    criteria: 'asc',
    limit: 100,
    offset: 0,
  });

  const resPoint = await fetch(`https://api.mercadopago.com/v1/payments/search?${paramsPoint}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` }
  });

  if (resPoint.ok) {
    const dataPoint = await resPoint.json();
    const pagosPoint = dataPoint.results || [];
    console.log(`Ventas Point específicas: ${pagosPoint.length}`);
    for (const pago of pagosPoint) {
      await guardarEnSupabase(parsearPago(pago, esDomingo));
      count++;
    }
  }

  return count;
}

export default async function handler(req, res) {
  try {
    const { hh, min, fecha, esDomingo } = ahoraAR();
    console.log(`Cron - Hora AR: ${hh}:${String(min).padStart(2,'0')} fecha: ${fecha} domingo: ${esDomingo}`);

    let procesados = 0;

    if (esDomingo) {
      if      (hh >= 9  && hh < 16) procesados = await fetchYGuardar(9,  30, 16,  0, true);
      else if (hh >= 16 && hh < 23) procesados = await fetchYGuardar(16,  1, 23,  0, true);
    } else {
      if      (hh >= 7  && hh < 12) procesados = await fetchYGuardar(7,  0, 11, 59, false);
      else if (hh >= 12 && hh < 17) procesados = await fetchYGuardar(12, 1, 16, 59, false);
      else if (hh >= 17 && hh < 23) procesados = await fetchYGuardar(17, 1, 22, 59, false);
    }

    console.log(`Cron ejecutado: ${procesados} pagos procesados`);
    return res.status(200).json({ ok: true, procesados, hora: hh });
  } catch (err) {
    console.error('Cron error:', err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
