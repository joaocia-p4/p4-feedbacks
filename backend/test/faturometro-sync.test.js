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

// ── revisão pré-merge: exceção do ML e escrita concorrente ───────────────────
test('ingestOrder captura exceção lançada por fetchOrder (ex.: conta sem conexão/token sem refresh) e registra o erro sem propagar', async () => {
  await semear('acc-excecao', '777');
  const original = meli.fetchOrder;
  meli.fetchOrder = async () => { throw new Error('Conexão expirada. Reconecte a conta do Mercado Livre.'); };
  try {
    assert.equal(await faturometro.ingestOrder('acc-excecao', '60'), null);
  } finally { meli.fetchOrder = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-excecao' }).first();
  assert.ok(sync.erro, 'esperava o erro registrado em faturometro_sync');
  assert.match(sync.erro, /60/);
});

test('dois saveOrderRow concorrentes do MESMO pedido não lançam e o consolidado fecha com um pedido só', async () => {
  await semear('acc-concorr', '888');
  const { orderRow } = require('../src/lib/faturometro');
  const row = orderRow(cru(70, 500, 4, 'b7'), 'acc-concorr');

  await assert.doesNotReject(Promise.all([
    faturometro.saveOrderRow(row),
    faturometro.saveOrderRow(row),
  ]));

  const linhas = await db('faturometro_orders').where({ order_id: '70' });
  assert.equal(linhas.length, 1, 'esperava uma única linha no livro para o mesmo order_id');

  const dia = await db('faturometro_daily').where({ account_id: 'acc-concorr', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 500);
  assert.equal(dia.pedidos, 1);
});

test('dois marcarSync concorrentes na mesma conta não lançam', async () => {
  await semear('acc-sync-concorr', '999');

  await assert.doesNotReject(Promise.all([
    faturometro.marcarSync('acc-sync-concorr', { erro: 'e1' }),
    faturometro.marcarSync('acc-sync-concorr', { erro: 'e2' }),
  ]));

  const sync = await db('faturometro_sync').where({ account_id: 'acc-sync-concorr' }).first();
  assert.ok(sync, 'esperava a linha de sync criada');
  assert.ok(['e1', 'e2'].includes(sync.erro), 'esperava um dos dois erros gravado, sem lançar');
});

test('marcarSync com patch parcial preserva os campos que não vieram no patch (não pode zerar backfill)', async () => {
  await semear('acc-patch', '1010');
  await faturometro.marcarSync('acc-patch', { backfill_status: 'pronto', backfill_dia: '2026-07-01' });
  await faturometro.marcarSync('acc-patch', { erro: 'x' });

  const sync = await db('faturometro_sync').where({ account_id: 'acc-patch' }).first();
  assert.equal(sync.backfill_status, 'pronto');
  assert.equal(sync.backfill_dia, '2026-07-01');
  assert.equal(sync.erro, 'x');
});

// ── webhook ──────────────────────────────────────────────────────────────────
// mlUserId '70001'/'70002' (em vez de '777'/'888'): esses dois já são usados por
// 'acc-excecao' e 'acc-concorr' mais acima neste arquivo, e meli_connections não
// tem unicidade em ml_user_id — reaproveitar colidiria e o where().first() do
// handleNotification pegaria a conta errada.
test('notificação de orders_v2 grava o pedido da conta certa', async () => {
  await semear('acc-hook', '70001');
  const original = meli.fetchOrder;
  meli.fetchOrder = async (accountId) => {
    assert.equal(accountId, 'acc-hook', 'buscou na conta errada');
    return { ok: true, status: 200, data: cru(60, 400, 1, 'b1') };
  };
  try {
    await faturometro.handleNotification({ topic: 'orders_v2', user_id: 70001, resource: '/orders/60' });
  } finally { meli.fetchOrder = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-hook', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 400);
});

test('a mesma notificação repetida não dobra o número', async () => {
  await semear('acc-hook2', '70002');
  const original = meli.fetchOrder;
  meli.fetchOrder = async () => ({ ok: true, status: 200, data: cru(70, 400, 1, 'b1') });
  const nota = { topic: 'orders_v2', user_id: 70002, resource: '/orders/70' };
  try {
    await faturometro.handleNotification(nota);
    await faturometro.handleNotification(nota);
    await faturometro.handleNotification(nota);
  } finally { meli.fetchOrder = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-hook2', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 400);
  assert.equal(dia.pedidos, 1);
});

test('tópico diferente de orders_v2 é ignorado', async () => {
  const r = await faturometro.handleNotification({ topic: 'items', user_id: 777, resource: '/items/MLB1' });
  assert.equal(r, null);
});

test('user_id sem conexão é ignorado sem quebrar', async () => {
  const r = await faturometro.handleNotification({ topic: 'orders_v2', user_id: 999999, resource: '/orders/1' });
  assert.equal(r, null);
});

test('notificação sem resource é ignorada', async () => {
  const r = await faturometro.handleNotification({ topic: 'orders_v2', user_id: 777 });
  assert.equal(r, null);
});
