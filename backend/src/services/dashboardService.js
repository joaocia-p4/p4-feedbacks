// dashboardService — métricas de acompanhamento (CS / admin).
const db = require('../db/knex');
const p4 = require('../lib/p4');
const clientService = require('./clientService');

// Segunda-feira da semana de uma data ISO.
function weekStartISO(isoStr) {
  if (!isoStr) return null;
  const d = new Date(String(isoStr).slice(0, 10) + 'T00:00:00');
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
  const reportsThisWeek = byWeek[weekStarts[weekStarts.length - 1]] || 0;
  const reportsLastWeek = byWeek[weekStarts[weekStarts.length - 2]] || 0;

  // ── clientes por gestor ───────────────────────────────────────────────────
  const mgr = new Map();
  for (const c of clients) {
    const k = c.analista || '—';
    if (!mgr.has(k)) mgr.set(k, { analista: k, clients: 0, overdue: 0, reports: 0 });
    const e = mgr.get(k);
    e.clients++;
    e.reports += c.n || 0;
    if (c.status === 'atrasado') e.overdue++;
  }
  const clientsByManager = [...mgr.values()].sort((a, b) => b.clients - a.clients);

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
    .filter((c) => c.status === 'atrasado')
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

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalClients = clients.length;
  const overdueClients = overdue.length;
  const clientsNoReports = clients.filter((c) => (c.n || 0) === 0).length;
  const totalReports = reports.length;
  const roasVals = clients.map((c) => c.roasW).filter((v) => v > 0);
  const avgRoas = roasVals.length ? +(roasVals.reduce((a, b) => a + b, 0) / roasVals.length).toFixed(2) : 0;
  const totalRevenue = clients.reduce((a, c) => a + (c.fatLatest || 0), 0);
  const onTimeRate = totalClients ? Math.round((1 - overdueClients / totalClients) * 100) : 100;
  const reportsPerClient = totalClients ? +(totalReports / totalClients).toFixed(1) : 0;
  const dueToday = clients.filter((c) => p4.isDueOn(c.agenda, p4.todayISO())).length;

  return {
    today: p4.todayISO(),
    totals: {
      totalClients,
      overdueClients,
      onTimeRate,
      totalReports,
      reportsThisWeek,
      reportsLastWeek,
      clientsNoReports,
      avgRoas,
      totalRevenue,
      reportsPerClient,
      dueToday,
    },
    reportsByWeek,
    clientsByManager,
    entriesByMonth,
    clientsByMarketplace,
    statusSplit: { emDia: totalClients - overdueClients, atrasado: overdueClients },
    overdue,
  };
}

module.exports = { getDashboard };
