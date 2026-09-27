// Feriados NACIONALES anunciados que todavía no figuran en ArgentinaDatos ni en el archivo
// oficial del Gobierno. /api/feriados los suma a los de esas fuentes; cuando una fuente los
// publica, se quedan con el nombre de la fuente (no se duplican) y se pueden borrar de acá.
// Solo nacionales: nada provincial, municipal ni religioso opcional (pedido de digra).
// El guion bajo del nombre hace que Vercel no lo publique como endpoint.
export default [
  // Visita del papa León XIV (8 al 11/11/2026): el Gobierno anunció el 22-23/9/2026 que el
  // lunes 9 es feriado nacional. (El 10 y el 11 son solo CABA, Provincia y Córdoba: no van.)
  { fecha: '2026-11-09', tipo: 'inamovible', nombre: 'Visita del papa León XIV' },
];
