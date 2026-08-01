// Proxy para el clima de Buenos Aires.
// Antes usaba api.open-meteo.com, pero quedo inalcanzable (timeout) tanto
// desde ISPs argentinos como desde los propios servidores de Vercel:
// https://github.com/open-meteo/open-meteo/issues/1669
// Se cambia a api.met.no (Instituto Meteorologico de Noruega / yr.no),
// gratis, sin API key, solo requiere un User-Agent identificable.

const LAT = -34.6037, LON = -58.3816;
const TZ = 'America/Argentina/Buenos_Aires';
const METAR_URL = 'https://aviationweather.gov/api/data/metar?ids=SABE&format=json&taf=false&hours=3';
const MAX_OBSERVATION_AGE_MS = 3 * 60 * 60 * 1000;

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
  if (t <= 12 && windKmh > 4.8) {
    const v = Math.pow(windKmh, 0.16);
    return Math.round(13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v);
  }
  return Math.round(t);
}

function metarWeatherCode(row, fallback) {
  const raw = String(row?.rawOb || '').toUpperCase();
  if (/\bTS/.test(raw)) return 95;
  if (/\b(?:SN|SG|PL)/.test(raw)) return 71;
  if (/\b(?:RA|DZ)/.test(raw)) return 61;
  if (/\b(?:FG|BR)/.test(raw)) return 45;
  const covers = [row?.cover, ...(row?.clouds || []).map(cloud => cloud?.cover)].filter(Boolean);
  if (covers.some(cover => /OVC|BKN/.test(cover))) return 3;
  if (covers.some(cover => /SCT|FEW/.test(cover))) return 2;
  if (/CAVOK|\b(?:CLR|SKC|NSC)\b/.test(raw)) return 1;
  return fallback;
}

async function aeroparqueObservation() {
  try {
    const response = await fetch(METAR_URL, {
      headers: {
        accept: 'application/json',
        'User-Agent': 'kiosco-app (github.com/EmiDigri/kiosco)',
      },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.value) ? payload.value : []);
    const row = rows.filter(item => item?.icaoId === 'SABE')
      .sort((a, b) => Date.parse(b.reportTime || 0) - Date.parse(a.reportTime || 0))[0];
    const observedAt = String(row?.reportTime || '');
    const observedMs = Date.parse(observedAt);
    const temperature = Number(row?.temp);
    const windKmh = Number(row?.wspd) * 1.852;
    const windDirection = row?.wdir === '' || row?.wdir == null ? NaN : Number(row.wdir);
    const windGustKmh = Number(row?.wgst) * 1.852;
    const age = Date.now() - observedMs;
    if (!Number.isFinite(temperature) || !Number.isFinite(observedMs) || age < -30 * 60 * 1000 || age > MAX_OBSERVATION_AGE_MS) return null;
    return {
      temperature,
      windKmh: Number.isFinite(windKmh) ? windKmh : 0,
      windDirection: Number.isFinite(windDirection) ? windDirection : null,
      windGustKmh: Number.isFinite(windGustKmh) && windGustKmh > 0 ? windGustKmh : null,
      observedAt,
      row,
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

  try {
    const [r, observation] = await Promise.all([
      fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`, {
        headers: { 'User-Agent': 'kiosco-app (github.com/EmiDigri/kiosco)' },
      }),
      aeroparqueObservation(),
    ]);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const series = j?.properties?.timeseries || [];
    if (!series.length) throw new Error('sin datos');

    const now = series[0];
    const nowDetails = now?.data?.instant?.details || {};
    const nextHourDetails = now?.data?.next_1_hours?.details || {};
    const nowSymbol = now?.data?.next_1_hours?.summary?.symbol_code || now?.data?.next_6_hours?.summary?.symbol_code || 'clearsky_day';
    const temperature = observation?.temperature ?? nowDetails.air_temperature;
    const windKmh = observation?.windKmh ?? ((nowDetails.wind_speed || 0) * 3.6);
    const windDirection = observation ? observation.windDirection : Number(nowDetails.wind_from_direction);
    const metNoGustKmh = Number(nowDetails.wind_speed_of_gust) * 3.6;
    const windGustKmh = observation?.windGustKmh ?? (!observation && Number.isFinite(metNoGustKmh) && metNoGustKmh > 0 ? metNoGustKmh : null);
    const weatherCode = observation ? metarWeatherCode(observation.row, symbolToWmoCode(nowSymbol)) : symbolToWmoCode(nowSymbol);
    const current = {
      temperature_2m: Math.round(temperature),
      apparent_temperature: feelsLike({ air_temperature: temperature, wind_speed: windKmh / 3.6 }),
      weather_code: weatherCode,
      wind_speed_10m: Math.round(windKmh),
      wind_direction_10m: Number.isFinite(windDirection) ? Math.round(windDirection) : null,
      wind_gusts_10m: Number.isFinite(windGustKmh) ? Math.round(windGustKmh) : null,
      cloud_cover: Number.isFinite(Number(nowDetails.cloud_area_fraction)) ? Math.round(Number(nowDetails.cloud_area_fraction)) : null,
      relative_humidity_2m: Number.isFinite(Number(nowDetails.relative_humidity)) ? Math.round(Number(nowDetails.relative_humidity)) : null,
      precipitation: Number.isFinite(Number(nextHourDetails.precipitation_amount)) ? Number(nextHourDetails.precipitation_amount) : 0,
      is_day: isDayFromSymbol(nowSymbol, hourAR(observation?.observedAt || now.time)),
      observed_at: observation?.observedAt || now.time,
      source: observation ? 'METAR Aeroparque' : 'met.no',
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
