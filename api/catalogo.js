const RETAIL_API = process.env.PRECIOS_CLAROS_RETAIL_API || 'https://d3e6htiiul5ek9.cloudfront.net/prod';
const WHOLESALE_API = process.env.PRECIOS_CLAROS_WHOLESALE_API || 'https://d3e6htiiul5ek9.cloudfront.net/dev';

const DEFAULT_LOCATION = { lat: -34.6037, lng: -58.3816 };
const BRANCH_CACHE_TTL = 15 * 60 * 1000;
const branchCache = new Map();
const SUPPLIER_CACHE_TTL = 10 * 60 * 1000;
const supplierCache = new Map();
const RADAR_CACHE_TTL = 6 * 60 * 60 * 1000;
let radarCache = null;
let publicApiKeyPromise;

const CASA_PASO_URL = 'https://www.libreriamayorista.com.ar';
const DULCE_SUR_URL = 'https://oepqhdjuujfdlpjjktbs.supabase.co';
const RAPPI_URL = 'https://www.rappi.com.ar';
const INFOKIOSCOS_RANKING_URL = 'https://infokioscos.com.ar/ranking-alfajores';
const INFOKIOSCOS_API_URL = 'https://infokioscos.com.ar/wp-json/wp/v2/posts';
const ML_RADAR_HIGHLIGHT_CATEGORIES = [
  { id: 'MLA114011', label: 'Golosinas' },
  { id: 'MLA376491', label: 'Chocolates' },
];
const ML_RADAR_TREND_CATEGORIES = [
  { id: 'MLA194317', label: 'Dulces y chocolates' },
  { id: 'MLA194320', label: 'Snacks' },
  { id: 'MLA389314', label: 'Galletitas' },
  { id: 'MLA178700', label: 'Bebidas' },
];
const RADAR_WEIGHTS = { sales: 50, searches: 20, social: 15, rappi: 10, news: 5 };
const RADAR_KIOSK_BRANDS = [
  'giga', 'bon o bon', 'arcor', 'milka', 'cofler', 'block', 'rasta', 'guaymallen', 'fantoche',
  'jorgito', 'jorgelin', 'oreo', 'pepitos', 'toddy', 'bagley', 'chocolinas', 'sonrisas', 'diversion',
  'opera', 'criollitas', 'traviata', 'tentaciones', 'kesitas', 'saladix', 'mogul', 'rocklets', 'shot',
  'mantecol', 'marroc', 'cabsha', 'cadbury', 'kinder', 'ferrero', 'nutella', 'beldent', 'topline',
  'bazooka', 'flynn paff', 'palitos de la selva', 'butter toffees', 'sugus', 'media hora', 'tic tac',
  'lays', 'doritos', 'cheetos', 'twistos', 'pehuamar', 'krachitos', 'coca cola', 'sprite', 'fanta',
  'pepsi', 'manaos', 'speed', 'monster', 'red bull', 'rockstar', 'gatorade', 'powerade', 'cepita',
  'baggio', 'levite', 'villavicencio', 'eco de los andes', 'aquarius', 'picotea',
];
const RADAR_KIOSK_PRODUCTS = [
  'alfajor', 'alfajores', 'chocolate', 'chocolates', 'bombon', 'bombones', 'caramelo', 'caramelos',
  'chicle', 'chicles', 'gomita', 'gomitas', 'galleta', 'galletas', 'galletita', 'galletitas', 'oblea',
  'obleas', 'turron', 'turrones', 'chupetin', 'chupetines', 'pastilla', 'pastillas', 'snack', 'snacks',
  'papas fritas', 'nachos', 'palitos', 'pochoclo', 'mani', 'bizcochito', 'bizcochitos', 'barrita',
  'barritas', 'gaseosa', 'gaseosas', 'jugo', 'jugos', 'agua saborizada', 'aguas saborizadas',
  'energizante', 'energizantes', 'isotonica', 'isotonicas', 'soda',
];
const RADAR_EXCLUDED_PRODUCTS = [
  'soju', 'sake', 'whisky', 'vodka', 'gin', 'licor', 'champagne', 'espumante', 'vino', 'nuez', 'nueces',
  'castana', 'castanas', 'almendra', 'almendras', 'semilla', 'semillas', 'proteina', 'suplemento',
  'cafe en grano', 'capsula', 'capsulas', 'te en hebras', 'alimento para', 'comida para', 'mayonesa',
  'aceite', 'arroz', 'fideo', 'fideos', 'harina',
];
const RADAR_GENERIC_QUERIES = new Set([
  'alfajor', 'alfajores', 'chocolate', 'chocolates', 'bombon', 'bombones', 'caramelo', 'caramelos',
  'galleta', 'galletas', 'galletita', 'galletitas', 'golosina', 'golosinas', 'snack', 'snacks',
  'bebida', 'bebidas', 'gaseosa', 'gaseosas', 'agua', 'aguas', 'jugo', 'jugos', 'energizante', 'energizantes',
]);
// Clave anon pública usada por la propia tienda. RLS limita el acceso a su catálogo visible.
const DULCE_SUR_PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lcHFoZGp1dWpmZGxwamprdGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MTM5MjIsImV4cCI6MjA4OTE4OTkyMn0.XxT5AUQRrYZmxVF66OXdM895JOVeEcjJGKE9OwwM8Xs';

const CABA_RETAIL_ANCHORS = [
  { lat: -34.6037, lng: -58.3816 }, // Centro
  { lat: -34.5875, lng: -58.3974 }, // Recoleta
  { lat: -34.5711, lng: -58.4233 }, // Palermo
  { lat: -34.6187, lng: -58.4425 }, // Caballito
  { lat: -34.6282, lng: -58.4631 }, // Flores
  { lat: -34.5627, lng: -58.4583 }, // Belgrano
];

const RADAR_FALLBACK = [
  {
    id: 'giga-spreen', name: 'GIGA x Spreen', query: 'alfajor GIGA Spreen', signal: 'Más pedido en 365',
    note: 'Fenómeno de venta informado por la cadena 365 Kioscos.', scope: '365 Kioscos', date: '2026-07-02',
    sourceLabel: 'Infokioscos', sourceUrl: 'https://infokioscos.com.ar/122816/furor-por-el-alfajor-giga-a-dos-meses-de-su-lanzamiento-rompe-records-en-ventas.html',
  },
  {
    id: 'bon-o-bon', name: 'Bon o Bon', query: 'bon o bon clasico', signal: '57% de las menciones',
    note: 'Lideró el relevamiento de la Semana de la Dulzura.', scope: 'Argentina', date: '2026-07-02',
    sourceLabel: 'Infokioscos', sourceUrl: 'https://infokioscos.com.ar/118545/semana-de-la-dulzura-las-5-golosinas-mas-vendidas-en-kioscos-de-argentina.html',
  },
  {
    id: 'cofler-block', name: 'Cofler Block', query: 'chocolate Cofler Block', signal: '15% de las menciones',
    note: 'Segundo producto destacado en la Semana de la Dulzura.', scope: 'Argentina', date: '2026-07-02',
    sourceLabel: 'Infokioscos', sourceUrl: 'https://infokioscos.com.ar/118545/semana-de-la-dulzura-las-5-golosinas-mas-vendidas-en-kioscos-de-argentina.html',
  },
  {
    id: 'picotea', name: 'Picoteá Arcor', query: 'Picotea Arcor', signal: 'Lanzamiento reciente',
    note: 'Bon o Bon, Block y Rocklets en formato de consumo al paso.', scope: 'Argentina', date: '2026-06-18',
    sourceLabel: 'Infokioscos', sourceUrl: 'https://infokioscos.com.ar/122631/arcor-lanza-picotea-la-nueva-linea-de-snacks-con-sus-chocolates-mas-populares.html',
  },
];

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
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SB_HEADERS = { apikey: SUPABASE_SECRET, Authorization: `Bearer ${SUPABASE_SECRET}`, 'Content-Type': 'application/json' };
let mlToken = null; // cache en memoria { value, expiresAt }

function mlEnabled() {
  return Boolean(ML_CLIENT_ID && ML_CLIENT_SECRET && SUPABASE_URL && SUPABASE_SECRET);
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

// La búsqueda general (/sites/MLA/search) devuelve "forbidden" para apps
// nuevas. /products/search sigue disponible para identificar variantes.
function mlText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mlAttribute(product, id) {
  const attribute = (product?.attributes || []).find(entry => entry?.id === id);
  return String(attribute?.value_name || attribute?.values?.[0]?.name || '').trim();
}

function mlQueryTokens(query) {
  const ignored = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'con', 'para', 'por', 'un', 'una']);
  return mlText(query).split(' ').filter(token => token.length > 1 && !ignored.has(token));
}

function textRelevance(title, query) {
  const text = mlText(title);
  const queryText = mlText(query);
  const tokens = mlQueryTokens(query);
  let score = text === queryText ? 70 : (text.startsWith(queryText) ? 42 : (text.includes(queryText) ? 28 : 0));
  const matched = tokens.filter(token => text.includes(token)).length;
  score += tokens.length ? (matched / tokens.length) * 35 : 0;
  score -= (tokens.length - matched) * 16;
  return score;
}

function mlRelevance(product, query) {
  const title = mlText(product?.name);
  const queryText = mlText(query);
  const tokens = mlQueryTokens(query);
  const gtin = mlText(mlAttribute(product, 'GTIN'));
  let score = 0;
  if (/^\d{8,18}$/.test(queryText) && gtin === queryText) score += 120;
  if (title === queryText) score += 50;
  else if (title.startsWith(queryText)) score += 28;
  else if (title.includes(queryText)) score += 18;
  const matched = tokens.filter(token => title.includes(token)).length;
  score += tokens.length ? (matched / tokens.length) * 28 : 0;
  score -= (tokens.length - matched) * 12;
  const queryWords = new Set(queryText.split(' '));
  const noisyWords = ['combo', 'kit', 'impresora', 'cartucho', 'toner', 'sublimacion', 'compatible', 'fotocopiadora'];
  noisyWords.forEach(word => { if (title.includes(word) && !queryWords.has(word)) score -= 18; });
  score -= Math.max(0, title.split(' ').length - queryText.split(' ').length - 5) * 0.6;
  return score;
}

function mlSearchRequest(token, query, limit, signal) {
  const params = new URLSearchParams({ status: 'active', site_id: 'MLA', q: query, limit: String(Math.min(25, Math.max(limit * 2, 12))) });
  return fetch(`https://api.mercadolibre.com/products/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    signal,
  });
}

function mlPresentation(product) {
  const parts = [];
  const add = value => { if (value && !parts.includes(value)) parts.push(value); };
  add(mlAttribute(product, 'PAPER_SIZE'));
  const sheets = mlAttribute(product, 'SHEETS_NUMBER');
  if (sheets) add(`${sheets} hojas`);
  add(mlAttribute(product, 'GRAMMAGE'));
  add(mlAttribute(product, 'SALE_FORMAT'));
  const units = mlAttribute(product, 'UNITS_PER_PACK');
  if (units && units !== '1') add(`x${units}`);
  add(mlAttribute(product, 'POINT_TYPE'));
  add(mlAttribute(product, 'INK_COLOR'));
  return parts.slice(0, 4).join(' · ');
}

function mlSuggestedCategory(product) {
  const domain = String(product?.domain_id || '').toUpperCase();
  if (/(SCHOOL|OFFICE|STATIONERY|PAPER|PEN|PENCIL|MARKER|NOTEBOOK|FOLDER|ART_SUPPL)/.test(domain)) return 'Librería';
  return '';
}

function mlReferenceFromDetail(detail) {
  const winner = numberOrNull(detail?.buy_box_winner?.price);
  const rangeMin = numberOrNull(detail?.buy_box_winner_price_range?.min?.price);
  const rangeMax = numberOrNull(detail?.buy_box_winner_price_range?.max?.price);
  if (!winner && !rangeMin && !rangeMax) return null;
  const min = rangeMin || winner || rangeMax;
  const max = rangeMax || winner || rangeMin;
  return { median: winner || ((min + max) / 2), min, max, count: 1, updatedToday: false };
}

// Desde octubre de 2025 Mercado Libre retiró /products/{id}/items.
// El contrato vigente publica precio sólo cuando existe buy_box_winner.
async function mlHydrate(token, product, signal) {
  try {
    const headers = { Authorization: `Bearer ${token}`, accept: 'application/json' };
    const detailRes = await fetch(`https://api.mercadolibre.com/products/${product.id}`, { headers, signal });
    const detail = detailRes.ok ? await detailRes.json().catch(() => null) : null;
    if (!detail) return null;
    const reference = mlReferenceFromDetail(detail);
    const rawUrl = detail?.pictures?.[0]?.url || product?.pictures?.[0]?.url || null;
    return {
      id: String(product.id),
      title: String(detail.name || product.name || 'Producto'),
      price: reference?.median || null,
      reference,
      image: rawUrl ? String(rawUrl).replace(/^http:/, 'https:') : null,
      permalink: detail.permalink || `https://www.mercadolibre.com.ar/p/${product.id}`,
      brand: mlAttribute(detail, 'BRAND') || mlAttribute(product, 'BRAND'),
      ean: mlAttribute(detail, 'GTIN') || mlAttribute(product, 'GTIN') || null,
      presentation: mlPresentation(detail) || mlPresentation(product),
      suggestedCategory: mlSuggestedCategory(detail) || mlSuggestedCategory(product),
      domainId: detail.domain_id || product.domain_id || '',
      relevance: Number(product._relevance) || 0,
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
      .map(product => ({ ...product, _relevance: mlRelevance(product, query) }))
      .sort((a, b) => b._relevance - a._relevance)
      .slice(0, Math.min(limit, 8));
    const hydrated = (await Promise.all(products.map(product => mlHydrate(token, product, controller.signal)))).filter(Boolean);
    return { disabled: false, items: hydrated.sort((a, b) => b.relevance - a.relevance) };
  } finally {
    clearTimeout(timeout);
  }
}

function supplierCacheGet(key) {
  const cached = supplierCache.get(key);
  return cached && Date.now() - cached.savedAt < SUPPLIER_CACHE_TTL ? cached.value : null;
}

function supplierCacheSet(key, value) {
  supplierCache.set(key, { savedAt: Date.now(), value });
  if (supplierCache.size > 80) supplierCache.delete(supplierCache.keys().next().value);
  return value;
}

function htmlText(value) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ' };
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-z]+);/gi, (_, name) => entities[name.toLowerCase()] || `&${name};`)
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlClass(block, className) {
  const match = block.match(new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i'));
  return htmlText(match?.[1]);
}

function sitePrice(value) {
  const raw = String(value || '').replace(/[^\d.,-]/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',') && raw.includes('.')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(',', '.');
  return numberOrNull(normalized);
}

async function supplierFetch(url, options = {}, timeoutMs = 6500, windowsEncoding = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder(windowsEncoding ? 'windows-1252' : 'utf-8').decode(buffer);
    if (!response.ok) throw new Error(`El proveedor respondió ${response.status}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function casaPasoQuery(query) {
  return normalizeQuery(query)
    .replace(/\bbiromes?\b/gi, 'boligrafo')
    .replace(/\bfibrones?\b/gi, 'marcador')
    .replace(/\bhojas?\s+a4\b/gi, 'resma a4');
}

async function casaPasoSearch(query, limit = 10) {
  const translated = casaPasoQuery(query);
  const cacheKey = `casa:${mlText(translated)}:${limit}`;
  const cached = supplierCacheGet(cacheKey);
  if (cached) return cached;
  const html = await supplierFetch(`${CASA_PASO_URL}/traerproductos.php`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': BROWSER_HEADERS['user-agent'],
      referer: `${CASA_PASO_URL}/`,
    },
    body: new URLSearchParams({ opc: '2', busqueda: translated, pagina: '1' }),
  }, 6500, true);
  const items = html.split(/<div id="" class="div-producto">/i).slice(1).map(block => {
    const code = block.match(/detalle_producto\('([^']+)'\)/i)?.[1] || '';
    const imagePath = block.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
    const priceRaw = block.match(/class=["']p-precio-oferta["'][^>]*>\s*\$?([\d.,]+)/i)?.[1];
    const title = htmlClass(block, 'p-descrip');
    const family = htmlClass(block, 'p-titulo');
    if (!code || !title) return null;
    const familyParts = family.split(/\s+-\s+/);
    return {
      id: `casa:${code}`,
      source: 'casa-paso',
      sourceLabel: 'Casa Paso',
      code,
      title,
      brand: familyParts[1] || '',
      presentation: familyParts[0] || 'Librería',
      category: 'Librería',
      unitPrice: sitePrice(priceRaw),
      packPrice: null,
      packUnits: null,
      minimum: null,
      stock: null,
      available: true,
      image: imagePath ? new URL(imagePath, `${CASA_PASO_URL}/`).href : null,
      permalink: `${CASA_PASO_URL}/index.php?codigo=${encodeURIComponent(code)}`,
      relevance: textRelevance(`${family} ${title}`, translated),
    };
  }).filter(Boolean).sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  return supplierCacheSet(cacheKey, items);
}

async function casaPasoDetail(code) {
  const safeCode = String(code || '').replace(/[^a-z0-9-]/gi, '').slice(0, 30);
  if (!safeCode) throw new Error('Código de Casa Paso inválido');
  const cacheKey = `casa-detail:${safeCode}`;
  const cached = supplierCacheGet(cacheKey);
  if (cached) return cached;
  const html = await supplierFetch(`${CASA_PASO_URL}/detalle_producto.php`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': BROWSER_HEADERS['user-agent'],
      referer: `${CASA_PASO_URL}/`,
    },
    body: new URLSearchParams({ codigo: safeCode }),
  }, 6500, true);
  const add = html.match(/agregar_producto\('([^']*)','((?:\\'|[^'])*)',([\d.]+),([\d.]+),'([^']*)',(\d+),(\d+)\)/i);
  const title = htmlClass(html, 'p-texto-ft') || 'Producto de librería';
  const heading = htmlClass(html, 'p-detalle-titulo');
  const imagePath = html.match(/class=["'][^"']*p-img-detalle[^"']*["'][\s\S]*?<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
  const unitPrice = sitePrice(add?.[3]) || sitePrice(html.match(/class=["']p-cantidades-ft["'][^>]*>\s*\$?([\d.,]+)/i)?.[1]);
  const minimum = Number(add?.[6]) || 1;
  const packUnits = Number(add?.[7]) || null;
  const familyParts = heading.split(/\s+-\s+/);
  return supplierCacheSet(cacheKey, {
    id: `casa:${safeCode}`,
    source: 'casa-paso',
    sourceLabel: 'Casa Paso',
    code: safeCode,
    title: title.replace(/\\'/g, "'"),
    brand: familyParts[1] || '',
    presentation: [minimum > 1 ? `Mínimo x${minimum}` : '', packUnits ? `Bulto x${packUnits}` : ''].filter(Boolean).join(' · ') || 'Venta mayorista',
    category: 'Librería',
    unitPrice,
    packPrice: unitPrice && packUnits ? unitPrice * packUnits : null,
    packUnits,
    minimum,
    stock: null,
    available: true,
    image: imagePath ? new URL(imagePath, `${CASA_PASO_URL}/`).href : null,
    permalink: `${CASA_PASO_URL}/index.php?codigo=${encodeURIComponent(safeCode)}`,
  });
}

function dulceSurSlug(title, id) {
  const slug = mlText(title).replace(/\s+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${String(id).slice(0, 8)}`;
}

async function dulceSurJson(table, params) {
  const response = await fetch(`${DULCE_SUR_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: DULCE_SUR_PUBLIC_KEY,
      Authorization: `Bearer ${DULCE_SUR_PUBLIC_KEY}`,
      accept: 'application/json',
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data)) throw new Error(data?.message || `Dulce Sur respondió ${response.status}`);
  return data;
}

async function dulceSurSearch(query, limit = 10) {
  const queryText = normalizeQuery(query);
  const cacheKey = `dulce:${mlText(queryText)}:${limit}`;
  const cached = supplierCacheGet(cacheKey);
  if (cached) return cached;
  const tokens = mlQueryTokens(queryText).slice(0, 4);
  if (!tokens.length) return [];
  const params = new URLSearchParams({
    select: 'id,codigo,nombre,precio,precio_oferta,imagen_url,stock,fecha_actualizacion,mostrar_precio_unidad,categorias(nombre),marcas(nombre)',
    activo: 'eq.true',
    visibilidad: 'eq.visible',
    limit: String(Math.min(24, Math.max(limit * 2, 12))),
  });
  params.set('and', `(${tokens.map(token => `nombre.ilike.*${token}*`).join(',')})`);
  const products = await dulceSurJson('productos', params);
  if (!products.length) return supplierCacheSet(cacheKey, []);
  const presentationParams = new URLSearchParams({
    select: 'producto_id,nombre,cantidad,precio,precio_oferta,sku',
    producto_id: `in.(${products.map(product => product.id).join(',')})`,
    order: 'cantidad.asc',
  });
  const presentations = await dulceSurJson('presentaciones', presentationParams).catch(() => []);
  const byProduct = new Map();
  presentations.forEach(row => {
    if (!byProduct.has(row.producto_id)) byProduct.set(row.producto_id, []);
    byProduct.get(row.producto_id).push(row);
  });
  const items = products.map(product => {
    const rows = byProduct.get(product.id) || [];
    const priced = rows.map(row => ({
      ...row,
      quantity: Math.max(1, Number(row.cantidad) || 1),
      effectivePrice: numberOrNull(row.precio_oferta) || numberOrNull(row.precio),
    })).filter(row => row.effectivePrice);
    const unit = priced.find(row => row.quantity === 1);
    const packs = priced.filter(row => row.quantity > 1).sort((a, b) => (a.effectivePrice / a.quantity) - (b.effectivePrice / b.quantity));
    const bestPack = packs[0] || null;
    const publicUnit = unit?.effectivePrice || numberOrNull(product.precio_oferta) || numberOrNull(product.precio);
    const bestUnit = bestPack ? Math.min(publicUnit || Infinity, bestPack.effectivePrice / bestPack.quantity) : publicUnit;
    const brand = Array.isArray(product.marcas) ? product.marcas[0]?.nombre : product.marcas?.nombre;
    const category = Array.isArray(product.categorias) ? product.categorias[0]?.nombre : product.categorias?.nombre;
    return {
      id: `dulce:${product.id}`,
      source: 'dulce-sur',
      sourceLabel: 'Dulce Sur',
      code: product.codigo || unit?.sku || '',
      title: product.nombre,
      brand: brand || '',
      presentation: bestPack?.nombre || unit?.nombre || 'Unidad',
      category: category || 'Kiosco varios',
      unitPrice: Number.isFinite(bestUnit) ? bestUnit : publicUnit,
      shelfPrice: publicUnit,
      packPrice: bestPack?.effectivePrice || null,
      packUnits: bestPack?.quantity || null,
      minimum: 1,
      stock: Number(product.stock) || 0,
      available: Number(product.stock) > 0,
      image: product.imagen_url || null,
      permalink: `https://www.dulcesur.com/productos/${dulceSurSlug(product.nombre, product.id)}`,
      updatedAt: product.fecha_actualizacion || null,
      relevance: textRelevance(`${brand || ''} ${product.nombre}`, queryText),
    };
  }).sort((a, b) => Number(b.available) - Number(a.available) || b.relevance - a.relevance).slice(0, limit);
  return supplierCacheSet(cacheKey, items);
}

function rappiQuery(query) {
  return normalizeQuery(query)
    .replace(/\bbonobon\b/gi, 'bon o bon')
    .replace(/\bblack\b/gi, 'negro');
}

function ldProducts(value, output) {
  if (!value || typeof value !== 'object') return;
  if (value['@type'] === 'Product') output.push(value);
  if (Array.isArray(value)) value.forEach(entry => ldProducts(entry, output));
  else Object.values(value).forEach(entry => ldProducts(entry, output));
}

function offerPrices(offers) {
  const rows = Array.isArray(offers) ? offers : [offers];
  const prices = [];
  rows.filter(Boolean).forEach(offer => {
    const direct = numberOrNull(offer.price);
    const low = numberOrNull(offer.lowPrice);
    const high = numberOrNull(offer.highPrice);
    if (direct) prices.push(direct);
    if (low) prices.push(low);
    if (high && high !== low) prices.push(high);
  });
  return prices;
}

function productBrand(title) {
  const text = mlText(title);
  const known = ['rasta', 'milka', 'guaymallen', 'fantoche', 'jorgito', 'aguila', 'terrabusi', 'tatin', 'jorgelin', 'cofler', 'bon o bon', 'mogul', 'oreo', 'arcor'];
  const found = known.find(brand => text.includes(brand));
  if (!found) return '';
  return found.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

async function rappiSearch(query, limit = 10) {
  const translated = rappiQuery(query);
  const cacheKey = `rappi:${mlText(translated)}`;
  const cached = supplierCacheGet(cacheKey);
  if (cached) return cached.slice(0, limit);
  const html = await supplierFetch(`${RAPPI_URL}/search?query=${encodeURIComponent(translated)}`, {
    headers: { ...BROWSER_HEADERS, accept: 'text/html,application/xhtml+xml' },
  }, 10000);
  const grouped = new Map();
  const scripts = html.matchAll(/<script([^>]*)type=["']application\/ld\+json["']([^>]*)>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    let data;
    try { data = JSON.parse(match[3]); } catch { continue; }
    const products = [];
    ldProducts(data, products);
    const scriptAttrs = `${match[1]} ${match[2]}`;
    const storeId = scriptAttrs.match(/cpg-carousel-schema-([\d-]+)/i)?.[1] || '';
    products.forEach(product => {
      const title = htmlText(product.name);
      const permalink = String(product.url || '');
      const productId = permalink.match(/-(\d+)(?:\?.*)?$/)?.[1] || mlText(title);
      const prices = offerPrices(product.offers);
      if (!title || !prices.length || !permalink.startsWith('https://www.rappi.com.ar/')) return;
      const current = grouped.get(productId) || { title, permalink, image: String(product.image || ''), prices: [], stores: new Set() };
      current.prices.push(...prices);
      if (storeId) current.stores.add(storeId);
      grouped.set(productId, current);
    });
  }
  const items = Array.from(grouped.entries()).map(([productId, product]) => {
    const relevance = textRelevance(product.title, translated);
    const prices = product.prices.filter(Number.isFinite);
    const presentation = product.title.match(/\b\d+(?:[.,]\d+)?\s*(?:g|gr|kg|ml|cc|l)\b/i)?.[0] || 'Unidad';
    return {
      id: `rappi:${productId}`,
      source: 'rappi',
      sourceLabel: 'Rappi Buenos Aires',
      priceType: 'retail',
      code: productId,
      title: product.title,
      brand: productBrand(product.title),
      presentation,
      category: 'Kiosco',
      unitPrice: median(prices),
      retailMin: Math.min(...prices),
      retailMax: Math.max(...prices),
      storeCount: Math.max(1, product.stores.size),
      packPrice: null,
      packUnits: null,
      minimum: 1,
      stock: null,
      available: true,
      image: /^https:\/\//.test(product.image) ? product.image : null,
      permalink: product.permalink,
      updatedAt: new Date().toISOString(),
      relevance,
    };
  }).filter(item => item.relevance >= 20).sort((a, b) => b.relevance - a.relevance || a.unitPrice - b.unitPrice).slice(0, 20);
  supplierCacheSet(cacheKey, items);
  return items.slice(0, limit);
}

// ── Open 25: cadena de drugstores/kioscos con tienda online ──
// La tienda corre en Tiendanube y no tiene API pública, pero el HTML trae
// todo en cada tarjeta de producto: data-product-id, el nombre, el link, la
// foto (data-srcset) y el precio en CENTAVOS en data-product-price. Precio
// real de venta al público de una cadena de kioscos — la referencia
// minorista más directa para este rubro.
function open25Card(card) {
  const title = htmlText(card.match(/data-store="product-item-name-\d+"[^>]*>([^<]*)</)?.[1]);
  const cents = Number(card.match(/data-product-price="(\d+)"/)?.[1]);
  if (!title || !Number.isFinite(cents) || cents <= 0) return null;
  const srcset = card.match(/data-srcset="([^"]+)"/)?.[1] || '';
  const image = srcset.match(/(\/\/[^\s,"]+)\s+480w/)?.[1] || srcset.match(/(\/\/[^\s,"]+)\s+\d+w/)?.[1] || null;
  return {
    productId: card.match(/data-product-id="(\d+)"/)?.[1] || mlText(title).replace(/ /g, '-'),
    title,
    price: cents / 100,
    image: image ? `https:${image}` : null,
    permalink: card.match(/href="(https:\/\/tienda\.open25\.com\.ar\/productos\/[^"]+)"/)?.[1] || null,
    // El cartel "Sin stock" viene en TODAS las tarjetas; cuando hay stock
    // llega oculto con style="display:none". Solo cuenta si está visible.
    outOfStock: (() => {
      const label = card.match(/data-store="product-item-label-stock"([^>]*)>/)?.[1];
      return Boolean(label) && !/display\s*:\s*none/i.test(label);
    })(),
  };
}

async function open25Search(query, limit = 10) {
  const queryText = normalizeQuery(query);
  const cacheKey = `open25:${mlText(queryText)}`;
  const cached = supplierCacheGet(cacheKey);
  if (cached) return cached.slice(0, limit);
  const html = await supplierFetch(`https://tienda.open25.com.ar/search/?q=${encodeURIComponent(queryText)}`, {
    headers: { ...BROWSER_HEADERS, accept: 'text/html,application/xhtml+xml' },
  }, 10000);
  const items = [];
  for (const card of html.split('class="js-item-product').slice(1)) {
    const parsed = open25Card(card);
    if (!parsed) continue;
    items.push({
      id: `open25:${parsed.productId}`,
      source: 'open25',
      sourceLabel: 'Open 25',
      priceType: 'retail',
      code: parsed.productId,
      title: parsed.title,
      brand: productBrand(parsed.title),
      presentation: parsed.title.match(/\b\d+(?:[.,]\d+)?\s*(?:g|gr|grs|kg|ml|cc|l|lt|un)\b/i)?.[0] || 'Unidad',
      category: 'Kiosco',
      unitPrice: parsed.price,
      retailMin: parsed.price,
      retailMax: parsed.price,
      storeCount: 1,
      packPrice: null,
      packUnits: null,
      minimum: 1,
      stock: parsed.outOfStock ? 0 : null,
      available: !parsed.outOfStock,
      image: parsed.image,
      permalink: parsed.permalink || `https://tienda.open25.com.ar/search/?q=${encodeURIComponent(queryText)}`,
      updatedAt: new Date().toISOString(),
      relevance: textRelevance(parsed.title, queryText),
    });
  }
  const ranked = items.filter(item => item.relevance >= 20)
    .sort((a, b) => b.relevance - a.relevance || a.unitPrice - b.unitPrice)
    .slice(0, 20);
  supplierCacheSet(cacheKey, ranked);
  return ranked.slice(0, limit);
}

// Vidriera "Los más elegidos" de la home de Open 25 (bloque "featured" del
// theme, clase estable js-products-featured-title aunque cambien el texto).
// Alimenta la pestaña "Más vendidos" del radar: se refresca sola cuando la
// cadena cambia la vidriera, con el mismo cache de 6 h del radar.
async function open25Destacados(limit = 30) {
  const cacheKey = 'open25:destacados';
  const cached = supplierCacheGet(cacheKey);
  if (cached) return cached.slice(0, limit);
  const html = await supplierFetch('https://tienda.open25.com.ar/', {
    headers: { ...BROWSER_HEADERS, accept: 'text/html,application/xhtml+xml' },
  }, 10000);
  const start = html.indexOf('js-products-featured-title');
  if (start === -1) return [];
  const section = html.slice(start);
  const end = section.search(/js-products-(?:new|best-seller|sale)-title/);
  const sectionHtml = end > 0 ? section.slice(0, end) : section;
  const rawTitle = htmlText(section.match(/^[^>]*>([^<]*)</)?.[1]).replace(/[^\p{L}\p{N} ]/gu, '').trim();
  const sectionTitle = rawTitle ? rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1).toLowerCase() : 'Los más elegidos';
  const today = new Date().toISOString().slice(0, 10);
  const items = [];
  for (const card of sectionHtml.split('class="js-item-product').slice(1)) {
    const parsed = open25Card(card);
    if (!parsed) continue;
    const rank = items.length + 1;
    const priceText = `$${parsed.price.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
    items.push({
      id: `open25-destacado-${parsed.productId}`,
      type: 'ranking',
      rank,
      name: parsed.title,
      query: parsed.title,
      signal: `#${rank} en la vidriera · ${priceText}${parsed.outOfStock ? ' · sin stock online' : ''}`,
      note: `Vidriera “${sectionTitle}” de la tienda online de Open 25. Cambia cuando la cadena la actualiza.`,
      scope: 'Open 25 · tienda online',
      date: today,
      sourceLabel: 'Open 25',
      sourceUrl: parsed.permalink,
      publicationUrl: parsed.permalink,
      publicationLabel: 'Ver en la tienda de Open 25',
      image: parsed.image,
      confidence: 0,
    });
    if (items.length >= limit) break;
  }
  if (items.length) supplierCacheSet(cacheKey, items);
  return items;
}

async function radarArticleImage(url) {
  try {
    const html = await supplierFetch(url, { headers: { ...BROWSER_HEADERS, accept: 'text/html' } }, 5000);
    const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    return /^https:\/\//.test(image || '') ? image : null;
  } catch {
    return null;
  }
}

function radarTokens(value) {
  const ignored = new Set([
    'alfajor', 'alfajores', 'chocolate', 'chocolates', 'golosina', 'golosinas', 'snack', 'snacks',
    'caja', 'pack', 'unidad', 'unidades', 'gramos', 'grs', 'para', 'con', 'del', 'las', 'los', 'una',
    'nuevo', 'nueva', 'oferta', 'venta', 'mayorista', 'argentina', 'kiosco', 'kioscos',
  ]);
  return Array.from(new Set(mlText(value).split(' ')
    .filter(token => token.length > 2 && !ignored.has(token) && !/^\d+$/.test(token))));
}

function radarHasPhrase(value, phrases) {
  const normalized = ` ${mlText(value)} `;
  return phrases.some(phrase => normalized.includes(` ${mlText(phrase)} `));
}

function isKioskRadarCandidate(candidate) {
  if (candidate?.salesRank || candidate?.newsScore) return true;
  const name = String(candidate?.name || '');
  const trustedBrand = radarHasPhrase(name, RADAR_KIOSK_BRANDS);
  if (radarHasPhrase(name, RADAR_EXCLUDED_PRODUCTS) && !trustedBrand) return false;
  return trustedBrand || radarHasPhrase(name, RADAR_KIOSK_PRODUCTS);
}

function isGenericRadarQuery(value) {
  return RADAR_GENERIC_QUERIES.has(mlText(value));
}

function radarSimilarity(left, right) {
  const a = new Set(radarTokens(left));
  const b = new Set(radarTokens(right));
  if (!a.size || !b.size) return 0;
  const matches = [...a].filter(token => b.has(token)).length;
  return matches / Math.max(a.size, b.size);
}

function mergeRadarCandidate(candidates, incoming) {
  const match = candidates.find(candidate => (
    (candidate.ean && incoming.ean && String(candidate.ean) === String(incoming.ean))
    || radarSimilarity(`${candidate.brand || ''} ${candidate.name}`, `${incoming.brand || ''} ${incoming.name}`) >= 0.5
  ));
  if (!match) {
    candidates.push({
      salesScore: 0,
      searchScore: 0,
      newsScore: 0,
      rappiScore: 0,
      sources: [],
      ...incoming,
      sources: Array.from(new Set(incoming.sources || [])),
    });
    return;
  }
  match.salesScore = Math.max(match.salesScore || 0, incoming.salesScore || 0);
  match.searchScore = Math.max(match.searchScore || 0, incoming.searchScore || 0);
  match.newsScore = Math.max(match.newsScore || 0, incoming.newsScore || 0);
  if (incoming.salesRank && (!match.salesRank || incoming.salesRank < match.salesRank)) {
    match.salesRank = incoming.salesRank;
    match.salesCategory = incoming.salesCategory;
  }
  if (incoming.searchPosition && (!match.searchPosition || incoming.searchPosition < match.searchPosition)) {
    match.searchPosition = incoming.searchPosition;
    match.searchKind = incoming.searchKind;
  }
  ['brand', 'ean', 'image', 'permalink', 'sourceUrl', 'category', 'newsUrl', 'newsDate', 'newsTitle'].forEach(key => {
    if (!match[key] && incoming[key]) match[key] = incoming[key];
  });
  match.sources = Array.from(new Set([...(match.sources || []), ...(incoming.sources || [])]));
}

async function mlRadarJson(token, path, signal) {
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `MercadoLibre respondió ${response.status}`);
  return data;
}

async function mlRadarProduct(token, row, category, signal) {
  if (!row?.id || !['PRODUCT', 'ITEM', 'USER_PRODUCT'].includes(row.type)) return null;
  const endpoint = row.type === 'PRODUCT'
    ? `/products/${row.id}`
    : row.type === 'USER_PRODUCT'
      ? `/user-products/${row.id}`
      : `/items/${row.id}`;
  try {
    const detail = await mlRadarJson(token, endpoint, signal);
    const name = String(detail?.name || detail?.title || '').trim();
    if (!name) return null;
    const rawImage = detail?.pictures?.[0]?.url || detail?.thumbnail || null;
    const productUrl = detail.permalink || (row.type === 'USER_PRODUCT'
      ? `https://listado.mercadolibre.com.ar/${mlText(name).replace(/\s+/g, '-')}`
      : `https://www.mercadolibre.com.ar/p/${row.id}`);
    const salesRank = Number.isFinite(Number(row.position)) ? Number(row.position) : 20;
    return {
      id: `ml:${row.id}`,
      name,
      query: `${mlAttribute(detail, 'BRAND')} ${name}`.trim(),
      brand: mlAttribute(detail, 'BRAND'),
      ean: mlAttribute(detail, 'GTIN') || null,
      image: rawImage ? String(rawImage).replace(/^http:/, 'https:') : null,
      permalink: productUrl,
      sourceUrl: productUrl,
      category: category.label,
      salesRank,
      salesCategory: category.label,
      salesScore: Math.max(5, 105 - salesRank * 5),
      sources: ['Mercado Libre'],
    };
  } catch {
    return null;
  }
}

function mlTrendSignal(row, index, category) {
  const name = String(row?.keyword || '').trim();
  if (!name) return null;
  let searchKind;
  let searchScore;
  if (index < 10) {
    searchKind = 'crecimiento';
    searchScore = 100 - index * 5;
  } else if (index < 30) {
    searchKind = 'más buscado';
    searchScore = 80 - (index - 10) * 2;
  } else {
    searchKind = 'popular';
    searchScore = 70 - (index - 30) * 2;
  }
  return {
    id: `ml-trend:${category.id}:${mlText(name).replace(/\s+/g, '-')}`,
    name,
    query: name,
    category: category.label,
    sourceUrl: String(row.url || ''),
    permalink: String(row.url || ''),
    searchPosition: index + 1,
    searchKind,
    searchScore: Math.max(10, searchScore),
    genericTrend: isGenericRadarQuery(name),
    needsConcreteProduct: !radarHasPhrase(name, RADAR_KIOSK_BRANDS),
    sources: ['Mercado Libre'],
  };
}

async function mlRadarSignals() {
  if (!mlEnabled()) return { candidates: [], bestSellers: [], sources: { sales: false, searches: false } };
  const token = await mlAccessToken();
  if (!token) return { candidates: [], bestSellers: [], sources: { sales: false, searches: false } };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const [highlightRows, trendRows] = await Promise.all([
      Promise.allSettled(ML_RADAR_HIGHLIGHT_CATEGORIES.map(async category => ({
        category,
        data: await mlRadarJson(token, `/highlights/MLA/category/${category.id}`, controller.signal),
      }))),
      Promise.allSettled(ML_RADAR_TREND_CATEGORIES.map(async category => ({
        category,
        data: await mlRadarJson(token, `/trends/MLA/${category.id}`, controller.signal),
      }))),
    ]);

    const candidates = [];
    const productsToLoad = [];
    highlightRows.filter(row => row.status === 'fulfilled').forEach(row => {
      const content = Array.isArray(row.value.data?.content) ? row.value.data.content : [];
      content.filter(item => item?.id && ['PRODUCT', 'ITEM', 'USER_PRODUCT'].includes(item.type)).slice(0, 5)
        .forEach(item => productsToLoad.push({ item, category: row.value.category }));
    });
    const loaded = await Promise.all(productsToLoad.map(({ item, category }) => mlRadarProduct(token, item, category, controller.signal)));
    loaded.filter(Boolean).forEach(item => mergeRadarCandidate(candidates, item));

    trendRows.filter(row => row.status === 'fulfilled').forEach(row => {
      const data = Array.isArray(row.value.data) ? row.value.data : [];
      data.slice(0, 12).forEach((item, index) => {
        const signal = mlTrendSignal(item, index, row.value.category);
        if (signal) mergeRadarCandidate(candidates, signal);
      });
    });

    return {
      candidates,
      bestSellers: candidates.filter(item => item.salesRank).sort((a, b) => b.salesScore - a.salesScore).slice(0, 10),
      sources: {
        sales: highlightRows.some(row => row.status === 'fulfilled'),
        searches: trendRows.some(row => row.status === 'fulfilled'),
      },
    };
  } catch {
    return { candidates: [], bestSellers: [], sources: { sales: false, searches: false } };
  } finally {
    clearTimeout(timeout);
  }
}

function newsProductQuery(title) {
  const text = htmlText(title);
  const patterns = [
    /(?:lanza(?:n)?\s+(?:el\s+|la\s+)?(?:nuevo|nueva)\s+)([^:,.]+)/i,
    /(?:nuevo|nueva)\s+([^:,.]+)/i,
    /(?:alfajor|chocolate|caramelo|snack)\s+([^:,.]+)/i,
  ];
  const found = patterns.map(pattern => text.match(pattern)?.[1]?.trim()).find(Boolean) || '';
  if (!found || /\b(?:tendencia|productos?|kioscos?|argentina|mercado)\b/i.test(found)) return '';
  return found.split(/\s+/).slice(0, 7).join(' ');
}

function newsFreshness(date) {
  const ageDays = Math.max(0, (Date.now() - Date.parse(date || 0)) / 86400000);
  if (ageDays <= 7) return 100;
  if (ageDays <= 30) return 70;
  if (ageDays <= 90) return 35;
  return 15;
}

async function infokioscosNews() {
  try {
    const params = new URLSearchParams({ search: 'golosinas', per_page: '12', _embed: 'wp:featuredmedia' });
    const raw = await supplierFetch(`${INFOKIOSCOS_API_URL}?${params}`, { headers: { ...BROWSER_HEADERS, accept: 'application/json' } }, 7000);
    const rows = JSON.parse(raw);
    const articles = (Array.isArray(rows) ? rows : []).map(row => {
      const title = htmlText(row?.title?.rendered);
      const query = newsProductQuery(title);
      const image = row?._embedded?.['wp:featuredmedia']?.[0]?.source_url || null;
      return {
        id: `news:${row.id}`,
        title,
        excerpt: htmlText(row?.excerpt?.rendered),
        query,
        date: String(row?.date || '').slice(0, 10),
        url: String(row?.link || ''),
        image: /^https:\/\//.test(image || '') ? image : null,
        score: newsFreshness(row?.date),
      };
    }).filter(item => item.title && item.url);
    return { available: true, articles };
  } catch {
    return { available: false, articles: [] };
  }
}

function applyNewsSignals(candidates, news) {
  news.articles.filter(article => article.query).slice(0, 8).forEach(article => {
    mergeRadarCandidate(candidates, {
      id: article.id,
      name: article.query,
      query: article.query,
      image: article.image,
      sourceUrl: article.url,
      newsUrl: article.url,
      newsDate: article.date,
      newsTitle: article.title,
      newsScore: article.score,
      category: 'Novedades',
      sources: ['Infokioscos'],
    });
  });
  candidates.forEach(candidate => {
    const match = news.articles.map(article => ({ article, score: radarSimilarity(candidate.name, `${article.title} ${article.excerpt}`) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!match || match.score < 0.3) return;
    candidate.newsScore = Math.max(candidate.newsScore || 0, Math.round(match.article.score * Math.min(1, match.score + 0.35)));
    candidate.newsUrl = match.article.url;
    candidate.newsDate = match.article.date;
    candidate.newsTitle = match.article.title;
    if (!candidate.image && match.article.image) candidate.image = match.article.image;
    candidate.sources = Array.from(new Set([...(candidate.sources || []), 'Infokioscos']));
  });
}

function preliminaryRadarScore(candidate) {
  return (candidate.salesScore || 0) * RADAR_WEIGHTS.sales
    + (candidate.searchScore || 0) * RADAR_WEIGHTS.searches
    + (candidate.newsScore || 0) * RADAR_WEIGHTS.news;
}

async function enrichRadarWithRappi(candidates) {
  const selected = candidates.sort((a, b) => preliminaryRadarScore(b) - preliminaryRadarScore(a)).slice(0, 5);
  const rows = await Promise.allSettled(selected.map(async candidate => {
    const items = await rappiSearch(candidate.query || candidate.name, 5);
    const ranked = items.map(item => ({ item, score: radarSimilarity(candidate.name, item.title) }))
      .sort((a, b) => b.score - a.score || Number(b.item.storeCount) - Number(a.item.storeCount));
    const best = ranked.find(row => row.score >= 0.25)?.item || null;
    return { candidate, best };
  }));
  rows.forEach((row, index) => {
    const candidate = selected[index];
    candidate.rappiChecked = row.status === 'fulfilled';
    if (row.status !== 'fulfilled' || !row.value.best) return;
    const item = row.value.best;
    const stores = Math.max(1, Number(item.storeCount) || 1);
    candidate.rappiScore = stores >= 5 ? 100 : [0, 45, 65, 80, 90][stores];
    candidate.rappiStoreCount = stores;
    candidate.rappiPrice = Number(item.unitPrice) || null;
    candidate.rappiMin = Number(item.retailMin) || candidate.rappiPrice;
    candidate.rappiMax = Number(item.retailMax) || candidate.rappiPrice;
    candidate.rappiUrl = item.permalink;
    candidate.rappiTitle = String(item.title || '').trim();
    if (!candidate.image && item.image) candidate.image = item.image;
    if (!candidate.salesRank && !candidate.newsTitle && candidate.rappiTitle) {
      candidate.trendQuery = candidate.name;
      candidate.name = candidate.rappiTitle;
      candidate.query = candidate.rappiTitle;
      if (!candidate.brand && item.brand) candidate.brand = item.brand;
    }
    candidate.sources = Array.from(new Set([...(candidate.sources || []), 'Rappi']));
  });
  const seen = new Set();
  return selected.filter(candidate => {
    if ((candidate.genericTrend || candidate.needsConcreteProduct)
      && !candidate.rappiStoreCount && !candidate.newsTitle && !candidate.salesRank) return false;
    const key = candidate.rappiUrl || candidate.ean || mlText(candidate.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function radarLabel(score) {
  if (score >= 80) return 'Muy caliente';
  if (score >= 60) return 'Está subiendo';
  if (score >= 40) return 'Para mirar';
  return 'Señal inicial';
}

function scoredRadarItem(candidate, sourceState, index) {
  let availableWeight = 0;
  let weighted = 0;
  if (sourceState.sales) {
    availableWeight += RADAR_WEIGHTS.sales;
    weighted += (candidate.salesScore || 0) * RADAR_WEIGHTS.sales;
  }
  if (sourceState.searches) {
    availableWeight += RADAR_WEIGHTS.searches;
    weighted += (candidate.searchScore || 0) * RADAR_WEIGHTS.searches;
  }
  if (candidate.rappiChecked) {
    availableWeight += RADAR_WEIGHTS.rappi;
    weighted += (candidate.rappiScore || 0) * RADAR_WEIGHTS.rappi;
  }
  if (sourceState.news) {
    availableWeight += RADAR_WEIGHTS.news;
    weighted += (candidate.newsScore || 0) * RADAR_WEIGHTS.news;
  }
  const score = availableWeight ? Math.round(weighted / availableWeight) : 0;
  const reasons = [];
  if (candidate.salesRank) reasons.push(`#${candidate.salesRank} en ventas de ${candidate.salesCategory}`);
  if (candidate.searchScore) reasons.push(candidate.searchKind === 'crecimiento' ? 'búsquedas creciendo' : 'entre las búsquedas destacadas');
  if (candidate.rappiStoreCount) reasons.push(`${candidate.rappiStoreCount} oferta${candidate.rappiStoreCount === 1 ? '' : 's'} en Rappi`);
  if (candidate.newsTitle) reasons.push('mencionado recientemente por Infokioscos');
  let publicationUrl = '';
  let publicationLabel = '';
  if (candidate.newsUrl) {
    publicationUrl = candidate.newsUrl;
    publicationLabel = 'Leer nota en Infokioscos';
  } else if (candidate.salesRank && candidate.permalink) {
    publicationUrl = candidate.permalink;
    publicationLabel = 'Ver publicación en Mercado Libre';
  } else if (candidate.rappiUrl) {
    publicationUrl = candidate.rappiUrl;
    publicationLabel = 'Ver producto en Rappi';
  } else if (candidate.permalink || candidate.sourceUrl) {
    publicationUrl = candidate.permalink || candidate.sourceUrl;
    publicationLabel = 'Ver resultados en Mercado Libre';
  }
  return {
    id: candidate.id || `radar-${index}`,
    type: 'now',
    rank: index + 1,
    name: candidate.name,
    query: candidate.query || candidate.name,
    signal: `${score} · ${radarLabel(score)}`,
    note: reasons.join(' · ') || 'Señal reciente en observación',
    scope: candidate.rappiStoreCount ? `Argentina · presencia en CABA` : `Argentina · ${candidate.category || 'kioscos'}`,
    date: candidate.newsDate || new Date().toISOString().slice(0, 10),
    sourceLabel: (candidate.sources || []).join(' + ') || 'Radar kiosco',
    sourceUrl: publicationUrl,
    publicationUrl,
    publicationLabel,
    image: candidate.image || null,
    score,
    confidence: availableWeight,
    price: candidate.rappiPrice || null,
    priceMin: candidate.rappiMin || null,
    priceMax: candidate.rappiMax || null,
    breakdown: {
      sales: candidate.salesScore || 0,
      searches: candidate.searchScore || 0,
      social: null,
      rappi: candidate.rappiChecked ? candidate.rappiScore || 0 : null,
      news: sourceState.news ? candidate.newsScore || 0 : null,
    },
  };
}

async function radarRanking() {
  const fallback = ['Guaymallén', 'Fantoche', 'Rasta', 'Jorgito', 'Milka'];
  try {
    const html = await supplierFetch(INFOKIOSCOS_RANKING_URL, { headers: { ...BROWSER_HEADERS, accept: 'text/html' } }, 6000);
    const chunks = html.split(/ranking-item position-/i).slice(1, 11);
    const parsed = chunks.map(chunk => {
      const rank = Number(chunk.match(/^(\d+)/)?.[1]);
      const name = htmlText(chunk.match(/alt=["']([^"']+)["']/i)?.[1]);
      const image = chunk.match(/data-src=["']([^"']+)["']/i)?.[1] || null;
      if (!rank || !name) return null;
      return { rank, name, image: /^https:\/\//.test(image || '') ? image : null };
    }).filter(Boolean).slice(0, 5);
    if (parsed.length >= 5) return parsed;
  } catch { /* el fallback conserva el radar disponible */ }
  return fallback.map((name, index) => ({ rank: index + 1, name, image: null }));
}

async function handleRadar() {
  if (radarCache && Date.now() - radarCache.savedAt < RADAR_CACHE_TTL) return radarCache.value;
  const [annualRanking, mlSignals, news, open25Featured] = await Promise.all([
    radarRanking(),
    mlRadarSignals(),
    infokioscosNews(),
    open25Destacados(30).catch(() => []),
  ]);
  const candidates = mlSignals.candidates.filter(isKioskRadarCandidate);
  applyNewsSignals(candidates, news);
  const enriched = await enrichRadarWithRappi(candidates.filter(isKioskRadarCandidate));
  const sourceState = { ...mlSignals.sources, news: news.available };
  const scored = enriched.map((candidate, index) => scoredRadarItem(candidate, sourceState, index))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const dynamicReady = scored.length >= 3 && (sourceState.sales || sourceState.searches);

  let now;
  if (dynamicReady) {
    now = scored.slice(0, 5);
  } else {
    const imageRows = await Promise.all(Array.from(new Set(RADAR_FALLBACK.map(item => item.sourceUrl)))
      .map(async url => [url, await radarArticleImage(url)]));
    const images = new Map(imageRows);
    now = RADAR_FALLBACK.map((item, index) => ({
      ...item,
      type: 'now',
      rank: index + 1,
      image: images.get(item.sourceUrl) || null,
      score: null,
      confidence: 20,
      note: `${item.note} · respaldo editorial`,
      publicationUrl: item.sourceUrl,
      publicationLabel: 'Leer publicación en Infokioscos',
    }));
  }

  const mlRanking = mlSignals.bestSellers.length >= 3
    ? mlSignals.bestSellers.slice(0, 5).map((item, index) => ({
      id: `ml-ranking-${item.id || index}`,
      type: 'ranking',
      rank: index + 1,
      name: item.name,
      query: item.query || item.name,
      signal: `#${item.salesRank} en ${item.salesCategory}`,
      note: 'Ranking oficial de productos más vendidos en Mercado Libre.',
      scope: `Argentina · ${item.salesCategory}`,
      date: new Date().toISOString().slice(0, 10),
      sourceLabel: 'Mercado Libre',
      sourceUrl: item.permalink,
      publicationUrl: item.permalink,
      publicationLabel: 'Ver publicación en Mercado Libre',
      image: item.image || null,
      confidence: 50,
    }))
    : annualRanking.map(item => ({
      id: `ranking-${item.rank}`,
      type: 'ranking',
      name: item.name,
      query: `alfajor ${item.name}`,
      signal: `#${item.rank} en ranking anual`,
      note: 'Ranking anual elaborado con más de 900 kiosqueros.',
      scope: 'Argentina · ranking anual 2026',
      date: null,
      sourceLabel: 'Infokioscos · relevamiento 2026',
      sourceUrl: INFOKIOSCOS_RANKING_URL,
      publicationUrl: INFOKIOSCOS_RANKING_URL,
      publicationLabel: 'Ver ranking en Infokioscos',
      image: item.image,
      confidence: 35,
    }));

  // La vidriera de Open 25 es la señal más directa del rubro: si el scrape
  // devolvió resultados manda ella; si no, quedan ML/Infokioscos de respaldo.
  const ranking = open25Featured.length >= 3 ? open25Featured : mlRanking;

  const value = {
    scope: dynamicReady ? 'Ventas, búsquedas, Rappi y novedades' : 'Señales editoriales de respaldo',
    scopeNow: dynamicReady ? 'Argentina/CABA · actualizado cada 6 h' : 'Argentina · respaldo editorial',
    scopeRanking: open25Featured.length >= 3
      ? 'Open 25 · vidriera de la tienda online · actualizado cada 6 h'
      : (mlSignals.bestSellers.length >= 3 ? 'Argentina · ventas Mercado Libre' : 'Argentina · ranking anual 2026 (+900 kiosqueros)'),
    generatedAt: new Date().toISOString(),
    dynamic: dynamicReady,
    weights: RADAR_WEIGHTS,
    sources: {
      mercadoLibreSales: sourceState.sales,
      mercadoLibreSearches: sourceState.searches,
      rappi: enriched.some(item => item.rappiChecked),
      infokioscos: sourceState.news,
      open25: open25Featured.length > 0,
      social: false,
    },
    ranking,
    now,
  };
  radarCache = { savedAt: Date.now(), value };
  return value;
}

async function supplierSearch(query, limit = 10) {
  const [casa, dulce, rappi, open25] = await Promise.allSettled([casaPasoSearch(query, limit), dulceSurSearch(query, limit), rappiSearch(query, limit), open25Search(query, limit)]);
  return {
    items: [
      ...(open25.status === 'fulfilled' ? open25.value : []),
      ...(rappi.status === 'fulfilled' ? rappi.value : []),
      ...(dulce.status === 'fulfilled' ? dulce.value : []),
      ...(casa.status === 'fulfilled' ? casa.value : []),
    ],
    sources: { casaPaso: casa.status === 'fulfilled', dulceSur: dulce.status === 'fulfilled', rappi: rappi.status === 'fulfilled', open25: open25.status === 'fulfilled' },
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

async function getCoverageBranches(kind, lat, lng, zone) {
  if (kind !== 'retail' || zone !== 'caba') return getBranches(kind, lat, lng);
  const settled = await Promise.allSettled(CABA_RETAIL_ANCHORS.map(anchor => getBranches('retail', anchor.lat, anchor.lng)));
  const byId = new Map();
  settled.forEach(result => {
    if (result.status !== 'fulfilled') return;
    result.value.forEach(branch => byId.set(`${branch.comercioId || ''}-${branch.banderaId || ''}-${branch.id}`, branch));
  });
  return Array.from(byId.values());
}

function officialQueryCandidates(query) {
  const original = normalizeQuery(query).replace(/\s+/g, ' ').trim();
  const generic = new Set(['alfajor', 'alfajores', 'chocolate', 'chocolates', 'galletita', 'galletitas', 'caramelo', 'caramelos', 'bebida', 'bebidas', 'gaseosa', 'gaseosas', 'unidad', 'unidades']);
  const colors = new Set(['negro', 'negra', 'blanco', 'blanca', 'leche', 'clasico', 'clasica']);
  const tokens = original.split(' ').filter(Boolean);
  const withoutGeneric = tokens.filter(token => !generic.has(mlText(token))).join(' ');
  const distinctive = tokens.filter(token => !generic.has(mlText(token)) && !colors.has(mlText(token)) && !/^\d/.test(token)).join(' ');
  return Array.from(new Set([original, withoutGeneric, distinctive].filter(value => value.length >= 2))).slice(0, 3);
}

function mergeSourceProducts(products, wholesale) {
  const byEan = new Map();
  products.forEach(product => {
    if (!product?.id) return;
    const key = String(product.id);
    const current = byEan.get(key);
    if (!current) { byEan.set(key, { ...product }); return; }
    const minFields = wholesale
      ? ['precio_unitario_bulto_min_con_iva', 'precio_unitario_bulto_min_sin_iva', 'precio_bulto_min_con_iva', 'precio_bulto_min_sin_iva']
      : ['precioMin'];
    const maxFields = wholesale
      ? ['precio_unitario_bulto_max_con_iva', 'precio_unitario_bulto_max_sin_iva', 'precio_bulto_max_con_iva', 'precio_bulto_max_sin_iva']
      : ['precioMax'];
    minFields.forEach(field => {
      const values = [numberOrNull(current[field]), numberOrNull(product[field])].filter(Number.isFinite);
      if (values.length) current[field] = Math.min(...values);
    });
    maxFields.forEach(field => {
      const values = [numberOrNull(current[field]), numberOrNull(product[field])].filter(Number.isFinite);
      if (values.length) current[field] = Math.max(...values);
    });
    current.cantSucursalesDisponible = (Number(current.cantSucursalesDisponible) || 0) + (Number(product.cantSucursalesDisponible) || 0);
  });
  return Array.from(byEan.values());
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

async function searchSource(kind, query, lat, lng, zone) {
  const wholesale = kind === 'wholesale';
  const base = wholesale ? WHOLESALE_API : RETAIL_API;
  const branches = await getCoverageBranches(kind, lat, lng, zone);
  if (!branches.length) return { branches, products: [] };
  const chunks = [];
  for (let index = 0; index < branches.length; index += 65) chunks.push(branches.slice(index, index + 65));
  let products = [];
  for (const candidate of officialQueryCandidates(query)) {
    const settled = await Promise.allSettled(chunks.map(async branchChunk => {
      const params = new URLSearchParams({
        string: candidate,
        array_sucursales: branchChunk.map(branch => branch.id).join(','),
        offset: '0',
        limit: '50',
      });
      if (wholesale) params.set('entorno', 'mayoristas');
      return officialJson(base, `/productos?${params}`, wholesale);
    }));
    const rows = settled.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value.productos) ? result.value.productos : []);
    products.push(...rows);
    if (rows.length) break;
  }
  return {
    branches,
    products: mergeSourceProducts(products, wholesale),
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

async function detailSource(kind, ean, lat, lng, zone) {
  const wholesale = kind === 'wholesale';
  const base = wholesale ? WHOLESALE_API : RETAIL_API;
  const branches = await getCoverageBranches(kind, lat, lng, zone);
  if (!branches.length) return { product: null, rows: [] };
  const chunks = [];
  for (let index = 0; index < branches.length; index += 45) chunks.push(branches.slice(index, index + 45));
  const settled = await Promise.allSettled(chunks.map(async branchChunk => {
    const params = new URLSearchParams({
      limit: wholesale ? '30' : '50',
      id_producto: ean,
      array_sucursales: branchChunk.map(branch => branch.id).join(','),
    });
    if (wholesale) params.set('entorno', 'mayoristas');
    return officialJson(base, `/producto?${params}`, wholesale);
  }));
  const responses = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!responses.length) throw settled.find(result => result.status === 'rejected')?.reason || new Error('Sin respuesta de Precios Claros');
  const data = responses.find(row => row.producto) || responses[0];
  const distances = distanceMap(branches);
  const sourceRows = responses.flatMap(row => Array.isArray(row.sucursales) ? row.sucursales : []);

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

async function handleSearch(query, lat, lng, zone) {
  const [retailSettled, wholesaleSettled, suppliersSettled] = await Promise.allSettled([
    searchSource('retail', query, lat, lng, zone),
    searchSource('wholesale', query, lat, lng, zone),
    supplierSearch(query, 10),
  ]);
  if (retailSettled.status === 'rejected' && wholesaleSettled.status === 'rejected' && suppliersSettled.status === 'rejected') {
    throw retailSettled.reason;
  }
  const retail = retailSettled.status === 'fulfilled' ? retailSettled.value : null;
  const wholesale = wholesaleSettled.status === 'fulfilled' ? wholesaleSettled.value : null;
  const suppliers = suppliersSettled.status === 'fulfilled' ? suppliersSettled.value : { items: [], sources: {} };
  return {
    items: mergeSearchResults(retail, wholesale),
    supplierItems: suppliers.items,
    coverage: {
      retailBranches: retail?.branches?.length || 0,
      wholesaleBranches: wholesale?.branches?.length || 0,
    },
    sources: {
      retail: retailSettled.status === 'fulfilled',
      wholesale: wholesaleSettled.status === 'fulfilled',
      casaPaso: suppliers.sources.casaPaso === true,
      dulceSur: suppliers.sources.dulceSur === true,
      rappi: suppliers.sources.rappi === true,
    },
  };
}

async function handleDetail(ean, lat, lng, zone) {
  const [retailSettled, wholesaleSettled, imageSettled] = await Promise.allSettled([
    detailSource('retail', ean, lat, lng, zone),
    detailSource('wholesale', ean, lat, lng, zone),
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
        const exact = found.find(item => item.ean && String(item.ean) === String(ean)) || found[0];
        mlRef = exact.reference || null;
        if (!image) image = exact.image || found.find(item => item.image)?.image || null;
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
  const requestedZone = String(req.query.zone || 'caba');
  const zone = ['caba', 'vicente-lopez', 'san-martin', 'avellaneda', 'la-plata', 'current'].includes(requestedZone) ? requestedZone : 'caba';

  try {
    let payload;
    if (action === 'detail') {
      const ean = String(req.query.ean || '').replace(/\D/g, '').slice(0, 18);
      if (ean.length < 8) return res.status(400).json({ error: 'EAN inválido' });
      payload = await handleDetail(ean, lat, lng, zone);
    } else if (action === 'radar') {
      payload = await handleRadar();
    } else if (action === 'supplier-detail') {
      const source = String(req.query.source || '');
      if (source !== 'casa-paso') return res.status(400).json({ error: 'Proveedor inválido' });
      payload = { item: await casaPasoDetail(req.query.code) };
    } else if (action === 'suggest') {
      const query = normalizeQuery(req.query.q);
      if (query.length < 2) return res.status(400).json({ error: 'Ingresá al menos 2 caracteres' });
      const suppliers = await supplierSearch(query, 6);
      payload = { items: suppliers.items.slice(0, 10), sources: suppliers.sources };
    } else if (action === 'ml') {
      // Búsqueda directa en MercadoLibre (para librería y todo lo que
      // Precios Claros no cubre).
      const query = normalizeQuery(req.query.q);
      if (query.length < 2) return res.status(400).json({ error: 'Ingresá al menos 2 caracteres' });
      const result = await mlSearch(query, 10);
      payload = result;
    } else if (action === 'foto') {
      // Solo la mejor foto para un producto cargado a mano en el catálogo.
      const query = normalizeQuery(req.query.q);
      if (query.length < 2) return res.status(400).json({ error: 'Ingresá al menos 2 caracteres' });
      const result = await mlSearch(query, 3);
      payload = { image: result.items.find(item => item.image)?.image || null, disabled: result.disabled === true };
    } else {
      const query = normalizeQuery(req.query.q);
      if (query.length < 2) return res.status(400).json({ error: 'Ingresá al menos 2 caracteres' });
      payload = await handleSearch(query, lat, lng, zone);
    }

    const cacheControl = action === 'suggest'
      ? 's-maxage=300, stale-while-revalidate=900'
      : (action === 'radar' ? 's-maxage=21600, stale-while-revalidate=86400' : 's-maxage=900, stale-while-revalidate=3600');
    res.setHeader('Cache-Control', cacheControl);
    return res.status(200).json({
      ...payload,
      location: { lat, lng, zone },
      checkedAt: new Date().toISOString(),
      source: 'Precios Claros + Open 25 + Rappi + proveedores mayoristas',
    });
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'La fuente oficial tardó demasiado en responder'
      : error?.message || 'No se pudieron consultar los precios';
    return res.status(502).json({ error: message });
  }
}
