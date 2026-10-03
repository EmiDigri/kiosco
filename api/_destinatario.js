// A quién se le transfirió. Mercado Pago no manda el nombre del que recibe una transferencia
// enviada (money_transfer / PSP_TRANSFER): solo su número de cuenta (collector.id). Pero si se
// le pregunta por ese número con la clave del kiosco (GET /users/{id}), devuelve el apodo de
// la cuenta, que suele ser el nombre de la persona o del negocio ("PABLO CASAS",
// "TODOIMPRESORAS 10"). Verificado con las transferencias reales del 3/10/2026.
// Archivo con "_": Vercel no lo publica como ruta, solo lo usan cron.js y webhook.js.

// "TODOIMPRESORAS 10" -> "Todoimpresoras 10"; "PABLO CASAS" -> "Pablo Casas".
export function nombreLindo(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es-AR')
    .replace(/(^|[\s.-])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-AR'));
}

// Devuelve el nombre del destinatario o '' si no se puede saber (sin número de cuenta, es la
// propia cuenta, MP no responde). Nunca tira error: sin nombre, la salida queda como siempre.
// `cache` (Map) evita preguntar dos veces por la misma cuenta en una misma corrida.
export async function nombreDestinatario(pago, { token, ownerId, cache = new Map(), pedir = fetch } = {}) {
  const id = pago?.collector?.id ?? pago?.collector_id;
  if (!id || !token || Number(id) === Number(ownerId)) return '';
  const clave = String(id);
  if (cache.has(clave)) return cache.get(clave);
  let nombre = '';
  try {
    const r = await pedir(`https://api.mercadopago.com/users/${encodeURIComponent(clave)}`, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const u = await r.json().catch(() => null);
      nombre = nombreLindo(u?.nickname || [u?.first_name, u?.last_name].filter(Boolean).join(' '));
    }
  } catch { /* sin nombre: queda "Transferencia enviada" */ }
  cache.set(clave, nombre);
  return nombre;
}

// Nombre con el que se guarda una salida: los pagos de servicio/producto muestran su
// descripción ("Pago Edenor"); las transferencias, a quién fueron; si no se sabe, lo de siempre.
export async function nombreSalida(pago, opciones) {
  if (pago?.operation_type === 'regular_payment' && pago.description) return `Pago ${pago.description}`;
  return (await nombreDestinatario(pago, opciones)) || 'Transferencia enviada';
}
