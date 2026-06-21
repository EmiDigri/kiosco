// Paso 6 — API de precio de venta al público de referencia.
// Endpoint: /api/publicos?q=oreo%20118g
//
// Ahora getPublicReference es ASYNC (consulta SEPA/Precios Claros en vivo
// antes de caer al catálogo manual), por eso se le agrega "await".

const { getPublicReference } = require('./lib/precioPublico');

module.exports = async function handler(req, res) {
  const q = String(req.query.q || '').trim();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');

  if (!q) {
    return res.status(200).json({ ok: true, step: 6, q, found: false, item: null });
  }

  const item = await getPublicReference(q);

  return res.status(200).json({
    ok: true,
    step: 6,
    q,
    found: !!item.found,
    item,
    note: 'Precio de venta al público de referencia: promedio Coto + Día (SEPA) cuando hay datos, o catálogo manual de respaldo. No calcula ganancia ni margen.'
  });
};
