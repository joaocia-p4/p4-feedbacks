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
async function marcarSync(accountId, patch) {
  const existing = await db('faturometro_sync').where({ account_id: accountId }).first();
  const dados = { ...patch, atualizado_em: agora() };
  if (existing) {
    await db('faturometro_sync').where({ account_id: accountId }).update(dados);
    return;
  }
  await db('faturometro_sync').insert({ account_id: accountId, backfill_status: 'pendente', ...dados });
}

// Recalcula o consolidado de um dia a partir do livro. É sempre uma soma do
// zero — nunca um incremento — então erra menos e é seguro chamar de novo.
async function recalcDay(accountId, dia) {
  const rows = await db('faturometro_orders').where({ account_id: accountId, dia });
  const patch = {
    faturamento: round2(rows.reduce((s, o) => s + (Number(o.total_amount) || 0), 0)),
    unidades: rows.reduce((s, o) => s + (Number(o.unidades) || 0), 0),
    pedidos: rows.length,
    atualizado_em: agora(),
  };
  const existing = await db('faturometro_daily').where({ account_id: accountId, dia }).first();
  if (existing) {
    await db('faturometro_daily').where({ id: existing.id }).update(patch);
    return;
  }
  await db('faturometro_daily').insert({ id: uuid(), account_id: accountId, dia, ...patch });
}

// Grava (ou atualiza) uma linha do livro e reconsolida o dia afetado.
async function saveOrderRow(row) {
  if (!row) return null;
  const existing = await db('faturometro_orders').where({ order_id: row.order_id }).first();
  const dados = { ...row, atualizado_em: agora() };
  if (existing) await db('faturometro_orders').where({ order_id: row.order_id }).update(dados);
  else await db('faturometro_orders').insert(dados);

  await recalcDay(row.account_id, row.dia);
  // Pedido que mudou de dia (ou de conta) deixa o consolidado antigo desatualizado.
  if (existing && (existing.dia !== row.dia || existing.account_id !== row.account_id)) {
    await recalcDay(existing.account_id, existing.dia);
  }
  return row;
}

// Busca um pedido no ML e grava. Falha do ML vira erro registrado, não exceção:
// o webhook não pode derrubar a resposta e a reconciliação conserta depois.
async function ingestOrder(accountId, orderId) {
  const r = await meli.fetchOrder(accountId, orderId);
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
