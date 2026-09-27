// Feriados de un año para "Info del día". Une tres fuentes para enterarse lo antes posible de
// feriados nuevos (ej. la visita del papa León XIV, 9/11/2026, que al anunciarse no estaba en
// ninguna):
//  1. ArgentinaDatos (la que usaba la app; sus nombres son los que se muestran).
//  2. El archivo oficial del Gobierno (el que usa argentina.gob.ar/feriados), solo feriados
//     nacionales y días puente: se descartan TODOS los "no_laborable" (religiosos opcionales
//     judíos, musulmanes y armenios, y el Jueves Santo). Pedido de digra: solo nacionales.
//  3. Los nacionales anunciados que todavía no publicó nadie (api/_feriados-extra.js).
// Una fecha que está en varias se toma una sola vez. Si una fuente falla se usan las otras;
// si fallan las dos primeras, 502 y la app va directo a ArgentinaDatos. Cache de 6 horas.
import EXTRA from './_feriados-extra.js';

const UA = { 'User-Agent': 'kiosco-app (github.com/EmiDigri/kiosco)' };
const TIPO_OFICIAL = { inamovible: 'inamovible', trasladable: 'trasladable', turistico: 'puente' };

async function traer(url, ms = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: UA });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// Archivo oficial (schema.org ItemList de Events) -> [{fecha, tipo, nombre}].
export function oficiales(json) {
  const out = [];
  (json?.mainEntity?.itemListElement || []).forEach(({ item } = {}) => {
    if (!item?.startDate) return;
    const tipo = item.additionalProperty?.value || '';
    const nombre = String(item.name || '').replace(/\s+/g, ' ').replace(/\.$/, '').trim();
    if (tipo === 'no_laborable') return;
    const fin = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
    for (let d = new Date(`${item.startDate}T12:00:00Z`); d <= fin; d = new Date(d.getTime() + 864e5)) {
      out.push({ fecha: d.toISOString().slice(0, 10), tipo: TIPO_OFICIAL[tipo] || tipo || 'feriado', nombre });
    }
  });
  return out;
}

// La primera lista que trae una fecha pone el nombre y el tipo.
export function unir(...listas) {
  const porFecha = new Map();
  listas.flat().forEach(f => {
    if (f?.fecha && !porFecha.has(f.fecha)) porFecha.set(f.fecha, { fecha: f.fecha, tipo: f.tipo || 'feriado', nombre: f.nombre });
  });
  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const year = Number(req.query?.year) || new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ error: 'año inválido' });
  const delAnio = f => String(f.fecha).startsWith(`${year}-`);
  const [ad, of] = await Promise.allSettled([
    traer(`https://api.argentinadatos.com/v1/feriados/${year}`),
    traer(`https://www.argentina.gob.ar/sites/default/files/holidays-${year}-es.json`),
  ]);
  const deAd = ad.status === 'fulfilled' && Array.isArray(ad.value) ? ad.value.filter(delAnio) : [];
  const deOf = of.status === 'fulfilled' ? oficiales(of.value).filter(delAnio) : [];
  if (!deAd.length && !deOf.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'sin fuentes' });
  }
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  return res.status(200).json(unir(deAd, deOf, EXTRA.filter(delAnio)));
}
