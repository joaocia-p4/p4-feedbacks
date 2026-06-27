// clientAggregate.js — turns a client row + its accounts (each with reports,
// newest-first) into the enriched object the screens consume. Mirrors the
// `CLIENTS = RAW.map(...)` derivation in p4-data.jsx exactly.
const p4 = require('./p4');

// Date a report counts as "sent" — its creation date (falls back to period end).
function reportDate(r) {
  if (!r) return null;
  const v = r.criadoEm || r.criado_em || r.periodoFim || r.periodo_fim || '';
  return String(v).slice(0, 10) || null;
}

// Shape one account for the API + compute its last date and status.
function enrichAccount(acc, asOf) {
  const reports = acc.reports || [];
  const last = reportDate(reports[0]);
  return {
    id: acc.id,
    marketplace: acc.marketplace,
    conta: acc.apelido || '',
    metaInvestimento: acc.metaInvestimento,
    metaRoas: acc.metaRoas,
    metaAcos: acc.metaAcos,
    metaTacos: acc.metaTacos,
    last,
    status: p4.accountStatus(last, asOf),
    reports,
  };
}

// client: { id, loja, tipo, analista_id, analista, agenda }
// accounts: array with { ...account, reports: [newest-first] }
function enrichClient(client, accounts, opts = {}) {
  // Referência do "atrasado" = último dia completo (ontem); hoje está em aberto.
  const asOf = opts.asOf || p4.lastCompleteDayISO();
  const contas = (accounts || []).map((a) => enrichAccount(a, asOf));

  const fatLatest = contas.reduce((sum, m) => sum + (m.reports[0]?.faturamento || 0), 0);
  const roasW =
    contas.reduce(
      (sum, m) => sum + (m.reports[0]?.roas || 0) * (m.reports[0]?.faturamento || 0),
      0
    ) / (fatLatest || 1);
  const n = contas.reduce((sum, m) => sum + m.reports.length, 0);
  const last = contas.reduce((a, m) => (m.last && m.last > a ? m.last : a), '0000-00-00');
  const lastWorst = contas.reduce(
    (a, m) => (m.last && m.last < a ? m.last : a),
    '9999-12-31'
  );
  const overdueSched = p4.isOverdueBySchedule(client.agenda, lastWorst, asOf);
  const status =
    contas.some((m) => m.status === 'atrasado') || overdueSched ? 'atrasado' : 'em-dia';

  return {
    id: client.id,
    loja: client.loja,
    tipo: client.tipo,
    analistaId: client.analista_id || client.analistaId,
    analista: client.analista, // resolved name
    agenda: client.agenda,
    criadoEm: client.criadoEm || null,
    observacoes: client.observacoes || '',
    contas,
    marketplaces: contas.map((m) => m.marketplace),
    fatLatest,
    roasW: +roasW.toFixed(2),
    n,
    last: last === '0000-00-00' ? null : last,
    lastWorst: lastWorst === '9999-12-31' ? null : lastWorst,
    overdueSched,
    status,
  };
}

module.exports = { enrichClient, enrichAccount, reportDate };
