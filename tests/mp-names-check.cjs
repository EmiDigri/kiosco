const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../api/mp-history.js'), 'utf8');

async function probe({ query = { payment_ids: '101' }, auth = true, method = 'GET', payment, upstream = 200, expired = false } = {}) {
  const calls = [];
  const sample = payment || {
    id: 101, collector_id: 42, transaction_amount: 1200, operation_type: 'money_transfer',
    payer: { id: 9, first_name: 'Ana', last_name: 'Prueba', email: 'private@example.test' },
    additional_info: { payer: { first_name: 'Nombre', last_name: 'Extra' } },
    card: { cardholder: { name: 'Tarjeta', identification: { number: 'private' } } },
  };
  class Clock extends Date { static now() { return Date.parse(expired ? '2026-09-29T00:00:00Z' : '2026-09-28T21:00:00Z'); } }
  const context = {
    process: { env: { MP_ACCESS_TOKEN: 'server-test', MP_USER_ID: '42' } }, Date: Clock, URLSearchParams, AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert(!options.method || options.method === 'GET', 'all calls must be read only');
      if (url.includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-test' }) };
      return { ok: upstream === 200, status: upstream, json: async () => sample };
    },
  };
  vm.runInNewContext(source.replace('export default async function handler', 'async function handler') + ';this.handler=handler;', context);
  const res = { code: null, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await context.handler({ method, headers: auth ? { authorization: 'Bearer user-test' } : {}, query }, res);
  return { ...res, calls };
}

test('direct details, only minimal fields, deduplication and no cache', async () => {
  const r = await probe({ query: { payment_ids: '101,101' } });
  assert.equal(r.code, 200);
  assert.equal(r.body.results.length, 1);
  assert.equal(r.body.results[0].names.payer, 'Ana Prueba');
  assert.equal(r.body.results[0].names.additional, 'Nombre Extra');
  assert.equal(r.body.results[0].has_payer_id, true);
  assert.equal(r.calls.length, 2);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert(!JSON.stringify(r.body).includes('private'));
  assert(!JSON.stringify(r.body).includes('server-test'));
});
test('authentication required, no MP call without login', async () => {
  const r = await probe({ auth: false });
  assert.equal(r.code, 401);
  assert.equal(r.calls.length, 0);
});
test('only GET', async () => assert.equal((await probe({ method: 'POST' })).code, 405));
test('rejects malformed ids and more than 10', async () => {
  for (const payment_ids of ['../1', '', ['101'], Array(11).fill('101').join(',')]) {
    const r = await probe({ query: { payment_ids } });
    assert.equal(r.code, 400);
    assert.equal(r.calls.length, 1);
  }
});
test('owner and operation id must match; no name exposure otherwise', async () => {
  for (const payment of [{ id: 101, collector_id: 99 }, { id: 102, collector_id: 42 }]) {
    const r = await probe({ payment });
    assert.equal(r.body.results[0].http_status, 403);
    assert.equal(r.body.results[0].names, undefined);
  }
});
test('upstream failure remains a failure, not an empty name', async () => {
  const r = await probe({ upstream: 404 });
  assert.equal(r.body.results[0].http_status, 404);
  assert.equal(r.body.results[0].names, undefined);
});
test('probe expires even in old deployments', async () => {
  const r = await probe({ expired: true });
  assert.equal(r.code, 410);
  assert.equal(r.calls.length, 1);
});
test('normal date validation is unchanged', async () => {
  const r = await probe({ query: { date: 'invalid' } });
  assert.equal(r.code, 400);
  assert.equal(r.body.error, 'Fecha inválida');
});
