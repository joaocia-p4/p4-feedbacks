// clientService — scoped client listing/detail with the README's filters, plus
// create/update/delete with account (conta) reconciliation. Aggregation matches
// p4-data.jsx via lib/clientAggregate.
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const p4 = require('../lib/p4');
const { enrichClient } = require('../lib/clientAggregate');
const reportService = require('./reportService');
const userService = require('./userService');
const { notFound, badRequest } = require('../lib/errors');

// ── small helpers ────────────────────────────────────────────────────────────
function buildAgenda(row) {
  const a = { freq: row.agenda_freq };
  if (row.agenda_freq === 'Mensal') a.diaMes = row.agenda_dia_mes;
  else a.diaSemana = row.agenda_dia_semana;
  return a;
}
function rowToClientBase(row) {
  return {
    id: row.id,
    loja: row.loja,
    tipo: row.tipo,
    analista_id: row.analista_id,
    analista: row.analista_nome,
    agenda: buildAgenda(row),
    criadoEm: row.criado_em ? String(row.criado_em).slice(0, 10) : null,
    observacoes: row.observacoes || '',
  };
}
function agendaColumns(agenda) {
  const mensal = agenda.freq === 'Mensal';
  return {
    agenda_freq: agenda.freq,
    agenda_dia_semana: mensal ? null : agenda.diaSemana,
    agenda_dia_mes: mensal ? agenda.diaMes : null,
  };
}
function normalizeAgenda(a) {
  return a.freq === 'Mensal'
    ? { freq: 'Mensal', diaMes: a.diaMes }
    : { freq: a.freq, diaSemana: a.diaSemana };
}
function normalizeContas(body) {
  if (body.contas && body.contas.length) {
    return body.contas.map((c) => ({
      id: c.id, // id da conta existente (na edição); ausente = nova conta
      marketplace: c.marketplace,
      apelido: (c.apelido ?? c.conta ?? '').trim(),
      // metas opcionais: mantém o que veio (inclusive "" = sem meta)
      metaInvestimento: c.metaInvestimento ?? '',
      metaRoas: c.metaRoas ?? '',
      metaAcos: c.metaAcos ?? '',
      metaTacos: c.metaTacos ?? '',
      // ciclo de vida: datas vazias viram null; ativo default true
      dataEntrada: (c.dataEntrada ?? '').trim() || null,
      dataEncerramento: (c.dataEncerramento ?? '').trim() || null,
      ativo: c.ativo === false ? false : true,
    }));
  }
  return (body.marketplaces || []).map((mk) => ({
    marketplace: mk,
    apelido: '',
    ...p4.DEFAULT_METAS,
    dataEntrada: null,
    dataEncerramento: null,
    ativo: true,
  }));
}
function sortAccounts(accs) {
  return [...accs].sort(
    (a, b) =>
      p4.AD_MARKETPLACES.indexOf(a.marketplace) - p4.AD_MARKETPLACES.indexOf(b.marketplace)
  );
}
function groupBy(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = x[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// ── assemble + enrich ────────────────────────────────────────────────────────
function assembleClient(clientRow, accountRows, reportsByAccount, asOf) {
  const client = rowToClientBase(clientRow);
  const accounts = sortAccounts(accountRows).map((a) => {
    const metaRoasNum = p4.parseNum(a.meta_roas);
    const rows = reportsByAccount.get(a.id) || [];
    return {
      id: a.id,
      marketplace: a.marketplace,
      apelido: a.apelido,
      metaInvestimento: a.meta_investimento,
      metaRoas: a.meta_roas,
      metaAcos: a.meta_acos,
      metaTacos: a.meta_tacos,
      dataEntrada: a.data_entrada ? String(a.data_entrada).slice(0, 10) : null,
      dataEncerramento: a.data_encerramento ? String(a.data_encerramento).slice(0, 10) : null,
      ativo: a.ativo === 0 || a.ativo === false ? false : true, // SQLite: 0/1
      reports: rows.map((r) => reportService.mapRow(r, metaRoasNum)),
    };
  });
  return enrichClient(client, accounts, { asOf });
}

// Drop heavy report arrays for the list response (card only needs derived data).
function slimClient(c) {
  // mantém tudo (inclusive observações, para exportar/editar em massa); só remove
  // os arrays pesados de relatórios das contas.
  return {
    ...c,
    contas: c.contas.map(({ reports, ...r }) => r),
  };
}

// ── queries ──────────────────────────────────────────────────────────────────
function baseQuery() {
  return db('clients as c')
    .leftJoin('users as u', 'u.id', 'c.analista_id')
    .select('c.*', 'u.nome as analista_nome');
}

async function loadScopedClients(user) {
  const qb = baseQuery().orderBy('c.loja', 'asc');
  // admin e cs enxergam todos; analista vê apenas os seus.
  if (user.papel === 'analista') qb.where('c.analista_id', user.id);
  return qb;
}

async function loadOneClientRow(id) {
  return baseQuery().where('c.id', id).first();
}

// Enriched client with full reports, no scope check (internal read-back).
async function getEnriched(id, { full = true } = {}) {
  const cr = await loadOneClientRow(id);
  if (!cr) throw notFound('Cliente não encontrado.');
  const accountRows = await db('accounts').where({ client_id: id });
  const reportRows = await reportService.fetchForAccounts(
    accountRows.map((a) => a.id),
    { full }
  );
  const reportsByAccount = reportService.groupByAccount(reportRows);
  return assembleClient(cr, accountRows, reportsByAccount, p4.lastCompleteDayISO());
}

// ── filters (mirror p4-clients.jsx) ──────────────────────────────────────────
function normalizeStatus(s) {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'em dia' || v === 'em-dia') return 'em-dia';
  if (v === 'atrasado') return 'atrasado';
  if (v === 'encerrado') return 'encerrado';
  return null; // 'Todos' / unknown → no status filter
}
function applyFilters(list, filters) {
  const due = filters.due || null;
  const q = (filters.q || '').trim().toLowerCase();
  const marketplace = (filters.marketplace || '').trim();
  const status = normalizeStatus(filters.status);

  let out = list.filter((c) => {
    // encerrados nunca entram em "para enviar"
    if (due && !(!c.encerrado && (p4.isDueOn(c.agenda, due) || c.status === 'atrasado'))) return false;
    if (marketplace && marketplace !== 'Todos' && !c.marketplaces.includes(marketplace)) return false;
    if (status === 'em-dia' && (c.encerrado || c.status !== 'em-dia')) return false;
    if (status === 'atrasado' && (c.encerrado || c.status !== 'atrasado')) return false;
    if (status === 'encerrado' && !c.encerrado) return false;
    if (q) {
      const hay =
        c.loja.toLowerCase() +
        ' ' +
        String(c.analista || '').toLowerCase() +
        ' ' +
        c.marketplaces.join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // "Para enviar": overdue clients come first.
  if (due) out = [...out].sort((a, b) => (b.status === 'atrasado') - (a.status === 'atrasado'));
  return out;
}

async function listClients(user, filters = {}) {
  const asOf = p4.todayISO(); // data atual (apenas informativa no meta)
  const refDay = p4.lastCompleteDayISO(); // referência do "atrasado" (último dia completo)
  const clientRows = await loadScopedClients(user);
  if (!clientRows.length) {
    // Empty scope (new analyst / fresh DB) must still return the documented shape.
    const meta = { asOf, total: 0, late: 0 };
    if (filters.due) {
      meta.due = filters.due;
      meta.weekday = p4.weekdayName(filters.due);
      meta.scheduled = 0;
      meta.toSend = 0;
    }
    return { clients: [], meta };
  }

  const clientIds = clientRows.map((c) => c.id);
  const accountRows = await db('accounts').whereIn('client_id', clientIds);
  const accountIds = accountRows.map((a) => a.id);
  const reportRows = await reportService.fetchForAccounts(accountIds, { full: false });
  const reportsByAccount = reportService.groupByAccount(reportRows);
  const accountsByClient = groupBy(accountRows, 'client_id');

  const enriched = clientRows.map((cr) =>
    assembleClient(cr, accountsByClient.get(cr.id) || [], reportsByAccount, refDay)
  );

  // Header metadata computed over the FULL scope (before due/search filters),
  // so the UI can show "N para enviar · X no dia · Y atrasados" like the prototype.
  const meta = {
    asOf,
    total: enriched.length,
    late: enriched.filter((c) => !c.encerrado && c.status === 'atrasado').length,
  };
  if (filters.due) {
    meta.due = filters.due;
    meta.weekday = p4.weekdayName(filters.due);
    meta.scheduled = enriched.filter((c) => !c.encerrado && p4.isDueOn(c.agenda, filters.due)).length;
    meta.toSend = enriched.filter(
      (c) => !c.encerrado && (p4.isDueOn(c.agenda, filters.due) || c.status === 'atrasado')
    ).length;
  }

  const clients = applyFilters(enriched, filters).map(slimClient);
  return { clients, meta };
}

async function getClientDetail(id, user) {
  const cr = await loadOneClientRow(id);
  // admin e cs veem qualquer cliente; analista, só os seus.
  if (!cr || (user.papel === 'analista' && cr.analista_id !== user.id)) {
    throw notFound('Cliente não encontrado.');
  }
  return getEnriched(id, { full: true });
}

// ── mutations (admin ou analista responsável) ────────────────────────────────
function isAdmin(user) {
  return !user || user.papel === 'admin';
}
// Garante que o analista só age sobre clientes dos quais é responsável.
function assertCanManage(user, client) {
  if (!isAdmin(user) && client.analista_id !== user.id) {
    throw notFound('Cliente não encontrado.');
  }
}

async function createClient(body, actingUser) {
  // Analista cria sempre para si mesmo; admin pode atribuir a qualquer analista.
  let analystId;
  if (isAdmin(actingUser)) {
    analystId = (await userService.resolveAnalyst(body)).id;
  } else {
    analystId = actingUser.id;
  }
  const contas = normalizeContas(body); // várias contas do mesmo marketplace são permitidas
  const agenda = normalizeAgenda(body.agenda);
  const clientId = uuid();

  await db.transaction(async (trx) => {
    await trx('clients').insert({
      id: clientId,
      loja: body.loja,
      tipo: body.tipo || 'Loja',
      analista_id: analystId,
      observacoes: body.observacoes || '',
      ...agendaColumns(agenda),
    });
    await trx('accounts').insert(
      contas.map((c) => ({
        id: uuid(),
        client_id: clientId,
        marketplace: c.marketplace,
        apelido: c.apelido,
        meta_investimento: c.metaInvestimento,
        meta_roas: c.metaRoas,
        meta_acos: c.metaAcos,
        meta_tacos: c.metaTacos,
        data_entrada: c.dataEntrada,
        data_encerramento: c.dataEncerramento,
        ativo: c.ativo,
      }))
    );
  });

  return getEnriched(clientId);
}

async function updateClient(id, body, actingUser) {
  const existing = await db('clients').where({ id }).first();
  if (!existing) throw notFound('Cliente não encontrado.');
  assertCanManage(actingUser, existing); // analista só edita os seus

  const patch = {};
  if (body.loja !== undefined) patch.loja = body.loja;
  if (body.tipo !== undefined) patch.tipo = body.tipo;
  // Só admin pode reatribuir o analista responsável.
  if (isAdmin(actingUser) && (body.analistaId || body.analista)) {
    const analyst = await userService.resolveAnalyst(body);
    patch.analista_id = analyst.id;
  }
  if (body.agenda) Object.assign(patch, agendaColumns(normalizeAgenda(body.agenda)));
  if (body.observacoes !== undefined) patch.observacoes = body.observacoes;

  // Only reconcile accounts when contas/marketplaces is explicitly provided.
  // Reject an empty array (a client must keep ≥1 conta) so a stray [] never
  // silently cascade-deletes every account and its reports.
  let desired;
  if (Array.isArray(body.contas) || Array.isArray(body.marketplaces)) {
    desired = normalizeContas(body);
    if (!desired.length) {
      throw badRequest('Um cliente precisa de ao menos um marketplace.');
    }
  }

  await db.transaction(async (trx) => {
    if (Object.keys(patch).length) await trx('clients').where({ id }).update(patch);

    if (desired) {
      // Reconcilia por ID da conta (não por marketplace) — assim um cliente pode
      // ter várias contas do mesmo marketplace e a edição preserva o histórico.
      const current = await trx('accounts').where({ client_id: id }).select('id');
      const currentIds = new Set(current.map((a) => a.id));
      const keptIds = new Set();

      for (const c of desired) {
        const vals = {
          marketplace: c.marketplace,
          apelido: c.apelido,
          meta_investimento: c.metaInvestimento,
          meta_roas: c.metaRoas,
          meta_acos: c.metaAcos,
          meta_tacos: c.metaTacos,
          data_entrada: c.dataEntrada,
          data_encerramento: c.dataEncerramento,
          ativo: c.ativo,
        };
        if (c.id && currentIds.has(c.id)) {
          keptIds.add(c.id);
          await trx('accounts').where({ id: c.id }).update(vals);
        } else {
          await trx('accounts').insert({ id: uuid(), client_id: id, ...vals });
        }
      }

      // Contas removidas no formulário são apagadas (cascata: seus relatórios).
      const toRemove = current.filter((a) => !keptIds.has(a.id)).map((a) => a.id);
      if (toRemove.length) await trx('accounts').whereIn('id', toRemove).del();
    }
  });

  return getEnriched(id);
}

async function deleteClient(id, actingUser) {
  const existing = await db('clients').where({ id }).first();
  if (!existing) throw notFound('Cliente não encontrado.');
  assertCanManage(actingUser, existing); // analista só exclui os seus
  await db('clients').where({ id }).del(); // cascades accounts + reports
  return { id, loja: existing.loja };
}

// ── account scope (used by report routes) ────────────────────────────────────
async function loadAccountWithOwner(accountId) {
  return db('accounts as a')
    .join('clients as c', 'c.id', 'a.client_id')
    .where('a.id', accountId)
    .select('a.*', 'c.analista_id as client_analista_id')
    .first();
}
// Leitura (listar relatórios): admin e cs em qualquer conta; analista só nas suas.
async function getAccountForRead(accountId, user) {
  const acc = await loadAccountWithOwner(accountId);
  if (!acc || (user.papel === 'analista' && acc.client_analista_id !== user.id)) {
    throw notFound('Conta (marketplace) não encontrada.');
  }
  return acc;
}
// Escrita (criar relatório): admin em qualquer conta; analista só nas suas; cs nunca.
async function getAccountForWrite(accountId, user) {
  const acc = await loadAccountWithOwner(accountId);
  if (!acc || (user.papel !== 'admin' && acc.client_analista_id !== user.id)) {
    throw notFound('Conta (marketplace) não encontrada.');
  }
  return acc;
}

module.exports = {
  listClients,
  getClientDetail,
  getEnriched,
  createClient,
  updateClient,
  deleteClient,
  getAccountForRead,
  getAccountForWrite,
};
