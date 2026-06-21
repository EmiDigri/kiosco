// Paso 5A — scraper genérico liviano para proveedores WooCommerce.
// No usa librerías externas. Está pensado para Vercel Serverless.
// Recibe un proveedor con baseUrl y busca en: /?s={query}&post_type=product

const USER_AGENT = 'Mozilla/5.0 (compatible; KioscoPriceBot/1.0; +https://kiosco-lac.vercel.app/)';

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
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
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

function parsePrices(value) {
  const text = decodeHtml(String(value || ''));
  const matches = [...text.matchAll(/\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]+(?:,[0-9]{2})?)/g)];
  const nums = matches
    .map(m => Number(m[1].replace(/\./g, '').replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0);
  return [...new Set(nums)];
}

function parsePrice(value) {
  const prices = parsePrices(value);
  if (!prices.length) return null;
  // En ofertas WooCommerce suele mostrar precio viejo + precio nuevo. Tomamos el menor.
  return Math.min(...prices);
}

function cleanTitle(text) {
  return stripHtml(text)
    .replace(/Oferta/gi, ' ')
    .replace(/Env[ií]o gratis/gi, ' ')
    .replace(/\b(Sale|Read more|Leer m[aá]s|Añadir al carrito|Agregar al carrito|Seleccionar opciones|Ver producto)\b/gi, ' ')
    .replace(/\$\s*[0-9\.]+(?:,[0-9]{2})?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function inferKind(title) {
  const n = normalize(title);
  if (n.includes('oreo') || n.includes('gallet')) return 'oreo';
  if (n.includes('coca') || n.includes('pepsi') || n.includes('sprite') || n.includes('fanta') || n.includes('manaos') || n.includes('levite') || n.includes('bebida') || n.includes('gaseosa') || n.includes('jugo') || n.includes('agua')) return 'coca';
  if (n.includes('bic') || n.includes('lapiz') || n.includes('birome') || n.includes('resalt') || n.includes('resma') || n.includes('plasticola') || n.includes('filgo')) return 'bic';
  if (n.includes('lays') || n.includes('doritos') || n.includes('papas') || n.includes('snack')) return 'snack';
  if (n.includes('alfajor') || n.includes('fantoche') || n.includes('jorgito') || n.includes('guaymallen')) return 'alfajor';
  if (n.includes('beldent') || n.includes('topline') || n.includes('chicle')) return 'chicle';
  return 'real';
}

function inferTags(title, provider) {
  const n = normalize(title);
  const tags = [];
  if (n.includes('gallet') || n.includes('oreo') || n.includes('terrabusi') || n.includes('don satur')) tags.push('Galletitas');
  if (n.includes('coca') || n.includes('pepsi') || n.includes('sprite') || n.includes('fanta') || n.includes('manaos') || n.includes('levite') || n.includes('bebida') || n.includes('gaseosa') || n.includes('jugo') || n.includes('agua')) tags.push('Bebidas');
  if (n.includes('lays') || n.includes('doritos') || n.includes('papas') || n.includes('snack')) tags.push('Snacks');
  if (n.includes('alfajor') || n.includes('fantoche') || n.includes('jorgito') || n.includes('guaymallen')) tags.push('Alfajores');
  if (n.includes('beldent') || n.includes('topline') || n.includes('chicle')) tags.push('Chicles');
  if (n.includes('mogul') || n.includes('billiken') || n.includes('caramelo') || n.includes('gomita')) tags.push('Golosinas');
  if (n.includes('bic') || n.includes('resma') || n.includes('lapiz') || n.includes('birome') || n.includes('plasticola') || n.includes('filgo')) tags.push('Librería');
  if (!tags.length) tags.push('Producto real');
  tags.push(provider.name);
  return [...new Set(tags)];
}

function extractImage(block, fullHtml, baseUrl) {
  const source = block || fullHtml || '';
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<img[^>]+(?:data-lazy-src|data-src|data-original|src)=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+srcset=["']([^"']+)["'][^>]*>/i
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (!m || !m[1]) continue;
    let raw = m[1].split(',')[0].trim().split(' ')[0];
    const url = absoluteUrl(raw, baseUrl);
    if (!url) continue;
    if (/placeholder|logo|visa|mastercard|mercadopago|facebook|instagram|sprite|blank|data:image/i.test(url)) continue;
    return url;
  }
  return null;
}

function stockFromText(text) {
  const t = normalize(text);
  if (t.includes('agotado') || t.includes('sin stock') || t.includes('no tenemos mas stock') || t.includes('out of stock')) return false;
  return true;
}

function titleFromBlock(block, url) {
  const patterns = [
    /<h2[^>]*class=["'][^"']*woocommerce-loop-product__title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i,
    /<h3[^>]*class=["'][^"']*(product-title|woocommerce-loop-product__title)[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i,
    /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i,
    /<a[^>]+title=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+alt=["']([^"']+)["'][^>]*>/i
  ];

  for (const re of patterns) {
    const m = block.match(re);
    if (m) {
      const raw = m[2] || m[1];
      const title = cleanTitle(raw);
      if (title && title.length > 2) return title;
    }
  }

  const anchorText = block.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  const fromAnchor = cleanTitle(anchorText || '');
  if (fromAnchor && fromAnchor.length > 2) return fromAnchor;

  if (url) {
    const slug = decodeURIComponent(String(url).split('/producto/')[1] || String(url).split('/product/')[1] || '')
      .replace(/\/?$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    if (slug && slug.length > 2) return slug;
  }
  return '';
}

function itemFromBlock(block, q, provider, sourceUrl) {
  const href = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  const url = href ? absoluteUrl(href, provider.baseUrl) : null;
  if (!url) return null;
  if (!/(\/producto\/|\/product\/|product=|post_type=product)/i.test(url)) return null;

  const title = titleFromBlock(block, url);
  if (!title || title.length < 3) return null;
  if (q && scoreTitle(title, q) <= 0) return null;

  const price = parsePrice(block);
  const image = extractImage(block, null, provider.baseUrl);
  const stock = stockFromText(stripHtml(block));
  const providerId = provider.id;
  const priceText = priceToText(price);

  return {
    id: `${providerId}_` + Buffer.from(url).toString('base64url').slice(0, 16),
    title,
    meta: provider.location ? `${provider.name} · ${provider.location}` : provider.name,
    provider: provider.name,
    providerId,
    logo: provider.logo || provider.name,
    providersCount: 1,
    price,
    priceText,
    prices: price !== null ? [{
      name: provider.name,
      logo: provider.logo || provider.name,
      price,
      priceText,
      url,
      image,
      stock,
      source: 'proveedor_real'
    }] : [],
    image,
    url,
    stock,
    kind: inferKind(title),
    tags: inferTags(title, provider),
    pack: 'Producto real',
    source: `${providerId}_woocommerce_listing`,
    sourceUrl,
    score: scoreTitle(title, q)
  };
}

function extractProductBlocks(html) {
  const blocks = [];
  const patterns = [
    /<li\b[^>]*class=["'][^"']*(?:product|type-product|wc-block-grid__product)[^"']*["'][^>]*>[\s\S]*?<\/li>/gi,
    /<article\b[^>]*class=["'][^"']*(?:product|type-product)[^"']*["'][^>]*>[\s\S]*?<\/article>/gi,
    /<div\b[^>]*class=["'][^"']*(?:product|type-product|wc-block-grid__product|product-small)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) blocks.push(m[0]);
  }
  return blocks;
}

function parseListing(html, q, provider, sourceUrl) {
  const items = [];
  const seen = new Set();

  for (const block of extractProductBlocks(html)) {
    const item = itemFromBlock(block, q, provider, sourceUrl);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
  }

  // Fallback: si la estructura no entró como bloque, buscamos links a productos y tomamos una ventana cercana.
  const anchorRe = /<a\b[^>]*href=["']([^"']*(?:\/producto\/|\/product\/)[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const url = absoluteUrl(m[1], provider.baseUrl);
    if (!url || seen.has(url)) continue;
    const start = Math.max(0, m.index - 900);
    const end = Math.min(html.length, anchorRe.lastIndex + 1300);
    const block = html.slice(start, end);
    const item = itemFromBlock(block, q, provider, sourceUrl);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
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
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
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

function searchUrl(provider, q) {
  const base = String(provider.baseUrl || '').replace(/\/$/, '');
  if (provider.searchUrl) return provider.searchUrl(q);
  return `${base}/?s=${encodeURIComponent(q)}&post_type=product`;
}

async function searchWooCommerce(q, provider, opts = {}) {
  const limit = opts.limit || 12;
  const url = searchUrl(provider, q);
  const html = await fetchHtml(url, opts.timeoutMs || 9000);
  const items = parseListing(html, q, provider, url);
  const sorted = uniqueSort(items, q, limit);

  return {
    provider,
    q,
    count: sorted.length,
    items: sorted,
    errors: sorted.length ? [] : [{ provider: provider.name, url, error: 'Sin resultados parseables para esta búsqueda' }]
  };
}

module.exports = {
  searchWooCommerce,
  normalize,
  decodeHtml,
  stripHtml,
  priceToText,
  parsePrice,
  scoreTitle,
  uniqueSort
};
