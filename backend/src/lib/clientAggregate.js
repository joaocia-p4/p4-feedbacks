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
// define o atraso (quando o relatório foi feito), não o fim do período. salvo_em
// é gravado em UTC; a comparação usa a data no fuso do negócio (São Paulo), senão
// um relatório gerado à noite conta como do dia seguinte e cai no ciclo errado.
function maxGen(reports) {
  let max = '';
  for (const r of reports || []) {
    const g = r && (r.salvoEm || r.salvo_em || r.criadoEm || r.criado_em || r.periodoFim || r.periodo_fim);
    const d = g ? p4.businessDateISO(g) : null;
    if (d && d > max) max = d;
  }
  return max || null;
}

// Entrega ATRASADA do ciclo anterior: relatório gerado até N dias depois do
// penúltimo envio, cobrindo período que terminou ANTES dele, é a recuperação do
// envio anterior — não pode "cobrir" o ciclo atual.
const RECUPERACAO_DIAS = 3;

// Relatório que COBRE o ciclo atual: gerado dentro do ciclo (data de salvo_em no
// fuso do negócio) E cobrindo um período recente — fim do período a menos de um
// intervalo antes do penúltimo envio. O teste de período impede que reeditar ou
// importar um relatório ANTIGO (salvo_em vira "agora") zere o atraso do ciclo.
function cobreCiclo(r, cicloInicio, fimMin, prevSend, limiteRecuperacao) {
  const g = r && (r.salvoEm || r.salvo_em || r.criadoEm || r.criado_em || r.periodoFim || r.periodo_fim);
  const gen = g ? p4.businessDateISO(g) : null;
  if (!gen || gen < cicloInicio) return false;
  const fim = r.periodoFim || r.periodo_fim || null;
  if (!fim) return true; // sem período = não penaliza
  const f = String(fim).slice(0, 10);
  if (f <= fimMin) return false; // período velho demais (reedição/importação)
  if (f < prevSend && gen <= limiteRecuperacao) return false; // recuperação do ciclo anterior
  return true;
}

// Atraso da conta no ciclo (regra completa, com graças para conta nova e
// para agenda recém-trocada).
function contaAtrasada(agenda, acc, reports, asOf, agendaDesde) {
  const cicloInicio = p4.currentCycleStart(agenda, asOf);
  if (!cicloInicio) return false; // sem agenda suficiente → não cobra
  const ultimoEnvio = p4.prevScheduled(agenda, new Date(asOf + 'T00:00:00'));
  const ultimoEnvioISO = ultimoEnvio ? p4.localISO(ultimoEnvio) : null;
  // Agenda recém-trocada: os "envios anteriores" da agenda nova são fictícios —
  // só cobra atraso depois que o primeiro envio real da agenda nova passar.
  if (agendaDesde && ultimoEnvioISO && ultimoEnvioISO < String(agendaDesde).slice(0, 10)) {
    return false;
  }
  // Conta NOVA (nenhum relatório ainda) só é cobrada se algum envio agendado já
  // passou DEPOIS da entrada dela — quem entrou no dia do último envio (ou depois)
  // não nasce "atrasada". Se um envio passou em branco desde a entrada, cobra.
  // "Entrada" = o mais RECENTE entre dataEntrada e a criação do registro: cadastrar
  // hoje um cliente antigo (dataEntrada retroativa) também merece a graça.
  const dataEntrada = acc.dataEntrada ? String(acc.dataEntrada).slice(0, 10) : null;
  const criadaEm = acc.criadoEm ? p4.businessDateISO(acc.criadoEm) : null;
  const entrada =
    dataEntrada && criadaEm ? (dataEntrada > criadaEm ? dataEntrada : criadaEm) : dataEntrada || criadaEm;
  if (reports.length === 0 && entrada && ultimoEnvioISO && entrada >= ultimoEnvioISO) {
    return false;
  }
  const intervalo = agenda && agenda.freq === 'Mensal' ? 31 : 7;
  const prevSend = p4.localISO(p4.addDays(new Date(cicloInicio + 'T00:00:00'), -1));
  const fimMin = p4.localISO(p4.addDays(new Date(prevSend + 'T00:00:00'), -intervalo));
  const limiteRecuperacao = p4.localISO(
    p4.addDays(new Date(prevSend + 'T00:00:00'), RECUPERACAO_DIAS)
  );
  return !reports.some((r) => cobreCiclo(r, cicloInicio, fimMin, prevSend, limiteRecuperacao));
}

// Shape one account for the API + compute its last date and status (por ciclo).
function enrichAccount(acc, asOf, agenda, agendaDesde) {
  const reports = acc.reports || [];
  const last = reportDate(reports[0]); // fim do período do relatório mais recente (exibição)
  const lastGen = maxGen(reports); // data de geração mais recente (define o atraso)
  const pausado = acc.pausado === true;
  const overdue = contaAtrasada(agenda, acc, reports, asOf, agendaDesde);
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
    // conta encerrada/pausada não cobra → status informativo (nunca "atrasado",
    // senão o chip vermelho aparece em conta que a equipe já fechou/pausou);
    // demais contas seguem a regra de ciclo
    status: acc.ativo === false ? 'encerrada' : pausado ? 'pausado' : (overdue ? 'atrasado' : 'em-dia'),
    reports,
  };
}

// client: { id, loja, tipo, analista_id, analista, agenda }
// accounts: array with { ...account, reports: [newest-first] }
function enrichClient(client, accounts, opts = {}) {
  // Referência do "atrasado" = último dia completo (ontem); hoje está em aberto.
  const asOf = opts.asOf || p4.lastCompleteDayISO();
  const agendaDesde = client.agendaDesde || null; // data da última troca de agenda
  const contas = (accounts || []).map((a) => enrichAccount(a, asOf, client.agenda, agendaDesde));

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
  // usa o status já computado por conta (inclui a graça de conta nova)
  const atrasado = cobraveis.some((m) => m.status === 'atrasado');
  const hoje = p4.todayISO();
  // mesma regra completa das contas, mas com asOf = hoje (o envio de hoje conta)
  const cobraveisRaw = (accounts || []).filter(
    (a) => a.ativo !== false && a.pausado !== true
  );
  const precisaHoje =
    !encerrado && !pausado && !onboarding &&
    p4.isDueOn(client.agenda, hoje) &&
    cobraveisRaw.some((a) => contaAtrasada(client.agenda, a, a.reports || [], hoje, agendaDesde));
  // precedência: Encerrado > Pausado > Onboarding > Atrasado > Enviar hoje > Em dia
  const statusTag = encerrado ? 'encerrado'
    : pausado ? 'pausado'
    : onboarding ? 'onboarding'
    : atrasado ? 'atrasado'
    : precisaHoje ? 'hoje'
    : 'em-dia';
  // compat com consumidores atuais — segue a tag (pausado/onboarding/encerrado
  // não podem exportar status "atrasado" junto com uma tag calma)
  const status = statusTag === 'atrasado' ? 'atrasado' : 'em-dia';
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
    agendaDesde,
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
