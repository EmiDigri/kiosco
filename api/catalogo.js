const MP_TOKEN = 'APP_USR-2677690000928530-060419-6c49e8560bd0de2e71129377f502b62a-443581160';

const BULK_REGEX = /\b(pack|combo|lote|fardo|bulto|display|mayorista|por\s+mayor|caja\s+x)\b|\bx\s*(?:6|8|10|12|15|18|20|24|30|36|48|60|72|96)\b/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'query requerida' });

  try {
    const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(q)}&limit=50&condition=new&buying_mode=buy_it_now`;
    const mlRes = await fetch(url, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });

    if (!mlRes.ok) return res.status(mlRes.status).json({ error: 'ML error', status: mlRes.status });

    const data = await mlRes.json();
    const items = (data.results || [])
      .filter(p => !BULK_REGEX.test(p.title))
      .slice(0, 16)
      .map(p => ({
        id: p.id,
        title: p.title,
        price: p.price,
        thumbnail: p.thumbnail,
        permalink: p.permalink
      }));

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
