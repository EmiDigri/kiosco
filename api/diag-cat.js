// TEMPORAL — ¿se aplicó el SQL transaccional del catálogo (Codex)? Solo lectura. Borrar después.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = 'cat-3d9a1f';

async function get(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt.slice(0, 300); }
  return { status: r.status, body };
}

export default async function handler(req, res) {
  if ((req.query.k || '') !== SECRET) return res.status(403).json({ error: 'no' });
  try {
    const openapi = await get('');
    const paths = Object.keys(openapi.body?.paths || {});
    const ops = await get('catalogo_operaciones?select=*&limit=3&order=created_at.desc');
    const opsCount = await fetch(`${SUPABASE_URL}/rest/v1/catalogo_operaciones?select=id`, { method: 'HEAD', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Prefer: 'count=exact' } });
    const cat = await get('catalogo?select=uid,nombre,ean,stock,costo,precio&limit=2000');
    const filas = Array.isArray(cat.body) ? cat.body : [];
    const eans = {}; filas.forEach(f => { const e = String(f.ean || '').trim(); if (e) (eans[e] = eans[e] || []).push(f.nombre); });
    res.status(200).json({
      rpcCatalogoAplicar: paths.includes('/rpc/catalogo_aplicar'),
      rpcsCatalogo: paths.filter(p => /catalogo/i.test(p)),
      tablaOperaciones: { status: ops.status, total: opsCount.headers.get('content-range'), ultimas: Array.isArray(ops.body) ? ops.body.map(o => ({ tipo: o.tipo, estado: o.estado, created_at: o.created_at })) : ops.body },
      catalogo: {
        status: cat.status, productos: filas.length,
        conEan: filas.filter(f => String(f.ean || '').trim()).length,
        conStock: filas.filter(f => f.stock != null).length,
        conCosto: filas.filter(f => Number(f.costo) > 0).length,
        eanDuplicados: Object.entries(eans).filter(([, n]) => n.length > 1).map(([e, n]) => ({ ean: e, productos: n })),
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
