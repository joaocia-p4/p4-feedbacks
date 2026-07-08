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
  const pausado = acc.pausado === true;
  const overdue = p4.isOverdueByCycle(agenda, lastGen, asOf);
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
    pausado,
    motivoPausa: acc.motivoPausa || acc.motivo_pausa || '',
    last,
    lastGen,
    // conta pausada não cobra → status "pausado" (informativo); senão pela regra de ciclo
    status: pausado ? 'pausado' : (overdue ? 'atrasado' : 'em-dia'),
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
  // ── situação e tag do cliente ──
  // Cobram relatório: contas ATIVAS e NÃO pausadas (encerrada/pausada não cobra).
  const situacao = client.situacao || 'ativo';
  const encerrado = contas.length > 0 && contas.every((m) => m.ativo === false);
  const ativas = contas.filter((m) => m.ativo !== false);
  const cobraveis = ativas.filter((m) => !m.pausado);
  const pausadoAll = ativas.length > 0 && ativas.every((m) => m.pausado);
  const pausado = situacao === 'pausado' || pausadoAll;
  const onboarding = situacao === 'onboarding';
  const atrasado = cobraveis.some((m) => p4.isOverdueByCycle(client.agenda, m.lastGen, asOf));
  const hoje = p4.todayISO();
  const precisaHoje =
    !encerrado && !pausado && !onboarding &&
    p4.isDueOn(client.agenda, hoje) &&
    cobraveis.some((m) => p4.isOverdueByCycle(client.agenda, m.lastGen, hoje));
  // precedência: Encerrado > Pausado > Onboarding > Atrasado > Enviar hoje > Em dia
  const statusTag = encerrado ? 'encerrado'
    : pausado ? 'pausado'
    : onboarding ? 'onboarding'
    : atrasado ? 'atrasado'
    : precisaHoje ? 'hoje'
    : 'em-dia';
  const status = atrasado ? 'atrasado' : 'em-dia'; // compat com consumidores atuais
  const lastWorst = (cobraveis.length ? cobraveis : ativas).reduce(
    (a, m) => (m.last && m.last < a ? m.last : a),
    '9999-12-31'
  );

  return {
    id: client.id,
    loja: client.loja,
    tipo: client.tipo,
    analistaId: client.analista_id || client.analistaId,
    analista: client.analista, // resolved name
    agenda: client.agenda,
    criadoEm: client.criadoEm || null,
    observacoes: client.observacoes || '',
    situacao,
    motivoPausa: client.motivoPausa || client.motivo_pausa || '',
    contas,
    marketplaces: contas.map((m) => m.marketplace),
    fatLatest,
    roasW: +roasW.toFixed(2),
    n,
    last: last === '0000-00-00' ? null : last,
    lastWorst: lastWorst === '9999-12-31' ? null : lastWorst,
    pausado,
    onboarding,
    precisaHoje,
    statusTag,
    status,
    encerrado,
  };
}

module.exports = { enrichClient, enrichAccount, reportDate };
