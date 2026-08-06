// faturometroSync — a ESCRITA do Faturômetro: webhook, reconciliação, backfill
// e expurgo. A leitura mora em services/faturometroService.js.
//
// Tudo aqui é idempotente porque a chave do livro é o id do pedido no ML: os
// três caminhos podem gravar o mesmo pedido à vontade sem inflar o número.
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const meli = require('../services/meliService');
const { orderRow, round2 } = require('./faturometro');

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

// Grava (ou atualiza) uma linha do livro e reconsolida o dia afetado.
// A escrita em si é um upsert atômico por order_id (a chave de idempotência) —
// duas gravações concorrentes do MESMO pedido não colidem na PK e não lançam.
// O SELECT prévio continua necessário só para saber se o pedido migrou de
// dia/conta e, nesse caso, reconsolidar o consolidado antigo também.
async function saveOrderRow(row) {
  if (!row) return null;
  const existing = await db('faturometro_orders').where({ order_id: row.order_id }).first();
  const dados = { ...row, atualizado_em: agora() };
  await db('faturometro_orders')
    .insert(dados)
    .onConflict('order_id')
    .merge(['account_id', 'dia', 'criado_em_ml', 'total_amount', 'unidades', 'comprador_id', 'atualizado_em']);

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

module.exports = { marcarSync, recalcDay, saveOrderRow, ingestOrder };
