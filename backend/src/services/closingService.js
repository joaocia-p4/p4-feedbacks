// closingService — fechamento mensal. Busca no banco e delega toda a regra
// para lib/monthlyClosing, que é pura e testada.
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const clientService = require('./clientService');
const { notFound, forbidden } = require('../lib/errors');
const { buildMonthlyClosing, monthRange } = require('../lib/monthlyClosing');

function isValidYm(ym) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''));
}

// Janela larga o bastante para pegar qualquer semana que atravesse a virada.
// reportMonth decide em definitivo depois, em JS — isto aqui é só o recorte
// da consulta, para não carregar o histórico inteiro.
function queryWindow(ym) {
  const { ini, fim } = monthRange(ym);
  const desloca = (iso, dias) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  return { de: desloca(ini, -45), ate: desloca(fim, 45) };
}

async function getMonthlyClosing(user, ym) {
  // listClients já filtra por papel (analista vê só os seus) e traz statusTag +
  // contas com metas e datas. Inclui encerrados de propósito: meses passados
  // precisam listar quem operou na época.
  const { clients } = await clientService.listClients(user, {});
  const accountIds = clients.flatMap((c) => (c.contas || []).map((a) => a.id));
  const clientIds = clients.map((c) => c.id);

  let reports = [];
  if (accountIds.length) {
    const { de, ate } = queryWindow(ym);
    reports = await db('reports')
      .whereIn('account_id', accountIds)
      .andWhereRaw('COALESCE(periodo_fim, periodo_ini, criado_em) BETWEEN ? AND ?', [de, ate])
      .select('account_id', 'periodo_ini', 'periodo_fim', 'criado_em',
              'faturamento', 'vendas', 'receita_ads', 'vendas_ads', 'investimento');
  }

  const closings = clientIds.length
    ? await db('monthly_closings').whereIn('client_id', clientIds).andWhere({ ym })
    : [];

  return buildMonthlyClosing({ clients, reports, closings, ym });
}

// Grava observação e/ou muda o estado do mês. A linha nasce no primeiro dos
// dois eventos. Reabrir zera fechado_em/fechado_por e PRESERVA a observação.
async function saveClosing(user, clientId, ym, { observacoes, fechado }) {
  // escopo de escrita: analista só mexe no próprio cliente
  const { clients } = await clientService.listClients(user, {});
  const alvo = clients.find((c) => c.id === clientId);
  if (!alvo) throw notFound('Cliente não encontrado.');
  if (user.papel === 'analista' && alvo.analistaId !== user.id) {
    throw forbidden('Você só pode fechar o mês dos seus clientes.');
  }

  const agora = new Date().toISOString();
  const existente = await db('monthly_closings').where({ client_id: clientId, ym }).first();

  const patch = { atualizado_em: agora };
  if (observacoes !== undefined) patch.observacoes = observacoes;
  if (fechado !== undefined) {
    patch.fechado_em = fechado ? agora : null;
    patch.fechado_por = fechado ? user.id : null;
  }

  if (existente) {
    await db('monthly_closings').where({ id: existente.id }).update(patch);
  } else {
    await db('monthly_closings').insert({
      id: uuid(),
      client_id: clientId,
      ym,
      observacoes: observacoes || '',
      fechado_em: patch.fechado_em || null,
      fechado_por: patch.fechado_por || null,
      criado_em: agora,
      atualizado_em: agora,
    });
  }

  const row = await db('monthly_closings').where({ client_id: clientId, ym }).first();
  return { observacoes: row.observacoes || '', fechadoEm: row.fechado_em || null, fechadoPor: row.fechado_por || null };
}

module.exports = { getMonthlyClosing, saveClosing, isValidYm };
