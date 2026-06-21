// Paso 8 — Casa Paso (librería mayorista) como proveedor real.
// CABA: San Cristóbal (Av Jujuy 1435) y Once (Larrea 249).
// No es WooCommerce: plataforma propia ("SmartyCart"). HTML simple, sin JS
// pesado — el precio viene directo en el HTML, confirmado manualmente.
//
// Patrón de búsqueda confirmado: /categoria/{termino} funciona tanto para
// nombres de categoría ("resma_de_papel") como para texto libre con espacios
// reemplazados por guión bajo o %20 ("Marcadores%20Resaltadores"). Lo usamos
// como buscador: probamos /categoria/{query} directamente.

const USER_AGENT = 'Mozilla/5.0 (compatible; KioscoPriceBot/1.0; +https://kiosco-lac.vercel.app/)';

const PROVIDER = {
  id: 'casapaso',
  name: 'Casa Paso',
  logo: 'Paso',
  baseUrl: 'https://www.casapaso.com.ar',
  location: 'CABA (San Cristóbal / Once)'
};

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Ntilde;/g, 'Ñ')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(value) {
  return decodeHtml(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href, baseUrl) {
  try { return new URL(decodeHtml(href), baseUrl).href; }
  catch (_) { return null; }
}

function priceToText(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoneyToken(raw) {
  let s = decodeHtml(String(raw || ''))
    .replace(/\s+/g, '')
    .replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const [intPart, decPart = ''] = s.split(',');
    s = decPart.length === 2 ? intPart.replace(/\./g, '') + '.' + decPart : s.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    const decPart = parts[parts.length - 1] || '';
    s = decPart.length === 2 ? parts[0] + '.' + decPart : s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// El precio en Casa Paso viene como "#### $ 3.769,70" en el detalle de
// producto, o en bloques de listado con "$ X.XXX,XX" cerca del nombre.
function parsePrice(value) {
  const text = decodeHtml(String(value || ''));
  const m = text.match(/\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/);
  if (!m) return null;
  const n = parseMoneyToken(m[1]);
  return n !== null && n >= 1 && n <= 500000 ? n : null;
}

function scoreTitle(title, q) {
  const nt = normalize(title);
  const nq = normalize(q);
  if (!nq) return 0;
  if (nt === nq) return 100;
  if (nt.includes(nq)) return 82;
  const terms = nq.split(/\s+/).filter(Boolean);
  return terms.reduce((acc, term) => acc + (nt.includes(term) ? 14 : 0), 0);
}

// Paso 7 — mismo filtro de packs que el resto del buscador. Casa Paso vende
// mucho "Bulto: 150 | Paquete: 10" — eso es info de presentación mayorista,
// no impide que el producto individual también aparezca, pero si el TÍTULO
// mismo dice "X50", "Caja x..." lo excluimos igual que en los demás.
function isPack(text) {
  const t = normalize(text);
  return /\bx\s*\d{2,}\b/.test(t)
    || /\bcaja\b/.test(t)
    || /\bpack\s*x?\s*\d+/.test(t)
    || /\bdisplay\b/.test(t)
    || /\b\d+\s*u(?:nidades)?\b/.test(t);
}

function isRelevantTitle(title, q) {
  const nt = normalize(title);
  const nq = normalize(q);
  if (!nq) return true;
  if (!nt) return false;
  if (isPack(title) || isPack(q)) return false;
  if (nt.includes(nq)) return true;
  const terms = nq.split(/\s+/).filter(t => t.length >= 2);
  if (!terms.length) return false;
  return terms.every(t => nt.includes(t));
}

function inferTags(title) {
  const n = normalize(title);
  const tags = [];
  if (n.includes('resaltador') || n.includes('marcador')) tags.push('Resaltadores');
  if (n.includes('resma') || n.includes('papel') || n.includes('cartulina')) tags.push('Papel');
  if (n.includes('bic') || n.includes('lapicera') || n.includes('birome')) tags.push('Biromes');
  if (n.includes('plasticola') || n.includes('pegamento') || n.includes('poxipol')) tags.push('Adhesivos');
  if (n.includes('filgo')) tags.push('Filgo');
  if (n.includes('cuaderno') || n.includes('carpeta') || n.includes('block')) tags.push('Cuadernos');
  if (!tags.length) tags.push('Librería');
  tags.push('Casa Paso');
  return [...new Set(tags)];
}

function extractImage(block) {
  const m = block.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (!m || !m[1]) return null;
  const url = absoluteUrl(m[1], PROVIDER.baseUrl);
  if (!url || /placeholder|logo|whatsapp|instagram|tiktok|afip/i.test(url)) return null;
  return url;
}

// Cada producto en el listado de Casa Paso suele venir como bloque con un
// link a /catalogo/{id}, un título, y un precio cerca. Buscamos esos bloques
// igual que hacemos en woocommerceGeneric: por anchors a /catalogo/.
function parseListing(html, q, sourceUrl) {
  const items = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href=["']([^"']*\/catalogo\/\d+[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const url = absoluteUrl(m[1], PROVIDER.baseUrl);
    if (!url || seen.has(url)) continue;
    const start = Math.max(0, m.index - 200);
    const end = Math.min(html.length, anchorRe.lastIndex + 600);
    const block = html.slice(start, end);

    let title = stripHtml(m[0]).replace(/\$\s*[0-9.,]+/g, '').trim();
    if (!title || title.length < 3) {
      const slug = decodeURIComponent(url.split('/catalogo/')[1] || '').replace(/^\d+/, '').trim();
      title = slug || '';
    }
    if (!title || title.length < 3) continue;
    if (q && !isRelevantTitle(title, q)) continue;

    const price = parsePrice(block);
    const image = extractImage(block);

    seen.add(url);
    items.push({
      id: `casapaso_${url.split('/catalogo/')[1]?.replace(/\D/g, '') || Buffer.from(url).toString('base64url').slice(0, 12)}`,
      title,
      meta: `${PROVIDER.name} · ${PROVIDER.location}`,
      provider: PROVIDER.name,
      providerId: PROVIDER.id,
      logo: PROVIDER.logo,
      providersCount: 1,
      price,
      priceText: priceToText(price),
      prices: price !== null ? [{
        name: PROVIDER.name,
        logo: PROVIDER.logo,
        price,
        priceText: priceToText(price),
        url,
        image,
        stock: true,
        source: 'proveedor_real'
      }] : [],
      image,
      url,
      stock: true,
      kind: 'libreria',
      tags: inferTags(title),
      pack: 'Producto real',
      source: 'casapaso_listing',
      sourceUrl,
      score: scoreTitle(title, q)
    });
  }
  return items;
}

async function fetchHtml(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.7'
      }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function uniqueSort(items, q, limit) {
  const byUrl = new Map();
  for (const item of items) {
    if (!item || !item.url) continue;
    const prev = byUrl.get(item.url);
    if (!prev || (item.price !== null && prev.price === null) || item.score > prev.score) byUrl.set(item.url, item);
  }
  return [...byUrl.values()]
    .sort((a, b) => (b.score - a.score) || ((a.price ?? Infinity) - (b.price ?? Infinity)))
    .slice(0, limit);
}

// Búsqueda: probamos el patrón /categoria/{query} con distintas variantes
// de formato de URL (espacios como _, como %20, y la query tal cual),
// porque confirmamos que ambos formatos funcionan en el sitio real.
function buildSearchUrls(q) {
  const base = PROVIDER.baseUrl;
  const raw = String(q || '').trim();
  const withUnderscore = raw.replace(/\s+/g, '_');
  const withSpace = raw;
  return [
    `${base}/categoria/${encodeURIComponent(withUnderscore)}`,
    `${base}/categoria/${encodeURIComponent(withSpace)}`
  ];
}

async function searchCasaPaso(q, opts = {}) {
  const limit = opts.limit || 10;
  const urls = buildSearchUrls(q);

  const settled = await Promise.allSettled(urls.map(url => fetchHtml(url, opts.timeoutMs || 9000)));

  const allItems = [];
  const errors = [];
  let anyOk = false;

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      if (result.value === null) return; // 404: esa variante de URL no existe
      anyOk = true;
      allItems.push(...parseListing(result.value, q, urls[i]));
    } else {
      errors.push({ provider: PROVIDER.name, url: urls[i], error: String(result.reason && result.reason.message || result.reason) });
    }
  });

  const sorted = uniqueSort(allItems, q, limit);

  if (!sorted.length) {
    return {
      provider: PROVIDER,
      q,
      count: 0,
      items: [],
      errors: anyOk
        ? [{ provider: PROVIDER.name, url: urls[0], error: 'Sin resultados parseables para esta búsqueda' }]
        : (errors.length ? errors : [{ provider: PROVIDER.name, url: urls[0], error: 'Sin resultados parseables para esta búsqueda' }])
    };
  }

  return { provider: PROVIDER, q, count: sorted.length, items: sorted, errors: [] };
}

module.exports = { PROVIDER, searchCasaPaso };
