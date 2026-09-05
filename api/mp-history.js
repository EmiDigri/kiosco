import { settlementOutflows } from './_mp-settlement.js';

const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MAX_RESULTS = 500;

// Este endpoint devuelve el historial de pagos de MP: solo para usuarios logueados.
// Verificamos el token de sesión del usuario contra Supabase (no alcanza con la
// clave pública). Sin sesión válida, 401.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_AE6T1LMQuY2T8mf0uD_ANA_Bh4nk_ej';
async function usuarioValido(req) {
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token || token === SUPABASE_ANON) return false; // exige token de usuario, no la clave pública
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const u = await r.json().catch(() => null);
    return Boolean(u && u.id);
  } catch { return false; }
}

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

function paymentIsOutgoing(payment) {
  return Number(payment.transaction_amount) < 0
    || payment.operation_type === 'money_transfer_send';
}

function publicPayment(payment) {
  return {
    id: payment.id ?? null,
    date_approved: payment.date_approved || null,
    date_created: payment.date_created || null,
    transaction_amount: Number(payment.transaction_amount) || 0,
    operation_type: payment.operation_type || '',
    status: payment.status || '',
    es_enviada: paymentIsOutgoing(payment),
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

async function searchPayments(window, extraParams = {}) {
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
      ...extraParams,
    });
    const response = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}`, accept: 'application/json' },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || 'Mercado Pago rechazó la consulta');
    const results = Array.isArray(data?.results) ? data.results : [];
    all.push(...results);
    if (results.length < 100) break;
  }
  return all;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  if (!(await usuarioValido(req))) return res.status(401).json({ error: 'Necesitás iniciar sesión' });
  if (!MP_TOKEN) return res.status(503).json({ error: 'Mercado Pago no está configurado' });

  const date = String(req.query.date || '');
  const window = validDate(date) ? dayWindow(date) : null;
  if (!window) return res.status(400).json({ error: 'Fecha inválida' });

  try {
    // La búsqueda general de MP no siempre incluye salidas. La segunda consulta
    // las pide explícitamente y luego se deduplica por el id de la operación.
    const searches = await Promise.allSettled([
      searchPayments(window),
      searchPayments(window, { operation_type: 'money_transfer_send' }),
    ]);
    const successful = searches.filter(result => result.status === 'fulfilled');
    if (!successful.length) throw searches[0].reason;
    const unique = new Map();
    successful.flatMap(result => result.value).forEach(payment => {
      const key = payment.id != null
        ? `id:${payment.id}`
        : `${payment.date_approved || payment.date_created}|${payment.transaction_amount}|${payment.operation_type}`;
      unique.set(key, payment);
    });
    const report = await settlementOutflows(date, MP_TOKEN).catch(() => ({ status: 'unavailable', outflows: [] }));
    report.outflows.forEach(payment => unique.set(`report:${payment.id}`, payment));
    const all = [...unique.values()].map(publicPayment);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: all });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'No se pudo consultar Mercado Pago' });
  }
}
