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

// ── reconciliação ────────────────────────────────────────────────────────────
test('reconciliação repõe um pedido que o webhook perdeu', async () => {
  await semear('acc-rec', '1010');
  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [cru(80, 100, 1, 'b1'), cru(81, 200, 2, 'b2')], erro: null });
  try {
    const r = await faturometro.reconcileAccount('acc-rec', '2026-08-06');
    assert.equal(r.ok, true);
  } finally { meli.ordersOfDay = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-rec', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 300);
  assert.equal(dia.pedidos, 2);
});

test('reconciliação apaga do livro pedido que não existe mais no ML', async () => {
  await semear('acc-rec2', '1111');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(90, 999, 1, 'b1'), 'acc-rec2')); // fantasma

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [cru(91, 100, 1, 'b2')], erro: null });
  try {
    await faturometro.reconcileAccount('acc-rec2', '2026-08-06');
  } finally { meli.ordersOfDay = original; }

  const fantasma = await db('faturometro_orders').where({ order_id: '90' }).first();
  assert.equal(fantasma, undefined);
  const dia = await db('faturometro_daily').where({ account_id: 'acc-rec2', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 100);
});

test('reconciliação com erro do ML preserva o que já havia e registra o erro', async () => {
  await semear('acc-rec3', '1212');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(95, 500, 1, 'b1'), 'acc-rec3'));

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: { message: 'invalid token' } });
  try {
    const r = await faturometro.reconcileAccount('acc-rec3', '2026-08-06');
    assert.equal(r.ok, false);
  } finally { meli.ordersOfDay = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-rec3', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 500, 'não pode zerar o que já estava contado');
  const sync = await db('faturometro_sync').where({ account_id: 'acc-rec3' }).first();
  assert.ok(sync.erro);
});

test('reconciliação bem-sucedida limpa o erro anterior e marca o horário', async () => {
  await semear('acc-rec4', '1313');
  await faturometro.marcarSync('acc-rec4', { erro: 'token expirado' });

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: null });
  try {
    await faturometro.reconcileAccount('acc-rec4', '2026-08-06');
  } finally { meli.ordersOfDay = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-rec4' }).first();
  assert.equal(sync.erro, null);
  assert.ok(sync.reconciliado_em);
});

// ── expurgo ──────────────────────────────────────────────────────────────────
test('expurgo apaga pedidos com mais de 70 dias sem tocar no consolidado', async () => {
  await semear('acc-purga', '1414');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(200, 100, 1, 'b1', '2026-01-10T13:00:00.000-03:00'), 'acc-purga'));
  await faturometro.saveOrderRow(orderRow(cru(201, 100, 1, 'b1', '2026-08-06T13:00:00.000-03:00'), 'acc-purga'));

  const apagados = await faturometro.purgeOldOrders('2026-08-06');

  assert.equal(apagados, 1);
  assert.equal(await db('faturometro_orders').where({ order_id: '200' }).first(), undefined);
  assert.ok(await db('faturometro_orders').where({ order_id: '201' }).first());
  const antigo = await db('faturometro_daily').where({ account_id: 'acc-purga', dia: '2026-01-10' }).first();
  assert.equal(Number(antigo.faturamento), 100, 'o consolidado tem de sobreviver ao expurgo');
});

// ── revisão pós-Task 6: corrida webhook × reconciliação e o dia que zera ─────
// ml_user_id na faixa 2001-2006: novos, não usados em nenhum teste acima.
//
// Usa ingestOrder (fetchOrder + saveOrderRow) em vez de chamar saveOrderRow
// direto: é o caminho REAL do webhook (handleNotification → ingestOrder →
// fetchOrder → saveOrderRow), e é essa passada extra por fetchOrder que faz o
// laço de reconciliação e o webhook chegarem no SELECT do mesmo order_id quase
// junto — reproduz a corrida de forma consistente (era 40/40 antes do fix,
// contra 0/40 com saveOrderRow chamado direto — este teste falha de verdade
// com o código antigo, o outro formato não chegava a colidir no agendamento
// do Node). É o teste que prova a correção.
test('ingestOrder (webhook) e reconcileAccount concorrentes no MESMO pedido não lançam e o consolidado fecha coerente com o livro', async () => {
  await semear('acc-corrida', '2001');
  const orderId = '300';

  const originalOrders = meli.ordersOfDay;
  const originalFetch = meli.fetchOrder;
  // A reconciliação enxerga o MESMO pedido que o webhook está buscando/gravando ao vivo.
  meli.ordersOfDay = async () => ({ pedidos: [cru(300, 700, 3, 'b1')], erro: null });
  meli.fetchOrder = async () => ({ ok: true, status: 200, data: cru(300, 700, 3, 'b1') });
  try {
    await assert.doesNotReject(Promise.all([
      faturometro.reconcileAccount('acc-corrida', '2026-08-06'),
      faturometro.ingestOrder('acc-corrida', orderId),
    ]));
  } finally { meli.ordersOfDay = originalOrders; meli.fetchOrder = originalFetch; }

  const linhas = await db('faturometro_orders').where({ order_id: orderId });
  assert.equal(linhas.length, 1, 'esperava uma única linha no livro para o mesmo order_id');

  const dia = await db('faturometro_daily').where({ account_id: 'acc-corrida', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 700, 'consolidado tem de bater com o livro, sem dobrar');
  assert.equal(dia.pedidos, 1);
});

test('reconciliação com resposta boa e ZERO pedidos apaga o dia inteiro e zera o consolidado (não confundir com erro do ML)', async () => {
  await semear('acc-zera', '2002');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(310, 250, 2, 'b1'), 'acc-zera'));
  await faturometro.saveOrderRow(orderRow(cru(311, 150, 1, 'b2'), 'acc-zera'));

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: null }); // resposta BOA, sem pedidos no dia
  try {
    const r = await faturometro.reconcileAccount('acc-zera', '2026-08-06');
    assert.equal(r.ok, true);
  } finally { meli.ordersOfDay = original; }

  assert.equal(await db('faturometro_orders').where({ order_id: '310' }).first(), undefined);
  assert.equal(await db('faturometro_orders').where({ order_id: '311' }).first(), undefined);
  const dia = await db('faturometro_daily').where({ account_id: 'acc-zera', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 0);
  assert.equal(dia.pedidos, 0);
});

// ── revisão final da branch: dia TRUNCADO não é dia completo ─────────────────
// ordersOfDay para no teto de offset do ML e, antes, devolvia erro:null — um dia
// cortado passava por dia inteiro e o del() abaixo apagava do livro todo pedido
// que não coubesse na resposta. Numa conta com mais de ~1.000 pedidos/dia isso
// DESTRÓI receita que o webhook já tinha capturado, e o número passa a mentir em
// silêncio, sem nenhum erro na tela. ml_user_id 7001-7002: faixa nova.
test('reconciliação de dia TRUNCADO não apaga nada do livro, mantém os upserts e registra o erro', async () => {
  await semear('acc-trunc', '7001');
  const { orderRow } = require('../src/lib/faturometro');
  // Pedido real, capturado pelo webhook, que NÃO cabe na resposta cortada.
  await faturometro.saveOrderRow(orderRow(cru(600, 400, 1, 'b1'), 'acc-trunc'));

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [cru(601, 100, 1, 'b2')], erro: null, truncado: true });
  try {
    const r = await faturometro.reconcileAccount('acc-trunc', '2026-08-06');
    assert.equal(r.truncado, true, 'a reconciliação tem de propagar que o dia veio cortado');
    assert.equal(r.ok, true, 'ok:true de propósito — ok:false travaria o backfill nesse dia para sempre');
  } finally { meli.ordersOfDay = original; }

  assert.ok(
    await db('faturometro_orders').where({ order_id: '600' }).first(),
    'dia truncado não pode apagar do livro um pedido real que só não coube na resposta',
  );
  assert.ok(
    await db('faturometro_orders').where({ order_id: '601' }).first(),
    'os upserts do que VEIO continuam valendo — são correção de verdade',
  );

  const dia = await db('faturometro_daily').where({ account_id: 'acc-trunc', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 500, '400 (preservado) + 100 (upsert da resposta cortada)');

  const sync = await db('faturometro_sync').where({ account_id: 'acc-trunc' }).first();
  assert.ok(sync.erro, 'dia cortado tem de aparecer em comErro na tela, não passar por conferência limpa');
  assert.match(sync.erro, /2026-08-06/);
});

test('dia truncado não zera um erro anterior nem deixa a conta parecer conferida sem ressalva', async () => {
  await semear('acc-trunc2', '7002');
  await faturometro.marcarSync('acc-trunc2', { erro: 'algo antigo' });

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: null, truncado: true });
  try {
    await faturometro.reconcileAccount('acc-trunc2', '2026-08-06');
  } finally { meli.ordersOfDay = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-trunc2' }).first();
  assert.ok(sync.erro, 'truncado não pode passar por erro:null');
  assert.ok(sync.reconciliado_em, 'o dia FOI visitado: o rodízio precisa andar');
});

// ── revisão final da branch: recalcDay não pode ser um lost-update ───────────
// O recálculo lia o dia inteiro, somava em JS e escrevia depois. Duas
// notificações orders_v2 de pedidos DIFERENTES do mesmo vendedor chegam
// concorrentes (a rota é fire-and-forget por desenho) e a que leu o conjunto
// menor pode escrever por último: livro certo, consolidado errado — e é do
// consolidado que sai mes.faturamento.
test('recalcDay consolida numa ÚNICA instrução, com a soma feita pelo banco', async () => {
  await semear('acc-1inst', '7101');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(610, 120, 2, 'b1'), 'acc-1inst'));

  const sqls = [];
  const ouvir = (q) => sqls.push(q.sql);
  db.on('query', ouvir);
  try {
    await faturometro.recalcDay('acc-1inst', '2026-08-06');
  } finally { db.removeListener('query', ouvir); }

  assert.equal(sqls.length, 1, `o recálculo tem de ser UMA instrução só (ler e escrever juntos); vieram ${sqls.length}: ${sqls.join(' | ')}`);
  assert.match(sqls[0], /insert\s+into\s+.?faturometro_daily/i);
  assert.match(sqls[0], /select[\s\S]*from\s+.?faturometro_orders/i, 'o agregado tem de sair do banco, não de uma soma em JS');

  const dia = await db('faturometro_daily').where({ account_id: 'acc-1inst', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 120);
  assert.equal(dia.unidades, 2);
  assert.equal(dia.pedidos, 1);
});

// Por que o teste ACIMA é estrutural (uma instrução só) e não uma corrida de
// verdade: o knex força pool {min:1,max:1} no dialeto sqlite (poolDefaults() em
// knex/lib/dialects/sqlite3), então TODA consulta da suíte passa por uma única
// conexão, em fila FIFO. Numa fila assim quem escreve por último é sempre quem
// leu por último, e o lost-update simplesmente não é alcançável pela API
// pública — medido: com o código antigo, `Promise.all` de 2 e de 10
// saveOrderRow fecha certo em 100% das execuções, e até atrasar a resposta da
// leitura não abre a janela (o atraso segura a única conexão e serializa o
// resto). A corrida é real no Postgres/Neon, onde cada ida ao banco é uma
// conexão própria com 5-15 ms de rede. Por isso o que se testa aqui é a
// PROPRIEDADE que a elimina (ler e escrever na mesma instrução), e o teste
// abaixo fica como guarda do resultado.
test('dois saveOrderRow concorrentes de pedidos DIFERENTES fecham o consolidado com a soma dos dois', async () => {
  await semear('acc-conc2', '7103');
  const { orderRow } = require('../src/lib/faturometro');

  await Promise.all([
    faturometro.saveOrderRow(orderRow(cru(630, 100, 1, 'b1'), 'acc-conc2')),
    faturometro.saveOrderRow(orderRow(cru(631, 200, 2, 'b2'), 'acc-conc2')),
  ]);

  const dia = await db('faturometro_daily').where({ account_id: 'acc-conc2', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 300);
  assert.equal(dia.unidades, 3);
  assert.equal(dia.pedidos, 2);
});

test('o uuid da linha do consolidado não muda a cada recálculo', async () => {
  await semear('acc-uuid', '7104');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(640, 100, 1, 'b1'), 'acc-uuid'));
  const antes = await db('faturometro_daily').where({ account_id: 'acc-uuid', dia: '2026-08-06' }).first();

  await faturometro.recalcDay('acc-uuid', '2026-08-06');
  await faturometro.recalcDay('acc-uuid', '2026-08-06');

  const depois = await db('faturometro_daily').where({ account_id: 'acc-uuid', dia: '2026-08-06' }).first();
  assert.equal(depois.id, antes.id, 'o id da linha é estável — recalcular não pode trocar o uuid');
});

// ── revisão pós-Task 6: o motor de segundo plano ─────────────────────────────
test('kick() com FATUROMETRO_BACKGROUND=off não dispara nada (a suíte de leitura não pode bater na API real)', async () => {
  await semear('acc-off', '2003');

  let chamou = false;
  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => { chamou = true; return { pedidos: [], erro: null }; };
  try {
    assert.equal(process.env.FATUROMETRO_BACKGROUND, 'off', 'este arquivo roda com o motor desligado');
    const retorno = faturometro.kick();
    assert.equal(retorno, undefined, 'kick() não devolve promessa, por design');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(chamou, false, 'com o motor desligado, ordersOfDay não pode ser chamado');
  } finally { meli.ordersOfDay = original; }
});

test('kick() duas vezes seguidas não dispara dois ciclos simultâneos (a trava de reentrância)', async () => {
  await semear('acc-trava', '2004');

  let emAndamento = 0;
  let maxSimultaneas = 0;
  const originalConn = meli.getConnection;
  meli.getConnection = async (accountId) => {
    emAndamento += 1;
    maxSimultaneas = Math.max(maxSimultaneas, emAndamento);
    await new Promise((r) => setTimeout(r, 20)); // segura o ciclo no ar de propósito
    emAndamento -= 1;
    return originalConn(accountId);
  };
  const originalOrders = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: null });

  const originalEnv = process.env.FATUROMETRO_BACKGROUND;
  process.env.FATUROMETRO_BACKGROUND = 'on'; // só para este teste — precisa do motor ligado
  try {
    faturometro.kick();
    faturometro.kick(); // enquanto o primeiro ciclo ainda está no ar — tem de ser um no-op
    await new Promise((r) => setTimeout(r, 400)); // espera o(s) ciclo(s) terminarem
  } finally {
    process.env.FATUROMETRO_BACKGROUND = originalEnv;
    meli.getConnection = originalConn;
    meli.ordersOfDay = originalOrders;
  }

  assert.equal(maxSimultaneas, 1, 'a trava "rodando" tem de impedir dois ciclos concorrentes');
});

test('rodízio: conta nunca reconciliada entra antes de conta reconciliada há muito tempo', async () => {
  // Silencia as contas de testes anteriores (marca como recém-reconciliadas)
  // para isolar o rodízio às duas contas deste teste.
  const outras = await faturometro.scopedAccounts();
  for (const c of outras) {
    await faturometro.marcarSync(c.accountId, { reconciliado_em: new Date().toISOString() });
  }

  await semear('acc-rodizio-velha', '2005');
  await faturometro.marcarSync('acc-rodizio-velha', { reconciliado_em: new Date(Date.now() - 60 * 60 * 1000).toISOString() }); // 1h atrás — vencida

  await semear('acc-rodizio-nova', '2006'); // nunca reconciliada — faturometro_sync nem existe

  const ordem = [];
  const originalConn = meli.getConnection;
  meli.getConnection = async (accountId) => {
    ordem.push(accountId);
    return originalConn(accountId);
  };
  const originalOrders = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: null });

  try {
    await faturometro.runQueue(); // exportado para os testes — não depende do kick()/env
  } finally {
    meli.getConnection = originalConn;
    meli.ordersOfDay = originalOrders;
  }

  const idxNova = ordem.indexOf('acc-rodizio-nova');
  const idxVelha = ordem.indexOf('acc-rodizio-velha');
  assert.notEqual(idxNova, -1, 'esperava a conta nunca reconciliada no rodízio');
  assert.notEqual(idxVelha, -1, 'esperava a conta reconciliada há muito tempo no rodízio');
  assert.ok(idxNova < idxVelha, 'conta nunca reconciliada (t=0) tem de vir antes da reconciliada há muito tempo');
});

// ── backfill ─────────────────────────────────────────────────────────────────
// backfillStep pega, entre as contas não-'pronto', a que tem o rodízio mais
// atrasado (ver comentário no código de produção). A partir dos testes do
// motor acima (kick(), rodízio), que rodam runQueue() de verdade, contas de
// testes anteriores (ex.: acc-livro) já ganharam linha em faturometro_sync e
// ficam 'pendente'/'rodando' — sem isolar, elas entrariam na disputa da conta
// que cada teste abaixo quer observar. Mesma técnica do teste de rodízio da
// reconciliação (que neutraliza reconciliado_em); aqui neutraliza-se
// backfill_status. `isolarBackfill()` sem argumentos marca TODAS como pronto;
// `isolarBackfill('a', 'b')` poupa as contas listadas.
async function isolarBackfill(...exceto) {
  const contas = await faturometro.scopedAccounts();
  for (const c of contas) {
    if (exceto.includes(c.accountId)) continue;
    await faturometro.marcarSync(c.accountId, { backfill_status: 'pronto' });
  }
}

// Mesma ideia, para o rodízio de RECONCILIAÇÃO (não o de backfill): marca as
// demais contas como "acabadas de reconciliar" para elas não entrarem na
// lista de vencidas de runQueue() e disputarem as CONTAS_POR_CICLO vagas com
// as contas que o teste quer observar.
async function isolarReconciliacao(...exceto) {
  const contas = await faturometro.scopedAccounts();
  for (const c of contas) {
    if (exceto.includes(c.accountId)) continue;
    await faturometro.marcarSync(c.accountId, { reconciliado_em: new Date().toISOString() });
  }
}

test('o alvo do backfill é o dia 1 do mês anterior', () => {
  assert.equal(faturometro.backfillTarget('2026-08-06'), '2026-07-01');
  assert.equal(faturometro.backfillTarget('2026-01-15'), '2025-12-01');
});

test('backfillStep preenche do dia mais recente para o mais antigo', async () => {
  await semear('acc-bf', '1515');
  await isolarBackfill('acc-bf');
  const vistos = [];
  const original = meli.ordersOfDay;
  meli.ordersOfDay = async (_acc, _seller, dia) => { vistos.push(dia); return { pedidos: [], erro: null }; };
  try {
    await faturometro.backfillStep('2026-08-06');
  } finally { meli.ordersOfDay = original; }

  // Primeiro lote: hoje e os dias imediatamente anteriores, do mais novo ao mais velho.
  assert.equal(vistos[0], '2026-08-06');
  assert.equal(vistos[1], '2026-08-05');
  const sync = await db('faturometro_sync').where({ account_id: 'acc-bf' }).first();
  assert.ok(sync.backfill_dia <= '2026-08-05');
});

test('backfill retoma de onde parou, não recomeça do zero', async () => {
  await semear('acc-bf2', '1616');
  await faturometro.marcarSync('acc-bf2', { backfill_dia: '2026-08-01', backfill_status: 'rodando' });
  await isolarBackfill('acc-bf2');

  const vistos = [];
  const original = meli.ordersOfDay;
  meli.ordersOfDay = async (_acc, _seller, dia) => { vistos.push(dia); return { pedidos: [], erro: null }; };
  try {
    await faturometro.backfillStep('2026-08-06');
  } finally { meli.ordersOfDay = original; }

  assert.equal(vistos[0], '2026-07-31', 'devia continuar do dia anterior ao já preenchido');
});

test('backfill que alcança o alvo marca a conta como pronta', async () => {
  await semear('acc-bf3', '1717');
  await faturometro.marcarSync('acc-bf3', { backfill_dia: '2026-07-02', backfill_status: 'rodando' });
  await isolarBackfill('acc-bf3');

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: null });
  try {
    await faturometro.backfillStep('2026-08-06');
  } finally { meli.ordersOfDay = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-bf3' }).first();
  assert.equal(sync.backfill_status, 'pronto');
  assert.equal(sync.backfill_dia, '2026-07-01');
});

// revisão pós-brief: uma conta cujo reconcileAccount falha sempre não pode
// monopolizar backfillStep para sempre — o rodízio por atualizado_em (achado
// Important da revisão) tem de tirá-la da frente da fila no ciclo seguinte.
test('conta cujo reconcileAccount falha sempre não trava o backfill das demais', async () => {
  await semear('acc-bf-quebrada', '3001');
  await semear('acc-bf-sadia', '3002');
  await isolarBackfill('acc-bf-quebrada', 'acc-bf-sadia');

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async (accountId) => (
    accountId === 'acc-bf-quebrada'
      ? { pedidos: [], erro: { message: 'token revogado' } }
      : { pedidos: [], erro: null }
  );
  try {
    // 1º ciclo: nenhuma das duas tem sync ainda (empate em "nunca tentada");
    // acc-bf-quebrada vem primeiro na ordem de scopedAccounts() (semeada
    // antes) e falha logo no 1º dia — marcarSync(erro) grava atualizado_em.
    const passo1 = await faturometro.backfillStep('2026-08-06');
    assert.equal(passo1.conta, 'acc-bf-quebrada');

    // 2º ciclo: acc-bf-quebrada acabou de ser tentada (atualizado_em recente);
    // acc-bf-sadia, nunca tentada, passa a ser a mais atrasada do rodízio.
    const passo2 = await faturometro.backfillStep('2026-08-06');
    assert.equal(passo2.conta, 'acc-bf-sadia');
  } finally { meli.ordersOfDay = original; }

  const quebrada = await db('faturometro_sync').where({ account_id: 'acc-bf-quebrada' }).first();
  assert.equal(quebrada.backfill_dia, null, 'conta que só falhou não pode ter avançado o marcador');
  assert.ok(quebrada.erro, 'esperava o erro registrado');

  const sadia = await db('faturometro_sync').where({ account_id: 'acc-bf-sadia' }).first();
  assert.ok(sadia && sadia.backfill_dia, 'a conta sadia devia ter avançado, mesmo com a quebrada travada em erro');
});

// ── reconcileAccount à prova de exceção ──────────────────────────────────────
// A revisão foi além do erro TRATADO (r.erro do teste acima) e achou que
// sellerIdOf/meli.ordersOfDay podem LANÇAR de verdade — ex.: renovação de
// token recusada (meliService.getValidAccessToken/refreshTokens/postToken não
// têm try/catch no meio do caminho). Sem captura dentro de reconcileAccount,
// nem backfillStep nem o rodízio de runQueue (que já assumem que ela nunca
// lança) registram QUALQUER coisa para a conta quebrada — nem erro, nem
// atualizado_em — e ela trava o rodízio de vez.
// ml_user_id 4001-4005: faixa nova, sem colisão com 777/888/1010-1414/
// 1515-1717/2001-2006/3001-3004/70001-70002.
test('reconcileAccount com meli.ordersOfDay que LANÇA (não que devolve erro) não propaga, registra o erro e preserva o livro', async () => {
  await semear('acc-rec-excecao', '4001');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(400, 500, 1, 'b1'), 'acc-rec-excecao')); // já tinha algo no livro

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => { throw new Error('token revogado'); };
  try {
    const r = await faturometro.reconcileAccount('acc-rec-excecao', '2026-08-06');
    assert.equal(r.ok, false);
  } finally { meli.ordersOfDay = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-rec-excecao' }).first();
  assert.ok(sync && sync.erro, 'esperava o erro registrado em faturometro_sync, mesmo tendo sido uma exceção');
  assert.match(sync.erro, /token revogado/);

  const dia = await db('faturometro_daily').where({ account_id: 'acc-rec-excecao', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 500, 'exceção não pode apagar o que já estava contado');
});

test('conta cujo reconcileAccount LANÇA (exceção, não erro tratado) também não trava o backfill das demais', async () => {
  await semear('acc-bf-quebrada-exc', '4002');
  await semear('acc-bf-sadia-exc', '4003');
  await isolarBackfill('acc-bf-quebrada-exc', 'acc-bf-sadia-exc');

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async (accountId) => {
    if (accountId === 'acc-bf-quebrada-exc') throw new Error('token revogado');
    return { pedidos: [], erro: null };
  };
  try {
    // 1º ciclo: empate em "nunca tentada"; acc-bf-quebrada-exc vem primeiro
    // (semeada antes) e lança no 1º dia.
    const passo1 = await faturometro.backfillStep('2026-08-06');
    assert.equal(passo1.conta, 'acc-bf-quebrada-exc');

    // 2º ciclo: a quebrada acabou de ter atualizado_em carimbado pelo catch
    // dentro de reconcileAccount; a sadia, nunca tentada, entra agora.
    const passo2 = await faturometro.backfillStep('2026-08-06');
    assert.equal(passo2.conta, 'acc-bf-sadia-exc');
  } finally { meli.ordersOfDay = original; }

  const quebrada = await db('faturometro_sync').where({ account_id: 'acc-bf-quebrada-exc' }).first();
  assert.equal(quebrada.backfill_dia, null, 'conta que só lançou exceção não pode ter avançado o marcador');
  assert.ok(quebrada.erro, 'esperava o erro capturado e registrado, mesmo tendo sido uma exceção');

  const sadia = await db('faturometro_sync').where({ account_id: 'acc-bf-sadia-exc' }).first();
  assert.ok(sadia && sadia.backfill_dia, 'a conta sadia devia ter avançado, mesmo com a quebrada lançando exceção');
});

// Nota: com só 1 quebrada + 1 sadia (bem abaixo do teto de CONTAS_POR_CICLO),
// as duas cabem no MESMO ciclo independente da ordenação — este teste NÃO
// cobre monopolização em escala (isso é o teste "com 5 ou mais contas
// travadas..." abaixo, no tamanho real de CONTAS_POR_CICLO). O que este teste
// prova: runQueue não trava com uma exceção no meio do rodízio, e o erro fica
// registrado (diagnóstico) em vez de a conta ficar muda.
test('conta que lança exceção na reconciliação não impede outra conta pendente de ser reconciliada no mesmo ciclo, e o erro fica registrado', async () => {
  await semear('acc-rec-quebrada', '4004');
  await semear('acc-rec-sadia', '4005');
  await isolarReconciliacao('acc-rec-quebrada', 'acc-rec-sadia');
  await isolarBackfill('acc-rec-quebrada', 'acc-rec-sadia'); // backfillStep do mesmo runQueue() não entra no caminho

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async (accountId) => {
    if (accountId === 'acc-rec-quebrada') throw new Error('token revogado');
    return { pedidos: [], erro: null };
  };
  try {
    await faturometro.runQueue();
    await faturometro.runQueue(); // alguns ciclos — a quebrada não pode empurrar a sadia para fora
  } finally { meli.ordersOfDay = original; }

  const sadia = await db('faturometro_sync').where({ account_id: 'acc-rec-sadia' }).first();
  assert.ok(sadia && sadia.reconciliado_em, 'a conta sadia devia ter sido reconciliada, mesmo com a quebrada lançando exceção');

  const quebrada = await db('faturometro_sync').where({ account_id: 'acc-rec-quebrada' }).first();
  assert.ok(quebrada && quebrada.erro, 'esperava o erro capturado e registrado para a conta quebrada (sem isso ela fica sem NENHUM diagnóstico)');
});

// revisão pós-round-2: ordenar as vencidas por reconciliado_em (em vez de
// atualizado_em) prendia uma conta que só falha na chave 0 para sempre — e
// com CONTAS_POR_CICLO (5) ou mais contas quebradas, elas tomavam 100% das
// vagas de TODO ciclo, starvation total das contas sadias (não só "empurra
// pra fora às vezes"). Este teste roda no tamanho real do teto para provar
// isso — o teste anterior (1 quebrada + 1 sadia) fica abaixo do teto e não
// pega esse caso. ml_user_id 5001-5006: faixa nova.
test('com CONTAS_POR_CICLO (5) ou mais contas travadas em erro, o rodízio da reconciliação ainda alcança a conta sadia', async () => {
  const quebradas = ['acc-rec5-q1', 'acc-rec5-q2', 'acc-rec5-q3', 'acc-rec5-q4', 'acc-rec5-q5'];
  const sadia = 'acc-rec5-sadia';
  const todos = [...quebradas, sadia];
  const mlIds = ['5001', '5002', '5003', '5004', '5005', '5006'];

  for (let i = 0; i < todos.length; i++) {
    await semear(todos[i], mlIds[i]);
    // backfill 'pronto' de saída: reconcileAccount grava reconciliado_em em
    // QUALQUER sucesso, mesmo para um dia passado — se o backfillStep do fim
    // do mesmo runQueue() pegasse uma destas contas, poderia "aprovar" a
    // sadia por um caminho que não é o rodízio de reconciliação que este
    // teste quer isolar.
    await faturometro.marcarSync(todos[i], { backfill_status: 'pronto' });
  }
  await isolarReconciliacao(...todos);

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async (accountId) => (
    quebradas.includes(accountId)
      ? { pedidos: [], erro: { message: 'token revogado' } }
      : { pedidos: [], erro: null }
  );
  try {
    await faturometro.runQueue();
    await faturometro.runQueue();
    await faturometro.runQueue();
  } finally { meli.ordersOfDay = original; }

  const syncSadia = await db('faturometro_sync').where({ account_id: sadia }).first();
  assert.ok(
    syncSadia && syncSadia.reconciliado_em,
    'CONTAS_POR_CICLO(=5) contas travadas em erro não podem esgotar todas as vagas para sempre: a 6ª conta (sadia) precisa ter sido reconciliada em algum ciclo',
  );

  for (const q of quebradas) {
    const s = await db('faturometro_sync').where({ account_id: q }).first();
    assert.ok(s && s.erro, `esperava erro registrado para ${q}`);
  }
});

// ── backfillProgress ─────────────────────────────────────────────────────────
test('backfillProgress com zero contas no escopo devolve pronto, sem dividir por zero', async () => {
  const outrosIds = (await db('accounts').select('id')).map((r) => r.id);
  await db('accounts').whereIn('id', outrosIds).update({ ativo: false }); // esvazia o escopo
  try {
    const p = await faturometro.backfillProgress('2026-08-06');
    assert.deepEqual(p, { pronto: true, progresso: 1, etapa: null });
  } finally {
    await db('accounts').whereIn('id', outrosIds).update({ ativo: true });
  }
});

test('backfillProgress com todas as contas prontas devolve progresso exatamente 1', async () => {
  await isolarBackfill(); // sem exceção: marca TODAS as contas do escopo como 'pronto'
  const p = await faturometro.backfillProgress('2026-08-06');
  assert.equal(p.pronto, true);
  assert.equal(p.progresso, 1);
  assert.equal(p.etapa, null);
});

test('backfillProgress calcula a fração parcial certa, com denominador conhecido', async () => {
  // Isola o escopo às duas contas deste teste (mesma técnica do teste de zero
  // contas acima) para o denominador (totalDias × nº de contas) ser um número
  // que dá para calcular à mão, não um número que depende de quantas contas
  // os testes anteriores acumularam no arquivo.
  const outrosIds = (await db('accounts').select('id')).map((r) => r.id);
  await db('accounts').whereIn('id', outrosIds).update({ ativo: false });
  try {
    await semear('acc-bf-frac1', '3003');
    await semear('acc-bf-frac2', '3004');
    await faturometro.marcarSync('acc-bf-frac1', { backfill_status: 'pronto' }); // 100% feita
    await faturometro.marcarSync('acc-bf-frac2', { backfill_dia: '2026-08-02' }); // 5 de 37 dias (08-06..08-02)

    const p = await faturometro.backfillProgress('2026-08-06');
    // totalDias: 2026-07-01..2026-08-06 inclusive = 31 (julho) + 6 (agosto) = 37.
    // feitos: 37 (conta pronta) + 5 (conta parcial) = 42. total possível: 37*2 = 74.
    // 42/74 = 0.567567... → arredonda para 0.57.
    assert.equal(p.pronto, false, 'só uma das duas contas está pronta');
    assert.equal(p.progresso, 0.57);
    assert.equal(p.etapa, 'histórico do mês');
  } finally {
    await db('accounts').whereIn('id', outrosIds).update({ ativo: true });
  }
});

// ── leitura (payload da tela) ────────────────────────────────────────────────
const faturometroService = require('../src/services/faturometroService');
const { todayISO } = require('../src/lib/p4');
const { addDaysISO } = require('../src/lib/faturometro');

// Grava direto no livro, sem passar pelo ML, para montar cenários de leitura.
async function lancar(accountId, orderId, dia, hora, valor, unidades, comprador) {
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow({
    id: orderId, date_created: `${dia}T${hora}-03:00`,
    total_amount: valor, order_items: [{ quantity: unidades }], buyer: { id: comprador },
  }, accountId));
}

// ml_user_id 6001-6007: faixa nova, sem colisão com 111-999/1010-1414/
// 1515-1717/2001-2006/3001-3004/4001-4005/5001-5006/70001-70002.
test('payload soma hoje de todas as contas no escopo', async () => {
  const hoje = todayISO();
  await semear('acc-le1', '6001');
  await semear('acc-le2', '6002');
  await lancar('acc-le1', 900, hoje, '09:00:00', 100, 1, 'b1');
  await lancar('acc-le2', 901, hoje, '09:30:00', 250, 2, 'b2');

  const p = await faturometroService.getFaturometro();

  assert.ok(p.hoje.faturamento >= 350, `esperava ao menos 350, veio ${p.hoje.faturamento}`);
  assert.ok(p.contas.conectadas >= 2);
  assert.equal(p.porHora.length, 24);
});

test('conta encerrada fica fora da soma e fora da lista', async () => {
  const hoje = todayISO();
  await semear('acc-enc', '6003');
  await lancar('acc-enc', 910, hoje, '09:00:00', 5000, 1, 'b1');
  const antes = await faturometroService.getFaturometro();

  await db('accounts').where({ id: 'acc-enc' }).update({ ativo: false });
  const depois = await faturometroService.getFaturometro();

  assert.equal(antes.hoje.faturamento - depois.hoje.faturamento, 5000);
  assert.equal(depois.clientes.some((c) => c.clienteId === 'c-acc-enc'), false);
});

test('conta com erro segue somando e aparece em comErro', async () => {
  const hoje = todayISO();
  await semear('acc-quebrou', '6004');
  await lancar('acc-quebrou', 920, hoje, '09:00:00', 700, 1, 'b1');
  await faturometro.marcarSync('acc-quebrou', { erro: 'token expirado' });

  const p = await faturometroService.getFaturometro();

  assert.ok(p.contas.comErro >= 1);
  const linha = p.clientes.find((c) => c.clienteId === 'c-acc-quebrou');
  assert.equal(linha.hoje, 700, 'receita anterior à quebra tem de continuar contando');
  assert.ok(linha.erro);
});

test('comparação com ontem corta pelo horário atual', async () => {
  const hoje = todayISO();
  const ontem = addDaysISO(hoje, -1);
  await semear('acc-ontem', '6005');
  await lancar('acc-ontem', 930, ontem, '00:00:01', 40, 1, 'b1'); // antes de agora
  await lancar('acc-ontem', 931, ontem, '23:59:59', 999, 1, 'b2'); // depois de agora

  const p = await faturometroService.getFaturometro();

  assert.ok(p.hoje.ontemAteAgora < 999, 'o pedido do fim do dia de ontem não pode entrar');
});

test('duas contas do mesmo cliente viram uma linha só', async () => {
  const hoje = todayISO();
  await db('users').insert({ id: 'u-fat', nome: 'Ana', email: 'ana@fat.test', senha_hash: 'x', papel: 'analista' })
    .onConflict('id').ignore();
  await db('clients').insert({
    id: 'c-duplo', loja: 'Loja Dupla', tipo: 'Loja',
    analista_id: 'u-fat', agenda_freq: 'Semanal', agenda_dia_semana: 'Segunda',
  }).onConflict('id').ignore();
  for (const [id, ml] of [['acc-d1', '6006'], ['acc-d2', '6007']]) {
    await db('accounts').insert({ id, client_id: 'c-duplo', marketplace: 'Mercado Livre', apelido: id, ativo: true })
      .onConflict('id').ignore();
    await db('meli_connections').insert({
      id: 'conn-' + id, account_id: id, ml_user_id: ml, access_token: 'x',
      expires_at: new Date(Date.now() + 3600e3).toISOString(),
    }).onConflict('id').ignore();
  }
  await lancar('acc-d1', 940, hoje, '09:00:00', 100, 1, 'b1');
  await lancar('acc-d2', 941, hoje, '09:00:00', 200, 1, 'b2');

  const p = await faturometroService.getFaturometro();
  const linha = p.clientes.find((c) => c.clienteId === 'c-duplo');

  assert.equal(linha.contas, 2);
  assert.equal(linha.hoje, 300);
});

test('lista sai ordenada pelo faturamento de hoje', async () => {
  const p = await faturometroService.getFaturometro();
  const valores = p.clientes.map((c) => c.hoje);
  assert.deepEqual(valores, [...valores].sort((a, b) => b - a));
});

// ── revisão pós-Task 8: cobertura do bloco `mes` ──────────────────────────────
// getFaturometro() ganhou um parâmetro opcional `hojeISO` (mesmo padrão de
// backfillProgress/backfillStep em lib/faturometroSync.js) só para estes
// testes fixarem o dia sem depender do relógio real — a rota continua
// chamando sem argumento. Isso permite testar a borda do dia 31 (mês anterior
// sem o dia equivalente) sem falsear o relógio; a lógica PURA dessa borda já
// está coberta por 'mês anterior sem o dia equivalente compara com o mês
// inteiro' em test/faturometro.test.js — aqui cobrimos o fio até o payload.
//
// Datas em fevereiro/março/abril/maio de 2026: faixa inteiramente livre de
// qualquer outro teste do arquivo (que só usa jan/jul/ago de 2026 — conferido
// via grep), então nenhuma isolação extra (tipo isolarBackfill) é necessária:
// nenhuma outra conta tem linha em faturometro_daily nesses meses.
async function plantarDaily(accountId, dia, faturamento) {
  await db('faturometro_daily').insert({
    id: `d-${accountId}-${dia}`, account_id: accountId, dia,
    faturamento, unidades: 0, pedidos: 1, atualizado_em: new Date().toISOString(),
  }).onConflict(['account_id', 'dia']).merge(['faturamento', 'atualizado_em']);
}

test('mes soma o consolidado do mês corrente até hoje e compara com o dia equivalente do mês anterior', async () => {
  await semear('acc-mes1', '6101');

  // Mês corrente: maio/2026, hoje = dia 15. O dia 16 (depois de hoje) fica fora.
  await plantarDaily('acc-mes1', '2026-05-01', 1000);
  await plantarDaily('acc-mes1', '2026-05-10', 500);
  await plantarDaily('acc-mes1', '2026-05-15', 200); // hoje: incluso e parcial
  await plantarDaily('acc-mes1', '2026-05-16', 99999); // depois de hoje: fora

  // Mês anterior: abril/2026 tem o dia 15 → dias completos (01..14, do
  // consolidado) + o parcial do dia 15 (do LIVRO, cortado pelo horário atual —
  // mesma técnica do teste "comparação com ontem" acima).
  await plantarDaily('acc-mes1', '2026-04-01', 300);
  await plantarDaily('acc-mes1', '2026-04-14', 100);
  await plantarDaily('acc-mes1', '2026-04-16', 99999); // fora do intervalo de completos
  await lancar('acc-mes1', 950, '2026-04-15', '00:00:01', 250, 1, 'b1'); // antes de agora: entra
  await lancar('acc-mes1', 951, '2026-04-15', '23:59:59', 99999, 1, 'b2'); // depois de agora: fora

  const p = await faturometroService.getFaturometro('2026-05-15');

  assert.equal(p.mes.ym, '2026-05');
  assert.equal(p.mes.faturamento, 1700, '1000 + 500 + 200 (hoje incluso), sem o dia seguinte');
  assert.equal(p.mes.anteriorAteAgora, 650, '300 + 100 (completos) + 250 (parcial cortado pelo horário)');
  assert.equal(p.mes.variacao, 1.6154, '(1700-650)/650, arredondado a 4 casas');
  assert.equal(p.mes.anteriorParcial, true);
});

test('mes: mês anterior sem o dia equivalente compara com o mês inteiro (anteriorParcial=false)', async () => {
  await semear('acc-mes2', '6102');

  // Mês corrente: março/2026, hoje = dia 31 (o próprio último dia do mês).
  await plantarDaily('acc-mes2', '2026-03-01', 500);
  await plantarDaily('acc-mes2', '2026-03-31', 300); // hoje: incluso

  // Mês anterior: fevereiro/2026 não tem dia 31 (28 dias, 2026 não é
  // bissexto) → compara com o mês INTEIRO, sem parcial nenhum.
  await plantarDaily('acc-mes2', '2026-02-01', 200);
  await plantarDaily('acc-mes2', '2026-02-28', 100);

  const p = await faturometroService.getFaturometro('2026-03-31');

  assert.equal(p.mes.ym, '2026-03');
  assert.equal(p.mes.faturamento, 800, '500 + 300 (hoje é o último dia do mês)');
  assert.equal(p.mes.anteriorAteAgora, 300, '200 + 100 — fevereiro inteiro, sem dia 31');
  assert.equal(p.mes.variacao, 1.6667, '(800-300)/300, arredondado a 4 casas');
  assert.equal(p.mes.anteriorParcial, false, 'fevereiro não tem dia 31: rótulo "vs mês inteiro"');
});
