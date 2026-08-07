// Lectura del cuaderno del cierre diario con IA (Claude, visión).
//
// El kiosquero saca UNA foto a la planilla escrita a mano del día (con los tres
// turnos y los gastos) y este endpoint devuelve los números estructurados para
// autocompletar el cierre. El MercadoPago principal NO se lee del papel: la app
// ya lo tiene capturado. Sí se leen el Cierre (total) por turno, la apertura, el
// Once (O), el MPO (juguetería) y los gastos. El efectivo lo calcula la app como
// Cierre − MP − Once.
//
// Requiere ANTHROPIC_API_KEY en Vercel (la misma del lector de facturas).

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const TOOL = {
  name: 'registrar_cierre',
  description: 'Registra los números leídos del cuaderno de cierre diario de un kiosco.',
  input_schema: {
    type: 'object',
    properties: {
      fecha: { type: ['string', 'null'], description: 'Fecha escrita arriba, tal cual (ej. "6/8"). null si no se lee.' },
      turnos: {
        type: 'array',
        description: 'Los turnos EN ORDEN de arriba hacia abajo (1° = mañana, 2° = tarde, 3° = noche). Máximo 3.',
        items: {
          type: 'object',
          properties: {
            cierre: { type: ['number', 'null'], description: 'El "Cierre" del turno: el TOTAL del turno (número grande, ej. 361600).' },
            apertura: { type: ['number', 'null'], description: 'La "Apertura" del turno (plata inicial, suele ser 10000).' },
            once: { type: ['number', 'null'], description: 'La columna "O" (Once): efectivo aparte. 0 o null si hay un guion o está vacío.' },
            mpo: { type: ['number', 'null'], description: 'La columna "MPO" (MercadoPago juguetería). 0 o null si hay guion o vacío.' },
          },
          required: ['cierre'],
        },
      },
      total_dia: { type: ['number', 'null'], description: 'El total escrito y subrayado abajo de los tres cierres (para verificar la suma).' },
      gastos: {
        type: 'array',
        description: 'La lista de la sección "GASTOS": cada renglón con su concepto y monto.',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string', description: 'Concepto o proveedor del gasto (ej. Edenor, Santos, Figus Mariano).' },
            monto: { type: 'number', description: 'Monto del gasto en pesos.' },
          },
          required: ['nombre', 'monto'],
        },
      },
    },
    required: ['turnos'],
  },
};

const PROMPT = `Sos el asistente de un kiosco argentino. Leé esta foto de la planilla ESCRITA A MANO del cierre del día y extraé los números.

Estructura de la planilla:
- Arriba está la fecha (ej. "6/8").
- Después vienen los turnos, EN ORDEN de arriba hacia abajo (hasta 3). Cada turno tiene dos renglones: "Apertura" (plata inicial, casi siempre 10000) y "Cierre" (el TOTAL de ese turno, un número grande). El nombre escrito al lado puede ser de un suplente (ej. "Luis" en vez de la persona del turno): NO te guíes por el nombre, guiate por el ORDEN.
- A la derecha hay columnas: "MP" (MercadoPago principal — NO lo extraigas, no se usa), "MPO" (MercadoPago de juguetería) y "O" (Once, efectivo aparte). Extraé MPO y O por turno si están; si hay un guion "—" o está vacío, poné 0.
- Abajo de los tres cierres hay un total subrayado: es la suma de los tres. Extraelo como total_dia.
- Después hay una sección "GASTOS" con una lista de concepto + monto (puede estar en dos columnas). Extraé cada gasto.

Reglas:
- Los números usan el punto como separador de miles (formato argentino): "361.600" = 361600, "1.574.350" = 1574350, "$ 35.400" = 35400.
- Si un número es ilegible o dudoso, poné null (no inventes).
- Devolvé los turnos en el mismo orden en que aparecen de arriba hacia abajo.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usá POST' });
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Falta configurar la clave de IA (ANTHROPIC_API_KEY) en Vercel para leer el cuaderno.' });
  }
  try {
    const { image, mime } = req.body || {};
    const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : 'image/jpeg';
    if (!image || typeof image !== 'string' || image.length < 100) {
      return res.status(400).json({ error: 'No llegó la foto del cuaderno' });
    }
    if (image.length > 6000000) {
      return res.status(413).json({ error: 'La foto es demasiado pesada: probá de nuevo' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'registrar_cierre' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(502).json({ error: data?.error?.message || `La IA respondió ${response.status}` });
    }

    const toolUse = (data?.content || []).find(block => block.type === 'tool_use');
    const parsed = toolUse?.input;
    if (!parsed || !Array.isArray(parsed.turnos)) {
      return res.status(502).json({ error: 'No pude leer el cuaderno: probá con una foto más nítida y derecha' });
    }
    const num = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0);
    const turnos = parsed.turnos.slice(0, 3).map(t => ({
      cierre: num(t?.cierre),
      apertura: num(t?.apertura) || 10000,
      once: num(t?.once),
      mpo: num(t?.mpo),
    }));
    const gastos = (Array.isArray(parsed.gastos) ? parsed.gastos : [])
      .filter(g => g && g.nombre && Number(g.monto) > 0)
      .map(g => ({ nombre: String(g.nombre).slice(0, 60), monto: Math.round(Number(g.monto)) }));

    return res.status(200).json({
      fecha: parsed.fecha || null,
      turnos,
      total_dia: num(parsed.total_dia) || null,
      gastos,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Error leyendo el cuaderno' });
  }
}
