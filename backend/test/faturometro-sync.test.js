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
// backfillStep pega a primeira conta do escopo que não está 'pronto'. A partir
// dos testes do motor acima (kick(), rodízio), que rodam runQueue() de verdade,
// contas de testes anteriores (ex.: acc-livro) já ganharam linha em
// faturometro_sync e ficam 'pendente'/'rodando' — sem isolar, elas ficariam na
// frente da conta que cada teste abaixo quer observar. Mesma técnica do teste
// de rodízio (que neutraliza reconciliado_em); aqui neutraliza-se backfill_status.
async function isolarBackfill(exceto) {
  const contas = await faturometro.scopedAccounts();
  for (const c of contas) {
    if (c.accountId === exceto) continue;
    await faturometro.marcarSync(c.accountId, { backfill_status: 'pronto' });
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

test('progresso é a fração de dias já preenchidos', async () => {
  const p = await faturometro.backfillProgress('2026-08-06');
  assert.ok(p.progresso >= 0 && p.progresso <= 1, `progresso fora de 0..1: ${p.progresso}`);
  assert.equal(typeof p.pronto, 'boolean');
});
