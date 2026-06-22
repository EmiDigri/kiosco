// Proxy para datos económicos argentinos.
// Devuelve los últimos 2 valores distintos por tipo de dólar para calcular variación,
// evitando que el browser descargue el historial completo desde 2018 (20-500KB).

const TIPOS = ['oficial', 'blue', 'bolsa'];
const BASE = 'https://api.argentinadatos.com/v1/cotizaciones/dolares';

async function fetchTipo(tipo) {
  const res = await fetch(`${BASE}/${tipo}`);
  if (!res.ok) throw new Error(`${tipo}: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  // El array viene ASC (más antiguo primero). Tomamos los últimos valores distintos.
  const last = data[data.length - 1];
  const current = last.venta;

  // Busca el anterior con venta distinta (omite duplicados de fin de semana)
  let prev = null;
  for (let i = data.length - 2; i >= 0; i--) {
    if (data[i].venta !== current) { prev = data[i].venta; break; }
  }

  return {
    fecha: last.fecha,
    venta: current,
    compra: last.compra,
    pct: prev != null ? ((current - prev) / prev * 100) : null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  try {
    const [oficial, blue, bolsa] = await Promise.allSettled(TIPOS.map(fetchTipo));
    res.status(200).json({
      oficial: oficial.status === 'fulfilled' ? oficial.value : null,
      blue:    blue.status    === 'fulfilled' ? blue.value    : null,
      bolsa:   bolsa.status   === 'fulfilled' ? bolsa.value   : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
