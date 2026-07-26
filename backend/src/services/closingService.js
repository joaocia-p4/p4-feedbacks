// closingService — fechamento mensal. Busca no banco e delega toda a regra
// para lib/monthlyClosing, que é pura e testada.
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const clientService = require('./clientService');
const { notFound, forbidden, badRequest } = require('../lib/errors');
const { buildMonthlyClosing } = require('../lib/monthlyClosing');

function isValidYm(ym) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''));
}

async function getMonthlyClosing(user, ym) {
  // listClients já filtra por papel (analista vê só os seus) e traz statusTag +
  // contas com metas e datas. Inclui encerrados de propósito: meses passados
  // precisam listar quem operou na época.
  const { clients } = await clientService.listClients(user, {});
  const accountIds = clients.flatMap((c) => (c.contas || []).map((a) => a.id));
  const clientIds = clients.map((c) => c.id);

  let figures = [];
  if (accountIds.length) {
    figures = await db('monthly_figures')
      .whereIn('account_id', accountIds)
      .andWhere({ ym })
      .select('account_id', 'ym', 'faturamento', 'investimento', 'receita_ads');
  }

  const closings = clientIds.length
    ? await db('monthly_closings').whereIn('client_id', clientIds).andWhere({ ym })
    : [];

  return buildMonthlyClosing({ clients, figures, closings, ym });
}

// Escopo de escrita: analista só mexe no próprio cliente. Devolve o cliente
// enriquecido, que já vem filtrado por papel do listClients.
async function clienteNoEscopo(user, clientId) {
  const { clients } = await clientService.listClients(user, {});
  const alvo = clients.find((c) => c.id === clientId);
  if (!alvo) throw notFound('Cliente não encontrado.');
  if (user.papel === 'analista' && alvo.analistaId !== user.id) {
    throw forbidden('Você só pode fechar o mês dos seus clientes.');
  }
  return alvo;
}

// Grava observação e/ou muda o estado do mês. A linha nasce no primeiro dos
// dois eventos. Reabrir zera fechado_em/fechado_por e PRESERVA a observação.
async function saveClosing(user, clientId, ym, { observacoes, fechado }) {
  await clienteNoEscopo(user, clientId);

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

// Grava em lote os lançamentos das contas de um cliente no mês.
// Conta com os três valores nulos tem a linha REMOVIDA (volta a "não lançado") —
// é a única forma de desfazer um lançamento feito na conta errada, já que
// gravar 0 afirmaria que não faturou.
async function saveFigures(user, clientId, ym, contas) {
  const alvo = await clienteNoEscopo(user, clientId);
  const doCliente = new Set((alvo.contas || []).map((a) => a.id));
  for (const c of contas || []) {
    if (!doCliente.has(c.accountId)) {
      throw badRequest(`A conta ${c.accountId} não pertence a este cliente.`);
    }
  }

  const agora = new Date().toISOString();
  let salvos = 0;
  let removidos = 0;

  for (const c of contas || []) {
    const vazio = c.faturamento == null && c.investimento == null && c.receitaAds == null;
    if (vazio) {
      removidos += await db('monthly_figures').where({ account_id: c.accountId, ym }).del();
      continue;
    }
    const valores = {
      faturamento: c.faturamento || 0,
      investimento: c.investimento || 0,
      receita_ads: c.receitaAds || 0,
      atualizado_em: agora,
      atualizado_por: user.id,
    };
    const existente = await db('monthly_figures').where({ account_id: c.accountId, ym }).first();
    if (existente) {
      await db('monthly_figures').where({ id: existente.id }).update(valores);
    } else {
      await db('monthly_figures').insert({
        id: uuid(), account_id: c.accountId, ym, criado_em: agora, ...valores,
      });
    }
    salvos++;
  }

  return { salvos, removidos };
}

module.exports = { getMonthlyClosing, saveClosing, saveFigures, isValidYm };
