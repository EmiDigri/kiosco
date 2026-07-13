// Conexión de la cuenta de MercadoLibre (un solo click, una sola vez).
//
// ¿Por qué existe? La búsqueda de ML devuelve "forbidden" con el token de
// aplicación sola (client_credentials): exige un token de CUENTA autorizada.
// Este endpoint hace las dos patas del flujo OAuth:
//   1. Sin ?code → redirige a MercadoLibre para que el dueño autorice la app.
//   2. ML vuelve con ?code → lo canjeamos por access + refresh token y los
//      guardamos en la tabla ml_tokens de Supabase. api/catalogo.js los lee
//      de ahí y los renueva solo (ML rota el refresh token en cada uso).
//
// Requisito: en developers.mercadolibre.com.ar, la app debe tener como URI de
// redirect exactamente https://<dominio>/api/ml-auth y el scope offline_access.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pilfeptwylgufhbmmday.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ML_CLIENT_ID = process.env.ML_CLIENT_ID || '';
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || '';

async function guardarTokens(data) {
  const row = {
    id: 1,
    access_token: data.access_token || null,
    refresh_token: data.refresh_token || null,
    expires_at: new Date(Date.now() + ((Number(data.expires_in) || 21600) - 300) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ml_tokens?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error('No pude guardar los tokens en Supabase (¿creaste la tabla ml_tokens?): ' + await res.text());
}

function pagina(res, status, emoji, titulo, detalle) {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  return res.status(status).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kiosco · MercadoLibre</title></head><body style="font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center"><div style="max-width:460px;padding:32px"><div style="font-size:52px;margin-bottom:14px">${emoji}</div><h1 style="font-size:21px;margin:0 0 10px">${titulo}</h1><p style="color:#9aa4b2;line-height:1.55;font-size:14px">${detalle}</p></div></body></html>`);
}

export default async function handler(req, res) {
  try {
    if (!ML_CLIENT_ID || !ML_CLIENT_SECRET || !SUPABASE_SECRET) {
      return pagina(res, 500, '🔑', 'Faltan las claves', 'Antes de conectar, cargá ML_CLIENT_ID, ML_CLIENT_SECRET y SUPABASE_SECRET_KEY en las variables de entorno de Vercel y hacé Redeploy.');
    }

    const redirectUri = `https://${req.headers.host}/api/ml-auth`;

    // El usuario canceló o ML devolvió un error en la autorización.
    if (req.query.error) {
      return pagina(res, 502, '🙅', 'Autorización cancelada', `MercadoLibre respondió: ${String(req.query.error_description || req.query.error)}. Volvé a intentar abriendo /api/ml-auth.`);
    }

    // Paso 1: sin code → mandamos a MercadoLibre a autorizar.
    const code = req.query.code;
    if (!code) {
      const url = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${encodeURIComponent(ML_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
      res.setHeader('Location', url);
      return res.status(302).end();
    }

    // Paso 2: ML volvió con el code → lo canjeamos por los tokens.
    const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });
    const data = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !data?.access_token) {
      return pagina(res, 502, '⚠️', 'MercadoLibre rechazó la conexión', `${data?.message || data?.error || 'Error desconocido'}. El código de autorización vence a los pocos minutos: probá abrir /api/ml-auth de nuevo. Revisá también que la URI de redirect de la app sea exactamente ${redirectUri}.`);
    }

    await guardarTokens(data);

    const aviso = data.refresh_token
      ? 'La conexión se renueva sola: no hace falta repetir esto nunca.'
      : 'Ojo: no llegó el refresh token, así que la conexión se corta cada 6 horas. Activá el permiso "offline_access" en la app de MercadoLibre y volvé a conectar.';
    return pagina(res, 200, '✅', 'MercadoLibre conectado', `Ya podés cerrar esta pestaña y buscar precios y fotos desde la app. ${aviso}`);
  } catch (err) {
    return pagina(res, 500, '💥', 'Algo salió mal', String(err.message || err));
  }
}
