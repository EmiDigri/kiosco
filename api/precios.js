// Paso 5A.4 — API de precios mayoristas + precio público de referencia.
// Endpoint: /api/precios?q=oreo
// Proveedores reales conectados:
// - Mayorista 12 de Octubre
// - Distribuidora OKS
// - Distribuidora Pop
// - Golmarymar
//
// Cambio clave (Paso 5A.4): mismo filtro estricto que en sugerencias.js —
// el TÍTULO tiene que contener la palabra buscada (o un alias de marca
// conocido). Ya no alcanza con matchear en tags/meta. Preferimos devolver
// vacío antes que mostrar un producto irrelevante (ej: "coca" trayendo
// "Alfajor Escolar X 60").

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

// ─────────────────────────────────────────────────────────────
// Paso 5A.4 — filtro global anti-basura, ESTRICTO por TÍTULO.
// (idéntico criterio al de sugerencias.js, para que ambos endpoints
// muestren siempre el mismo conjunto de productos "reales")
// ─────────────────────────────────────────────────────────────

const BP_STOP_TERMS = new Set(['de','del','la','el','los','las','y','en','x','por','pack','caja','cajas','unidad','unidades','u','un','una','gr','g','kg','ml','cc','lt','l','litro','litros']);

const BP_QUERY_ALIASES = [
  { match: /^coca( cola)?( zero)?$/, any: ['coca cola', 'coca-cola', 'cocacola', 'coca'] },
  { match: /^lays?$/, any: ['lays', 'lay s'] },
  { match: /^rocklets?$/, any: ['rocklets', 'rocklet'] },
  { match: /^oreo$/, any: ['oreo'] },
  { match: /^fantoche$/, any: ['fantoche'] },
  { match: /^baggio$/, any: ['baggio'] },
  { match: /^guaymall?en$/, any: ['guaymallen', 'guaymallén'] },
  { match: /^jorgito$/, any: ['jorgito'] },
  { match: /^beldent$/, any: ['beldent'] },
  { match: /^top ?line$/, any: ['topline', 'top line'] },
  { match: /^mogul$/, any: ['mogul'] },
  { match: /^billiken$/, any: ['billiken'] },
  { match: /^tita$/, any: ['tita'] },
  { match: /^rhodesia$/, any: ['rhodesia'] },
  { match: /^manaos$/, any: ['manaos'] },
  { match: /^levit[eé]$/, any: ['levite', 'levité'] },
  { match: /^sprite$/, any: ['sprite'] },
  { match: /^fanta$/, any: ['fanta'] },
  { match: /^pepsi$/, any: ['pepsi'] },
  { match: /^bic$/, any: ['bic'] },
  { match: /^resma$/, any: ['resma'] },
  { match: /^plasticola$/, any: ['plasticola'] },
  { match: /^filgo$/, any: ['filgo'] },
  { match: /^pringles$/, any: ['pringles'] },
  { match: /^doritos$/, any: ['doritos'] }
];

function bpNorm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bpImportantTerms(q) {
  return bpNorm(q).split(/\s+/).filter(t => t && t.length >= 2 && !BP_STOP_TERMS.has(t));
}

// SOLO el título decide relevancia (ya no meta/tags).
function bpIsRelevantResult(item, q) {
  const nq = bpNorm(q);
  if (!nq) return true;

  const title = bpNorm(item && item.title);
  if (!title) return false;

  if (title.includes(nq)) return true;

  for (const rule of BP_QUERY_ALIASES) {
    if (rule.match.test(nq)) {
      return rule.any.some(alias => title.includes(bpNorm(alias)));
    }
  }

  const terms = bpImportantTerms(q);
  if (!terms.length) return false;
  return terms.every(t => title.includes(t));
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
    return res.status(200).json({ ok: true, step: '5A.4', q, count: 0, items: [], providers: [] });
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
        if (!bpIsRelevantResult(item, q)) {
          errors.push({ provider: result.entry.name, ignored: item.title || item.url || 'sin_titulo', reason: 'irrelevante_para_busqueda_titulo' });
          continue;
        }
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
      step: '5A.4',
      q,
      count: items.length,
      rawCount: rawItems.length,
      providers,
      providerNames: providers.map(p => p.name),
      items,
      publicReference: getPublicReference(q),
      errors,
      note: items.length
        ? 'Paso 5A.4: links mayoristas reales con filtro estricto por título. Incluye precio público de referencia si existe.'
        : 'Paso 5A.4: no hubo resultados reales relevantes (por título) para esta búsqueda. Incluye precio público de referencia si existe.'
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      step: '5A.4',
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
