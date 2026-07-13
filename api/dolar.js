const TIPOS = ['oficial', 'blue', 'bolsa'];
const CURRENT_URL = 'https://dolarapi.com/v1/dolares';
const HISTORY_BASE = 'https://api.argentinadatos.com/v1/cotizaciones/dolares';
const TIME_ZONE = 'America/Argentina/Buenos_Aires';

async function fetchJson(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'kiosco-cotizaciones/1.0' },
    });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function argentinaDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function historyRows(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.fecha || '')) && Number.isFinite(Number(row?.venta)))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

function previousClose(data, todayKey) {
  const rows = historyRows(data).filter(row => row.fecha < todayKey);
  return rows.length ? Number(rows[rows.length - 1].venta) : null;
}

function latestHistory(data) {
  const rows = historyRows(data);
  return rows.length ? rows[rows.length - 1] : null;
}

function variation(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous * 100;
}

function buildQuote(tipo, currentRows, history, todayKey) {
  const live = Array.isArray(currentRows) ? currentRows.find(row => row?.casa === tipo) : null;
  const fallback = latestHistory(history);
  const venta = Number(live?.venta ?? fallback?.venta);
  const compra = Number(live?.compra ?? fallback?.compra);
  if (!Number.isFinite(venta)) return null;
  const previous = previousClose(history, todayKey);
  return {
    fecha: live?.fechaActualizacion || fallback?.fecha || null,
    venta,
    compra: Number.isFinite(compra) ? compra : null,
    pct: variation(venta, previous),
    cierreAnterior: previous,
    fuente: live ? 'DolarAPI' : 'ArgentinaDatos',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const checkedAt = new Date();
  const results = await Promise.allSettled([
    fetchJson(CURRENT_URL),
    ...TIPOS.map(tipo => fetchJson(`${HISTORY_BASE}/${tipo}`, 5000)),
  ]);
  const currentRows = results[0].status === 'fulfilled' ? results[0].value : null;
  const histories = Object.fromEntries(TIPOS.map((tipo, index) => [
    tipo,
    results[index + 1].status === 'fulfilled' ? results[index + 1].value : [],
  ]));
  const todayKey = argentinaDateKey(checkedAt);
  const quotes = Object.fromEntries(TIPOS.map(tipo => [
    tipo,
    buildQuote(tipo, currentRows, histories[tipo], todayKey),
  ]));

  if (!quotes.oficial && !quotes.blue && !quotes.bolsa) {
    return res.status(502).json({ error: 'No hay cotizaciones disponibles' });
  }

  return res.status(200).json({
    actualizadoEn: checkedAt.toISOString(),
    estado: Array.isArray(currentRows) ? 'actual' : 'respaldo',
    fuente: Array.isArray(currentRows) ? 'DolarAPI' : 'ArgentinaDatos',
    ...quotes,
  });
}
