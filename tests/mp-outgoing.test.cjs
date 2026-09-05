const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function jsonResponse(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, async json() { return body; } };
}

function loadApi(fetchImpl) {
  let source = fs.readFileSync('api/mp-history.js', 'utf8');
  source = source.replace('export default async function handler', 'async function handler');
  source += '\nmodule.exports={handler,paymentIsOutgoing,publicPayment};';
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    process: { env: { MP_ACCESS_TOKEN: 'test-token', MP_USER_ID: '443581160' } },
    fetch: fetchImpl,
    URLSearchParams,
    Date,
    Number,
    Map,
    Promise,
    Error,
    console,
  });
  return module.exports;
}

function loadHandler(file, fetchImpl) {
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace('export default async function handler', 'async function handler');
  source += '\nmodule.exports={handler,turnoDeHora,pagoEsEnviado};';
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, fetch: fetchImpl, URLSearchParams, Date, Number,
    Map, Promise, Error, String, Math, console,
    process: { env: { MP_ACCESS_TOKEN: 'test-token', MP_USER_ID: '443581160', SUPABASE_SECRET_KEY: 'test-secret' } },
  });
  return module.exports;
}

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
  };
}

async function main() {
  const incoming = { id: 1, date_approved: '2026-09-04T15:00:00-03:00', transaction_amount: 3500, operation_type: 'money_transfer', status: 'approved' };
  const byType = { id: 2, date_approved: '2026-09-04T15:10:00-03:00', transaction_amount: 12000, operation_type: 'money_transfer_send', status: 'approved' };
  const byFlow = { id: 3, date_approved: '2026-09-04T15:20:00-03:00', transaction_amount: -8000, operation_type: 'account_fund', status: 'approved', payer_id: 443581160, point_of_interaction: { business_info: { sub_unit: 'money_outflows' } } };
  const byPayer = { id: 4, date_approved: '2026-09-04T15:30:00-03:00', transaction_amount: -217557.5, operation_type: 'money_transfer', status: 'approved', payer: { id: 443581160 }, collector_id: 9001, point_of_interaction: { business_info: { sub_unit: 'money_outflows' } } };
  const ownerOnly = { id: 5, date_approved: '2026-09-04T15:40:00-03:00', transaction_amount: 4200, operation_type: 'money_transfer', status: 'approved', payer: { id: 443581160 }, collector_id: 9002 };
  const api = loadApi(async url => {
    if (String(url).includes('/users/me')) return jsonResponse({ id: 443581160 });
    if (String(url).includes('/auth/v1/user')) return jsonResponse({ id: 'user-test' });
    const query = new URL(url).searchParams;
    if (query.get('payer.id')) return jsonResponse({ results: [byPayer, ownerOnly] });
    if (query.get('operation_type') === 'money_transfer_send') return jsonResponse({ results: [byType, byFlow] });
    return jsonResponse({ results: [incoming, byType] });
  });
  const res = responseCapture();
  await api.handler({ method: 'GET', query: { date: '2026-09-04' }, headers: { authorization: 'Bearer user-token' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.results.length, 5, 'deduplicates all outgoing searches');
  assert.deepEqual(Array.from(res.body.results, row => [row.id, row.es_enviada]), [[1, false], [2, true], [3, true], [4, true], [5, false]]);

  const html = fs.readFileSync('index.html', 'utf8');
  const fnStart = html.indexOf('function parsearMovimientos(results)');
  const fnEnd = html.indexOf('\n// ─── PULSO DEL KIOSCO', fnStart);
  const front = { exports: {} };
  vm.runInNewContext(`${html.slice(fnStart, fnEnd)}\nmodule.exports=parsearMovimientos;`, { module: front, Number, Math, Date, String });
  const parsed = front.exports(res.body.results);
  assert.equal(parsed.movs.length, 2);
  assert.equal(parsed.enviadas.length, 3);
  assert.deepEqual(Array.from(parsed.enviadas, row => row.monto).sort((a, b) => a - b), [8000, 12000, 217557.5]);

  const cronWrites = [];
  const cron = loadHandler('api/cron.js', async (url, options = {}) => {
    if (String(url).includes('/users/me')) return jsonResponse({ id: 443581160 });
    if (String(url).includes('/rest/v1/pagos')) {
      cronWrites.push(JSON.parse(options.body));
      return { ok: true, async text() { return ''; } };
    }
    const query = new URL(url).searchParams;
    if (query.get('payer.id')) return jsonResponse({ results: [byPayer, ownerOnly] });
    if (query.get('operation_type') === 'money_transfer_send') return jsonResponse({ results: [byType] });
    if (query.get('operation_type') === 'pos_payment') return jsonResponse({ results: [] });
    return jsonResponse({ results: [incoming, byType] });
  });
  await cron.handler({ query: { date: '2026-09-04' } }, responseCapture());
  assert.equal(cronWrites.filter(row => row.es_enviada).length, 2, 'cron saves outgoing transfers found by type and payer');
  assert.equal(cron.turnoDeHora(12, 0, false), 'Vale');
  assert.equal(cron.turnoDeHora(12, 1, false), 'Ani');
  assert.equal(cron.turnoDeHora(17, 0, false), 'Ani');
  assert.equal(cron.turnoDeHora(17, 1, false), 'Marta');
  assert.equal(cron.turnoDeHora(16, 0, true), 'Turno 1');
  assert.equal(cron.turnoDeHora(16, 1, true), 'Turno 2');

  const webhookWrites = [];
  const webhook = loadHandler('api/webhook.js', async (url, options = {}) => {
    if (String(url).includes('/users/me')) return jsonResponse({ id: 443581160 });
    if (String(url).includes('/v1/payments/')) return jsonResponse(byType);
    webhookWrites.push(JSON.parse(options.body));
    return { ok: true, async text() { return ''; } };
  });
  await webhook.handler({ method: 'POST', body: { type: 'payment', data: { id: byType.id } }, query: {} }, responseCapture());
  assert.equal(webhookWrites[0].es_enviada, true);
  assert.equal(webhookWrites[0].monto, 12000);
  assert.equal(webhookWrites[0].tipo, 'Transferencia enviada');
  assert.equal(webhook.turnoDeHora('12:00', false), 'Vale');
  assert.equal(webhook.turnoDeHora('12:01', false), 'Ani');
  assert.equal(webhook.turnoDeHora('17:00', false), 'Ani');
  assert.equal(webhook.turnoDeHora('17:01', false), 'Marta');
  assert.equal(webhook.turnoDeHora('16:00', true), 'Turno 1');
  assert.equal(webhook.turnoDeHora('16:01', true), 'Turno 2');
  console.log('PASS: explicit outgoing search, money-outflow detection, deduplication and frontend classification.');
}

main().catch(error => { console.error(error); process.exit(1); });
