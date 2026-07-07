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

// Data de GERAÇÃO (salvo_em) mais recente entre os relatórios da conta — é ela que
// define o atraso (quando o relatório foi feito), não o fim do período.
function maxGen(reports) {
  let max = '';
  for (const r of reports || []) {
    const g = r && (r.salvoEm || r.salvo_em || r.criadoEm || r.criado_em || r.periodoFim || r.periodo_fim);
    if (g && String(g) > max) max = String(g);
  }
  return max || null;
}

// Shape one account for the API + compute its last date and status (por ciclo).
function enrichAccount(acc, asOf, agenda) {
  const reports = acc.reports || [];
  const last = reportDate(reports[0]); // fim do período do relatório mais recente (exibição)
  const lastGen = maxGen(reports); // data de geração mais recente (define o atraso)
  return {
    id: acc.id,
    marketplace: acc.marketplace,
    conta: acc.apelido || '',
    metaInvestimento: acc.metaInvestimento,
    metaRoas: acc.metaRoas,
    metaAcos: acc.metaAcos,
    metaTacos: acc.metaTacos,
    dataEntrada: acc.dataEntrada || null,
    dataEncerramento: acc.dataEncerramento || null,
    ativo: acc.ativo === false ? false : true,
    last,
    lastGen,
    status: p4.isOverdueByCycle(agenda, lastGen, asOf) ? 'atrasado' : 'em-dia',
    reports,
  };
}

// client: { id, loja, tipo, analista_id, analista, agenda }
// accounts: array with { ...account, reports: [newest-first] }
function enrichClient(client, accounts, opts = {}) {
  // Referência do "atrasado" = último dia completo (ontem); hoje está em aberto.
  const asOf = opts.asOf || p4.lastCompleteDayISO();
  const contas = (accounts || []).map((a) => enrichAccount(a, asOf, client.agenda));

  const fatLatest = contas.reduce((sum, m) => sum + (m.reports[0]?.faturamento || 0), 0);
  const roasW =
    contas.reduce(
      (sum, m) => sum + (m.reports[0]?.roas || 0) * (m.reports[0]?.faturamento || 0),
      0
    ) / (fatLatest || 1);
  const n = contas.reduce((sum, m) => sum + m.reports.length, 0);
  const last = contas.reduce((a, m) => (m.last && m.last > a ? m.last : a), '0000-00-00');
  // o atraso considera só contas ATIVAS — marketplace encerrado não cobra relatório
  const ativas = contas.filter((m) => m.ativo !== false);
  const baseAtraso = ativas.length ? ativas : contas;
  const lastWorst = baseAtraso.reduce(
    (a, m) => (m.last && m.last < a ? m.last : a),
    '9999-12-31'
  );
  // Status por CICLO: atrasado se QUALQUER conta ativa não gerou relatório no ciclo
  // atual (cada conta já calculou seu status com a agenda do cliente).
  const overdueSched = baseAtraso.some((m) => m.status === 'atrasado');
  const status = overdueSched ? 'atrasado' : 'em-dia';
  // cliente "encerrado" só quando TODAS as contas estão inativas (derivado, não persistido)
  const encerrado = contas.length > 0 && contas.every((m) => m.ativo === false);

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
    encerrado,
  };
}

module.exports = { enrichClient, enrichAccount, reportDate };
