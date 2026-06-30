// reportService — report row <-> API mapping and report queries.
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const p4 = require('../lib/p4');
const { notFound } = require('../lib/errors');

const num = (v) => (v == null ? 0 : Number(v));

const MINIMAL_COLS = [
  'id', 'account_id', 'periodo_ini', 'periodo_fim', 'criado_em',
  'faturamento', 'vendas', 'receita_ads', 'vendas_ads', 'investimento',
  'roas', 'acos', 'tacos',
];

function parsePayload(p) {
  if (p == null) return null;
  if (typeof p === 'object') return p; // pg jsonb / already-parsed
  try {
    return JSON.parse(p);
  } catch (_e) {
    return null;
  }
}

// DB row → API report. `metaRoasNum` (number) drives the `ok` flag (roas ≥ meta).
function mapRow(row, metaRoasNum) {
  if (!row) return null;
  const out = {
    id: row.id,
    accountId: row.account_id,
    periodoIni: row.periodo_ini || null,
    periodoFim: row.periodo_fim || null,
    criadoEm: row.criado_em,
    faturamento: num(row.faturamento),
    vendas: num(row.vendas),
    receitaAds: num(row.receita_ads),
    vendasAds: num(row.vendas_ads),
    investimento: num(row.investimento),
    roas: num(row.roas),
    acos: num(row.acos),
    tacos: num(row.tacos),
    ok: metaRoasNum != null ? num(row.roas) >= metaRoasNum : null,
  };
  if (Object.prototype.hasOwnProperty.call(row, 'payload')) {
    out.payload = parsePayload(row.payload);
  }
  return out;
}

// Fetch reports for a set of account ids, newest-first. `full` includes payload.
async function fetchForAccounts(accountIds, { full = false } = {}) {
  if (!accountIds.length) return [];
  const cols = full ? [...MINIMAL_COLS, 'payload'] : MINIMAL_COLS;
  return db('reports')
    .whereIn('account_id', accountIds)
    .select(cols)
    .orderBy([
      { column: 'criado_em', order: 'desc' },
      { column: 'id', order: 'desc' },
    ]);
}

// Group rows by account_id, preserving the (newest-first) order.
function groupByAccount(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.account_id)) map.set(r.account_id, []);
    map.get(r.account_id).push(r);
  }
  return map;
}

async function listForAccount(accountId, metaRoasNum) {
  const rows = await fetchForAccounts([accountId], { full: true });
  return rows.map((r) => mapRow(r, metaRoasNum));
}

// Build a DB row from a single-period payload.
function buildReportRow(account, periodPayload) {
  const nums = p4.deriveNumbers(periodPayload);
  // Sent date == period end (the prototype invariant), falling back to "today".
  const criadoEm = periodPayload.criadoEm || periodPayload.periodoFim || p4.todayISO();
  return {
    id: uuid(),
    account_id: account.id,
    periodo_ini: periodPayload.periodoIni || null,
    periodo_fim: periodPayload.periodoFim || null,
    criado_em: criadoEm,
    salvo_em: new Date().toISOString(), // momento em que foi gerado/salvo

    faturamento: nums.faturamento,
    vendas: nums.vendas,
    receita_ads: nums.receitaAds,
    vendas_ads: nums.vendasAds,
    investimento: nums.investimento,
    roas: nums.roas,
    acos: nums.acos,
    tacos: nums.tacos,
    payload: JSON.stringify(periodPayload),
  };
}

// One comparison-period record (the shape the generator's prev[] uses).
function periodRecord(src) {
  return {
    label: src.label || '',
    periodoIni: src.periodoIni || '',
    periodoFim: src.periodoFim || '',
    faturamento: src.faturamento || '',
    vendas: src.vendas || '',
    receitaAds: src.receitaAds || '',
    vendasAds: src.vendasAds || '',
    investimento: src.investimento || '',
    roas: src.roas || '',
    acos: src.acos || '',
    tacos: src.tacos || '',
    roasAuto: src.roasAuto,
    acosAuto: src.acosAuto,
    tacosAuto: src.tacosAuto,
    preP4: !!src.preP4,
  };
}

// Ingest a generator payload → one report per period (current + each comparison
// period). Every report gets prev[] = all account periods chronologically BEFORE
// it, so the earlier reports also render their comparison — not just the latest.
// Dedup is by period end: existing periods aren't duplicated, but their comparison
// (prev[]) is refreshed when newly-added earlier periods make it grow.
async function createReport(account, payload) {
  const base = {
    marketplace: payload.marketplace || account.marketplace,
    analista: payload.analista || '',
    loja: payload.loja || '',
    lojaTipo: payload.lojaTipo || 'Loja',
    periodicidade: payload.periodicidade || 'Semanal',
    metaInvestimento: payload.metaInvestimento,
    metaRoas: payload.metaRoas,
    metaAcos: payload.metaAcos,
    metaTacos: payload.metaTacos,
  };

  // periods coming in: the current/user report (carries obs) + comparison periods
  const incoming = [
    { rec: periodRecord(payload), isUserReport: true },
    ...(payload.prev || []).map((p) => ({ rec: periodRecord(p), isUserReport: false })),
  ];

  // periods already stored for this account (with their payloads)
  const existingRows = await db('reports')
    .where({ account_id: account.id })
    .select('id', 'periodo_fim', 'payload');
  const existingByFim = new Map();
  for (const row of existingRows) {
    if (!row.periodo_fim) continue;
    existingByFim.set(row.periodo_fim, { id: row.id, payload: parsePayload(row.payload) || {} });
  }

  // combined set of period records keyed by period end (existing metrics win)
  const recByFim = new Map();
  for (const [fim, e] of existingByFim) recByFim.set(fim, periodRecord(e.payload));
  for (const it of incoming) {
    const fim = it.rec.periodoFim;
    if (!fim || recByFim.has(fim)) continue;
    recByFim.set(fim, it.rec);
  }

  // chronological order (oldest first) → each period's comparison = those before it
  const ordered = [...recByFim.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const orderedRecs = ordered.map(([, rec]) => rec);
  const idxOfFim = new Map(ordered.map(([fim], i) => [fim, i]));
  const prevForFim = (fim) => {
    const i = idxOfFim.get(fim);
    if (i == null || i === 0) return [];
    return orderedRecs.slice(0, i).reverse().map((r) => ({ ...r })); // mais recente primeiro
  };

  const metaRoasNum = p4.parseNum(account.meta_roas);
  const created = [];
  let overwritten = 0;
  const handledIds = new Set();

  // 1) cria (novos) ou SOBRESCREVE o período atual já existente (sem duplicar).
  //    Períodos de comparação que já existem são mantidos (só o prev é atualizado).
  for (const it of incoming) {
    const fim = it.rec.periodoFim;
    const existing = fim ? existingByFim.get(fim) : null;
    if (existing && !it.isUserReport) continue; // comparação já existente → mantém

    const periodPayload = {
      ...base,
      ...it.rec,
      obs: it.isUserReport ? payload.obs || '' : '',
      obsImages: it.isUserReport ? payload.obsImages || [] : [],
      campanhas: it.isUserReport ? payload.campanhas || [] : [],
      campanhasMeta: it.isUserReport ? payload.campanhasMeta || null : null,
      campanhasObsAuto: it.isUserReport ? payload.campanhasObsAuto || '' : '',
      status: it.isUserReport ? payload.status || {} : {},
      prev: fim ? prevForFim(fim) : [],
    };
    const row = buildReportRow(account, periodPayload);

    if (existing) {
      // sobrescreve o relatório desse período (mantém o mesmo id — não duplica)
      const { id, ...vals } = row;
      await db('reports').where({ id: existing.id }).update(vals);
      handledIds.add(existing.id);
      overwritten++;
    } else {
      await db('reports').insert(row);
      created.push(mapRow({ ...row }, metaRoasNum));
    }
  }

  // 2) atualiza o comparativo (prev[]) dos demais relatórios já existentes
  for (const [fim, e] of existingByFim) {
    if (handledIds.has(e.id)) continue;
    const newPrev = prevForFim(fim);
    const oldKey = JSON.stringify((e.payload.prev || []).map((p) => p.periodoFim || ''));
    const newKey = JSON.stringify(newPrev.map((p) => p.periodoFim || ''));
    if (oldKey !== newKey) {
      await db('reports').where({ id: e.id }).update({ payload: JSON.stringify({ ...e.payload, prev: newPrev }) });
    }
  }

  return { reports: created, overwritten };
}

async function deleteReport(id) {
  const deleted = await db('reports').where({ id }).del();
  if (!deleted) throw notFound('Relatório não encontrado.');
}

// Snapshot das campanhas do relatório SALVO mais recente desta conta cujo período
// terminou antes de `beforeFim` (AAAA-MM-DD). Serve para comparar a semana atual
// com a anterior e detectar campanhas novas / alterações — o histórico que a API
// do ML não expõe nós construímos a partir dos próprios relatórios.
async function lastCampaignsSnapshot(accountId, beforeFim) {
  let q = db('reports').where({ account_id: accountId });
  if (beforeFim) q = q.where('periodo_fim', '<', beforeFim);
  const rows = await q
    .select('periodo_ini', 'periodo_fim', 'payload')
    .orderBy([
      { column: 'periodo_fim', order: 'desc' },
      { column: 'id', order: 'desc' },
    ]);
  for (const r of rows) {
    const pl = parsePayload(r.payload) || {};
    if (Array.isArray(pl.campanhas) && pl.campanhas.length) {
      return { periodoIni: r.periodo_ini, periodoFim: r.periodo_fim, campanhas: pl.campanhas };
    }
  }
  return null;
}

module.exports = {
  mapRow,
  fetchForAccounts,
  groupByAccount,
  listForAccount,
  createReport,
  deleteReport,
  lastCampaignsSnapshot,
  parsePayload,
  num,
};
