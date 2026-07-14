// Lectura de facturas/remitos/tickets de proveedores con IA (Claude, visión).
//
// El kiosquero le saca una foto al comprobante cuando recibe mercadería y
// este endpoint devuelve los renglones estructurados (producto, cantidad,
// costo unitario con IVA) listos para revisar y cargar al catálogo.
//
// Requiere ANTHROPIC_API_KEY en las variables de entorno de Vercel
// (se crea en console.anthropic.com). Cada foto cuesta ~US$0,004.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

// Salida forzada vía tool-use: la respuesta llega siempre como JSON válido
// con esta estructura, sin texto suelto que haya que parsear.
const TOOL = {
  name: 'registrar_factura',
  description: 'Registra los datos extraídos de una factura, remito o ticket de proveedor.',
  input_schema: {
    type: 'object',
    properties: {
      proveedor: { type: ['string', 'null'], description: 'Razón social o nombre de fantasía del proveedor' },
      fecha: { type: ['string', 'null'], description: 'Fecha del comprobante en formato AAAA-MM-DD' },
      tipo: { type: ['string', 'null'], description: 'Tipo de comprobante: Factura A, Factura B, Factura C, Remito, Ticket u otro' },
      nota: { type: ['string', 'null'], description: 'Aclaración importante para el kiosquero (ej. IVA no discriminado, foto cortada, renglones ilegibles)' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            descripcion: { type: 'string', description: 'Descripción del producto, expandiendo abreviaturas obvias' },
            cantidad: { type: 'number', description: 'Cantidad facturada, tal como la factura el proveedor (unidades o bultos)' },
            unitario: { type: 'number', description: 'Precio unitario FINAL con IVA incluido, en pesos' },
            importe: { type: ['number', 'null'], description: 'Importe total del renglón con IVA incluido' },
            unidadesPorBulto: { type: ['integer', 'null'], description: 'Si el renglón es un pack o bulto (ej. x24u, 1x12), cuántas unidades trae' },
            ean: { type: ['string', 'null'], description: 'Código de barras EAN si figura en el renglón' },
          },
          required: ['descripcion', 'cantidad', 'unitario'],
        },
      },
    },
    required: ['items'],
  },
};

const PROMPT = `Sos el asistente de compras de un kiosco argentino. Leé este comprobante de un proveedor (factura A/B/C, remito o ticket) y extraé TODOS los renglones de mercadería.

Reglas:
- "unitario" siempre CON IVA incluido: si es una factura A con precios netos e IVA discriminado, calculá el unitario final aplicando la alícuota que corresponda al comprobante.
- Ignorá los renglones que no son mercadería: percepciones, IIBB, fletes, envases retornables, descuentos globales, subtotales.
- Si un renglón es un pack o bulto (ej. "x24u", "1x12", "CAJA 18"), completá unidadesPorBulto y dejá "unitario" como el precio de ESE bulto completo.
- Expandí abreviaturas obvias (GALL → Galletitas, CHOC → Chocolate, GASEOSA CC → Gaseosa Coca-Cola) pero NO inventes lo que no se lee.
- Si algo importante quedó ilegible o dudoso, mencionalo brevemente en "nota".`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usá POST' });
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Falta configurar la clave de IA (ANTHROPIC_API_KEY) en Vercel para poder leer facturas.' });
  }
  try {
    const { image, mime } = req.body || {};
    const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : 'image/jpeg';
    if (!image || typeof image !== 'string' || image.length < 100) {
      return res.status(400).json({ error: 'No llegó la foto del comprobante' });
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
        max_tokens: 4000,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'registrar_factura' },
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
      const message = data?.error?.message || `La IA respondió ${response.status}`;
      return res.status(502).json({ error: message });
    }

    const toolUse = (data?.content || []).find(block => block.type === 'tool_use');
    const parsed = toolUse?.input;
    if (!parsed || !Array.isArray(parsed.items)) {
      return res.status(502).json({ error: 'No pude estructurar el comprobante: probá con una foto más nítida y derecha' });
    }
    const items = parsed.items
      .filter(item => item && item.descripcion && Number(item.cantidad) > 0 && Number(item.unitario) > 0)
      .map(item => ({
        descripcion: String(item.descripcion).slice(0, 120),
        cantidad: Number(item.cantidad),
        unitario: Number(item.unitario),
        importe: Number(item.importe) > 0 ? Number(item.importe) : null,
        unidadesPorBulto: Number(item.unidadesPorBulto) > 1 ? Math.round(Number(item.unidadesPorBulto)) : null,
        ean: /^\d{8,18}$/.test(String(item.ean || '')) ? String(item.ean) : null,
      }));

    return res.status(200).json({
      proveedor: parsed.proveedor || null,
      fecha: parsed.fecha || null,
      tipo: parsed.tipo || null,
      nota: parsed.nota || null,
      items,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Error leyendo el comprobante' });
  }
}
