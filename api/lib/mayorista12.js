const PROVIDER = {
  id: 'mayorista12',
  name: 'Mayorista 12 de Octubre',
  logo: '12 Oct',
  baseUrl: 'https://www.mayorista12deoctubre.com',
  location: 'Morón, Buenos Aires'
};

const USER_AGENT = 'Mozilla/5.0 (compatible; KioscoPriceBot/1.0; +https://kiosco-lac.vercel.app/)';

const KNOWN_URLS = [
  'https://www.mayorista12deoctubre.com/productos/galletitas-oreo-118g/'
];

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

function absoluteUrl(href) {
  try { return new URL(decodeHtml(href), PROVIDER.baseUrl).href; }
  catch (_) { return null; }
}

function parsePrice(value) {
  const text = decodeHtml(String(value || ''));
  const m = text.match(/\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]+(?:,[0-9]{2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function priceToText(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cleanTitle(text) {
  return stripHtml(text)
    .replace(/Oferta/gi, ' ')
    .replace(/Env[ií]o gratis/gi, ' ')
    .replace(/0\s*%\s*OFF/gi, ' ')
    .replace(/\$\s*[0-9\.]+(?:,[0-9]{2})?/g, ' ')
    .replace(/\b(Agregar al carrito|Añadir al carrito|Ver medios de pago|Inicio|Productos|Carrito)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferKind(title) {
  const n = normalize(title);
  if (n.includes('oreo') || n.includes('gallet')) return 'oreo';
  if (n.includes('coca') || n.includes('speed') || n.includes('baggio') || n.includes('jugo')) return 'coca';
  if (n.includes('bic') || n.includes('lapiz') || n.includes('birome') || n.includes('resalt')) return 'bic';
  return 'real';
}

function inferTags(title) {
  const n = normalize(title);
  const tags = [];
  if (n.includes('gallet') || n.includes('oreo') || n.includes('pitusa') || n.includes('chocolina')) tags.push('Galletitas');
  if (n.includes('coca') || n.includes('baggio') || n.includes('speed') || n.includes('jugo')) tags.push('Bebidas');
  if (n.includes('alfajor')) tags.push('Alfajores');
  if (n.includes('caramelo')) tags.push('Caramelos');
  if (n.includes('combo')) tags.push('Combos');
  if (!tags.length) tags.push('Producto real');
  tags.push(PROVIDER.name);
  return [...new Set(tags)];
}

function extractImage(block, fullHtml) {
  const source = block || fullHtml || '';
  const imgPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/i
  ];
  for (const re of imgPatterns) {
    const m = source.match(re);
    if (m && m[1]) {
      const url = absoluteUrl(m[1]);
      if (url && !/placeholder|logo|visa|mastercard|mercadopago|facebook|instagram/i.test(url)) return url;
    }
  }
  return null;
}

function stockFromText(text) {
  const t = normalize(text);
  if (t.includes('agotado') || t.includes('sin stock') || t.includes('no tenemos mas stock')) return false;
  return true;
}

function scoreTitle(title, q) {
  const nt = normalize(title);
  const nq = normalize(q);
  if (!nq) return 0;
  if (nt === nq) return 100;
  if (nt.includes(nq)) return 80;
  const terms = nq.split(/\s+/).filter(Boolean);
  return terms.reduce((acc, term) => acc + (nt.includes(term) ? 10 : 0), 0);
}

function parseProductPage(html, url, q) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = cleanTitle(ogTitle || h1 || '');
  if (!title) return null;

  const afterH1 = h1 ? html.slice(html.indexOf(h1)) : html;
  const price = parsePrice(afterH1) ?? parsePrice(html);
  if (price === null) return null;

  const image = extractImage(html, html);
  const text = stripHtml(html.slice(0, 3500));

  return {
    id: 'm12_' + Buffer.from(url).toString('base64url').slice(0, 16),
    title,
    meta: `${PROVIDER.name} · ${PROVIDER.location}`,
    provider: PROVIDER.name,
    providerId: PROVIDER.id,
    logo: PROVIDER.logo,
    providersCount: 1,
    price,
    priceText: priceToText(price),
    prices: [{
      name: PROVIDER.name,
      logo: PROVIDER.logo,
      price,
      priceText: priceToText(price),
      url,
      image,
      stock: stockFromText(text),
      source: 'proveedor_real'
    }],
    image,
    url,
    stock: stockFromText(text),
    kind: inferKind(title),
    tags: inferTags(title),
    pack: 'Producto real',
    source: 'mayorista12_product_page',
    score: scoreTitle(title, q)
  };
}

function parseListing(html, q, sourceUrl) {
  const items = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href=["']([^"']*\/productos\/[^"']*\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const url = absoluteUrl(m[1]);
    if (!url || seen.has(url)) continue;
    const block = m[2] || '';
    let title = cleanTitle(block);
    const price = parsePrice(block);
    const image = extractImage(block, html);

    // Sometimes the anchor text is only an image. Try URL slug as a backup.
    if (!title || title.length < 3) {
      const slug = url.split('/productos/')[1]?.replace(/\/?$/, '') || '';
      title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    if (!title || title.length < 3) continue;
    if (q && scoreTitle(title, q) <= 0) continue;

    seen.add(url);
    items.push({
      id: 'm12_' + Buffer.from(url).toString('base64url').slice(0, 16),
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
        stock: stockFromText(stripHtml(block)),
        source: 'proveedor_real'
      }] : [],
      image,
      url,
      stock: stockFromText(stripHtml(block)),
      kind: inferKind(title),
      tags: inferTags(title),
      pack: 'Producto real',
      source: 'mayorista12_listing',
      sourceUrl,
      score: scoreTitle(title, q)
    });
  }
  return items;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.7'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function urlsForQuery(q) {
  const nq = normalize(q);
  const urls = new Set();
  urls.add(`${PROVIDER.baseUrl}/search/?q=${encodeURIComponent(q)}`);

  if (/oreo|gallet|pitusa|chocolina|pepitos|traviata|don satur|lincoln/.test(nq)) urls.add(`${PROVIDER.baseUrl}/galletitas/`);
  if (/coca|speed|baggio|jugo|bebida|gaseosa|agua/.test(nq)) urls.add(`${PROVIDER.baseUrl}/bebidas/`);
  if (/alfajor|caramelo|guaymayen|jorgito|billiken|arcor/.test(nq)) urls.add(`${PROVIDER.baseUrl}/golosinas/`);
  if (/combo|merienda/.test(nq)) urls.add(`${PROVIDER.baseUrl}/combos/`);

  // Exact known first product. Useful for the first real proof of concept.
  if (/oreo/.test(nq) && /118|original|gallet/.test(nq)) {
    KNOWN_URLS.forEach(u => urls.add(u));
  }

  return [...urls];
}

function uniqueSort(items, q, limit = 12) {
  const byUrl = new Map();
  for (const item of items) {
    if (!item || !item.url) continue;
    const prev = byUrl.get(item.url);
    if (!prev || (item.price !== null && prev.price === null) || item.score > prev.score) byUrl.set(item.url, item);
  }
  return [...byUrl.values()]
    .map(x => ({ ...x, score: x.score ?? scoreTitle(x.title, q) }))
    .filter(x => !q || x.score > 0)
    .sort((a, b) => (b.score - a.score) || ((a.price ?? Infinity) - (b.price ?? Infinity)))
    .slice(0, limit);
}

async function searchMayorista12(q, opts = {}) {
  const limit = opts.limit || 12;
  const urls = urlsForQuery(q);
  const settled = await Promise.allSettled(urls.map(async url => {
    const html = await fetchHtml(url);
    if (/\/productos\//.test(url)) {
      const product = parseProductPage(html, url, q);
      return product ? [product] : [];
    }
    return parseListing(html, q, url);
  }));

  const items = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const errors = settled
    .map((r, i) => r.status === 'rejected' ? { url: urls[i], error: String(r.reason && r.reason.message || r.reason) } : null)
    .filter(Boolean);

  return {
    provider: PROVIDER,
    q,
    count: uniqueSort(items, q, limit).length,
    items: uniqueSort(items, q, limit),
    errors
  };
}

module.exports = {
  PROVIDER,
  searchMayorista12,
  normalize,
  priceToText
};
