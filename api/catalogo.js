const RETAIL_API = process.env.PRECIOS_CLAROS_RETAIL_API || 'https://d3e6htiiul5ek9.cloudfront.net/prod';
const WHOLESALE_API = process.env.PRECIOS_CLAROS_WHOLESALE_API || 'https://d3e6htiiul5ek9.cloudfront.net/dev';

const DEFAULT_LOCATION = { lat: -34.6037, lng: -58.3816 };
const BRANCH_CACHE_TTL = 15 * 60 * 1000;
const branchCache = new Map();
let publicApiKeyPromise;

const BROWSER_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'es-AR,es;q=0.9',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
};

async function preciosClarosApiKey() {
  if (process.env.PRECIOS_CLAROS_API_KEY) return process.env.PRECIOS_CLAROS_API_KEY;
  if (!publicApiKeyPromise) {
    publicApiKeyPromise = fetch('https://www.preciosclaros.gob.ar/', {
      headers: { 'user-agent': BROWSER_HEADERS['user-agent'], accept: 'text/html' },
    })
      .then(async response => {
        if (!response.ok) throw new Error('No se pudo leer la configuración pública de Precios Claros');
        const html = await response.text();
        const match = html.match(/\bAPI_KEY=["']([^"']+)["']/);
        if (!match) throw new Error('Precios Claros no informó su clave pública de consulta');
        return match[1];
      })
      .catch(error => {
        publicApiKeyPromise = null;
        throw error;
      });
  }
  return publicApiKeyPromise;
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function coordinate(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function normalizeQuery(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/['&]/g, '')
    .replace(/ñ/gi, 'n');
}

async function officialJson(base, path, wholesale = false) {
  const apiKey = await preciosClarosApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  const site = wholesale ? 'https://mayoristas.preciosclaros.gob.ar' : 'https://www.preciosclaros.gob.ar';

  try {
    const response = await fetch(`${base}${path}`, {
      headers: {
        ...BROWSER_HEADERS,
        'x-api-key': apiKey,
        origin: site,
        referer: `${site}/`,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Precios Claros respondió ${response.status} sin datos válidos`);
    }
    if (!response.ok || Number(data.status) >= 400) {
      throw new Error(data.errorDescription || `Precios Claros respondió ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function branchCacheKey(kind, lat, lng) {
  return `${kind}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

async function getBranches(kind, lat, lng) {
  const key = branchCacheKey(kind, lat, lng);
  const cached = branchCache.get(key);
  if (cached && Date.now() - cached.savedAt < BRANCH_CACHE_TTL) return cached.items;

  const wholesale = kind === 'wholesale';
  const base = wholesale ? WHOLESALE_API : RETAIL_API;
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    limit: '30',
  });
  if (wholesale) params.set('entorno', 'mayoristas');
  const data = await officialJson(base, `/sucursales?${params}`, wholesale);
  const items = Array.isArray(data.sucursales) ? data.sucursales.slice(0, 30) : [];
  branchCache.set(key, { savedAt: Date.now(), items });
  if (branchCache.size > 40) branchCache.delete(branchCache.keys().next().value);
  return items;
}

function normalizeProduct(product) {
  if (!product || !product.id) return null;
  return {
    ean: String(product.id),
    name: String(product.nombre || 'Producto sin nombre'),
    brand: String(product.marca || ''),
    presentation: String(product.presentacion || ''),
  };
}

async function searchSource(kind, query, lat, lng) {
  const wholesale = kind === 'wholesale';
  const base = wholesale ? WHOLESALE_API : RETAIL_API;
  const branches = await getBranches(kind, lat, lng);
  if (!branches.length) return { branches, products: [] };

  const params = new URLSearchParams({
    string: query,
    array_sucursales: branches.map(branch => branch.id).join(','),
    offset: '0',
    limit: '50',
  });
  if (wholesale) params.set('entorno', 'mayoristas');
  const data = await officialJson(base, `/productos?${params}`, wholesale);
  return {
    branches,
    products: Array.isArray(data.productos) ? data.productos : [],
  };
}

function mergeSearchResults(retailResult, wholesaleResult) {
  const byEan = new Map();

  for (const product of retailResult?.products || []) {
    const normalized = normalizeProduct(product);
    if (!normalized) continue;
    byEan.set(normalized.ean, {
      ...normalized,
      retail: {
        min: numberOrNull(product.precioMin),
        max: numberOrNull(product.precioMax),
        stores: Number(product.cantSucursalesDisponible) || 0,
      },
      wholesale: null,
    });
  }

  for (const product of wholesaleResult?.products || []) {
    const normalized = normalizeProduct(product);
    if (!normalized) continue;
    const current = byEan.get(normalized.ean) || { ...normalized, retail: null };
    current.wholesale = {
      unitWithVatMin: numberOrNull(product.precio_unitario_bulto_min_con_iva),
      unitWithVatMax: numberOrNull(product.precio_unitario_bulto_max_con_iva),
      unitWithoutVatMin: numberOrNull(product.precio_unitario_bulto_min_sin_iva),
      unitWithoutVatMax: numberOrNull(product.precio_unitario_bulto_max_sin_iva),
      packWithVatMin: numberOrNull(product.precio_bulto_min_con_iva),
      packWithVatMax: numberOrNull(product.precio_bulto_max_con_iva),
      stores: Number(product.cantSucursalesDisponible) || 0,
    };
    byEan.set(normalized.ean, current);
  }

  return Array.from(byEan.values()).slice(0, 18);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function withoutOutliers(rows, field) {
  if (rows.length < 5) return rows;
  const values = rows.map(row => row[field]).filter(Number.isFinite).sort((a, b) => a - b);
  if (values.length < 5) return rows;
  const lower = values.slice(0, Math.floor(values.length / 2));
  const upper = values.slice(Math.ceil(values.length / 2));
  const q1 = median(lower);
  const q3 = median(upper);
  const iqr = q3 - q1;
  if (!Number.isFinite(iqr) || iqr <= 0) return rows;
  const min = q1 - 1.5 * iqr;
  const max = q3 + 1.5 * iqr;
  const filtered = rows.filter(row => row[field] >= min && row[field] <= max);
  return filtered.length ? filtered : rows;
}

function distanceMap(branches) {
  return new Map(branches.map(branch => [String(branch.id), numberOrNull(branch.distanciaNumero)]));
}

function detailBranchId(branch) {
  return `${branch.comercioId}-${branch.banderaId}-${branch.id}`;
}

async function detailSource(kind, ean, lat, lng) {
  const wholesale = kind === 'wholesale';
  const base = wholesale ? WHOLESALE_API : RETAIL_API;
  const branches = await getBranches(kind, lat, lng);
  if (!branches.length) return { product: null, rows: [] };

  const params = new URLSearchParams({
    limit: wholesale ? '30' : '50',
    id_producto: ean,
    array_sucursales: branches.map(branch => branch.id).join(','),
  });
  if (wholesale) params.set('entorno', 'mayoristas');
  const data = await officialJson(base, `/producto?${params}`, wholesale);
  const distances = distanceMap(branches);
  const sourceRows = Array.isArray(data.sucursales) ? data.sucursales : [];

  if (!wholesale) {
    const rows = sourceRows
      .filter(branch => !branch.message && !/mayorista/i.test(branch.sucursalTipo || ''))
      .map(branch => ({
        store: String(branch.banderaDescripcion || branch.comercioRazonSocial || 'Comercio'),
        address: String(branch.direccion || ''),
        locality: String(branch.localidad || ''),
        distanceKm: distances.get(detailBranchId(branch)) || null,
        price: numberOrNull(branch.preciosProducto?.precioLista),
        updatedToday: branch.actualizadoHoy === true,
      }))
      .filter(row => row.price)
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    return { product: normalizeProduct(data.producto), rows };
  }

  const rows = sourceRows
    .filter(branch => !branch.message)
    .map(branch => {
      const prices = branch.preciosProducto || {};
      const unitsPerPack = numberOrNull(branch.unidad_venta);
      const packWithVat = numberOrNull(prices.precio_bulto_con_iva);
      const packWithoutVat = numberOrNull(prices.precio_bulto_sin_iva);
      const unitWithVat = numberOrNull(prices.precio_unitario_con_iva)
        || (packWithVat && unitsPerPack ? packWithVat / unitsPerPack : null);
      const unitWithoutVat = numberOrNull(prices.precio_unitario_sin_iva)
        || (packWithoutVat && unitsPerPack ? packWithoutVat / unitsPerPack : null);
      return {
        store: String(branch.banderaDescripcion || branch.comercioRazonSocial || 'Mayorista'),
        address: String(branch.direccion || ''),
        locality: String(branch.localidad || ''),
        distanceKm: distances.get(detailBranchId(branch)) || null,
        unitWithVat,
        unitWithoutVat,
        packWithVat: packWithVat || (unitWithVat && unitsPerPack ? unitWithVat * unitsPerPack : null),
        packWithoutVat: packWithoutVat || (unitWithoutVat && unitsPerPack ? unitWithoutVat * unitsPerPack : null),
        unitsPerPack,
        updatedToday: branch.actualizadoHoy === true,
      };
    })
    .filter(row => row.unitWithVat || row.packWithVat)
    .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  return { product: normalizeProduct(data.producto), rows };
}

function reference(rows, field) {
  const cleaned = withoutOutliers(rows.filter(row => Number.isFinite(row[field])), field);
  const values = cleaned.map(row => row[field]);
  return {
    median: median(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    count: cleaned.length,
    updatedToday: cleaned.length > 0 && cleaned.every(row => row.updatedToday),
  };
}

async function productImage(ean) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=image_front_small_url,image_front_url`,
      {
        headers: { 'user-agent': 'KioscoApp/1.0 (price reference)' },
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data?.product?.image_front_url || data?.product?.image_front_small_url || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSearch(query, lat, lng) {
  const [retailSettled, wholesaleSettled] = await Promise.allSettled([
    searchSource('retail', query, lat, lng),
    searchSource('wholesale', query, lat, lng),
  ]);
  if (retailSettled.status === 'rejected' && wholesaleSettled.status === 'rejected') {
    throw retailSettled.reason;
  }
  const retail = retailSettled.status === 'fulfilled' ? retailSettled.value : null;
  const wholesale = wholesaleSettled.status === 'fulfilled' ? wholesaleSettled.value : null;
  return {
    items: mergeSearchResults(retail, wholesale),
    coverage: {
      retailBranches: retail?.branches?.length || 0,
      wholesaleBranches: wholesale?.branches?.length || 0,
    },
    sources: {
      retail: retailSettled.status === 'fulfilled',
      wholesale: wholesaleSettled.status === 'fulfilled',
    },
  };
}

async function handleDetail(ean, lat, lng) {
  const [retailSettled, wholesaleSettled, imageSettled] = await Promise.allSettled([
    detailSource('retail', ean, lat, lng),
    detailSource('wholesale', ean, lat, lng),
    productImage(ean),
  ]);
  if (retailSettled.status === 'rejected' && wholesaleSettled.status === 'rejected') {
    throw retailSettled.reason;
  }

  const retail = retailSettled.status === 'fulfilled' ? retailSettled.value : { product: null, rows: [] };
  const wholesale = wholesaleSettled.status === 'fulfilled' ? wholesaleSettled.value : { product: null, rows: [] };
  const retailReference = reference(retail.rows, 'price');
  const unitWithVat = reference(wholesale.rows, 'unitWithVat');
  const unitWithoutVat = reference(wholesale.rows, 'unitWithoutVat');
  const packWithVat = reference(wholesale.rows, 'packWithVat');
  const packWithoutVat = reference(wholesale.rows, 'packWithoutVat');
  const unitsPerPack = reference(wholesale.rows, 'unitsPerPack');

  return {
    product: retail.product || wholesale.product || { ean, name: 'Producto', brand: '', presentation: '' },
    image: imageSettled.status === 'fulfilled' ? imageSettled.value : null,
    retailReference,
    wholesaleReference: {
      unitWithVatMedian: unitWithVat.median,
      unitWithVatMin: unitWithVat.min,
      unitWithVatMax: unitWithVat.max,
      unitWithoutVatMedian: unitWithoutVat.median,
      packWithVatMedian: packWithVat.median,
      packWithoutVatMedian: packWithoutVat.median,
      unitsPerPackMedian: unitsPerPack.median,
      count: unitWithVat.count,
      updatedToday: unitWithVat.updatedToday,
    },
    retailStores: retail.rows.slice(0, 12),
    wholesaleStores: wholesale.rows.slice(0, 12),
    sources: {
      retail: retailSettled.status === 'fulfilled',
      wholesale: wholesaleSettled.status === 'fulfilled',
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const action = String(req.query.action || 'search');
  const lat = coordinate(req.query.lat, DEFAULT_LOCATION.lat, -55, -20);
  const lng = coordinate(req.query.lng, DEFAULT_LOCATION.lng, -75, -53);

  try {
    let payload;
    if (action === 'detail') {
      const ean = String(req.query.ean || '').replace(/\D/g, '').slice(0, 18);
      if (ean.length < 8) return res.status(400).json({ error: 'EAN inválido' });
      payload = await handleDetail(ean, lat, lng);
    } else {
      const query = normalizeQuery(req.query.q);
      if (query.length < 2) return res.status(400).json({ error: 'Ingresá al menos 2 caracteres' });
      payload = await handleSearch(query, lat, lng);
    }

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({
      ...payload,
      location: { lat, lng },
      checkedAt: new Date().toISOString(),
      source: 'Precios Claros (SEPA)',
    });
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'La fuente oficial tardó demasiado en responder'
      : error?.message || 'No se pudieron consultar los precios';
    return res.status(502).json({ error: message });
  }
}
