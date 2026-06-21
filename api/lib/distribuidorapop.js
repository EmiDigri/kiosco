// Paso 5A — Distribuidora Pop usando scraper genérico WooCommerce.

const { searchWooCommerce } = require('./woocommerceGeneric');

const PROVIDER = {
  id: 'distribuidorapop',
  name: 'Distribuidora Pop',
  logo: 'POP',
  baseUrl: 'https://www.distribuidorapop.com.ar',
  location: 'Buenos Aires'
};

async function searchDistribuidoraPop(q, opts = {}) {
  return searchWooCommerce(q, PROVIDER, opts);
}

module.exports = { PROVIDER, searchDistribuidoraPop };
