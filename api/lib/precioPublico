// Paso 6 — Precio de Venta al Público (PVP) real, vía Precios Claros (SEPA).
// Fuente: Sistema Electrónico de Publicidad de Precios Argentinos, gobierno nacional.
// Dataset oficial, actualizado a diario, cubre Coto / Día / Jumbo / Carrefour / etc.
//
// Flujo:
//   1) Buscamos el producto por texto en /prod/productos?string={query}
//      (esto nos da el código de barras / id de cada producto que matchea)
//   2) Con ese id de producto, consultamos /prod/producto?id_producto={id}
//      junto con la lista fija de sucursales de Buenos Aires (Coto + Día)
//      para traer el precio real de cada una.
//   3) Promediamos los precios de Coto y Día (precio unidad, no bulto/mayorista)
//      y devolvemos ese promedio como PVP de referencia.
//
// No reemplaza el catálogo manual viejo (precioPublico.js): si esta consulta
// falla o no hay datos, ese catálogo manual sigue funcionando como fallback.

const SEPA_BASE = 'https://d3e6htiiul5ek9.cloudfront.net/prod';

// Sucursales de Buenos Aires (zona del kiosco: Olivos / Villa Martelli /
// San Isidro / Munro / Vicente López) ya confirmadas en pruebas reales.
// comercioId 15 = Supermercados DIA, comercioId 12 = COTO CICSA.
// Esta lista se puede ampliar más adelante sin tocar el resto del código.
const SUCURSALES_BA = [
  '15-1-100', '15-1-1038', '15-1-204', '15-1-1008', '15-1-5534', '15-1-1004',
  '12-1-188', // COTO CICSA, Munro
  '15-1-5134', '15-1-5549', '15-1-87', '15-1-139', '15-1-57',
  '15-1-158', '15-1-160', '15-1-5498', '15-1-5291', '15-1-5551', '15-1-103'
];

// Cadenas que sí queremos promediar para el PVP. Dejamos afuera Axion Energy,
// Jumbo, estaciones de servicio, etc. — el pedido fue específicamente
// "promedio entre Coto y Día".
const COMERCIOS_VALIDOS = new Set([12, 15]); // 12 = Coto, 15 = Día

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Paso 1: buscar productos por texto libre. Devuelve una lista de productos
// candidatos con su id (código de barras) y nombre.
async function buscarProductosSepa(q) {
  const url = `${SEPA_BASE}/productos?string=${encodeURIComponent(q)}&array_sucursales=${SUCURSALES_BA.join(',')}&offset=0&limit=20&sort=-cant_sucursales_disponible`;
  const data = await fetchJson(url);
  const lista = Array.isArray(data && data.productos) ? data.productos
    : Array.isArray(data && data.resultado) ? data.resultado
    : Array.isArray(data) ? data
    : [];
  return lista
    .map(p => ({
      id: p.id || p.codigoBarra || p.codigo_barra,
      nombre: p.nombre || p.descripcion || '',
      presentacion: p.presentacion || ''
    }))
    .filter(p => p.id && p.nombre);
}

// Paso 2: con el id de un producto puntual, traer el precio real en cada
// sucursal de Coto/Día de la lista fija.
async function precioProductoSepa(idProducto) {
  const url = `${SEPA_BASE}/producto?limit=30&id_producto=${encodeURIComponent(idProducto)}&array_sucursales=${SUCURSALES_BA.join(',')}`;
  const data = await fetchJson(url);
  const sucursales = Array.isArray(data && data.sucursales) ? data.sucursales : [];

  const precios = [];
  for (const s of sucursales) {
    if (s.message) continue; // "La sucursal no contiene el producto."
    const comercioId = Number(s.comercioId);
    if (!COMERCIOS_VALIDOS.has(comercioId)) continue;
    const precio = s.preciosProducto && Number(s.preciosProducto.precioLista);
    if (!Number.isFinite(precio) || precio <= 0) continue;
    precios.push({
      precio,
      cadena: s.banderaDescripcion || (comercioId === 12 ? 'Coto' : 'Día'),
      comercioId
    });
  }

  return {
    nombre: data && data.producto && data.producto.nombre,
    presentacion: data && data.producto && data.producto.presentacion,
    precios
  };
}

// Elegimos, entre los candidatos de la búsqueda por texto, el que mejor
// matchea el título. Igual criterio "estricto" que ya usamos en el resto
// del buscador: el nombre del producto SEPA tiene que contener la palabra
// buscada, para no promediar precios de otra cosa.
function elegirMejorCandidato(candidatos, q) {
  const nq = normalize(q);
  const conMatch = candidatos.filter(c => normalize(c.nombre).includes(nq));
  return conMatch[0] || null;
}

// Función principal: dado un texto de búsqueda, devuelve el PVP promedio
// de Coto + Día, o null si no se pudo conseguir un dato confiable.
async function getPvpSepa(q) {
  const texto = String(q || '').trim();
  if (!texto) return null;

  try {
    const candidatos = await buscarProductosSepa(texto);
    const elegido = elegirMejorCandidato(candidatos, texto);
    if (!elegido) return null;

    const { nombre, presentacion, precios } = await precioProductoSepa(elegido.id);
    if (!precios.length) return null;

    const promedio = precios.reduce((a, p) => a + p.precio, 0) / precios.length;
    const cadenas = [...new Set(precios.map(p => p.cadena))];

    return {
      found: true,
      publicPrice: Math.round(promedio * 100) / 100,
      publicPriceText: '$' + Math.round(promedio).toLocaleString('es-AR'),
      source: `Promedio Precios Claros (SEPA) · ${cadenas.join(' + ')} · ${precios.length} sucursal(es)`,
      nombreOficial: nombre || elegido.nombre,
      presentacion: presentacion || elegido.presentacion,
      detalle: precios
    };
  } catch (err) {
    // Si SEPA falla (caído, timeout, cambio de formato), no rompemos nada:
    // el caller debe usar el fallback manual existente.
    console.warn('SEPA PVP falló para "' + texto + '":', err && err.message || err);
    return null;
  }
}

module.exports = {
  getPvpSepa,
  buscarProductosSepa,
  precioProductoSepa,
  SUCURSALES_BA,
  COMERCIOS_VALIDOS
};
