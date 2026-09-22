// TEMPORAL — ver cómo informa MP comisión/impuestos en cobros reales. Borrar después.
// Solo lectura, gateado por ?k=<secreto>. No devuelve datos personales (sin payer/card).
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const SECRET = 'fees-7c1e4b';

function resumen(p) {
  return {
    id: p.id,
    fecha: p.date_approved,
    operation_type: p.operation_type,
    payment_type_id: p.payment_type_id,
    payment_method_id: p.payment_method_id,
    transaction_amount: p.transaction_amount,
    taxes_amount: p.taxes_amount,
    fee_details: p.fee_details,
    charges_details: (p.charges_details || []).map(c => ({ name: c.name, type: c.type, accounts: c.accounts, amounts: c.amounts, metadata: c.metadata })),
    transaction_details: p.transaction_details,
    money_release_date: p.money_release_date,
    money_release_status: p.money_release_status,
  };
}

export default async function handler(req, res) {
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  if (!MP_TOKEN) return res.status(500).json({ error: 'sin token MP' });
  try {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - 20 * 24 * 60 * 60 * 1000);
    const buscar = async (extra) => {
      const params = new URLSearchParams({ status: 'approved', range: 'date_approved', sort: 'date_approved', criteria: 'desc', limit: 50, begin_date: desde.toISOString(), end_date: hasta.toISOString(), ...extra });
      const r = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
      if (!r.ok) throw new Error(`search ${r.status}`);
      return (await r.json()).results || [];
    };
    const [point, transf] = await Promise.all([buscar({ operation_type: 'pos_payment' }), buscar({ operation_type: 'money_transfer' })]);
    // Para asegurar el objeto completo, pido 3 de cada uno por id.
    const detalle = async (lista) => Promise.all(lista.slice(0, 3).map(async p => {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${p.id}`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
      return r.ok ? resumen(await r.json()) : { id: p.id, error: r.status };
    }));
    // Totales de los últimos 20 días para ver el efecto agregado.
    const tot = lista => lista.reduce((a, p) => {
      a.n++; a.bruto += Number(p.transaction_amount) || 0;
      a.neto += Number(p.transaction_details?.net_received_amount) || 0;
      (p.fee_details || []).forEach(f => { a.fees[f.type] = (a.fees[f.type] || 0) + (Number(f.amount) || 0); });
      (p.charges_details || []).forEach(c => { const k = `${c.type}:${c.name}`; a.charges[k] = (a.charges[k] || 0) + (Number(c.amounts?.original) || 0); });
      a.taxes += Number(p.taxes_amount) || 0;
      return a;
    }, { n: 0, bruto: 0, neto: 0, taxes: 0, fees: {}, charges: {} });
    res.status(200).json({
      point: { totales20d: tot(point), ejemplos: await detalle(point) },
      transferencias: { totales20d: tot(transf), ejemplos: await detalle(transf) },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
