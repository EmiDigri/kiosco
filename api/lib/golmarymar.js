// Paso 5A.3 — Golmarymar usando scraper genérico WooCommerce.
// Mayorista de golosinas con sucursales en CABA.

const { searchWooCommerce } = require('./woocommerceGeneric');

const PROVIDER = {
  id: 'golmarymar',
  name: 'Golmarymar',
  logo: 'GMM',
  baseUrl: 'https://golmarymar.com.ar',
  location: 'CABA, Buenos Aires',
  priceOptions: {
    // Golmarymar muestra rangos por x1/x24/x40; igual la app ahora solo usa links.
    // Este límite evita precios delirantes si el parser agarra basura.
    maxReasonablePrice: 500000
  }
};

async function searchGolmarymar(q, opts = {}) {
  return searchWooCommerce(q, PROVIDER, opts);
}

module.exports = { PROVIDER, searchGolmarymar };
