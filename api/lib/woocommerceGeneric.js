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

function parseMoneyToken(raw) {
  let s = decodeHtml(String(raw || ''))
    .replace(/\s+/g, '')
    .replace(/[^0-9.,]/g, '');

  if (!s) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  // Formato mixto:
  // 11.330,00 => AR / europeo
  // 11,330.00 => US
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    const [intPart, decPart = ''] = s.split(',');
    // 11,33 puede ser decimal real, pero en muchas páginas WooCommerce aparece
    // recortado desde 11,330.00 cuando el regex viejo agarraba solo una parte.
    // Acá lo parseamos bien solo cuando viene como token completo.
    if (decPart.length === 2) s = intPart.replace(/\./g, '') + '.' + decPart;
    else s = s.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    const decPart = parts[parts.length - 1] || '';
    if (decPart.length === 2 && parts.length === 2 && parts[0].length > 3) {
      // 5000.00 => 5000
      s = parts[0] + '.' + decPart;
    } else if (decPart.length === 2 && parts.length === 2 && parts[0].length <= 3) {
      // 11.33 => 11.33
      s = parts[0] + '.' + decPart;
    } else {
      // 11.330 o 5.000 => miles AR
      s = s.replace(/\./g, '');
    }
  }

  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPriceTokens(value) {
  const text = decodeHtml(String(value || ''));
  const tokens = [];

  // Primero tomamos bloques típicos de WooCommerce para no agarrar cuotas,
  // scripts, contadores o basura alrededor del producto.
  const amountRe = /<[^>]+class=["'][^"']*(?:woocommerce-Price-amount|amount|price)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi;
  let m;
  while ((m = amountRe.exec(text))) {
    const clean = stripHtml(m[0]);
    const money = clean.match(/\$?\s*((?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?)/);
    if (money && money[1]) tokens.push(money[1]);
  }

  // Fallback general: soporta 11.330,00, 11,330.00, 5000.00, 5000,00, 5000.
  const generalRe = /\$\s*((?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?)/g;
  while ((m = generalRe.exec(text))) {
    if (m && m[1]) tokens.push(m[1]);
  }

  return tokens;
}

function parsePrices(value, opts = {}) {
  const maxReasonablePrice = opts.maxReasonablePrice || 250000;
  const tokens = extractPriceTokens(value);
  const nums = tokens
    .map(parseMoneyToken)
    .filter(n => Number.isFinite(n) && n > 0)
    // Evita precios delirantes por parseo malo o placeholders del sitio.
    .filter(n => n <= maxReasonablePrice);
  return [...new Set(nums)];
}

function parsePrice(value, opts = {}) {
  const prices = parsePrices(value, opts);
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

// Paso 5A.3 — filtro fuerte de relevancia.
// Evita que una búsqueda como “coca” acepte cualquier producto que la web
// devuelve por defecto (frutos secos, bazar, ceniceros, etc.).
const STOP_TERMS = new Set(['de','del','la','el','los','las','y','en','x','por','pack','caja','cajas','unidad','unidades','u','un','una','gr','g','kg','ml','cc','lt','l']);

const QUERY_ALIASES = [
  { match: /^(coca|coca cola|coca cola zero|coca zero|cocacola)/, any: ['coca','cola','cocacola'] },
  { match: /^(lays|lay s|papas lays)/, any: ['lays','lay s'] },
  { match: /^(rocklets|rocklet)/, any: ['rocklets','rocklet'] },
  { match: /^(oreo)/, any: ['oreo'] },
  { match: /^(fantoche)/, any: ['fantoche'] },
  { match: /^(baggio)/, any: ['baggio'] },
  { match: /^(guaymallen|guaymallen)/, any: ['guaymallen','guaymallen'] },
  { match: /^(jorgito)/, any: ['jorgito'] },
  { match: /^(beldent)/, any: ['beldent'] },
  { match: /^(topline|top line)/, any: ['topline','top line'] },
  { match: /^(mogul)/, any: ['mogul'] },
  { match: /^(billiken)/, any: ['billiken'] },
  { match: /^(tita)/, any: ['tita'] },
  { match: /^(rhodesia)/, any: ['rhodesia'] },
  { match: /^(manaos)/, any: ['manaos'] },
  { match: /^(levite|levite)/, any: ['levite','levite'] },
  { match: /^(sprite)/, any: ['sprite'] },
  { match: /^(fanta)/, any: ['fanta'] },
  { match: /^(pepsi)/, any: ['pepsi'] },
  { match: /^(bic)/, any: ['bic'] },
  { match: /^(resma)/, any: ['resma'] },
  { match: /^(plasticola)/, any: ['plasticola'] },
  { match: /^(filgo)/, any: ['filgo'] },
  { match: /^(pringles)/, any: ['pringles'] },
  { match: /^(doritos)/, any: ['doritos'] }
];

function significantTerms(q) {
  return normalize(q)
    .split(/\s+/)
    .filter(t => t && t.length >= 2 && !STOP_TERMS.has(t));
}

function isRelevantTitle(title, q) {
  const nt = normalize(title);
  const nq = normalize(q);
  if (!nq) return true;
  if (!nt) return false;
  if (nt.includes(nq)) return true;

  for (const rule of QUERY_ALIASES) {
    if (rule.match.test(nq)) return rule.any.some(alias => nt.includes(normalize(alias)));
  }

  const terms = significantTerms(q);
  if (!terms.length) return true;
  if (terms.length === 1) return nt.includes(terms[0]);

  const hits = terms.filter(t => nt.includes(t)).length;
  // Para consultas con varias palabras pedimos coincidencia fuerte.
  // Ej: “coca zero” debe pegar en coca/cola y zero, no en cualquier bebida.
  return hits === terms.length || (terms.length >= 3 && hits >= terms.length - 1);
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
  if (q && !isRelevantTitle(title, q)) return null;

  const price = parsePrice(block, provider.priceOptions || {});
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
    .filter(x => !q || isRelevantTitle(x.title, q))
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
  parseMoneyToken,
  extractPriceTokens,
  scoreTitle,
  uniqueSort,
  isRelevantTitle
};
