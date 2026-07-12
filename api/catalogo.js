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

// ── MercadoLibre: fotos y precios de referencia (cubre librería y kiosco) ──
// Requiere una app gratuita en developers.mercadolibre.com.ar con
// ML_CLIENT_ID / ML_CLIENT_SECRET cargados en Vercel, y ADEMÁS conectar la
// cuenta una vez entrando a /api/ml-auth: la búsqueda de ML devuelve
// "forbidden" con tokens de aplicación sola (client_credentials), solo
// funciona con un token de cuenta autorizada. Los tokens viven en la tabla
// ml_tokens de Supabase y se renuevan solos (ML rota el refresh token en
// cada renovación, por eso hay que persistirlo y no alcanza una env var).
const ML_CLIENT_ID = process.env.ML_CLIENT_ID || '';
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || '';
const SUPABASE_URL = 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_SECRET = 'sb_secret_I-zc6YWn33cDY6jfIZwyAA_lJEDHXVu';
const SB_HEADERS = { apikey: SUPABASE_SECRET, Authorization: `Bearer ${SUPABASE_SECRET}`, 'Content-Type': 'application/json' };
let mlToken = null; // cache en memoria { value, expiresAt }

function mlEnabled() {
  return Boolean(ML_CLIENT_ID && ML_CLIENT_SECRET);
}

async function mlTokensLeer() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ml_tokens?id=eq.1&select=access_token,refresh_token,expires_at`, {
      headers: SB_HEADERS,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function mlTokensGuardar(data) {
  const row = {
    id: 1,
    access_token: data.access_token || null,
    refresh_token: data.refresh_token || null,
    expires_at: new Date(Date.now() + ((Number(data.expires_in) || 21600) - 300) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await fetch(`${SUPABASE_URL}/rest/v1/ml_tokens?on_conflict=id`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
}

async function mlAccessToken(forceRefresh = false) {
  if (!mlEnabled()) return null;
  if (!forceRefresh && mlToken && Date.now() < mlToken.expiresAt) return mlToken.value;
  const row = await mlTokensLeer();
  if (!row) return null; // nunca se conectó la cuenta: falta abrir /api/ml-auth
  const dbExpiry = row.expires_at ? Date.parse(row.expires_at) : 0;
  if (!forceRefresh && row.access_token && dbExpiry > Date.now()) {
    mlToken = { value: row.access_token, expiresAt: dbExpiry };
    return mlToken.value;
  }
  if (!row.refresh_token) return null;
  try {
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        refresh_token: row.refresh_token,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) throw new Error(data?.message || 'refresh rechazado');
    await mlTokensGuardar(data); // ML rota el refresh token: persistimos el nuevo
    mlToken = { value: data.access_token, expiresAt: Date.now() + ((Number(data.expires_in) || 21600) - 300) * 1000 };
    return mlToken.value;
  } catch {
    // Otra instancia pudo renovar al mismo tiempo (y rotar el token): releemos.
    const again = await mlTokensLeer();
    if (again?.access_token && Date.parse(again.expires_at || 0) > Date.now()) {
      mlToken = { value: again.access_token, expiresAt: Date.parse(again.expires_at) };
      return mlToken.value;
    }
    return null;
  }
}

// La búsqueda general (/sites/MLA/search) devuelve "forbidden" incluso con
// token de cuenta: ML la cerró para apps nuevas. La vía que SÍ funciona es la
// búsqueda de CATÁLOGO: /products/search da los productos (nombre + id), y
// por cada uno /products/{id} trae las fotos y /products/{id}/items los
// precios reales de las publicaciones activas.
function mlSearchRequest(token, query, limit, signal) {
  const params = new URLSearchParams({ status: 'active', site_id: 'MLA', q: query, limit: String(Math.min(10, Math.max(limit, 4))) });
  return fetch(`https://api.mercadolibre.com/products/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    signal,
  });
}

// Completa un producto de catálogo con su foto y el precio mediano de sus
// publicaciones activas. Si algo falla, se descarta ese producto y listo.
async function mlHydrate(token, product, signal) {
  try {
    const headers = { Authorization: `Bearer ${token}`, accept: 'application/json' };
    const [detailRes, itemsRes] = await Promise.all([
      fetch(`https://api.mercadolibre.com/products/${product.id}`, { headers, signal }),
      fetch(`https://api.mercadolibre.com/products/${product.id}/items?limit=5`, { headers, signal }),
    ]);
    const detail = detailRes.ok ? await detailRes.json().catch(() => null) : null;
    const listing = itemsRes.ok ? await itemsRes.json().catch(() => null) : null;
    const prices = (Array.isArray(listing?.results) ? listing.results : [])
      .map(row => Number(row?.price))
      .filter(value => Number.isFinite(value) && value > 0);
    const rawUrl = detail?.pictures?.[0]?.url || null;
    return {
      id: String(product.id),
      title: String(product.name || 'Producto'),
      price: prices.length ? median(prices) : null,
      image: rawUrl ? String(rawUrl).replace(/^http:/, 'https:') : null,
      permalink: `https://www.mercadolibre.com.ar/p/${product.id}`,
    };
  } catch {
    return null;
  }
}

async function mlSearch(query, limit = 8) {
  if (!mlEnabled()) return { disabled: true, items: [] };
  let token = await mlAccessToken();
  if (!token) return { disabled: true, items: [], needsAuth: true };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    let response = await mlSearchRequest(token, query, limit, controller.signal);
    if (response.status === 401) {
      // El access token pudo vencer entre lecturas: renovamos y reintentamos una vez.
      token = await mlAccessToken(true);
      if (token) response = await mlSearchRequest(token, query, limit, controller.signal);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `MercadoLibre respondió ${response.status}`);
    const products = (Array.isArray(data?.results) ? data.results : [])
      .filter(product => product?.id && product?.name)
      .slice(0, Math.min(limit, 6));
    const hydrated = (await Promise.all(products.map(product => mlHydrate(token, product, controller.signal)))).filter(Boolean);
    // Con precio primero (manteniendo la relevancia dentro de cada grupo).
    const items = hydrated.filter(item => item.price).concat(hydrated.filter(item => !item.price));
    return { disabled: false, items };
  } finally {
    clearTimeout(timeout);
  }
}

function mlPriceReference(items) {
  const prices = items.map(item => item.price).filter(Number.isFinite);
  if (!prices.length) return null;
  return {
    median: median(prices),
    min: Math.min(...prices),
    max: Math.max(...prices),
    count: prices.length,
  };
}

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

  const product = retail.product || wholesale.product || { ean, name: 'Producto', brand: '', presentation: '' };
  let image = imageSettled.status === 'fulfilled' ? imageSettled.value : null;
  let mlRef = null;
  // MercadoLibre entra como respaldo: cuando falta la foto o no hay precio
  // minorista en Precios Claros (pasa seguido con productos de kiosco).
  if (mlEnabled() && (!image || !retailReference.count)) {
    try {
      let found = (await mlSearch(ean, 3)).items;
      if (!found.length && product.name && product.name !== 'Producto') {
        found = (await mlSearch(`${product.brand || ''} ${product.name}`.trim(), 3)).items;
      }
      if (found.length) {
        mlRef = mlPriceReference(found);
        if (!image) image = found.find(item => item.image)?.image || null;
      }
    } catch { /* ML es un extra: si falla seguimos sin él */ }
  }

  return {
    product,
    image,
    mlReference: mlRef,
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
    } else if (action === 'ml') {
      // Búsqueda directa en MercadoLibre (para librería y todo lo que
      // Precios Claros no cubre).
      const query = normalizeQuery(req.query.q);
      if (query.length < 2) return res.status(400).json({ error: 'Ingresá al menos 2 caracteres' });
      const result = await mlSearch(query, 10);
      payload = { ...result, reference: mlPriceReference(result.items) };
    } else if (action === 'foto') {
      // Solo la mejor foto para un producto cargado a mano en el catálogo.
      const query = normalizeQuery(req.query.q);
      if (query.length < 2) return res.status(400).json({ error: 'Ingresá al menos 2 caracteres' });
      const result = await mlSearch(query, 3);
      payload = { image: result.items.find(item => item.image)?.image || null, disabled: result.disabled === true };
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
