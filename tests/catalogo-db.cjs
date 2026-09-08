// npm install --no-save --package-lock=false @electric-sql/pglite
// node --test tests/catalogo-db.cjs (isolated in-memory PostgreSQL)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const migration = readFileSync(require('node:path').join(__dirname, '../supabase/catalogo-transacciones.sql'), 'utf8');

test('inventory transactions, permissions, retries and rollback', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      select set_config('test.actor','11111111-1111-4111-8111-111111111111',false);`);
    await db.exec(migration);
    await db.exec(migration); // rerunnable
    const apply = async (type, data, id = randomUUID()) => (await db.query('select public.catalogo_aplicar($1,$2,$3) as result', [id, type, JSON.stringify(data)])).rows[0].result;
    const get = async uid => (await db.query('select * from public.catalogo where uid=$1', [uid])).rows[0];
    const product = (uid, ean, stock = 10) => ({uid,ean,nombre:'Producto ' + uid,categoria:'Golosinas',precio:1000,costo:500,stock});
    const a = product('c_test_a','7790000000013');
    const b = product('c_test_b','7790000000020',2);
    await apply('guardar', a); await apply('guardar', b);
    await t.test('rejects barcode duplicates', async () => {
      await assert.rejects(apply('guardar', {...a, uid:'c_duplicate'}), /codigo ya pertenece/);
    });
    await t.test('a retry discounts only once, and cannot change its payload', async () => {
      const id = randomUUID(), data = {items:[{uid:a.uid,cantidad:2,precio:1000}],medio_pago:'mp'};
      const first = await apply('venta',data,id), second = await apply('venta',data,id);
      assert.deepEqual(first,second); assert.equal((await get(a.uid)).stock,8);
      await assert.rejects(apply('venta',{...data,medio_pago:'efectivo'},id),/otros datos/);
      assert.equal(first.total,2000);
    });
    await t.test('the whole basket rolls back on insufficient stock', async () => {
      await assert.rejects(apply('venta',{items:[{uid:a.uid,cantidad:1,precio:1000},{uid:b.uid,cantidad:3,precio:1000}],medio_pago:'efectivo'}),/Stock insuficiente/);
      assert.equal((await get(a.uid)).stock,8); assert.equal((await get(b.uid)).stock,2);
    });
    await t.test('stale metadata cannot overwrite a sale', async () => {
      await assert.rejects(apply('guardar',{...a,version:1}),/cambio en otro equipo/);
      const current = await get(a.uid);
      const { stock, ...metadata } = current;
      await apply('guardar',{...metadata,precio:1200});
      assert.equal((await get(a.uid)).stock,8);
      await assert.rejects(apply('venta',{items:[{uid:a.uid,cantidad:1,precio:1000}],medio_pago:'efectivo'}),/Cambio un precio/);
    });
    await t.test('receiving adds units and stores unit cost', async () => {
      const r = await apply('entrada',{items:[{uid:b.uid,cantidad:72,costo:450}]});
      assert.equal((await get(b.uid)).stock,74); assert.equal(Number((await get(b.uid)).costo),450);
      assert.equal(r.total,32400);
    });
    await t.test('untracked stock stays null when sold', async () => {
      await apply('guardar',product('c_untracked','7790000000037',null));
      await apply('venta',{items:[{uid:'c_untracked',cantidad:1,precio:1000}],medio_pago:'efectivo'});
      assert.equal((await get('c_untracked')).stock,null);
      await assert.rejects(apply('entrada',{items:[{uid:'c_untracked',cantidad:1}]}),/Primero carga/);
    });
    await t.test('void reverses recorded quantities once, not money', async () => {
      const sale = await apply('venta',{items:[{uid:b.uid,cantidad:2,precio:1000}],medio_pago:'point'});
      const current = await get(b.uid);
      await apply('archivar',{uid:b.uid,version:Number(current.version)});
      await apply('anular',{original:sale.id});
      assert.equal((await get(b.uid)).stock,74);
      await assert.rejects(apply('anular',{original:sale.id}),/ya fue anulada/);
    });
    await t.test('rejects duplicate lines, zero quantities and invalid payment', async () => {
      await assert.rejects(apply('venta',{items:[{uid:a.uid,cantidad:1,precio:1200},{uid:a.uid,cantidad:1,precio:1200}],medio_pago:'mp'}),/Agrupa/);
      await assert.rejects(apply('entrada',{items:[{uid:a.uid,cantidad:0}]}),/Cantidad invalida/);
      await assert.rejects(apply('venta',{items:[{uid:a.uid,cantidad:1,precio:1200}],medio_pago:'inventado'}),/forma de pago/);
    });
    await t.test('authenticated clients cannot bypass the RPC', async () => {
      await db.exec('set role authenticated');
      await assert.rejects(db.exec("update public.catalogo set stock=999"),/permission denied/);
      assert.ok((await db.query('select * from public.catalogo')).rows.length);
      await apply('venta',{items:[{uid:a.uid,cantidad:1,precio:1200}],medio_pago:'efectivo'});
      await db.exec('reset role');
      await db.exec("select set_config('test.actor','',false)");
      await assert.rejects(apply('guardar',product('c_noauth','7790000000044')),/Inicia sesion/);
      await db.exec('set role anon');
      await assert.rejects(db.query('select * from public.catalogo_operaciones'),/permission denied/);
    });
  } finally { await db.close(); }
});
