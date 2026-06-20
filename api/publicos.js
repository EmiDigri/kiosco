// Paso 4 — API de precio de venta al público de referencia.
// Endpoint: /api/publicos?q=oreo%20118g

const { getPublicReference } = require('./lib/precioPublico');

module.exports = async function handler(req, res) {
  const q = String(req.query.q || '').trim();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');

  if (!q) {
    return res.status(200).json({ ok: true, step: 4, q, found: false, item: null });
  }

  const item = getPublicReference(q);
  return res.status(200).json({
    ok: true,
    step: 4,
    q,
    found: !!item.found,
    item,
    note: 'Precio de venta al público de referencia. No calcula ganancia ni margen.'
  });
};
