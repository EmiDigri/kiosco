// Paso 5A — API de precios mayoristas + precio público de referencia.
// Endpoint: /api/precios?q=oreo
// Proveedores reales conectados:
// - Mayorista 12 de Octubre
// - Distribuidora OKS
// - Distribuidora Pop
// - Golmarymar

const { searchMayorista12 } = require('./lib/mayorista12');
const { searchDistrioks } = require('./lib/distrioks');
const { searchDistribuidoraPop } = require('./lib/distribuidorapop');
const { searchGolmarymar } = require('./lib/golmarymar');
const { getPublicReference } = require('./lib/precioPublico');

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function money(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function productKey(item) {
  return normalize(item.title || item.id || item.url || '')
    .replace(/\b(x|pack|unidad|unidades|producto|real)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePriceRows(item) {
  const rows = Array.isArray(item.prices) ? item.prices : [];
  if (rows.length) return rows;
  if (item.price === null || item.price === undefined) return [];
  return [{
    name: item.provider || item.providerId || 'Proveedor',
    logo: item.logo || item.provider || 'P',
    price: item.price,
    priceText: item.priceText || money(item.price),
    url: item.url,
    image: item.image,
    stock: item.stock,
    source: item.source || 'proveedor_real'
  }];
}

function mergePriceRows(a = [], b = []) {
  const map = new Map();
  for (const row of [...a, ...b]) {
    const key = normalize([row.name, row.url, row.price].join(' '));
    if (!key || map.has(key)) continue;
    map.set(key, { ...row, priceText: row.priceText || money(row.price) });
  }
  return [...map.values()].sort((x, y) => (x.price ?? Infinity) - (y.price ?? Infinity));
}

function mergeRealItems(items, limit = 18) {
  const byKey = new Map();

  for (const item of items) {
    if (!item) continue;
    const key = productKey(item) || normalize(item.url || '');
    if (!key) continue;

    const prev = byKey.get(key);
    if (!prev) {
      const prices = normalizePriceRows(item);
      const min = prices.map(p => p.price).filter(p => p !== null && p !== undefined).sort((a, b) => a - b)[0];
      byKey.set(key, {
        ...item,
        prices,
        price: min ?? item.price ?? null,
        priceText: min !== undefined ? money(min) : (item.priceText || null),
        providersCount: prices.length || item.providersCount || 1
      });
      continue;
    }

    const prices = mergePriceRows(prev.prices, normalizePriceRows(item));
    const min = prices.map(p => p.price).filter(p => p !== null && p !== undefined).sort((a, b) => a - b)[0];
    byKey.set(key, {
      ...prev,
      title: prev.title || item.title,
      meta: prices.length > 1 ? `${prices.length} proveedores encontrados` : (prev.meta || item.meta),
      image: prev.image || item.image,
      url: prev.url || item.url,
      prices,
      price: min ?? prev.price ?? item.price ?? null,
      priceText: min !== undefined ? money(min) : (prev.priceText || item.priceText || null),
      providersCount: prices.length || prev.providersCount || item.providersCount || 1,
      tags: [...new Set([...(prev.tags || []), ...(item.tags || [])])]
    });
  }

  return [...byKey.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0) || ((a.price ?? Infinity) - (b.price ?? Infinity)))
    .slice(0, limit);
}

async function fetchProviderSafely(entry, q, limit = 8) {
  try {
    const live = await entry.fn(q, { limit });
    return { ok: true, entry, live };
  } catch (err) {
    return {
      ok: false,
      entry,
      live: null,
      error: { provider: entry.name, error: String(err && err.message || err) }
    };
  }
}

module.exports = async function handler(req, res) {
  const q = String(req.query.q || '').trim();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600');

  if (!q) {
    return res.status(200).json({ ok: true, step: '5A', q, count: 0, items: [], providers: [] });
  }

  const providerEntries = [
    { name: 'Mayorista 12 de Octubre', source: 'proveedor_real_mayorista12', fn: searchMayorista12 },
    { name: 'Distribuidora OKS', source: 'proveedor_real_distrioks', fn: searchDistrioks },
    { name: 'Distribuidora Pop', source: 'proveedor_real_distribuidorapop', fn: searchDistribuidoraPop },
    { name: 'Golmarymar', source: 'proveedor_real_golmarymar', fn: searchGolmarymar }
  ];

  try {
    const settled = await Promise.all(providerEntries.map(entry => fetchProviderSafely(entry, q, 8)));
    const rawItems = [];
    const providers = [];
    const errors = [];

    for (const result of settled) {
      if (!result.ok) {
        errors.push(result.error);
        continue;
      }

      const live = result.live || {};
      if (live.provider) providers.push(live.provider);
      if (Array.isArray(live.errors) && live.errors.length) errors.push(...live.errors);

      for (const item of live.items || []) {
        rawItems.push({
          ...item,
          source: result.entry.source,
          providersCount: item.providersCount || 1
        });
      }
    }

    const items = mergeRealItems(rawItems, 18);

    return res.status(200).json({
      ok: true,
      step: '5A',
      q,
      count: items.length,
      rawCount: rawItems.length,
      providers,
      providerNames: providers.map(p => p.name),
      items,
      publicReference: getPublicReference(q),
      errors,
      note: items.length
        ? 'Paso 5A.3: links mayoristas reales obtenidos de proveedores conectados. Incluye precio público de referencia si existe.'
        : 'Paso 5A.3: no hubo resultados reales para esta búsqueda en proveedores conectados. Incluye precio público de referencia si existe.'
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      step: '5A',
      q,
      count: 0,
      items: [],
      providers: [],
      publicReference: getPublicReference(q),
      error: String(err && err.message || err),
      note: 'Falló la consulta a proveedores reales. Revisar logs de Vercel.'
    });
  }
};
