// Paso 4 — API de precios mayoristas + precio público de referencia.
// Endpoint: /api/precios?q=oreo
// Primer proveedor real conectado: Mayorista 12 de Octubre, Morón, Buenos Aires.

const { searchMayorista12 } = require('./lib/mayorista12');
const { getPublicReference } = require('./lib/precioPublico');

module.exports = async function handler(req, res) {
  const q = String(req.query.q || '').trim();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600');

  if (!q) {
    return res.status(200).json({ ok: true, q, count: 0, items: [], providers: [] });
  }

  try {
    const m12 = await searchMayorista12(q, { limit: 8 });
    const items = m12.items || [];

    return res.status(200).json({
      ok: true,
      step: 4,
      q,
      count: items.length,
      providers: [m12.provider],
      items,
      publicReference: getPublicReference(q),
      errors: m12.errors || [],
      note: items.length
        ? 'Precios mayoristas reales obtenidos del proveedor conectado. Incluye precio público de referencia si existe.'
        : 'No hubo resultados reales para esta búsqueda en el proveedor conectado. Incluye precio público de referencia si existe.'
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      step: 4,
      q,
      count: 0,
      items: [],
      providers: [],
      publicReference: getPublicReference(q),
      error: String(err && err.message || err),
      note: 'Falló la consulta al proveedor real. La app puede usar el fallback simulado.'
    });
  }
};
