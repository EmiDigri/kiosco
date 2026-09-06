const BASE_URL = 'https://api.mercadopago.com/v1/account/settlement_report';

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, accept: 'application/json', ...extra };
}

function dayWindow(date) {
  const [year, month, day] = date.split('-').map(Number);
  const begin = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
  const dayEnd = new Date(Date.UTC(year, month - 1, day + 1, 2, 59, 59, 999));
  const end = new Date(Math.min(dayEnd.getTime(), Date.now()));
  return { begin, end };
}

async function ensureConfig(token) {
  const current = await fetch(`${BASE_URL}/config`, { headers: authHeaders(token) });
  if (current.ok) return;
  if (current.status !== 404) throw new Error(`No se pudo consultar la configuracion del reporte (${current.status})`);
  const response = await fetch(`${BASE_URL}/config`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      columns: [
        { key: 'SOURCE_ID' },
        { key: 'TRANSACTION_TYPE' },
        { key: 'TRANSACTION_AMOUNT' },
        { key: 'TRANSACTION_DATE' },
        { key: 'SETTLEMENT_NET_AMOUNT' },
        { key: 'REAL_AMOUNT' },
      ],
      file_name_prefix: 'kiosco-movimientos',
      frequency: { hour: 0, value: 1, type: 'monthly' },
      separator: ';',
      display_timezone: 'GMT-03',
      report_translation: 'es',
      header_language: 'en',
      scheduled: false,
    }),
  });
  if (!response.ok && response.status !== 409) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || 'No se pudo configurar el reporte de Mercado Pago');
  }
}

function parseCsv(text, separator = ';') {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(values => values.some(value => value !== ''));
}

function numberValue(value) {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  if (!normalized || !Number.isFinite(parsed)) throw new Error('Importe invalido en el reporte de Mercado Pago');
  return parsed;
}

function reportOutflows(csv, date) {
  const content = String(csv || '').replace(/^\uFEFF/, '');
  const separator = content.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows = parseCsv(content, separator);
  if (!rows.length) throw new Error('El reporte de Mercado Pago esta vacio');
  const headers = rows[0].map(header => header.trim().toUpperCase());
  const indexOf = (...names) => names.map(name => headers.indexOf(name)).find(index => index >= 0) ?? -1;
  const idIndex = indexOf('SOURCE_ID', 'ID DE OPERACIÓN EN MERCADO PAGO');
  const dateIndex = indexOf('SETTLEMENT_DATE', 'TRANSACTION_DATE', 'FECHA DE ORIGEN');
  const typeIndex = indexOf('TRANSACTION_TYPE', 'TIPO DE OPERACIÓN');
  const netIndex = indexOf('SETTLEMENT_NET_AMOUNT', 'REAL_AMOUNT', 'MONTO NETO DE LA OPERACIÓN');
  if ([idIndex, dateIndex, typeIndex, netIndex].some(index => index < 0)) {
    throw new Error('El reporte no tiene las columnas necesarias para verificar salidas');
  }
  const window = date ? dayWindow(date) : null;
  const unique = new Map();
  rows.slice(1).forEach(values => {
    const timestamp = values[dateIndex];
    const instant = new Date(timestamp).getTime();
    if (!timestamp || !Number.isFinite(instant) || !/(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) {
      throw new Error('Fecha sin zona horaria o invalida en el reporte de Mercado Pago');
    }
    if (window && (instant < window.begin.getTime() || instant > window.end.getTime())) return;
    const net = numberValue(values[netIndex]);
    if (net >= 0) return;
    const type = String(values[typeIndex] || '').trim().toUpperCase();
    // A refund can share the original payment ID: it must never overwrite it as a transfer.
    if (['REFUND', 'CHARGEBACK', 'DISPUTE', 'WITHDRAWAL_CANCEL'].includes(type)) return;
    if (!['WITHDRAWAL', 'PAYOUT'].includes(type)) {
      throw new Error('Hay debitos cuyo tipo requiere verificar el reporte original de Mercado Pago');
    }
    const sourceId = String(values[idIndex] || '').trim();
    if (!sourceId) throw new Error('Salida sin identificador de operacion en el reporte');
    if (unique.has(sourceId)) throw new Error('Identificador de salida repetido en el reporte');
    unique.set(String(sourceId), {
      id: sourceId,
      date_approved: timestamp,
      date_created: timestamp,
      transaction_amount: -Math.abs(net),
      operation_type: 'money_transfer_send',
      status: 'approved',
      es_enviada: true,
      description: type === 'PAYOUT' ? 'Retiro de efectivo' : 'Retiro a cuenta bancaria',
    });
  });
  return [...unique.values()];
}

function coversWindow(report, begin, end) {
  const reportBegin = new Date(report.begin_date).getTime();
  const reportEnd = new Date(report.end_date).getTime();
  return Number.isFinite(reportBegin) && Number.isFinite(reportEnd)
    && reportBegin <= begin.getTime() + 60000
    && reportEnd >= end.getTime() - 60000;
}

export async function settlementOutflows(date, token) {
  if (!token) return { status: 'disabled', outflows: [] };
  await ensureConfig(token);
  const { begin, end } = dayWindow(date);
  const listResponse = await fetch(`${BASE_URL}/list`, { headers: authHeaders(token) });
  if (!listResponse.ok) throw new Error(`No se pudo consultar la lista de reportes (${listResponse.status})`);
  const reports = await listResponse.json();
  if (!Array.isArray(reports)) throw new Error('Formato de lista de reportes no reconocido');
  const matching = reports
    .filter(report => coversWindow(report, begin, end))
    .sort((a, b) => new Date(b.generation_date || b.last_modified || 0) - new Date(a.generation_date || a.last_modified || 0));
  const processed = matching.find(report => report.status === 'processed' && report.file_name);
  if (processed) {
    const download = await fetch(`${BASE_URL}/${encodeURIComponent(processed.file_name)}`, { headers: authHeaders(token) });
    if (!download.ok) throw new Error('No se pudo descargar el reporte de Mercado Pago');
    return { status: 'processed', outflows: reportOutflows(await download.text(), date) };
  }
  if (matching.some(report => report.status === 'pending' || report.status === 'processing')) {
    return { status: 'pending', outflows: [] };
  }
  const create = await fetch(BASE_URL, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ begin_date: begin.toISOString(), end_date: end.toISOString() }),
  });
  const task = await create.json().catch(() => null);
  if (!create.ok) throw new Error(task?.message || 'No se pudo iniciar el reporte de Mercado Pago');
  return { status: task?.status || 'pending', outflows: [] };
}

export const settlementInternals = { parseCsv, reportOutflows };
