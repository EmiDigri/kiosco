// Proxy de la probabilidad de lluvia para "Info del día" (Villa Pueyrredón, donde está el kiosco): reenvía el ensemble de
// Open-Meteo (simulaciones de ECMWF, GFS e ICON para Buenos Aires) con cache de 30
// minutos, así todos los equipos del kiosco comparten una sola consulta. El cálculo
// (chance y franjas horarias) se hace en la app: iwLluviaResumen en index.html.
// Open-Meteo a veces no responde desde Vercel (github.com/open-meteo/open-meteo/issues/1669);
// en ese caso la app lo pide directo desde el navegador.
const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=-34.58&longitude=-58.50&hourly=precipitation&models=ecmwf_ifs025,gfs025,icon_global&forecast_days=3&timezone=America%2FArgentina%2FBuenos_Aires';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(ENSEMBLE_URL, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'kiosco-app (github.com/EmiDigri/kiosco)' },
    });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: e.name === 'AbortError' ? 'timeout' : e.message });
  } finally {
    clearTimeout(timer);
  }
}
