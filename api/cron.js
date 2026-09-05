const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_USER_ID = 443581160; // ID de cuenta del kiosco (último segmento del token)

function turnoDeHora(h, esDomingo) {
  if (esDomingo) {
    if (h >= 9 && h < 16) return 'Turno 1';
    if (h >= 16 && h < 23) return 'Turno 2';
    return 'Fuera de horario';
  }
  // Las transferencias de madrugada (00-06:59) se asignan a Vale, que arranca
  // el dia y las ve en pantalla apenas abre. Ver TURNOS_SEMANA.capturaDesdeH en index.html.
  if (h < 12) return 'Vale';
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

async function guardarEnSupabase(registro) {
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

// Inicio del día argentino (00:00 AR) en UTC. AR es UTC-3, así que 00:00 AR
// del día D equivale a las 03:00 UTC de D.
function inicioDiaAR(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
}

// Trae TODAS las páginas de MP para una ventana (MP devuelve de a 100).
async function buscarPagosMP(extraParams) {
  const todos = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const params = new URLSearchParams({
      status: 'approved', sort: 'date_approved', criteria: 'asc',
      limit: 100, offset, ...extraParams,
    });
    const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });
    if (!res.ok) { console.error('MP error', res.status); break; }
    const data = await res.json();
    const pagos = data.results || [];
    todos.push(...pagos);
    if (pagos.length < 100) break;
  }
  return todos;
}

// Reconcilia un día entero contra MP. Idempotente (upsert por pago_id): re-correr
// no duplica y de paso corrige la hora/fecha de filas que el webhook guardó mal.
// Se reconcilia TODO el día (no las "últimas 2 horas") para que, aunque el cron
// no haya corrido de madrugada, la primera corrida del día repesque lo de la
// noche y la madrugada. Ver bug: transferencias fuera de horario no aparecían.
async function fetchYGuardar(esDomingo, fecha) {
  const now = new Date();
  const begin = inicioDiaAR(fecha);
  const end = now;

  console.log(`Reconciliando día ${fecha}: ${begin.toISOString()} → ${end.toISOString()}`);

  const win = { begin_date: begin.toISOString(), end_date: end.toISOString() };
  const [pagosGenerales, pagosEnviados] = await Promise.all([
    buscarPagosMP(win),
    buscarPagosMP({ ...win, operation_type: 'money_transfer_send' }),
  ]);
  const pagosUnicos = new Map();
  [...pagosGenerales, ...pagosEnviados].forEach(pago => {
    const key = pago.id != null
      ? `id:${pago.id}`
      : `${pago.date_approved || pago.date_created}|${pago.transaction_amount}|${pago.operation_type}`;
    pagosUnicos.set(key, pago);
  });
  const pagos = [...pagosUnicos.values()];
  console.log(`MP devolvió ${pagos.length} operaciones (${pagosEnviados.length} salidas explícitas)`);

  let count = 0;
  for (const pago of pagos) {
    const esEnviada = pago.transaction_amount < 0
      || pago.operation_type === 'money_transfer_send'
      || (pago.point_of_interaction?.business_info?.sub_unit === 'money_outflows' && pago.payer_id === MP_USER_ID);

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

    const esValido = ['money_transfer', 'pos_payment', 'account_fund'].includes(pago.operation_type);
    if (!esValido) {
      console.log(`Excluido: ${pago.operation_type} $${pago.transaction_amount}`);
      continue;
    }

    await guardarEnSupabase(parsearPago(pago, esDomingo));
    count++;
  }

  // Ventas Point específicas (a veces no aparecen en el search general)
  const pagosPoint = await buscarPagosMP({ ...win, operation_type: 'pos_payment' });
  console.log(`Ventas Point específicas: ${pagosPoint.length}`);
  for (const pago of pagosPoint) {
    await guardarEnSupabase(parsearPago(pago, esDomingo));
    count++;
  }

  return count;
}

export default async function handler(req, res) {
  try {
    const { hh, min, fecha, esDomingo } = ahoraAR();

    // Permite reconciliar un día puntual con ?date=YYYY-MM-DD (backfill manual).
    // Sin parámetro, reconcilia el día argentino en curso.
    const pedido = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : fecha;
    const esDomingoPedido = new Date(`${pedido}T12:00:00-03:00`).getDay() === 0;

    console.log(`Cron - Hora AR: ${hh}:${String(min).padStart(2,'0')} · reconciliando ${pedido}`);

    // Se corre a cualquier hora: las transferencias entran las 24 h y el webhook
    // en tiempo real no es 100% confiable, así que el cron tiene que repescar
    // también de madrugada y de noche (antes estaba limitado a 7-23 h y por eso
    // los movimientos fuera de horario no aparecían).
    const procesados = await fetchYGuardar(esDomingoPedido, pedido);

    console.log(`Cron ejecutado: ${procesados} pagos procesados`);
    return res.status(200).json({ ok: true, procesados, fecha: pedido, hora: hh });
  } catch (err) {
    console.error('Cron error:', err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
