// Proxy para el clima de Buenos Aires.
// Necesario porque api.open-meteo.com es inalcanzable desde varios ISP
// argentinos (Personal, Tuenti) por un problema de ruteo ajeno a nosotros:
// https://github.com/open-meteo/open-meteo/issues/1669
// El fetch corre en los servidores de Vercel, no en el navegador del kiosco,
// así que no depende de esa ruta rota.

const URL = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude=-34.6037&longitude=-58.3816'
  + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
  + '&forecast_days=5&timezone=America/Argentina/Buenos_Aires';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

  try {
    const r = await fetch(URL);
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
