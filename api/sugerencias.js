// Paso 2 — API propia de autosugerencias para Vercel.
// Endpoint: /api/sugerencias?q=oreo
// Por ahora usa un catálogo simulado. En el próximo paso este endpoint se conecta a proveedores reales.

const PRODUCTS = [
  {
    id: 'oreo118', kind: 'oreo', title: 'Oreo Original 118g', meta: 'Galletitas dulces · Mondelez', providersCount: 3,
    tags: ['Golosinas', 'Galletitas', 'Mondelez'], pack: 'Paquete x 118g', keys: ['oreo', 'galletita', 'galletitas', 'mondelez'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 1790, best: true },
      { name: 'Distribuidora OKS', logo: 'OKS', price: 1850 },
      { name: 'Golomax', logo: 'Golomax', price: 1920 }
    ]
  },
  {
    id: 'oreo36', kind: 'oreo', title: 'Oreo Original 36g', meta: 'Presentación chica', providersCount: 3,
    tags: ['Golosinas', 'Galletitas', 'Unidad'], pack: 'Paquete x 36g', keys: ['oreo'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 620, best: true },
      { name: 'Distribuidora OKS', logo: 'OKS', price: 650 },
      { name: 'Golomax', logo: 'Golomax', price: 690 }
    ]
  },
  {
    id: 'oreo220', kind: 'oreo', title: 'Oreo 220g', meta: 'Pack familiar', providersCount: 3,
    tags: ['Golosinas', 'Galletitas', 'Familiar'], pack: 'Paquete x 220g', keys: ['oreo'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 3220 },
      { name: 'Distribuidora OKS', logo: 'OKS', price: 3140, best: true },
      { name: 'Golomax', logo: 'Golomax', price: 3370 }
    ]
  },
  {
    id: 'oreoBlanca', kind: 'oreo', title: 'Oreo Bañada Chocolate Blanco', meta: 'Chocolate blanco', providersCount: 2,
    tags: ['Golosinas', 'Chocolate', 'Oreo'], pack: 'Unidad', keys: ['oreo', 'bañada', 'banada', 'chocolate blanco'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 1450, best: true },
      { name: 'Golomax', logo: 'Golomax', price: 1530 }
    ]
  },
  {
    id: 'milkaOreo', kind: 'oreo', title: 'Milka Oreo 100g', meta: 'Chocolate Milka', providersCount: 2,
    tags: ['Chocolate', 'Milka', 'Oreo'], pack: 'Tableta x 100g', keys: ['oreo', 'milka', 'chocolate'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 2300, best: true },
      { name: 'Golomax', logo: 'Golomax', price: 2450 }
    ]
  },
  {
    id: 'kitkatOreo', kind: 'oreo', title: 'Kit Kat Oreo', meta: 'Chocolate', providersCount: 2,
    tags: ['Chocolate', 'Kit Kat', 'Oreo'], pack: 'Unidad', keys: ['oreo', 'kit kat', 'kitkat', 'chocolate'],
    prices: [
      { name: 'El Goloso', logo: 'El Goloso', price: 1850, best: true },
      { name: 'Golomax', logo: 'Golomax', price: 1930 }
    ]
  },
  {
    id: 'bicAzul', kind: 'bic', title: 'Bic Cristal Azul x50', meta: 'Librería · Caja x50', providersCount: 3,
    tags: ['Librería', 'Biromes', 'Bic'], pack: 'Caja x 50 unidades', keys: ['bic', 'lapicera', 'birome', 'azul'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 18400, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 19150 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 20500 }
    ]
  },
  {
    id: 'bicNegra', kind: 'bic', title: 'Bic Cristal Negra x50', meta: 'Librería · Caja x50', providersCount: 3,
    tags: ['Librería', 'Biromes', 'Bic'], pack: 'Caja x 50 unidades', keys: ['bic', 'lapicera', 'birome', 'negra', 'negro'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 18400, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 19300 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 20900 }
    ]
  },
  {
    id: 'lapizBic', kind: 'bic', title: 'Lápiz Bic Evolution', meta: 'Librería escolar', providersCount: 2,
    tags: ['Librería', 'Escolar', 'Bic'], pack: 'Pack / caja', keys: ['bic', 'lapiz', 'lápiz', 'evolution'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 8900, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 9400 }
    ]
  },
  {
    id: 'resaltadorBic', kind: 'bic', title: 'Resaltador Bic', meta: 'Librería', providersCount: 3,
    tags: ['Librería', 'Resaltadores', 'Bic'], pack: 'Unidad / pack', keys: ['bic', 'resaltador', 'marcador'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 1250, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 1320 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1500 }
    ]
  },
  {
    id: 'resmaA4', kind: 'paper', title: 'Resma A4 75g x500 hojas', meta: 'Librería · Papel', providersCount: 3,
    tags: ['Librería', 'Papel', 'Escolar'], pack: '500 hojas', keys: ['resma', 'a4', 'papel', 'hojas'],
    prices: [
      { name: 'Casa Paso', logo: 'Paso', price: 5850, best: true },
      { name: 'SASA Mayorista', logo: 'SASA', price: 6100 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 6900 }
    ]
  },
  {
    id: 'coca500', kind: 'coca', title: 'Coca-Cola 500ml', meta: 'Bebidas', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 500ml', keys: ['coca', 'coca cola', 'coca-cola', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 980, best: true },
      { name: 'Masivos', logo: 'Mas', price: 1030 },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 1150 }
    ]
  },
  {
    id: 'coca225', kind: 'coca', title: 'Coca-Cola 2.25L', meta: 'Bebidas', providersCount: 3,
    tags: ['Bebidas', 'Gaseosas', 'Coca-Cola'], pack: 'Botella 2.25L', keys: ['coca', 'coca cola', 'coca-cola', 'bebida', 'gaseosa'],
    prices: [
      { name: 'Distribuidora OKS', logo: 'OKS', price: 2450 },
      { name: 'Masivos', logo: 'Mas', price: 2390, best: true },
      { name: 'Mercado Libre ref.', logo: 'ML', price: 2700 }
    ]
  }
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matches(product, q) {
  const nq = normalize(q);
  if (!nq) return false;
  const haystack = normalize([
    product.title,
    product.meta,
    product.pack,
    ...(product.tags || []),
    ...(product.keys || [])
  ].join(' '));
  return haystack.includes(nq) || (product.keys || []).some(k => nq.includes(normalize(k)));
}

module.exports = function handler(req, res) {
  const q = String(req.query.q || '').trim();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (!q) {
    return res.status(200).json({ ok: true, q, count: 0, items: [] });
  }

  const items = PRODUCTS
    .filter(product => matches(product, q))
    .slice(0, 8)
    .map(product => ({ ...product, source: 'catalogo_simulado_api' }));

  return res.status(200).json({ ok: true, q, count: items.length, items });
};
