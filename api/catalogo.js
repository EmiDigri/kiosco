// Proxy para Open Food Facts — API pública, sin auth, CORS bloqueado en algunos browsers
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ items: [] });

  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&action=process&page_size=30&lc=es&fields=product_name,brands,image_url,image_front_small_url`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'KioscoApp/1.0' }
    });

    if (!r.ok) return res.status(r.status).json({ items: [] });

    const data = await r.json();
    const items = (data.products || [])
      .filter(p => p.product_name && (p.image_url || p.image_front_small_url))
      .slice(0, 16)
      .map(p => ({
        title: p.product_name + (p.brands ? ` — ${p.brands}` : ''),
        thumbnail: (p.image_front_small_url || p.image_url || '').replace(/\.(jpg|png)$/i, '.400.$1'),
        permalink: `https://www.mercadolibre.com.ar/search?as_word=${encodeURIComponent(p.product_name + (p.brands ? ' ' + p.brands : ''))}`
      }));

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ items: [], error: err.message });
  }
}
