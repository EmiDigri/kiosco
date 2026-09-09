// Guarda/lee la foto del cuaderno de un dia en Supabase Storage (bucket privado).
// Snapshot visual del cierre: se sube al confirmar el cierre por foto y se muestra
// en el detalle del dia del historial. Protegido por login (token de usuario).
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_AE6T1LMQuY2T8mf0uD_ANA_Bh4nk_ej';
const BUCKET = 'cierres-foto';

async function usuarioValido(req) {
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token || token === ANON) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const u = await r.json().catch(() => null);
    return Boolean(u && u.id);
  } catch { return false; }
}

const svcHeaders = extra => Object.assign({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }, extra || {});

async function ensureBucket() {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: svcHeaders() });
  if (r.ok) return;
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: svcHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 8000000, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }),
  });
}

const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!await usuarioValido(req)) return res.status(401).json({ error: 'Inicia sesion' });
  if (!SERVICE) return res.status(503).json({ error: 'Storage no configurado en el servidor' });

  try {
    if (req.method === 'POST') {
      const { fecha, image, mime } = req.body || {};
      if (!validDate(fecha)) return res.status(400).json({ error: 'fecha invalida' });
      if (!image || typeof image !== 'string') return res.status(400).json({ error: 'falta la imagen' });
      const b64 = image.replace(/^data:[^;]+;base64,/, '');
      if (b64.length > 8000000) return res.status(413).json({ error: 'imagen demasiado pesada' });
      const buffer = Buffer.from(b64, 'base64');
      const tipo = ['image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : 'image/jpeg';
      await ensureBucket();
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fecha}`, {
        method: 'POST',
        headers: svcHeaders({ 'Content-Type': tipo, 'x-upsert': 'true' }),
        body: buffer,
      });
      if (!up.ok) return res.status(502).json({ error: `No se pudo guardar (${up.status})` });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET') {
      const fecha = String(req.query.fecha || '');
      if (!validDate(fecha)) return res.status(400).json({ error: 'fecha invalida' });
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${fecha}`, {
        method: 'POST',
        headers: svcHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      if (!r.ok) return res.status(200).json({ url: null });
      const data = await r.json().catch(() => null);
      const signed = data && data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : null;
      return res.status(200).json({ url: signed });
    }
    return res.status(405).json({ error: 'Metodo no permitido' });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
