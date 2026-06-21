// Paso 8 — Casa Paso (librería mayorista) como proveedor real.
// CABA: San Cristóbal (Av Jujuy 1435) y Once (Larrea 249).
// Plataforma propia (SmartyCart). HTML simple, sin JS pesado.
//
// Paso 8.1 — corrección importante: Casa Paso NO tiene buscador de texto
// libre real. Confirmado: "?search=palabra" es ignorado y devuelve TODO el
// catálogo sin filtrar (8682 productos). El sitio solo soporta:
//   - /categoria/{nombre_exacto_de_categoria}
//   - /?f[brand_ids][]={id}|{NOMBRE_MARCA}  (filtro por marca)
// Como no podemos adivinar nombres de categoría para cualquier búsqueda,
// usamos el listado de MARCAS (que sí conocemos de antemano: Bic, Filgo,
// Plasticola, etc.) como la vía principal de búsqueda. Si la palabra
// buscada coincide con una marca conocida, filtramos por esa marca.
// Si no, devolvemos vacío (mejor nada que adivinar mal).

const USER_AGENT = 'Mozilla/5.0 (compatible; KioscoPriceBot/1.0; +https://kiosco-lac.vercel.app/)';

const PROVIDER = {
  id: 'casapaso',
  name: 'Casa Paso',
  logo: 'Paso',
  baseUrl: 'https://www.casapaso.com.ar',
  location: 'CABA (San Cristóbal / Once)'
};

// Marcas confirmadas en el catálogo real de Casa Paso, con su id interno.
// (id|NOMBRE tal como aparece en los links ?f[brand_ids][]=...)
const MARCAS_CONOCIDAS = {
  'bic': { id: 288, nombre: 'BIC' },
  'filgo': { id: 283, nombre: 'FILGO' },
  'plasticola': { id: 382, nombre: 'PLASTICOLA' },
  'maped': { id: 334, nombre: 'MAPED' },
  'faber castell': { id: 287, nombre: 'FABER CASTELL' },
  'faber': { id: 287, nombre: 'FABER CASTELL' },
  'pelikan': { id: 337, nombre: 'PELIKAN' },
  'staedtler': { id: 520, nombre: 'STAEDTLER' },
  'stabilo': { id: 535, nombre: 'STABILO' },
  'sharpie': { id: 341, nombre: 'SHARPIE' },
  'pilot': { id: 497, nombre: 'PILOT' },
  'paper mate': { id: 518, nombre: 'PAPER MATE' },
  'crayola': { id: 336, nombre: 'CRAYOLA' },
  'giotto': { id: 506, nombre: 'GIOTTO' },
  'uhu': { id: 532, nombre: 'UHU' },
  'poxipol': { id: 580, nombre: 'POXIPOL' },
  'ledesma': { id: 280, nombre: 'LEDESMA' },
  'rivadavia': { id: 332, nombre: 'RIVADAVIA' },
  'kangaro': { id: 536, nombre: 'KANGARO' }
};

// Categorías comunes de kiosco/librería, con su slug real confirmado en el
// sitio. Si la búsqueda matchea (o está contenida en) alguno de estos
// nombres, navegamos directo a esa categoría.
const CATEGORIAS_CONOCIDAS = {
  'resaltador': 'marcadores_resaltadores',
  'resaltadores': 'marcadores_resaltadores',
  'marcador resaltador': 'marcadores_resaltadores',
  'resma': 'resma_de_papel',
  'resma de papel': 'resma_de_papel',
  'papel': 'resma_de_papel',
  'lapicera': 'lapiceras',
  'lapiceras': 'lapiceras',
  'birome': 'lapiceras',
  'boligrafo': 'boligrafos',
  'boligrafos': 'boligrafos',
  'lapiz': 'lapices_de_grafito',
  'lapices': 'lapices_de_grafito',
  'cuaderno': 'cuaderno_tapa_dura',
  'cuadernos': 'cuaderno_tapa_dura',
  'carpeta': 'carpeta_a4',
  'carpetas': 'carpeta_a4',
  'cartuchera': 'cartucheras_1_piso',
  'cartucheras': 'cartucheras_1_piso',
  'tijera': 'tijeras',
  'tijeras': 'tijeras',
  'sacapuntas': 'sacapuntas',
  'goma': 'gomas_de_borrar',
  'goma de borrar': 'gomas_de_borrar',
  'corrector': 'corrector_en_cinta',
  'cinta adhesiva': 'cinta_adhesiva',
  'cinta': 'cinta_adhesiva',
  'plastilina': 'plastilinas',
  'temperas': 'temperas_escolares|profesionales',
  'tempera': 'temperas_escolares|profesionales',
  'calculadora': 'calculadoras',
  'calculadoras': 'calculadoras',
  'cartulina': 'cartulina_blanca',
  'block': 'blocks_a4',
  'mochila': 'mochilas',
  'mochilas': 'mochilas',
  'chinches': 'chinches',
  'clips': 'clips',
  'broches': 'broches_para_abrochadora',
  'abrochadora': 'abrochadoras_de_mesa|mano',
  'perforadora': 'perforadoras',
  'pegamento': 'siliconas',
  'plastificadora': 'maquina_plastificadora'
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
    .replace(/&ordm;/gi, 'º')
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
  if (n.includes('bic') || n.includes('lapicera') || n.includes('birome') || n.includes('boligrafo')) tags.push('Biromes');
  if (n.includes('plasticola') || n.includes('pegamento') || n.includes('poxipol') || n.includes('silicona')) tags.push('Adhesivos');
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
  if (!url || /placeholder|logo|whatsapp|instagram|tiktok|afip|no_img/i.test(url)) return null;
  return url;
}

// Cada producto en el listado de Casa Paso viene como un bloque con un link
// a /catalogo/{id}, una imagen, un h5/h4 con el nombre, y el precio "$ X,XX"
// cerca. Tomamos una ventana de texto alrededor de cada link a /catalogo/.
function parseListing(html, q, sourceUrl) {
  const items = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href=["']([^"']*\/catalogo\/\d+[^"']*)["'][^>]*>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const url = absoluteUrl(m[1], PROVIDER.baseUrl);
    if (!url || seen.has(url)) continue;

    const start = m.index;
    const end = Math.min(html.length, anchorRe.lastIndex + 700);
    const block = html.slice(start, end);

    // El título suele venir en un encabezado (#####) cerca del link.
    const titleMatch = block.match(/#{2,5}\s*([^\n#]+?)\s*\n/) || stripHtml(block).match(/^[^$]{3,120}/);
    let title = titleMatch ? stripHtml(titleMatch[1] || titleMatch[0]) : '';
    title = title.replace(/\$\s*[0-9.,]+/g, '').replace(/Código:.*$/i, '').trim();

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

// Paso 8.1 — encuentra la mejor forma de buscar en Casa Paso para esta
// query: por marca conocida, por categoría conocida, o ninguna (sin URL
// confiable, evitamos adivinar y devolvemos vacío).
function resolveSearchUrl(q) {
  const nq = normalize(q);
  const base = PROVIDER.baseUrl;

  // 1) ¿La query ES o CONTIENE una marca conocida?
  for (const [key, marca] of Object.entries(MARCAS_CONOCIDAS)) {
    if (nq === key || nq.includes(key)) {
      const filtro = `${marca.id}|${encodeURIComponent(marca.nombre)}`;
      return `${base}/?f%5Bbrand_ids%5D%5B%5D=${filtro}`;
    }
  }

  // 2) ¿La query ES o CONTIENE una categoría conocida?
  for (const [key, slug] of Object.entries(CATEGORIAS_CONOCIDAS)) {
    if (nq === key || nq.includes(key)) {
      return `${base}/categoria/${slug}`;
    }
  }

  return null;
}

async function searchCasaPaso(q, opts = {}) {
  const limit = opts.limit || 10;
  const url = resolveSearchUrl(q);

  if (!url) {
    // No conocemos ninguna marca/categoría que coincida con esta búsqueda.
    // Mejor no adivinar una URL de categoría inexistente.
    return {
      provider: PROVIDER,
      q,
      count: 0,
      items: [],
      errors: [{ provider: PROVIDER.name, error: 'Sin marca o categoría conocida para esta búsqueda en Casa Paso' }]
    };
  }

  try {
    const html = await fetchHtml(url, opts.timeoutMs || 9000);
    if (html === null) {
      return { provider: PROVIDER, q, count: 0, items: [], errors: [{ provider: PROVIDER.name, url, error: 'Página no encontrada (404)' }] };
    }
    const items = parseListing(html, q, url);
    const sorted = uniqueSort(items, q, limit);

    if (!sorted.length) {
      return { provider: PROVIDER, q, count: 0, items: [], errors: [{ provider: PROVIDER.name, url, error: 'Sin resultados parseables para esta búsqueda' }] };
    }

    return { provider: PROVIDER, q, count: sorted.length, items: sorted, errors: [] };
  } catch (err) {
    return { provider: PROVIDER, q, count: 0, items: [], errors: [{ provider: PROVIDER.name, url, error: String(err && err.message || err) }] };
  }
}

module.exports = { PROVIDER, searchCasaPaso, MARCAS_CONOCIDAS, CATEGORIAS_CONOCIDAS };
