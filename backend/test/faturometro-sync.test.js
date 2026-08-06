// Testes da escrita do Faturômetro (livro de pedidos, reconciliação, backfill).
// Roda contra um SQLite descartável — mesmo padrão de update-client.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-fat-'));
process.env.SQLITE_FILE = path.join(tmpDir, 'test.sqlite');
process.env.BUSINESS_TZ = 'America/Sao_Paulo';
process.env.FATUROMETRO_BACKGROUND = 'off'; // sem motor de segundo plano no teste
delete process.env.DATABASE_URL; // garante SQLite mesmo com .env de produção

const db = require('../src/db/knex');

test.before(async () => {
  await db.migrate.latest();
});

test.after(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── esquema ──────────────────────────────────────────────────────────────────
test('as três tabelas do Faturômetro existem', async () => {
  assert.equal(await db.schema.hasTable('faturometro_orders'), true);
  assert.equal(await db.schema.hasTable('faturometro_daily'), true);
  assert.equal(await db.schema.hasTable('faturometro_sync'), true);
});

test('o livro tem as colunas que a curva por hora e os compradores exigem', async () => {
  for (const col of ['order_id', 'account_id', 'dia', 'criado_em_ml', 'total_amount', 'unidades', 'comprador_id']) {
    assert.equal(await db.schema.hasColumn('faturometro_orders', col), true, `faltou ${col}`);
  }
});

test('o consolidado tem as colunas dos totais do mês', async () => {
  for (const col of ['account_id', 'dia', 'faturamento', 'unidades', 'pedidos']) {
    assert.equal(await db.schema.hasColumn('faturometro_daily', col), true, `faltou ${col}`);
  }
});

test('o estado de sincronismo guarda backfill, reconciliação e erro', async () => {
  for (const col of ['account_id', 'backfill_dia', 'backfill_status', 'reconciliado_em', 'erro']) {
    assert.equal(await db.schema.hasColumn('faturometro_sync', col), true, `faltou ${col}`);
  }
});

const faturometro = require('../src/lib/faturometroSync');
const meli = require('../src/services/meliService');

// Cliente + conta + conexão mínimos para as gravações terem FK válida.
// `clients` exige analista_id e agenda_freq (NOT NULL), por isso o usuário vem junto.
async function semear(accountId, mlUserId) {
  await db('users').insert({ id: 'u-fat', nome: 'Ana', email: 'ana@fat.test', senha_hash: 'x', papel: 'analista' })
    .onConflict('id').ignore();
  await db('clients').insert({
    id: 'c-' + accountId, loja: 'Loja ' + accountId, tipo: 'Loja',
    analista_id: 'u-fat', agenda_freq: 'Semanal', agenda_dia_semana: 'Segunda',
  }).onConflict('id').ignore();
  await db('accounts').insert({
    id: accountId, client_id: 'c-' + accountId, marketplace: 'Mercado Livre',
    apelido: 'conta ' + accountId, ativo: true,
  }).onConflict('id').ignore();
  await db('meli_connections').insert({
    id: 'conn-' + accountId, account_id: accountId, ml_user_id: mlUserId,
    access_token: 'x', expires_at: new Date(Date.now() + 3600e3).toISOString(),
  }).onConflict('id').ignore();
}

const cru = (id, valor, unidades, comprador, criado) => ({
  id, date_created: criado || '2026-08-06T13:00:00.000-03:00',
  total_amount: valor, order_items: [{ quantity: unidades }], buyer: { id: comprador },
});

// ── livro de pedidos ─────────────────────────────────────────────────────────
test('gravar um pedido cria a linha do livro e consolida o dia', async () => {
  await semear('acc-livro', '111');
  await faturometro.saveOrderRow(require('../src/lib/faturometro').orderRow(cru(1, 100, 2, 'b1'), 'acc-livro'));

  const dia = await db('faturometro_daily').where({ account_id: 'acc-livro', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 100);
  assert.equal(dia.pedidos, 1);
  assert.equal(dia.unidades, 2);
});

test('gravar o MESMO pedido duas vezes não dobra o número', async () => {
  await semear('acc-idem', '222');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(10, 100, 1, 'b1'), 'acc-idem'));
  await faturometro.saveOrderRow(orderRow(cru(10, 100, 1, 'b1'), 'acc-idem'));

  const dia = await db('faturometro_daily').where({ account_id: 'acc-idem', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 100);
  assert.equal(dia.pedidos, 1);
});

test('update de um pedido corrige o valor em vez de somar por cima', async () => {
  await semear('acc-upd', '333');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(20, 100, 1, 'b1'), 'acc-upd'));
  await faturometro.saveOrderRow(orderRow(cru(20, 250, 3, 'b1'), 'acc-upd')); // mesmo id, valor novo

  const dia = await db('faturometro_daily').where({ account_id: 'acc-upd', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 250);
  assert.equal(dia.unidades, 3);
  assert.equal(dia.pedidos, 1);
});

test('pedido que muda de dia recalcula os DOIS dias', async () => {
  await semear('acc-mudou', '444');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(30, 100, 1, 'b1', '2026-08-05T13:00:00.000-03:00'), 'acc-mudou'));
  await faturometro.saveOrderRow(orderRow(cru(30, 100, 1, 'b1', '2026-08-06T13:00:00.000-03:00'), 'acc-mudou'));

  const antigo = await db('faturometro_daily').where({ account_id: 'acc-mudou', dia: '2026-08-05' }).first();
  const novo = await db('faturometro_daily').where({ account_id: 'acc-mudou', dia: '2026-08-06' }).first();
  assert.equal(Number(antigo.faturamento), 0);
  assert.equal(Number(novo.faturamento), 100);
});

test('ingestOrder busca o pedido no ML e grava', async () => {
  await semear('acc-ingest', '555');
  const original = meli.fetchOrder;
  meli.fetchOrder = async () => ({ ok: true, status: 200, data: cru(40, 300, 2, 'b9') });
  try {
    const row = await faturometro.ingestOrder('acc-ingest', '40');
    assert.equal(row.order_id, '40');
  } finally { meli.fetchOrder = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-ingest', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 300);
});

test('ingestOrder devolve null e registra o erro quando o ML recusa', async () => {
  await semear('acc-erro', '666');
  const original = meli.fetchOrder;
  meli.fetchOrder = async () => ({ ok: false, status: 401, data: { message: 'invalid token' } });
  try {
    assert.equal(await faturometro.ingestOrder('acc-erro', '50'), null);
  } finally { meli.fetchOrder = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-erro' }).first();
  assert.ok(sync.erro, 'esperava o erro registrado em faturometro_sync');
});
