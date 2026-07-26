// dashboardService — métricas de acompanhamento (CS / admin).
const db = require('../db/knex');
const p4 = require('../lib/p4');
const clientService = require('./clientService');
const { byManager, countActiveAccounts } = require('../lib/dashboardAggregates');
const { reportMonth, ratios } = require('../lib/metrics');

// Segunda-feira da semana de uma data ISO (salvo_em em UTC → data no fuso do negócio).
function weekStartISO(isoStr) {
  const day = p4.businessDateISO(isoStr);
  if (!day) return null;
  const d = new Date(day + 'T00:00:00');
  if (isNaN(d)) return null;
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  d.setDate(d.getDate() - dow);
  return p4.localISO(d);
}

async function getDashboard(user) {
  // Clientes enriquecidos (admin/cs => todos). Já trazem status, criadoEm,
  // contas (com status/último), marketplaces, n (nº de relatórios), roasW, etc.
  const { clients: allClients } = await clientService.listClients(user, {});
  // clientes encerrados (todas as contas inativas) não entram nas métricas de acompanhamento
  const clients = allClients.filter((c) => !c.encerrado);
  const reports = await db('reports').select('salvo_em', 'criado_em');

  const today = new Date(p4.todayISO() + 'T00:00:00');
  const dowT = (today.getDay() + 6) % 7;
  const thisMon = new Date(today);
  thisMon.setDate(thisMon.getDate() - dowT);

  // ── relatórios gerados por semana (últimas 12 semanas) ────────────────────
  const weekStarts = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisMon);
    d.setDate(d.getDate() - 7 * i);
    weekStarts.push(p4.localISO(d));
  }
  const byWeek = {};
  for (const r of reports) {
    const w = weekStartISO(r.salvo_em || r.criado_em);
    if (w) byWeek[w] = (byWeek[w] || 0) + 1;
  }
  const reportsByWeek = weekStarts.map((w) => ({ weekStart: w, count: byWeek[w] || 0 }));

  // ── clientes por gestor ───────────────────────────────────────────────────
  // Único ponto do painel que enxerga encerrados: usa `allClients`, não `clients`.
  const clientsByManager = byManager(allClients);

  // ── entrada de clientes por mês ───────────────────────────────────────────
  const byMonth = {};
  for (const c of clients) {
    const m = (c.criadoEm || '').slice(0, 7);
    if (m) byMonth[m] = (byMonth[m] || 0) + 1;
  }
  const entriesByMonth = Object.keys(byMonth).sort().map((m) => ({ month: m, count: byMonth[m] }));

  // ── clientes por marketplace (únicos por cliente) ─────────────────────────
  const mk = {};
  for (const c of clients) {
    for (const m of new Set(c.marketplaces)) mk[m] = (mk[m] || 0) + 1;
  }
  const clientsByMarketplace = p4.AD_MARKETPLACES
    .map((m) => ({ marketplace: m, clients: mk[m] || 0 }))
    .filter((x) => x.clients > 0);

  // ── lista de atrasados ────────────────────────────────────────────────────
  const overdue = clients
    .filter((c) => c.statusTag === 'atrasado')
    .map((c) => {
      const lateContas = (c.contas || [])
        .filter((m) => m.status === 'atrasado')
        .map((m) => ({ marketplace: m.marketplace, conta: m.conta, last: m.last }));
      const ref = c.lastWorst || c.last;
      return {
        clientId: c.id,
        loja: c.loja,
        analista: c.analista,
        agendaLabel: p4.agendaLabel(c.agenda),
        last: c.last,
        lastWorst: c.lastWorst,
        daysLate: ref ? Math.round(p4.daysSince(ref)) : null,
        reason: lateContas.length ? 'marketplace' : 'agenda',
        contas: lateContas.length
          ? lateContas
          : (c.contas || []).map((m) => ({ marketplace: m.marketplace, conta: m.conta, last: m.last })),
      };
    })
    .sort((a, b) => (b.daysLate || 0) - (a.daysLate || 0));

  // ── métricas financeiras por analista, por mês ────────────────────────────
  // Soma faturamento/investimento/receita de Ads dos relatórios das contas
  // ATIVAS (marketplaces encerrados saem, como no resto do painel) e deriva
  // ROAS/ACOS/TACOS ponderados (soma os valores e só então faz a razão).
  const mq = db('reports as r')
    .join('accounts as a', 'a.id', 'r.account_id')
    .join('clients as c', 'c.id', 'a.client_id')
    .leftJoin('users as u', 'u.id', 'c.analista_id')
    .where('a.ativo', true);
  if (user.papel === 'analista') mq.where('c.analista_id', user.id);
  const metricRows = await mq.select(
    'r.periodo_fim', 'r.periodo_ini', 'r.criado_em',
    'r.faturamento', 'r.investimento', 'r.receita_ads',
    'c.id as client_id', 'u.nome as analista'
  );

  const monthsMap = {};
  for (const r of metricRows) {
    const m = reportMonth(r);
    if (!m) continue; // ignora relatórios sem data de período válida
    const nome = r.analista || '—';
    if (!monthsMap[m]) monthsMap[m] = new Map();
    const map = monthsMap[m];
    if (!map.has(nome)) map.set(nome, { analista: nome, faturamento: 0, investimento: 0, receitaAds: 0, nReports: 0, clientes: new Set() });
    const e = map.get(nome);
    e.faturamento += Number(r.faturamento) || 0;
    e.investimento += Number(r.investimento) || 0;
    e.receitaAds += Number(r.receita_ads) || 0;
    e.nReports += 1;
    e.clientes.add(r.client_id);
  }
  const analystMonths = Object.keys(monthsMap).sort().reverse(); // mais recente primeiro
  const analystByMonth = {};
  for (const m of analystMonths) {
    const rows = [...monthsMap[m].values()]
      .map((e) => ({
        analista: e.analista,
        faturamento: e.faturamento,
        investimento: e.investimento,
        receitaAds: e.receitaAds,
        nClientes: e.clientes.size,
        nReports: e.nReports,
        ...ratios(e.faturamento, e.investimento, e.receitaAds),
      }))
      .sort((a, b) => b.faturamento - a.faturamento);
    const s = rows.reduce(
      (acc, r) => {
        acc.faturamento += r.faturamento; acc.investimento += r.investimento; acc.receitaAds += r.receitaAds;
        acc.nClientes += r.nClientes; acc.nReports += r.nReports; return acc;
      },
      { faturamento: 0, investimento: 0, receitaAds: 0, nClientes: 0, nReports: 0 }
    );
    analystByMonth[m] = { rows, total: { analista: 'Total', ...s, ...ratios(s.faturamento, s.investimento, s.receitaAds) } };
  }
  const analystMonthly = { months: analystMonths, byMonth: analystByMonth };

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalClients = clients.length;
  const overdueClients = overdue.length;
  const clientsNoReports = clients.filter((c) => (c.n || 0) === 0).length;
  // contas em operação na carteira viva (encerrada sai, pausada fica)
  const totalAccounts = countActiveAccounts(clients);
  const accountsPerClient = totalClients ? +(totalAccounts / totalClients).toFixed(1) : 0;
  const onTimeRate = totalClients ? Math.round((1 - overdueClients / totalClients) * 100) : 100;
  // pausados/onboarding não são cobrados → fora da contagem "para enviar hoje"
  const dueToday = clients.filter((c) => c.statusTag !== 'pausado' && c.statusTag !== 'onboarding' && p4.isDueOn(c.agenda, p4.todayISO())).length;

  return {
    today: p4.todayISO(),
    totals: {
      totalClients,
      totalAccounts,
      accountsPerClient,
      overdueClients,
      onTimeRate,
      clientsNoReports,
      dueToday,
    },
    reportsByWeek,
    clientsByManager,
    analystMonthly,
    entriesByMonth,
    clientsByMarketplace,
    statusSplit: { emDia: totalClients - overdueClients, atrasado: overdueClients },
    overdue,
  };
}

module.exports = { getDashboard };
