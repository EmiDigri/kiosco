// Paso 5A.4 — API propia de autosugerencias para Vercel.
// Endpoint: /api/sugerencias?q=oreo
// Mezcla catálogo simulado + proveedores reales:
// Mayorista 12 de Octubre + Distribuidora OKS + Distribuidora Pop + Golmarymar.
//
// Cambio clave (Paso 5A.4): el filtro de relevancia ahora exige que el
// TÍTULO del producto contenga la palabra buscada (o un alias conocido de
// esa marca). Ya no alcanza con que matchee en tags/meta, porque esos
// campos son heurísticos (inferTags) y pueden estar mal inferidos, lo que
// dejaba pasar basura como "Alfajor Escolar" al buscar "coca".
// Preferimos devolver vacío antes que mostrar un producto irrelevante.

const { searchMayorista12 } = require('./lib/mayorista12');
const { searchDistrioks } = require('./lib/distrioks');
const { searchDistribuidoraPop } = require('./lib/distribuidorapop');
const { searchGolmarymar } = require('./lib/golmarymar');

const PRODUCTS = [
  {
    id: 'oreo118', kind: 'oreo', title: 'Oreo Original 118g', meta: 'Galletitas dulces · Mondelez', providersCount: 3,
    tags: ['Golosinas', 'Galletitas', 'Mondelez'], pack: 'Paquete x 118g', keys: ['oreo', 'galletita', 'galletitas', 'mondelez'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 1790, best: true },
      { name: 'Distribuidora OKS', logo: 'OKS', price: 1850 },
      { name: 'Golomax', logo: 'Golomax', price: 1920 }
    ]
  },
  {
    id: 'oreo36', kind: 'oreo', title: 'Oreo Original 36g', meta: 'Presentación chica', providersCount: 3,
    tags: ['Golosinas', 'Galletitas', 'Unidad'], pack: 'Paquete x 36g', keys: ['oreo'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 620, best: true },
      { name: 'Distribuidora OKS', logo: 'OKS', price: 650 },
      { name: 'Golomax', logo: 'Golomax', price: 690 }
    ]
  },
  {
    id: 'oreo220', kind: 'oreo', title: 'Oreo 220g', meta: 'Pack familiar', providersCount: 3,
    tags: ['Golosinas', 'Galletitas', 'Familiar'], pack: 'Paquete x 220g', keys: ['oreo'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 3220 },
      { name: 'Distribuidora OKS', logo: 'OKS', price: 3140, best: true },
      { name: 'Golomax', logo: 'Golomax', price: 3370 }
    ]
  },
  {
    id: 'oreoBlanca', kind: 'oreo', title: 'Oreo Bañada Chocolate Blanco', meta: 'Chocolate blanco', providersCount: 2,
    tags: ['Golosinas', 'Chocolate', 'Oreo'], pack: 'Unidad', keys: ['oreo', 'bañada', 'banada', 'chocolate blanco'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 1450, best: true },
      { name: 'Golomax', logo: 'Golomax', price: 1530 }
    ]
  },
  {
    id: 'milkaOreo', kind: 'oreo', title: 'Milka Oreo 100g', meta: 'Chocolate Milka', providersCount: 2,
    tags: ['Chocolate', 'Milka', 'Oreo'], pack: 'Tableta x 100g', keys: ['oreo', 'milka', 'chocolate'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 2300, best: true },
      { name: 'Golomax', logo: 'Golomax', price: 2450 }
    ]
  },
  {
    id: 'kitkatOreo', kind: 'oreo', title: 'Kit Kat Oreo', meta: 'Chocolate', providersCount: 2,
    tags: ['Chocolate', 'Kit Kat', 'Oreo'], pack: 'Unidad', keys: ['oreo', 'kit kat', 'kitkat', 'chocolate'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 1850, best: true },
      { name: 'Golomax', logo: 'Golomax', price: 1930 }
    ]
  },
  {
    id: 'bicAzul', kind: 'bic', title: 'Bic Cristal Azul x50', meta: 'Librería · Caja x50', providersCount: 3,
    tags: ['Librería', 'Biromes', 'Bic'], pack: 'Caja x 50 unidades', keys: ['bic', 'lapicera', 'birome', 'azul'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 18400, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 19150 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 20500 }
    ]
  },
  {
    id: 'bicNegra', kind: 'bic', title: 'Bic Cristal Negra x50', meta: 'Librería · Caja x50', providersCount: 3,
    tags: ['Librería', 'Biromes', 'Bic'], pack: 'Caja x 50 unidades', keys: ['bic', 'lapicera', 'birome', 'negra', 'negro'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 18400, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 19300 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 20900 }
    ]
  },
  {
    id: 'lapizBic', kind: 'bic', title: 'Lápiz Bic Evolution', meta: 'Librería escolar', providersCount: 2,
    tags: ['Librería', 'Escolar', 'Bic'], pack: 'Pack / caja', keys: ['bic', 'lapiz', 'lápiz', 'evolution'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 8900, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 9400 }
    ]
  },
  {
    id: 'resaltadorBic', kind: 'bic', title: 'Resaltador Bic', meta: 'Librería', providersCount: 3,
    tags: ['Librería', 'Resaltadores', 'Bic'], pack: 'Unidad / pack', keys: ['bic', 'resaltador', 'marcador'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 1250, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 1320 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1500 }
    ]
  },
  {
    id: 'resmaA4', kind: 'paper', title: 'Resma A4 75g x500 hojas', meta: 'Librería · Papel', providersCount: 3,
    tags: ['Librería', 'Papel', 'Escolar'], pack: '500 hojas', keys: ['resma', 'a4', 'papel', 'hojas'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 5850, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 6100 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 6900 }
    ]
  },
  {
    id: 'coca500', kind: 'coca', title: 'Coca-Cola 500ml', meta: 'Bebidas', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 500ml', keys: ['coca', 'coca cola', 'coca-cola', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 980, best: true },
      { name: 'Masivos', logo: 'Mas', price: 1030 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1150 }
    ]
  },
  {
    id: 'coca225', kind: 'coca', title: 'Coca-Cola 2.25L', meta: 'Bebidas', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 2.25L', keys: ['coca', 'coca cola', 'coca-cola', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 2450 },
      { name: 'Masivos', logo: 'Mas', price: 2390, best: true },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 2700 }
    ]
  },
  {
    id: 'cocaLata354', kind: 'coca', title: 'Coca-Cola Lata 354ml', meta: 'Bebidas · Lata', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Lata 354ml', keys: ['coca', 'coca cola', 'coca-cola', 'lata', '354', '354ml', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 890, best: true },
      { name: 'Masivos', logo: 'Mas', price: 930 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1050 }
    ]
  },
  {
    id: 'cocaMini220', kind: 'coca', title: 'Coca-Cola Mini 220ml', meta: 'Bebidas · Mini', providersCount: 2,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botellita / lata 220ml', keys: ['coca', 'coca cola', 'mini', '220', '220ml', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 620, best: true },
      { name: 'Masivos', logo: 'Mas', price: 690 }
    ]
  },
  {
    id: 'coca600', kind: 'coca', title: 'Coca-Cola 600ml', meta: 'Bebidas · Botella', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 600ml', keys: ['coca', 'coca cola', '600', '600ml', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 1120, best: true },
      { name: 'Masivos', logo: 'Mas', price: 1180 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1300 }
    ]
  },
  {
    id: 'coca1L', kind: 'coca', title: 'Coca-Cola 1L', meta: 'Bebidas · Botella', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 1L', keys: ['coca', 'coca cola', '1l', '1 litro', '1000', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 1480, best: true },
      { name: 'Masivos', logo: 'Mas', price: 1560 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1700 }
    ]
  },
  {
    id: 'coca125', kind: 'coca', title: 'Coca-Cola 1.25L', meta: 'Bebidas · Botella', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 1.25L', keys: ['coca', 'coca cola', '1.25', '125', '1,25', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 1760, best: true },
      { name: 'Masivos', logo: 'Mas', price: 1830 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1990 }
    ]
  },
  {
    id: 'coca15', kind: 'coca', title: 'Coca-Cola 1.5L', meta: 'Bebidas · Botella', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 1.5L', keys: ['coca', 'coca cola', '1.5', '1,5', '1500', 'litro y medio', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 1980, best: true },
      { name: 'Masivos', logo: 'Mas', price: 2070 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 2250 }
    ]
  },
  {
    id: 'coca175', kind: 'coca', title: 'Coca-Cola 1.75L', meta: 'Bebidas · Botella', providersCount: 2,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 1.75L', keys: ['coca', 'coca cola', '1.75', '1,75', '1750', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 2180, best: true },
      { name: 'Masivos', logo: 'Mas', price: 2290 }
    ]
  },
  {
    id: 'coca2L', kind: 'coca', title: 'Coca-Cola 2L', meta: 'Bebidas · Botella', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 2L', keys: ['coca', 'coca cola', '2l', '2 litros', '2000', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 2280 },
      { name: 'Masivos', logo: 'Mas', price: 2220, best: true },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 2500 }
    ]
  },
  {
    id: 'coca3L', kind: 'coca', title: 'Coca-Cola 3L', meta: 'Bebidas · Botella familiar', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 3L', keys: ['coca', 'coca cola', '3l', '3 litros', '3000', 'familiar', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 3180 },
      { name: 'Masivos', logo: 'Mas', price: 3090, best: true },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 3500 }
    ]
  },
  {
    id: 'cocaZero500', kind: 'coca', title: 'Coca-Cola Zero 500ml', meta: 'Bebidas · Sin azúcar', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola Zero'], pack: 'Botella 500ml', keys: ['coca', 'coca cola', 'zero', 'sin azucar', 'sin azúcar', '500', '500ml', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 1010, best: true },
      { name: 'Masivos', logo: 'Mas', price: 1060 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1180 }
    ]
  },
  {
    id: 'cocaZero15', kind: 'coca', title: 'Coca-Cola Zero 1.5L', meta: 'Bebidas · Sin azúcar', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola Zero'], pack: 'Botella 1.5L', keys: ['coca', 'coca cola', 'zero', 'sin azucar', 'sin azúcar', '1.5', '1,5', '1500', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 2050 },
      { name: 'Masivos', logo: 'Mas', price: 1990, best: true },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 2300 }
    ]
  },
  {
    id: 'cocaZero225', kind: 'coca', title: 'Coca-Cola Zero 2.25L', meta: 'Bebidas · Sin azúcar', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola Zero'], pack: 'Botella 2.25L', keys: ['coca', 'coca cola', 'zero', 'sin azucar', 'sin azúcar', '2.25', '2,25', '2250', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 2490 },
      { name: 'Masivos', logo: 'Mas', price: 2420, best: true },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 2760 }
    ]
  }
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Paso 5A.4 — filtro de relevancia ESTRICTO basado en TÍTULO.
// Regla pedida: el título tiene que contener la palabra buscada sí o sí
// (o un alias conocido de esa misma marca/producto, ej. "coca" ~ "coca-cola").
// Ya NO se acepta un match que venga solo de tags/meta, porque esos campos
// son inferidos heurísticamente por los scrapers y pueden estar mal.
// ─────────────────────────────────────────────────────────────

const BP_STOP_TERMS = new Set(['de','del','la','el','los','las','y','en','x','por','pack','caja','cajas','unidad','unidades','u','un','una','gr','g','kg','ml','cc','lt','l','litro','litros']);

// Alias = variantes de escritura del MISMO producto/marca. No agregamos
// alias "temáticos" (como antes "bebida"/"gaseosa" para "coca"), porque eso
// es lo que dejaba pasar productos de otra marca que comparten categoría.
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

// SOLO el título. Ya no miramos meta/tags para decidir relevancia.
function bpIsRelevantResult(item, q) {
  const nq = bpNorm(q);
  if (!nq) return true;

  const title = bpNorm(item && item.title);
  if (!title) return false;

  // Match directo: el título contiene la query completa.
  if (title.includes(nq)) return true;

  // Alias de marca/producto conocido (variantes de escritura, no categorías).
  for (const rule of BP_QUERY_ALIASES) {
    if (rule.match.test(nq)) {
      return rule.any.some(alias => title.includes(bpNorm(alias)));
    }
  }

  // Búsquedas de varias palabras (ej: "coca cola 500ml"): todas las palabras
  // importantes tienen que aparecer en el título. Estricto: sin tolerancia.
  const terms = bpImportantTerms(q);
  if (!terms.length) return false;
  return terms.every(t => title.includes(t));
}

function matches(product, q) {
  const nq = normalize(q);
  if (!nq) return false;
  // El catálogo simulado también se filtra por TÍTULO (con sus keys como alias propios).
  const title = normalize(product.title);
  if (title.includes(nq)) return true;
  return (product.keys || []).some(k => nq.includes(normalize(k)) || normalize(k).includes(nq));
}

function scoreForSort(item) {
  const source = String(item.source || '');
  let score = Number(item.score || 0);
  if (source.includes('proveedor_real')) score += 1000;
  if (item.price !== null && item.price !== undefined) score += 30;
  if (item.image) score += 10;
  return score;
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
    priceText: item.priceText,
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
    map.set(key, row);
  }
  return [...map.values()].sort((x, y) => (x.price ?? Infinity) - (y.price ?? Infinity));
}

function mergeItems(realItems, fallbackItems, limit = 18) {
  const byKey = new Map();

  function add(item, isFallback = false) {
    if (!item) return;
    const key = productKey(item);
    if (!key) return;

    const prev = byKey.get(key);
    if (!prev) {
      const prices = normalizePriceRows(item);
      const minPrice = prices.map(p => p.price).filter(p => p !== null && p !== undefined).sort((a, b) => a - b)[0];
      byKey.set(key, {
        ...item,
        prices,
        price: minPrice ?? item.price ?? null,
        priceText: item.priceText,
        providersCount: prices.length || item.providersCount || 1,
        _fallbackOnly: isFallback
      });
      return;
    }

    // Si ya hay resultado real, no pisamos con uno simulado del fallback.
    if (isFallback && !prev._fallbackOnly) return;

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
      priceText: min !== undefined ? ('$' + Number(min).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : (prev.priceText || item.priceText),
      providersCount: prices.length || prev.providersCount || item.providersCount || 1,
      tags: [...new Set([...(prev.tags || []), ...(item.tags || [])])],
      source: prev.source || item.source,
      _fallbackOnly: prev._fallbackOnly && isFallback
    });
  }

  realItems.forEach(item => add(item, false));
  fallbackItems.forEach(item => add(item, true));

  return [...byKey.values()]
    .sort((a, b) => scoreForSort(b) - scoreForSort(a))
    .slice(0, limit)
    .map(({ _fallbackOnly, ...item }) => item);
}

async function fetchProviderSafely(entry, q, limit = 10) {
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
  res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=600');

  if (!q) {
    return res.status(200).json({ ok: true, step: '5A.4', q, count: 0, items: [] });
  }

  const fallbackItems = PRODUCTS
    .filter(product => matches(product, q))
    .slice(0, 15)
    .map(product => ({ ...product, source: 'catalogo_simulado_api' }));

  const providerEntries = [
    { name: 'Mayorista 12 de Octubre', source: 'proveedor_real_mayorista12', fn: searchMayorista12 },
    { name: 'Distribuidora OKS', source: 'proveedor_real_distrioks', fn: searchDistrioks },
    { name: 'Distribuidora Pop', source: 'proveedor_real_distribuidorapop', fn: searchDistribuidoraPop },
    { name: 'Golmarymar', source: 'proveedor_real_golmarymar', fn: searchGolmarymar }
  ];

  const settled = await Promise.all(providerEntries.map(entry => fetchProviderSafely(entry, q, 10)));

  const realItems = [];
  const providerErrors = [];
  const providers = [];

  for (const result of settled) {
    if (!result.ok) {
      providerErrors.push(result.error);
      continue;
    }

    const live = result.live || {};
    if (live.provider) providers.push(live.provider);
    if (Array.isArray(live.errors) && live.errors.length) providerErrors.push(...live.errors);

    for (const item of live.items || []) {
      if (!bpIsRelevantResult(item, q)) {
        providerErrors.push({ provider: result.entry.name, ignored: item.title || item.url || 'sin_titulo', reason: 'irrelevante_para_busqueda_titulo' });
        continue;
      }
      realItems.push({
        ...item,
        source: result.entry.source,
        providersCount: item.providersCount || 1
      });
    }
  }

  const items = mergeItems(realItems, fallbackItems, 18);

  return res.status(200).json({
    ok: true,
    step: '5A.4',
    q,
    count: items.length,
    realCount: realItems.length,
    fallbackCount: fallbackItems.length,
    providers,
    providerNames: providers.map(p => p.name),
    items,
    errors: providerErrors,
    note: 'Paso 5A.4: filtro de relevancia ESTRICTO por título. Si ningún resultado real tiene la palabra buscada en el título, se prefiere mostrar vacío (o solo el catálogo simulado si matchea) antes que mostrar basura.'
  });
};
