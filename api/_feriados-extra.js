// Feriados NACIONALES anunciados que todavía no figuran en ArgentinaDatos ni en el archivo
// oficial del Gobierno. /api/feriados los suma a los de esas fuentes; cuando una fuente los
// publica, se quedan con el nombre de la fuente (no se duplican) y se pueden borrar de acá.
// Solo nacionales: nada provincial, municipal ni religioso opcional (pedido de digra).
// El guion bajo del nombre hace que Vercel no lo publique como endpoint.
export default [
  // (vacío) La visita del papa León XIV (9/11/2026) estuvo acá hasta que la publicaron
  // ArgentinaDatos y el archivo oficial. El 10 y el 11/11 no son nacionales: llegan del
  // archivo oficial como feriados "locales" (CABA y Córdoba / Provincia de Buenos Aires).
  // Formato: { fecha: 'AAAA-MM-DD', tipo: 'inamovible', nombre: '...' },
];
