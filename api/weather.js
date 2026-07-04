// Proxy para el clima de Buenos Aires.
// Antes usaba api.open-meteo.com, pero quedo inalcanzable (timeout) tanto
// desde ISPs argentinos como desde los propios servidores de Vercel:
// https://github.com/open-meteo/open-meteo/issues/1669
// Se cambia a api.met.no (Instituto Meteorologico de Noruega / yr.no),
// gratis, sin API key, solo requiere un User-Agent identificable.

const LAT = -34.6037, LON = -58.3816;
const TZ = 'America/Argentina/Buenos_Aires';

function symbolToWmoCode(symbol) {
  const s = (symbol || '').replace(/_day|_night|_polartwilight/g, '');
  if (s.includes('thunder')) return 95;
  if (s.includes('sleet') || s.includes('snow')) return 71;
  if (s.includes('showers')) return 80;
  if (s.includes('rain') || s.includes('drizzle')) return 61;
  if (s.includes('fog')) return 45;
  if (s === 'cloudy') return 3;
  if (s === 'partlycloudy') return 2;
  return 1; // clearsky, fair
}

function isDayFromSymbol(symbol, hourLocal) {
  if (/_night/.test(symbol || '')) return 0;
  if (/_day/.test(symbol || '')) return 1;
  return hourLocal >= 6 && hourLocal < 19 ? 1 : 0;
}

function dateKeyAR(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function hourAR(iso) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(iso)));
}

function feelsLike(details) {
  if (!details || details.air_temperature == null) return null;
  const t = details.air_temperature, windKmh = (details.wind_speed || 0) * 3.6;
  if (t <= 10 && windKmh > 4.8) {
    const v = Math.pow(windKmh, 0.16);
    return Math.round(13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v);
  }
  return Math.round(t);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

  try {
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`, {
      headers: { 'User-Agent': 'kiosco-app (github.com/EmiDigri/kiosco)' },
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const series = j?.properties?.timeseries || [];
    if (!series.length) throw new Error('sin datos');

    const now = series[0];
    const nowDetails = now?.data?.instant?.details || {};
    const nowSymbol = now?.data?.next_1_hours?.summary?.symbol_code || now?.data?.next_6_hours?.summary?.symbol_code || 'clearsky_day';
    const current = {
      temperature_2m: Math.round(nowDetails.air_temperature),
      apparent_temperature: feelsLike(nowDetails),
      weather_code: symbolToWmoCode(nowSymbol),
      wind_speed_10m: nowDetails.wind_speed != null ? Math.round(nowDetails.wind_speed * 3.6) : 0,
      is_day: isDayFromSymbol(nowSymbol, hourAR(now.time)),
    };

    // Agrupa por dia (hora local AR) para min/max y elige el simbolo mas cercano al mediodia
    const byDay = {};
    series.forEach((entry) => {
      const temp = entry?.data?.instant?.details?.air_temperature;
      if (temp == null) return;
      const key = dateKeyAR(entry.time);
      if (!byDay[key]) byDay[key] = { min: temp, max: temp, symbol: null, symbolDiff: Infinity };
      const d = byDay[key];
      if (temp < d.min) d.min = temp;
      if (temp > d.max) d.max = temp;
      const symbol = entry?.data?.next_1_hours?.summary?.symbol_code || entry?.data?.next_6_hours?.summary?.symbol_code;
      const diff = Math.abs(hourAR(entry.time) - 13);
      if (symbol && diff < d.symbolDiff) { d.symbolDiff = diff; d.symbol = symbol; }
    });
    const days = Object.keys(byDay).sort().slice(0, 5);
    const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] };
    days.forEach((key) => {
      const d = byDay[key];
      daily.time.push(key);
      daily.weather_code.push(symbolToWmoCode(d.symbol));
      daily.temperature_2m_max.push(Math.round(d.max));
      daily.temperature_2m_min.push(Math.round(d.min));
    });

    res.status(200).json({ current, daily });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
