// faturometroSync — a ESCRITA do Faturômetro: webhook, reconciliação, backfill
// e expurgo. A leitura mora em services/faturometroService.js.
//
// Tudo aqui é idempotente porque a chave do livro é o id do pedido no ML: os
// três caminhos podem gravar o mesmo pedido à vontade sem inflar o número.
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const meli = require('../services/meliService');
const { orderRow, round2, addDaysISO } = require('./faturometro');
const { todayISO } = require('./p4');

function agora() {
  return new Date().toISOString();
}

// Marca o estado de sincronismo de uma conta (cria a linha se não existir).
// Upsert atômico (insert...onConflict...merge) em vez de SELECT-então-INSERT/UPDATE:
// duas chamadas concorrentes na mesma conta não podem colidir na PK e lançar.
// O merge cobre só as chaves do PATCH (+ atualizado_em) — nunca `.merge()` sem
// argumentos — senão um `marcarSync(id, { erro: null })` zeraria backfill_dia e
// devolveria backfill_status para 'pendente', estragando o backfill da Task 7.
async function marcarSync(accountId, patch) {
  const dados = { ...patch, atualizado_em: agora() };
  await db('faturometro_sync')
    .insert({ account_id: accountId, backfill_status: 'pendente', ...dados })
    .onConflict('account_id')
    .merge(Object.keys(dados));
}

// Recalcula o consolidado de um dia a partir do livro. É sempre uma soma do
// zero — nunca um incremento — então erra menos e é seguro chamar de novo.
// Upsert atômico no conflito real (['account_id','dia'], não a PK `id`) — o
// merge NÃO inclui `id`, senão o uuid da linha mudaria a cada recálculo.
async function recalcDay(accountId, dia) {
  const rows = await db('faturometro_orders').where({ account_id: accountId, dia });
  const patch = {
    faturamento: round2(rows.reduce((s, o) => s + (Number(o.total_amount) || 0), 0)),
    unidades: rows.reduce((s, o) => s + (Number(o.unidades) || 0), 0),
    pedidos: rows.length,
    atualizado_em: agora(),
  };
  await db('faturometro_daily')
    .insert({ id: uuid(), account_id: accountId, dia, ...patch })
    .onConflict(['account_id', 'dia'])
    .merge(['faturamento', 'unidades', 'pedidos', 'atualizado_em']);
}

// Colunas que o upsert do livro atualiza quando o order_id já existe.
// Compartilhada entre saveOrderRow (uma linha) e reconcileAccount (o dia
// inteiro) — se as duas listas divergissem, o bug seria silencioso.
const ORDER_UPSERT_COLS = ['account_id', 'dia', 'criado_em_ml', 'total_amount', 'unidades', 'comprador_id', 'atualizado_em'];

// Upsert atômico de UMA linha do livro por order_id (a chave de idempotência) —
// duas gravações concorrentes do MESMO pedido, de QUALQUER origem (webhook,
// reconciliação, backfill), não colidem na PK e não lançam.
async function upsertOrderRow(row) {
  const dados = { ...row, atualizado_em: agora() };
  await db('faturometro_orders').insert(dados).onConflict('order_id').merge(ORDER_UPSERT_COLS);
  return dados;
}

// Grava (ou atualiza) uma linha do livro e reconsolida o dia afetado.
// A escrita em si é o upsert atômico acima. O SELECT prévio continua
// necessário só para saber se o pedido migrou de dia/conta e, nesse caso,
// reconsolidar o consolidado antigo também.
async function saveOrderRow(row) {
  if (!row) return null;
  const existing = await db('faturometro_orders').where({ order_id: row.order_id }).first();
  await upsertOrderRow(row);

  await recalcDay(row.account_id, row.dia);
  // Pedido que mudou de dia (ou de conta) deixa o consolidado antigo desatualizado.
  if (existing && (existing.dia !== row.dia || existing.account_id !== row.account_id)) {
    await recalcDay(existing.account_id, existing.dia);
  }
  return row;
}

// Busca um pedido no ML e grava. Falha do ML vira erro registrado, não exceção:
// o webhook não pode derrubar a resposta e a reconciliação conserta depois. Isso
// vale tanto para falha HTTP ({ok:false}, tratado no meliService) quanto para
// exceção lançada antes disso — ex.: conta sem conexão ou token sem refresh
// (meliService.getValidAccessToken lança) e falha de rede no fetch().
async function ingestOrder(accountId, orderId) {
  let r;
  try {
    r = await meli.fetchOrder(accountId, orderId);
  } catch (err) {
    const msg = (err && err.message) || String(err);
    await marcarSync(accountId, { erro: `pedido ${orderId}: ${msg}`.slice(0, 300) });
    return null;
  }
  if (!r || !r.ok) {
    await marcarSync(accountId, { erro: `pedido ${orderId}: ${JSON.stringify((r && r.data) || {}).slice(0, 300)}` });
    return null;
  }
  const row = orderRow(r.data, accountId);
  if (!row) return null;
  await marcarSync(accountId, { erro: null });
  return saveOrderRow(row);
}

// Notificação do Mercado Livre → pedido no livro. Só nos interessa `orders_v2`;
// qualquer outra coisa (tópico diferente, vendedor que não conectou conosco,
// corpo incompleto) sai em silêncio, porque reenviar não resolveria nada.
async function handleNotification(body) {
  if (!body || body.topic !== 'orders_v2') return null;
  const mlUserId = body.user_id != null ? String(body.user_id) : '';
  const orderId = String(body.resource || '').split('/').filter(Boolean).pop() || '';
  if (!mlUserId || !orderId) return null;

  const conn = await db('meli_connections').where({ ml_user_id: mlUserId }).first();
  if (!conn) return null;
  return ingestOrder(conn.account_id, orderId);
}

const JANELA_LIVRO_DIAS = 70; // cobre com folga o dia equivalente do mês anterior
const JANELA_RECONCILIA_MS = 10 * 60 * 1000;
const CONTAS_POR_CICLO = 5; // rodízio: com 40+ contas, tudo de uma vez derruba o ciclo
const BACKFILL_DIAS_POR_CICLO = 3;

// Id do vendedor no ML. Vem da conexão; só chama /users/me se ela não tiver.
async function sellerIdOf(accountId) {
  const conn = await meli.getConnection(accountId);
  if (!conn) return null;
  if (conn.ml_user_id) return conn.ml_user_id;
  const me = await meli.apiGet(accountId, '/users/me');
  return me.ok ? String(me.data.id) : null;
}

// Rebusca um dia inteiro na API de Pedidos e faz o livro bater com a resposta:
// grava o que veio, apaga o que sumiu. É o que conserta o que o webhook perdeu
// enquanto o Render dormia.
//
// Erro do ML NÃO zera nada: mantemos o que já estava contado (é receita que
// aconteceu) e registramos o erro para a tela sinalizar "precisa reconectar".
async function reconcileAccount(accountId, dia) {
  const sellerId = await sellerIdOf(accountId);
  if (!sellerId) {
    await marcarSync(accountId, { erro: 'conta sem conexão com o Mercado Livre' });
    return { ok: false, erro: 'sem conexão' };
  }

  const r = await meli.ordersOfDay(accountId, sellerId, dia);
  if (r.erro) {
    await marcarSync(accountId, { erro: JSON.stringify(r.erro).slice(0, 300) });
    return { ok: false, erro: r.erro };
  }

  const rows = r.pedidos.map((o) => orderRow(o, accountId)).filter((x) => x && x.dia === dia);
  const ids = rows.map((x) => x.order_id);

  const del = db('faturometro_orders').where({ account_id: accountId, dia });
  if (ids.length) del.whereNotIn('order_id', ids);
  await del.del();

  // Upsert atômico por linha (mesmo helper de saveOrderRow) — não read-then-write:
  // o webhook pode estar gravando o MESMO order_id neste exato instante (mesma
  // conta, mesmo pedido) e um SELECT-então-INSERT colidiria na PK.
  for (const row of rows) {
    await upsertOrderRow(row);
  }

  await recalcDay(accountId, dia);
  await marcarSync(accountId, { erro: null, reconciliado_em: agora() });
  return { ok: true, pedidos: rows.length };
}

// O livro guarda 70 dias; o consolidado guarda tudo. Só a granularidade por hora
// dos dias antigos se perde, e ninguém a consulta.
async function purgeOldOrders(hojeISO) {
  const corte = addDaysISO(hojeISO || todayISO(), -JANELA_LIVRO_DIAS);
  return db('faturometro_orders').where('dia', '<', corte).del();
}

// Contas no escopo do Faturômetro: conectadas ao ML e não encerradas.
function scopedAccounts() {
  return db('meli_connections')
    .join('accounts', 'accounts.id', 'meli_connections.account_id')
    .whereNot('accounts.ativo', false)
    .select('accounts.id as accountId');
}

// Um ciclo de trabalho: expurgo (uma vez por dia), rodízio de reconciliação e um
// lote de backfill. Roda em segundo plano — nada aqui pode lançar para fora.
let rodando = false;
let ultimoExpurgo = null;

async function runQueue() {
  const hoje = todayISO();

  if (ultimoExpurgo !== hoje) {
    ultimoExpurgo = hoje;
    await purgeOldOrders(hoje).catch(() => {});
  }

  const contas = await scopedAccounts();
  const syncs = await db('faturometro_sync').whereIn('account_id', contas.map((c) => c.accountId));
  const porConta = new Map(syncs.map((s) => [s.account_id, s]));

  const vencidas = contas
    .map((c) => ({ id: c.accountId, sync: porConta.get(c.accountId) }))
    .filter((x) => {
      const t = x.sync && x.sync.reconciliado_em ? Date.parse(x.sync.reconciliado_em) : 0;
      return Date.now() - t > JANELA_RECONCILIA_MS;
    })
    .sort((a, b) => {
      const ta = a.sync && a.sync.reconciliado_em ? Date.parse(a.sync.reconciliado_em) : 0;
      const tb = b.sync && b.sync.reconciliado_em ? Date.parse(b.sync.reconciliado_em) : 0;
      return ta - tb; // a mais antiga primeiro
    })
    .slice(0, CONTAS_POR_CICLO);

  for (const c of vencidas) {
    await reconcileAccount(c.id, hoje).catch(() => {});
  }
}

// Dispara o motor sem bloquear quem chamou. A trava garante um ciclo por vez —
// com polling de 30s, sem ela os ciclos se empilhariam.
//
// FATUROMETRO_BACKGROUND=off desliga o motor: os testes de leitura chamam
// getFaturometro(), que dispara o kick, e sem essa trava o ciclo sairia batendo
// na API real do Mercado Livre no meio da suíte.
function kick() {
  if (process.env.FATUROMETRO_BACKGROUND === 'off') return;
  if (rodando) return;
  rodando = true;
  Promise.resolve()
    .then(runQueue)
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[faturometro] ciclo falhou:', e.message);
    })
    .finally(() => { rodando = false; });
}

module.exports = {
  marcarSync, recalcDay, saveOrderRow, ingestOrder, handleNotification,
  reconcileAccount, purgeOldOrders, scopedAccounts, runQueue, kick,
};
