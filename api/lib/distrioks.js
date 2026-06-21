// Paso 5A — Distribuidora OKS usando scraper genérico WooCommerce.

const { searchWooCommerce } = require('./woocommerceGeneric');

const PROVIDER = {
  id: 'distrioks',
  name: 'Distribuidora OKS',
  logo: 'OKS',
  baseUrl: 'https://distrioks.com.ar',
  location: 'Buenos Aires'
};

async function searchDistrioks(q, opts = {}) {
  return searchWooCommerce(q, PROVIDER, opts);
}

module.exports = { PROVIDER, searchDistrioks };
